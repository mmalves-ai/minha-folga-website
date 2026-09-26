import { z } from 'zod'
import { createECDH } from 'node:crypto'
import { isValidCnpj } from '../lib/cnpj.js'

/**
 * Esquema único da configuração do backend.
 *
 * Regras de publicação (NODE_ENV=staging|production):
 * - identidade empresarial e canais obrigatórios precisam estar preenchidos com dados reais;
 * - segredos (inclusive os de integração) precisam ter tamanho mínimo, não podem ser marcadores e não se repetem;
 * - a API escuta só em loopback (HOST 127.0.0.1 ou ::1), atrás do servidor web;
 * - PGlite (desenvolvimento) é recusado.
 *
 * Decisão D1 (docs/DECISOES.md): este sistema não envia WhatsApp. A Hal-AI (Bia, número oficial, webchat e
 * templates) chama as APIs daqui com X-API-Key (HALAI_INBOUND_API_KEY); a saída para a Hal-AI é só o
 * placeholder de template do cadastro, desligado por padrão (HALAI_SIGNUP_TEMPLATE_ENABLED=false).
 *
 * Nenhum valor daqui é enviado ao navegador, exceto a lista permitida de `public.ts`.
 */

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1')

const optionalString = z
  .string()
  .trim()
  .transform((v) => (v === '' ? undefined : v))
  .optional()

/** Vazio no arquivo de ambiente = não informado. */
const blankAsUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v)

const PLACEHOLDER = /[<>]|\b(todo|changeme|placeholder|exemplo|example|xxx+)\b/i

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(0).max(65535),
  TRUST_PROXY: z.string().default('loopback'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  /**
   * Interruptor do formulário de cadastro do SITE (ataque de robôs, volume anormal). `false` fecha o formulário e o
   * painel não consegue reabrir. A Bia (telefone atestado) e o pedido de saída continuam. O painel também pausa
   * sem reiniciar a API (collection-switch.service.ts).
   */
  WAITLIST_FORM_ENABLED: bool.default(true),

  CREDIT_PHASE: z.enum(['PRE_LAUNCH', 'PILOT', 'LIVE']).default('PRE_LAUNCH'),
  CREDIT_OPERATIONS_ENABLED: bool.default(false),

  PUBLIC_SITE_URL: z.url(),
  ALLOWED_ORIGINS: optionalString,

  LEGAL_ENTITY_NAME: optionalString,
  LEGAL_ENTITY_TRADE_NAME: optionalString,
  LEGAL_ENTITY_CNPJ: optionalString,
  LEGAL_ENTITY_ADDRESS: optionalString,
  PRIVACY_CONTACT: optionalString,
  PRIVACY_OFFICER_NAME: optionalString,
  SUPPORT_CONTACT: optionalString,
  SUPPORT_PHONE: optionalString,
  SUPPORT_HOURS: optionalString,
  SUPPORT_RESPONSE_TIME: optionalString,
  HUMAN_SUPPORT_ENABLED: bool.default(false),

  /** Número oficial do WhatsApp hospedado na Hal-AI (botão flutuante do site, wa.me). */
  WHATSAPP_BUSINESS_NUMBER: optionalString,

  /** Entrada: a Bia (Hal-AI) chama /api/agent/* com X-API-Key = HALAI_INBOUND_API_KEY. */
  HALAI_ENABLED: bool.default(false),
  HALAI_INBOUND_API_KEY: optionalString,
  /** Opcional: com ele configurado, as chamadas da Bia também precisam da assinatura v1 (X-MF-Signature). */
  HALAI_WEBHOOK_SECRET: optionalString,
  /** Saída (placeholder): API pública da Hal-AI para envio de template. */
  HALAI_API_BASE_URL: z.preprocess(blankAsUndefined, z.url().default('https://api.halai.com.br')),
  HALAI_API_KEY: optionalString,
  HALAI_CHANNEL: optionalString,
  HALAI_SIGNUP_TEMPLATE: optionalString,
  HALAI_SIGNUP_TEMPLATE_ENABLED: bool.default(false),
  HALAI_TEMPLATE_DAILY_CAP: z.preprocess(blankAsUndefined, z.coerce.number().int().min(1).max(100_000).optional()),
  /** Widget de webchat da Hal-AI (placeholder; carregado no site só depois do clique). */
  HALAI_WEBCHAT_ENABLED: bool.default(false),
  HALAI_WEBCHAT_SCRIPT_URL: optionalString,
  HALAI_WEBCHAT_WIDGET_ID: optionalString,

  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),

  SUPPORT_NOTIFY_WEBHOOK_URL: optionalString,
  SUPPORT_NOTIFY_WEBHOOK_SECRET: optionalString,

  CONTACT_ENCRYPTION_KEY: z.string().min(1),
  CONTACT_DEDUP_HMAC_KEY: z.string().min(1),
  SESSION_SECRET: z.string().min(1),
  READINESS_TOKEN: optionalString,

  ANALYTICS_ENABLED: bool.default(false),
  WEB_PUSH_ENABLED: bool.default(false),
  WEB_PUSH_VAPID_PUBLIC_KEY: optionalString,
  WEB_PUSH_VAPID_PRIVATE_KEY: optionalString,
  WEB_PUSH_VAPID_SUBJECT: optionalString,
  WEB_PUSH_DAILY_CAMPAIGN_CAP: z.coerce.number().int().min(1).max(20).default(3),
  COOKIE_SECURE: bool.default(true),
  WORKER_MODE: z.enum(['inline', 'separate']).default('inline'),
})

export type RawEnv = z.infer<typeof EnvSchema>

/**
 * Variáveis que deixaram de existir com a decisão D1 (WhatsApp saiu deste sistema). São ignoradas; a API avisa
 * no log ao iniciar para que o arquivo de ambiente seja limpo (sem mostrar valores).
 */
export const OBSOLETE_KEYS = [
  'MESSAGE_PROVIDER',
  'MESSAGE_PROVIDER_SECRET',
  'WHATSAPP_CLOUD_PHONE_NUMBER_ID',
  'WHATSAPP_CLOUD_API_VERSION',
  'WHATSAPP_TEMPLATE_VERIFICATION',
  'WHATSAPP_TEMPLATE_PREFERENCES_LINK',
  'WHATSAPP_TEMPLATE_LAUNCH_NOTICE',
  'WHATSAPP_TEMPLATE_MARKETING',
  'WHATSAPP_TEMPLATE_SUPPORT_REPLY',
  'WHATSAPP_TEMPLATE_LANGUAGE',
  'MESSAGE_WEBHOOK_SECRET',
  'MESSAGE_WEBHOOK_VERIFY_TOKEN',
  'DEV_MESSAGE_LOG_FILE',
  'HALAI_BASE_URL',
  'HALAI_API_SECRET',
] as const

/** Mesma regra do site (frontend/src/components/site/channels.ts): o navegador recusa o que fugir dela. */
const WIDGET_ID = /^[A-Za-z0-9_-]{1,128}$/

export interface ConfigIssue {
  key: string
  message: string
}

const IDENTITY_KEYS = [
  'LEGAL_ENTITY_NAME',
  'LEGAL_ENTITY_CNPJ',
  'LEGAL_ENTITY_ADDRESS',
  'PRIVACY_CONTACT',
  'PRIVACY_OFFICER_NAME',
  'SUPPORT_CONTACT',
  'SUPPORT_HOURS',
] as const satisfies readonly (keyof RawEnv)[]

export function identityIssues(env: RawEnv): ConfigIssue[] {
  const issues: ConfigIssue[] = []
  for (const key of IDENTITY_KEYS) {
    const value = env[key]
    if (!value) issues.push({ key, message: 'obrigatório para publicação (dado real validado)' })
    else if (PLACEHOLDER.test(value)) issues.push({ key, message: 'parece um marcador, não um dado real' })
  }
  if (env.LEGAL_ENTITY_CNPJ && !isValidCnpj(env.LEGAL_ENTITY_CNPJ)) {
    issues.push({ key: 'LEGAL_ENTITY_CNPJ', message: 'CNPJ com dígitos verificadores inválidos' })
  }
  return issues
}

/** Validações que não cabem no esquema campo a campo. */
export function crossFieldIssues(env: RawEnv): ConfigIssue[] {
  const issues: ConfigIssue[] = []
  const publicEnv = env.NODE_ENV === 'production' || env.NODE_ENV === 'staging'

  if (env.CREDIT_PHASE === 'PRE_LAUNCH' && env.CREDIT_OPERATIONS_ENABLED) {
    issues.push({
      key: 'CREDIT_OPERATIONS_ENABLED',
      message: 'não pode ser true em PRE_LAUNCH; a habilitação financeira exige PILOT ou LIVE',
    })
  }
  if (env.WHATSAPP_BUSINESS_NUMBER && !/^\+55\d{10,11}$/.test(env.WHATSAPP_BUSINESS_NUMBER)) {
    issues.push({ key: 'WHATSAPP_BUSINESS_NUMBER', message: 'use o formato E.164, por exemplo +55DDNNNNNNNNN' })
  }
  // Entrada da Bia: sem chave configurada, nenhuma ferramenta responde (e a API não inicia com HALAI_ENABLED=true).
  if (env.HALAI_ENABLED && !env.HALAI_INBOUND_API_KEY) {
    issues.push({ key: 'HALAI_INBOUND_API_KEY', message: 'obrigatório quando HALAI_ENABLED=true' })
  }
  // Placeholder do template de cadastro: só liga com o agente provisionado e toda a configuração de saída.
  if (env.HALAI_SIGNUP_TEMPLATE_ENABLED) {
    if (!env.HALAI_ENABLED) {
      issues.push({ key: 'HALAI_SIGNUP_TEMPLATE_ENABLED', message: 'exige HALAI_ENABLED=true (agente da Hal-AI provisionado)' })
    }
    for (const key of ['HALAI_API_KEY', 'HALAI_CHANNEL', 'HALAI_SIGNUP_TEMPLATE', 'HALAI_TEMPLATE_DAILY_CAP'] as const) {
      if (env[key] === undefined) issues.push({ key, message: 'obrigatório quando HALAI_SIGNUP_TEMPLATE_ENABLED=true' })
    }
  }
  if (env.HALAI_WEBCHAT_ENABLED) {
    for (const key of ['HALAI_WEBCHAT_SCRIPT_URL', 'HALAI_WEBCHAT_WIDGET_ID'] as const) {
      if (!env[key]) issues.push({ key, message: 'obrigatório quando HALAI_WEBCHAT_ENABLED=true' })
    }
  }
  // Sempre HTTPS, também em desenvolvimento: o site não carrega o widget por HTTP.
  if (env.HALAI_WEBCHAT_SCRIPT_URL && !isHttpUrl(env.HALAI_WEBCHAT_SCRIPT_URL, true)) {
    issues.push({ key: 'HALAI_WEBCHAT_SCRIPT_URL', message: 'use uma URL HTTPS completa' })
  }
  if (env.HALAI_WEBCHAT_WIDGET_ID && !WIDGET_ID.test(env.HALAI_WEBCHAT_WIDGET_ID)) {
    issues.push({ key: 'HALAI_WEBCHAT_WIDGET_ID', message: 'use só letras, números, _ e - (até 128 caracteres)' })
  }
  if (publicEnv && !env.HALAI_API_BASE_URL.startsWith('https://')) {
    issues.push({ key: 'HALAI_API_BASE_URL', message: 'precisa usar HTTPS em homologação e produção' })
  }
  if (env.SUPPORT_NOTIFY_WEBHOOK_URL && !env.SUPPORT_NOTIFY_WEBHOOK_SECRET) {
    issues.push({ key: 'SUPPORT_NOTIFY_WEBHOOK_SECRET', message: 'obrigatório quando SUPPORT_NOTIFY_WEBHOOK_URL é informado' })
  }

  if (env.WEB_PUSH_ENABLED) {
    for (const key of ['WEB_PUSH_VAPID_PUBLIC_KEY', 'WEB_PUSH_VAPID_PRIVATE_KEY', 'WEB_PUSH_VAPID_SUBJECT'] as const) {
      if (!env[key]) issues.push({ key, message: 'obrigatório quando WEB_PUSH_ENABLED=true' })
    }
  }
  if (env.WEB_PUSH_VAPID_PUBLIC_KEY || env.WEB_PUSH_VAPID_PRIVATE_KEY) {
    try {
      const privateKey = env.WEB_PUSH_VAPID_PRIVATE_KEY ?? ''
      const publicKey = env.WEB_PUSH_VAPID_PUBLIC_KEY ?? ''
      if (!/^[A-Za-z0-9_-]{43}$/.test(privateKey) || !/^[A-Za-z0-9_-]{87}$/.test(publicKey)) throw new Error()
      const pair = createECDH('prime256v1')
      pair.setPrivateKey(Buffer.from(privateKey, 'base64url'))
      if (pair.getPublicKey().toString('base64url') !== publicKey) throw new Error()
    } catch {
      issues.push({ key: 'WEB_PUSH_VAPID_PUBLIC_KEY', message: 'informe um par VAPID P-256 válido e correspondente' })
    }
  }
  if (env.WEB_PUSH_VAPID_SUBJECT && !/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.WEB_PUSH_VAPID_SUBJECT) && !isHttpUrl(env.WEB_PUSH_VAPID_SUBJECT, true)) {
    issues.push({ key: 'WEB_PUSH_VAPID_SUBJECT', message: 'use mailto: com contato válido ou URL HTTPS da organização' })
  }

  const secretKeys = CORE_SECRET_KEYS
  for (const key of secretKeys) {
    if (PLACEHOLDER.test(env[key])) issues.push({ key, message: 'marcador de documentação; gere um segredo real' })
  }
  if (env.CONTACT_ENCRYPTION_KEY === env.CONTACT_DEDUP_HMAC_KEY) {
    issues.push({ key: 'CONTACT_DEDUP_HMAC_KEY', message: 'precisa ser distinta de CONTACT_ENCRYPTION_KEY' })
  }
  if (Buffer.byteLength(env.SESSION_SECRET) < 32) {
    issues.push({ key: 'SESSION_SECRET', message: 'use pelo menos 32 bytes aleatórios' })
  }
  if (Buffer.byteLength(env.CONTACT_DEDUP_HMAC_KEY) < 32) {
    issues.push({ key: 'CONTACT_DEDUP_HMAC_KEY', message: 'use pelo menos 32 bytes aleatórios' })
  }

  if (publicEnv) {
    issues.push(...identityIssues(env))
    if (!env.PUBLIC_SITE_URL.startsWith('https://')) {
      issues.push({ key: 'PUBLIC_SITE_URL', message: 'precisa usar HTTPS em homologação e produção' })
    }
    if (!/^postgres(ql)?:\/\//.test(env.DATABASE_URL)) {
      issues.push({ key: 'DATABASE_URL', message: 'homologação e produção exigem PostgreSQL dedicado' })
    }
    if (!env.COOKIE_SECURE) {
      issues.push({ key: 'COOKIE_SECURE', message: 'cookies precisam ser Secure fora do desenvolvimento' })
    }
    if (!env.READINESS_TOKEN || env.READINESS_TOKEN.length < 24) {
      issues.push({ key: 'READINESS_TOKEN', message: 'obrigatório (24+ caracteres) para a verificação interna de prontidão' })
    }
    if (!isLoopbackHost(env.HOST)) {
      issues.push({ key: 'HOST', message: 'em homologação e produção a API escuta só em loopback (127.0.0.1 ou ::1), atrás do servidor web' })
    }
    issues.push(...integrationSecretIssues(env))
  }
  return issues
}

const CORE_SECRET_KEYS = ['CONTACT_ENCRYPTION_KEY', 'CONTACT_DEDUP_HMAC_KEY', 'SESSION_SECRET'] as const

/**
 * Segredos de integração, conferidos em homologação e produção quando informados:
 * - gerados pela equipe (autenticam chamadas de entrada ou assinam avisos internos): 32+ bytes;
 * - emitidos pelo fornecedor (credenciais de saída): 16+ bytes, o mínimo de qualquer token real.
 * Em todos: nada de marcador de documentação, e nenhum segredo pode repetir outro.
 */
const INTEGRATION_SECRETS: ReadonlyArray<{ key: keyof RawEnv; minBytes: number }> = [
  { key: 'HALAI_INBOUND_API_KEY', minBytes: 32 },
  { key: 'HALAI_WEBHOOK_SECRET', minBytes: 32 },
  { key: 'SUPPORT_NOTIFY_WEBHOOK_SECRET', minBytes: 32 },
  { key: 'HALAI_API_KEY', minBytes: 16 },
]

function isHttpUrl(value: string, httpsOnly: boolean): boolean {
  try {
    const url = new URL(value)
    return httpsOnly ? url.protocol === 'https:' : url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase()
  return h === 'localhost' || h === '::1' || h === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(h)
}

function integrationSecretIssues(env: RawEnv): ConfigIssue[] {
  const issues: ConfigIssue[] = []
  for (const { key, minBytes } of INTEGRATION_SECRETS) {
    const value = env[key]
    if (typeof value !== 'string' || !value) continue
    if (PLACEHOLDER.test(value)) issues.push({ key, message: 'marcador de documentação; use o segredo real' })
    else if (Buffer.byteLength(value) < minBytes) issues.push({ key, message: `use pelo menos ${minBytes} bytes aleatórios` })
  }
  // Um mesmo valor em dois lugares faz o vazamento de uma integração abrir as outras.
  const seen = new Map<string, string>()
  for (const key of [...CORE_SECRET_KEYS, ...INTEGRATION_SECRETS.map((s) => s.key)]) {
    const value = env[key]
    if (typeof value !== 'string' || !value) continue
    const first = seen.get(value)
    if (first) issues.push({ key, message: `precisa ser distinto de ${first}` })
    else seen.set(value, key)
  }
  return issues
}
