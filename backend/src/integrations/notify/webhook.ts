import type { AppContext } from '../../context.js'
import { signV1 } from '../halai/signature.js'
import { ProviderError } from '../provider-error.js'

/** Tempo máximo de uma entrega; a outbox reprograma em caso de estouro. */
export const INTERNAL_WEBHOOK_TIMEOUT_MS = 5_000

/**
 * Entrega um evento interno (ex.: nova solicitação de atendimento) ao webhook da equipe.
 * O evento nunca contém dados pessoais nem a mensagem do titular (apenas ids, protocolo, assunto e horários).
 *
 * POST JSON com `X-MF-Timestamp`, `X-MF-Signature` (v1, HMAC-SHA256 com SUPPORT_NOTIFY_WEBHOOK_SECRET sobre
 * "<timestamp>.<corpo>") e `X-MF-Idempotency-Key` (o receptor descarta repetições).
 * Chamado pelo worker da outbox para mensagens channel='webhook':
 * - rede, tempo esgotado, 408, 429 e 5xx → ProviderError retentável;
 * - demais 4xx, redirecionamento ou configuração ausente → ProviderError definitivo.
 * A mensagem de erro não inclui a URL (que pode conter credenciais do destino).
 */
export async function deliverInternalWebhook(
  ctx: AppContext,
  event: Record<string, unknown>,
  idempotencyKey: string,
): Promise<void> {
  const { url, secret } = ctx.config.supportNotify
  if (!url || !secret) throw new ProviderError('Webhook interno não configurado.', false)
  if (ctx.config.isPublicEnvironment && !url.startsWith('https://')) {
    throw new ProviderError('Webhook interno precisa usar HTTPS fora do desenvolvimento.', false)
  }

  const body = JSON.stringify(event)
  const timestamp = String(Math.floor(ctx.now().getTime() / 1000))
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(INTERNAL_WEBHOOK_TIMEOUT_MS),
      headers: {
        'content-type': 'application/json',
        'user-agent': 'minhafolga-notify/1',
        'x-mf-timestamp': timestamp,
        'x-mf-signature': signV1(secret, timestamp, body),
        'x-mf-idempotency-key': idempotencyKey,
      },
      body,
    })
  } catch (err) {
    const timeout = (err as Error)?.name === 'TimeoutError' || (err as Error)?.name === 'AbortError'
    throw new ProviderError(timeout ? 'Webhook interno não respondeu a tempo.' : 'Falha de rede no webhook interno.', true)
  }
  // Corpo da resposta é descartado: não guardamos nem registramos o que o destino devolve.
  await response.body?.cancel().catch(() => undefined)

  const { status } = response
  if (status >= 200 && status < 300) return
  const retryable = status >= 500 || status === 408 || status === 429
  throw new ProviderError(`Webhook interno respondeu ${status}.`, retryable)
}
