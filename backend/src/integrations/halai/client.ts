import type { AppConfig } from '../../config/index.js'
import { ProviderError } from '../provider-error.js'

/**
 * Cliente de SAÍDA para a API pública da Hal-AI (https://api.halai.com.br/api/v1/docs/).
 *
 * PLACEHOLDER: agente Hal-AI ainda não provisionado. Nada é enviado por padrão — o único uso é o template do
 * cadastro (services/signup-template.service.ts), que só entra na outbox com HALAI_SIGNUP_TEMPLATE_ENABLED=true
 * e depois de todas as travas anti-robô. O WhatsApp em si (número oficial, Bia, filas, templates aprovados) é da
 * Hal-AI (decisão D1, docs/DECISOES.md).
 *
 * Envio de template: POST {HALAI_API_BASE_URL}/api/v1/smart-crm/send-template
 *   Authorization: Bearer hal_…  (HALAI_API_KEY; a API também aceita X-API-Key)
 *   { to, channel, templateName, language, bodyVariables }   — `to` só com dígitos (5511999999999)
 * Envelope: { success: true, data, meta } | { success: false, error: { code, message, details } }.
 *
 * Erros: rede/tempo esgotado, 408, 429 e 5xx → retentáveis; 401/403 (chave ou escopo), demais 4xx, resposta de
 * sucesso sem envelope válido e redirecionamento → definitivos. A mensagem traz só status e código do erro
 * (nunca o corpo, que pode ecoar o número do destinatário).
 */

export const HALAI_SEND_TEMPLATE_PATH = '/api/v1/smart-crm/send-template'
export const HALAI_TIMEOUT_MS = 10_000

export interface HalaiTemplateMessage {
  /** E.164 (+55DDNNNNNNNNN), decifrado pelo worker imediatamente antes do envio. */
  to: string
  templateName: string
  language: string
  /** Variáveis do corpo, na ordem do template aprovado na Hal-AI. */
  bodyVariables: string[]
}

export interface HalaiSendResult {
  providerMessageId: string | null
}

/** Saída para a Hal-AI injetada no contexto (nos testes, um dublê em memória). */
export interface HalaiOutbound {
  /** true quando base, chave e canal estão configurados. */
  readonly configured: boolean
  sendTemplate(message: HalaiTemplateMessage): Promise<HalaiSendResult>
}

export interface HalaiClientOptions {
  baseUrl: string
  apiKey?: string
  channel?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

/** Variáveis de template não aceitam quebras de linha, tabulações nem sequências longas de espaços. */
const cleanVariable = (value: string) => value.replace(/[\r\n\t]+/g, ' ').replace(/ {4,}/g, '   ').slice(0, 1000)

/** Código de erro do envelope, restrito a um identificador (nada de texto livre na trilha). */
function errorCode(body: unknown): string | null {
  const code = (body as { error?: { code?: unknown } } | null)?.error?.code
  return typeof code === 'string' && /^[a-z0-9_.-]{1,64}$/i.test(code) ? code : null
}

function messageIdOf(data: unknown): string | null {
  const d = (data ?? {}) as Record<string, unknown>
  for (const key of ['messageId', 'id', 'wamid']) {
    const v = d[key]
    if (typeof v === 'string' && v.length > 0 && v.length <= 200) return v
  }
  return null
}

export function buildSendTemplateBody(message: HalaiTemplateMessage, channel: string): Record<string, unknown> {
  return {
    to: message.to.replace(/\D/g, ''),
    channel,
    templateName: message.templateName,
    language: message.language,
    bodyVariables: message.bodyVariables.map(cleanVariable),
  }
}

export function createHalaiClient(options: HalaiClientOptions): HalaiOutbound {
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? HALAI_TIMEOUT_MS
  const endpoint = `${options.baseUrl.replace(/\/+$/, '')}${HALAI_SEND_TEMPLATE_PATH}`
  const configured = Boolean(options.baseUrl && options.apiKey && options.channel)

  return {
    configured,
    async sendTemplate(message) {
      if (!configured) throw new ProviderError('halai_not_configured', false)
      let res: Response
      try {
        res = await fetchImpl(endpoint, {
          method: 'POST',
          redirect: 'manual',
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'User-Agent': 'minhafolga-api/1',
          },
          body: JSON.stringify(buildSendTemplateBody(message, options.channel!)),
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch (err) {
        const name = (err as Error)?.name
        throw new ProviderError(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network_error', true)
      }

      const body = (await res.json().catch(() => null)) as { success?: unknown; data?: unknown } | null
      if (res.status >= 200 && res.status < 300) {
        if (body?.success === true) return { providerMessageId: messageIdOf(body.data) }
        const code = errorCode(body)
        throw new ProviderError(`halai_rejected${code ? `:${code}` : ''}`, false)
      }
      const code = errorCode(body)
      const retryable = res.status === 408 || res.status === 429 || res.status >= 500
      throw new ProviderError(`http_${res.status}${code ? `:${code}` : ''}`, retryable)
    },
  }
}

/** Cliente a partir da configuração validada (config/env.ts). */
export function halaiClientFromConfig(config: AppConfig): HalaiOutbound {
  return createHalaiClient({ baseUrl: config.halai.apiBaseUrl, apiKey: config.halai.apiKey, channel: config.halai.channel })
}
