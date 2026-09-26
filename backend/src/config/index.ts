import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { parseKeyring, type Keyring } from '../lib/crypto.js'
import { crossFieldIssues, EnvSchema, identityIssues, OBSOLETE_KEYS, type ConfigIssue, type RawEnv } from './env.js'

export type CreditPhase = RawEnv['CREDIT_PHASE']
export type NodeEnvName = RawEnv['NODE_ENV']

export interface AppConfig {
  env: NodeEnvName
  isPublicEnvironment: boolean
  host: string
  port: number
  trustProxy: string
  logLevel: string
  credit: { phase: CreditPhase; operationsEnabled: boolean }
  siteUrl: string
  allowedOrigins: string[]
  identity: {
    legalName?: string
    tradeName: string
    cnpj?: string
    address?: string
    privacyContact?: string
    privacyOfficerName?: string
    supportContact?: string
    supportPhone?: string
    supportHours?: string
    supportResponseTime?: string
    complete: boolean
    missing: string[]
  }
  humanSupport: { enabled: boolean }
  /** Número oficial do WhatsApp hospedado na Hal-AI (botão do site). Este sistema não envia WhatsApp (D1). */
  whatsapp: { businessNumber?: string }
  halai: {
    /** Entrada: ferramentas da Bia em /api/agent/*. */
    enabled: boolean
    inboundApiKey?: string
    /** Opcional: quando configurado, a assinatura v1 também é exigida. */
    webhookSecret?: string
    /** Saída (placeholder): API pública da Hal-AI. */
    apiBaseUrl: string
    apiKey?: string
    channel?: string
    signupTemplate: { enabled: boolean; name?: string; dailyCap?: number }
    webchat: { enabled: boolean; scriptUrl?: string; widgetId?: string }
  }
  database: { url: string; poolMax: number }
  supportNotify: { url?: string; secret?: string }
  secrets: { encryption: Keyring; dedupKey: Buffer; sessionSecret: Buffer; readinessToken?: string }
  analyticsEnabled: boolean
  webPush: { enabled: boolean; publicKey?: string; privateKey?: string; subject?: string; dailyCampaignCap: number }
  cookieSecure: boolean
  workerMode: RawEnv['WORKER_MODE']
  /**
   * `waitlistEnabled`: cadastro possível pela configuração (vale para o site e para a Bia). `siteFormEnabled`: além
   * disso, o formulário do site não foi fechado por `WAITLIST_FORM_ENABLED=false`. A pausa pelo painel é lida em
   * tempo de execução (collection-switch.service.ts).
   */
  collection: { waitlistEnabled: boolean; siteFormEnabled: boolean; supportEnabled: boolean; reasons: string[] }
  /** Variáveis obsoletas presentes na fonte (só os nomes), para aviso no log. */
  obsoleteKeys: string[]
}

export class ConfigError extends Error {
  readonly issues: ConfigIssue[]
  constructor(issues: ConfigIssue[]) {
    super(
      'Configuração inválida:\n' + issues.map((i) => `  - ${i.key}: ${i.message}`).join('\n'),
    )
    this.name = 'ConfigError'
    this.issues = issues
  }
}

export interface LoadConfigOptions {
  /** Fonte explícita (testes). */
  source?: Record<string, string | undefined>
  /** Arquivo de ambiente explícito. Quando informado, é a ÚNICA fonte (não herda variáveis de outros projetos). */
  envFile?: string
}

export function readEnvSource(options: LoadConfigOptions = {}): Record<string, string | undefined> {
  if (options.source) return options.source
  const envFile = options.envFile ?? process.env.MF_ENV_FILE
  if (envFile) return parseEnv(readFileSync(envFile, 'utf8')) as Record<string, string>
  return process.env
}

export function parseRawEnv(source: Record<string, string | undefined>): RawEnv {
  const known = Object.keys(EnvSchema.shape)
  const picked: Record<string, string> = {}
  for (const key of known) {
    const v = source[key]
    if (v !== undefined) picked[key] = v
  }
  const parsed = EnvSchema.safeParse(picked)
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((i) => ({ key: String(i.path[0] ?? '?'), message: i.message })),
    )
  }
  return parsed.data
}

export function loadConfig(options: LoadConfigOptions = {}): AppConfig {
  const source = readEnvSource(options)
  const raw = parseRawEnv(source)
  const obsoleteKeys = OBSOLETE_KEYS.filter((key) => source[key] !== undefined && source[key] !== '')
  const issues = crossFieldIssues(raw)

  let encryption: Keyring | undefined
  try {
    encryption = parseKeyring(raw.CONTACT_ENCRYPTION_KEY)
  } catch (err) {
    issues.push({ key: 'CONTACT_ENCRYPTION_KEY', message: (err as Error).message })
  }
  if (issues.length || !encryption) throw new ConfigError(issues)

  const missingIdentity = identityIssues(raw).map((i) => i.key)
  const identityComplete = missingIdentity.length === 0
  const isPublicEnvironment = raw.NODE_ENV === 'production' || raw.NODE_ENV === 'staging'

  const reasons: string[] = []
  // D1: o cadastro não depende mais de canal de mensagens (não há confirmação por código); em ambientes públicos
  // depende só da identidade empresarial, que o aviso de privacidade exige.
  if (isPublicEnvironment && !identityComplete) reasons.push('identity_incomplete')
  const waitlistEnabled = reasons.length === 0
  const supportEnabled = !(isPublicEnvironment && !identityComplete)

  const siteUrl = raw.PUBLIC_SITE_URL.replace(/\/$/, '')
  const allowedOrigins = (raw.ALLOWED_ORIGINS ?? siteUrl)
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean)

  return {
    env: raw.NODE_ENV,
    isPublicEnvironment,
    host: raw.HOST,
    port: raw.PORT,
    trustProxy: raw.TRUST_PROXY,
    logLevel: raw.LOG_LEVEL,
    credit: { phase: raw.CREDIT_PHASE, operationsEnabled: raw.CREDIT_OPERATIONS_ENABLED },
    siteUrl,
    allowedOrigins,
    identity: {
      legalName: raw.LEGAL_ENTITY_NAME,
      tradeName: raw.LEGAL_ENTITY_TRADE_NAME ?? 'Minha Folga',
      cnpj: raw.LEGAL_ENTITY_CNPJ,
      address: raw.LEGAL_ENTITY_ADDRESS,
      privacyContact: raw.PRIVACY_CONTACT,
      privacyOfficerName: raw.PRIVACY_OFFICER_NAME,
      supportContact: raw.SUPPORT_CONTACT,
      supportPhone: raw.SUPPORT_PHONE,
      supportHours: raw.SUPPORT_HOURS,
      supportResponseTime: raw.SUPPORT_RESPONSE_TIME,
      complete: identityComplete,
      missing: missingIdentity,
    },
    humanSupport: { enabled: raw.HUMAN_SUPPORT_ENABLED },
    whatsapp: { businessNumber: raw.WHATSAPP_BUSINESS_NUMBER },
    halai: {
      enabled: raw.HALAI_ENABLED,
      inboundApiKey: raw.HALAI_INBOUND_API_KEY,
      webhookSecret: raw.HALAI_WEBHOOK_SECRET,
      apiBaseUrl: raw.HALAI_API_BASE_URL.replace(/\/+$/, ''),
      apiKey: raw.HALAI_API_KEY,
      channel: raw.HALAI_CHANNEL,
      signupTemplate: {
        enabled: raw.HALAI_SIGNUP_TEMPLATE_ENABLED,
        name: raw.HALAI_SIGNUP_TEMPLATE,
        dailyCap: raw.HALAI_TEMPLATE_DAILY_CAP,
      },
      webchat: {
        enabled: raw.HALAI_WEBCHAT_ENABLED && Boolean(raw.HALAI_WEBCHAT_SCRIPT_URL && raw.HALAI_WEBCHAT_WIDGET_ID),
        scriptUrl: raw.HALAI_WEBCHAT_SCRIPT_URL,
        widgetId: raw.HALAI_WEBCHAT_WIDGET_ID,
      },
    },
    database: { url: raw.DATABASE_URL, poolMax: raw.DATABASE_POOL_MAX },
    supportNotify: { url: raw.SUPPORT_NOTIFY_WEBHOOK_URL, secret: raw.SUPPORT_NOTIFY_WEBHOOK_SECRET },
    secrets: {
      encryption,
      dedupKey: Buffer.from(raw.CONTACT_DEDUP_HMAC_KEY),
      sessionSecret: Buffer.from(raw.SESSION_SECRET),
      readinessToken: raw.READINESS_TOKEN,
    },
    analyticsEnabled: raw.ANALYTICS_ENABLED,
    webPush: {
      enabled: raw.WEB_PUSH_ENABLED,
      publicKey: raw.WEB_PUSH_VAPID_PUBLIC_KEY,
      privateKey: raw.WEB_PUSH_VAPID_PRIVATE_KEY,
      subject: raw.WEB_PUSH_VAPID_SUBJECT,
      dailyCampaignCap: raw.WEB_PUSH_DAILY_CAMPAIGN_CAP,
    },
    cookieSecure: raw.COOKIE_SECURE,
    workerMode: raw.WORKER_MODE,
    collection: { waitlistEnabled, siteFormEnabled: waitlistEnabled && raw.WAITLIST_FORM_ENABLED, supportEnabled, reasons },
    obsoleteKeys,
  }
}
