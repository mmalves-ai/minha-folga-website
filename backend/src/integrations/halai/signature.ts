import { createHmac } from 'node:crypto'
import { safeEqual } from '../../lib/crypto.js'

/**
 * Esquema de assinatura "v1" da Minha Folga, usado nas duas direções servidor-a-servidor:
 * - entrada (opcional): chamadas da Hal-AI às ferramentas da Bia, quando HALAI_WEBHOOK_SECRET está configurado
 *   (a autenticação principal é X-API-Key — request-auth.ts);
 * - saída: notificação interna de atendimento (segredo SUPPORT_NOTIFY_WEBHOOK_SECRET).
 *
 * Cabeçalhos: `X-MF-Timestamp` (epoch em segundos) e `X-MF-Signature: v1=<hex>`, com
 * hex = HMAC-SHA256(segredo, "<timestamp>.<corpo bruto>"). A janela de tempo limita a reutilização;
 * a proteção contra replay (X-MF-Request-Id) fica em quem recebe.
 */
export const SIGNATURE_TOLERANCE_SECONDS = 300

const V1 = /^v1=([0-9a-f]{64})$/
const TIMESTAMP = /^\d{9,11}$/

export function signV1(secret: string, timestamp: string, body: string | Buffer): string {
  const mac = createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest('hex')
  return `v1=${mac}`
}

export type SignatureCheck =
  | { ok: true; signature: string }
  | { ok: false; code: 'invalid_signature' | 'stale_request' }

export interface VerifyInput {
  secret: string
  timestamp: string | undefined
  /** Aceita uma lista separada por vírgula (rotação de segredo do lado de quem assina). */
  signature: string | undefined
  rawBody: Buffer | string | undefined
  nowSeconds: number
  toleranceSeconds?: number
}

/**
 * Confere assinatura e janela de tempo. A assinatura é conferida antes da janela para que uma
 * requisição forjada nunca receba "stale_request" (que confirmaria o formato aceito).
 */
export function verifyV1(input: VerifyInput): SignatureCheck {
  const { timestamp, signature } = input
  if (!timestamp || !TIMESTAMP.test(timestamp) || !signature || signature.length > 400) {
    return { ok: false, code: 'invalid_signature' }
  }
  const expected = signV1(input.secret, timestamp, input.rawBody ?? '')
  const candidates = signature.split(',').map((s) => s.trim())
  const match = candidates.find((c) => V1.test(c) && safeEqual(c, expected))
  if (!match) return { ok: false, code: 'invalid_signature' }
  const tolerance = input.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS
  if (Math.abs(input.nowSeconds - Number(timestamp)) > tolerance) return { ok: false, code: 'stale_request' }
  return { ok: true, signature: match }
}
