import type { AppContext } from '../context.js'
import { processPushBatch } from './push-worker.js'
import { deliverInternalWebhook } from '../integrations/notify/webhook.js'
import { ProviderError } from '../integrations/provider-error.js'
import { decryptField } from '../lib/crypto.js'
import { contactDedupKey, isSuppressed } from '../repositories/leads.repo.js'
import type { HalaiTemplatePayload } from '../repositories/outbox.repo.js'
import { incrementMetric } from '../services/metrics.service.js'

/**
 * Worker da outbox de comunicação (decisão D1: este sistema não envia WhatsApp).
 *
 * Canais:
 * - `webhook`: aviso interno de nova solicitação de atendimento (integrations/notify/webhook.ts);
 * - `halai`: PLACEHOLDER do template de cadastro pela API da Hal-AI (integrations/halai/client.ts), só existe na
 *   fila quando HALAI_SIGNUP_TEMPLATE_ENABLED=true e as travas anti-robô passaram;
 * - `whatsapp` (legado, anterior à D1): cancelado sem envio (`whatsapp_removed`).
 *
 * - Lote reclamado de forma segura: `FOR UPDATE SKIP LOCKED` (PostgreSQL com mais de um worker; no PGlite,
 *   conexão única, o comando é o mesmo). Itens reclamados ficam `sending` com `locked_until`.
 * - Itens presos (processo encerrado no meio do envio) voltam para `pending` quando o prazo vence.
 * - Retentativa limitada (`max_attempts`) com backoff exponencial; falha definitiva → `failed`.
 * - No momento do envio conferimos de novo (canal halai): cadastro não anonimizado, contato fora da supressão,
 *   finalidade autorizada e o placeholder ainda ligado. Senão → `cancelled`.
 * - Destinatário e conteúdo só são decifrados aqui, imediatamente antes do envio.
 * - `last_error` e logs nunca contêm telefone, código, nome ou conteúdo.
 */

export interface WorkerHandle {
  stop(): Promise<void>
}

export interface OutboxWorkerOptions {
  intervalMs?: number
  batchSize?: number
}

const LEASE_MS = 5 * 60 * 1000
const BACKOFF_BASE_MS = 30_000
const BACKOFF_MAX_MS = 60 * 60 * 1000
/**
 * Conteúdo apagado assim que a mensagem sai da fila: segredos de uso único (legado) e o template da Hal-AI
 * (variáveis com o primeiro nome do titular).
 */
const SECRET_KINDS = ['verification_code', 'preferences_link', 'halai_template']
export const REDACTED_PAYLOAD = 'redacted'

/** Espera antes da próxima tentativa: 30 s, 1 min, 2 min, 4 min… até 1 h. */
export function backoffMs(attempt: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1))
}

/** Remove de mensagens de erro qualquer coisa que pareça e-mail ou número de telefone. */
export function sanitizeError(message: string): string {
  return message
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/\+?\d[\d\s().-]{6,}\d/g, '[number]')
    .slice(0, 200)
}

interface ClaimedMessage {
  id: string
  kind: string
  channel: 'whatsapp' | 'webhook' | 'halai'
  purpose: 'transactional' | 'launch_notice' | 'marketing' | 'internal'
  lead_id: string | null
  recipient_ciphertext: string | null
  payload_ciphertext: string
  idempotency_key: string
  attempts: number
  max_attempts: number
}

interface Payload {
  template?: HalaiTemplatePayload
  event?: Record<string, unknown>
}

async function recoverStuck(ctx: AppContext, now: Date): Promise<number> {
  const r = await ctx.db.query(
    `UPDATE outbox_messages SET
        status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
        last_error = CASE WHEN attempts >= max_attempts THEN 'lock_expired_max_attempts' ELSE 'lock_expired' END,
        payload_ciphertext = CASE WHEN attempts >= max_attempts AND kind = ANY($2::text[]) THEN $3 ELSE payload_ciphertext END,
        locked_until = NULL, next_attempt_at = $1, updated_at = $1
      WHERE status = 'sending' AND locked_until < $1`,
    [now, SECRET_KINDS, REDACTED_PAYLOAD],
  )
  if (r.rowCount) ctx.logger.warn({ recovered: r.rowCount }, 'outbox: itens presos em envio foram liberados')
  return r.rowCount
}

async function claim(ctx: AppContext, now: Date, limit: number): Promise<ClaimedMessage[]> {
  const r = await ctx.db.query<ClaimedMessage & { created_at: Date }>(
    `UPDATE outbox_messages o
        SET status = 'sending', attempts = o.attempts + 1, locked_until = $2, updated_at = $1
      WHERE o.id IN (
        SELECT id FROM outbox_messages
         WHERE status = 'pending' AND next_attempt_at <= $1
         ORDER BY next_attempt_at, created_at
         LIMIT $3
         FOR UPDATE SKIP LOCKED)
      RETURNING o.id, o.kind, o.channel, o.purpose, o.lead_id, o.recipient_ciphertext, o.payload_ciphertext,
                o.idempotency_key, o.attempts, o.max_attempts, o.created_at`,
    [now, new Date(now.getTime() + LEASE_MS), limit],
  )
  return r.rows.sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
}

async function finish(ctx: AppContext, msg: ClaimedMessage, status: 'failed' | 'cancelled', reason: string): Promise<void> {
  const now = ctx.now()
  await ctx.db.query(
    `UPDATE outbox_messages SET status = $2, last_error = $3, locked_until = NULL, updated_at = $4,
        payload_ciphertext = CASE WHEN kind = ANY($5::text[]) THEN $6 ELSE payload_ciphertext END
      WHERE id = $1 AND status = 'sending'`,
    [msg.id, status, reason, now, SECRET_KINDS, REDACTED_PAYLOAD],
  )
  await incrementMetric(ctx.db, now, status === 'failed' ? 'outbox_failed' : 'outbox_cancelled', msg.kind)
}

async function markSent(ctx: AppContext, msg: ClaimedMessage, providerMessageId: string | null): Promise<void> {
  const now = ctx.now()
  await ctx.db.query(
    `UPDATE outbox_messages SET status = 'sent', sent_at = $2, provider_message_id = $3, last_error = NULL,
        locked_until = NULL, updated_at = $2,
        payload_ciphertext = CASE WHEN kind = ANY($4::text[]) THEN $5 ELSE payload_ciphertext END
      WHERE id = $1 AND status = 'sending'`,
    [msg.id, now, providerMessageId, SECRET_KINDS, REDACTED_PAYLOAD],
  )
  await incrementMetric(ctx.db, now, 'outbox_sent', msg.kind)
}

async function scheduleRetry(ctx: AppContext, msg: ClaimedMessage, reason: string): Promise<void> {
  const now = ctx.now()
  await ctx.db.query(
    `UPDATE outbox_messages SET status = 'pending', next_attempt_at = $2, last_error = $3, locked_until = NULL, updated_at = $4
      WHERE id = $1 AND status = 'sending'`,
    [msg.id, new Date(now.getTime() + backoffMs(msg.attempts)), reason, now],
  )
}

/**
 * Motivo para NÃO enviar pela Hal-AI, conferido no momento do envio (preferência do titular prevalece).
 * O template do cadastro vai para número ainda não validado (é o objetivo dele), então não exige
 * contact_verified_at — por isso só entra na fila depois das travas anti-robô (signup-template.service.ts).
 */
async function blockReason(ctx: AppContext, msg: ClaimedMessage, recipient: string | null): Promise<string | null> {
  if (msg.channel !== 'halai') return null
  if (msg.kind === 'halai_template') {
    const cfg = ctx.config.halai.signupTemplate
    if (!cfg.enabled || !cfg.name) return 'template_disabled'
  }
  if (!recipient) return 'invalid_message'
  if (await isSuppressed(ctx.db, contactDedupKey(recipient, ctx.config.secrets.dedupKey))) return 'contact_suppressed'

  const needsConsent = msg.purpose === 'launch_notice' || msg.purpose === 'marketing'
  if (msg.lead_id) {
    const r = await ctx.db.query<{ anonymized_at: Date | null; granted: boolean | null }>(
      `SELECT l.anonymized_at, p.granted
         FROM leads l LEFT JOIN lead_preferences p ON p.lead_id = l.id AND p.purpose = $2
        WHERE l.id = $1`,
      [msg.lead_id, msg.purpose],
    )
    const lead = r.rows[0]
    if (!lead || lead.anonymized_at) return 'lead_anonymized'
    if (needsConsent && lead.granted !== true) return 'purpose_not_authorized'
  } else if (needsConsent) {
    return 'purpose_not_authorized'
  }
  return null
}

async function deliver(ctx: AppContext, msg: ClaimedMessage): Promise<void> {
  // D1: nada sai por WhatsApp daqui. Itens antigos (códigos, links, avisos) são encerrados sem envio.
  if (msg.channel === 'whatsapp') {
    await finish(ctx, msg, 'cancelled', 'whatsapp_removed')
    return
  }
  const keyring = ctx.config.secrets.encryption
  let recipient: string | null
  let payload: Payload
  try {
    recipient = msg.recipient_ciphertext ? decryptField(msg.recipient_ciphertext, keyring, `outbox.recipient:${msg.id}`) : null
    if (msg.payload_ciphertext === REDACTED_PAYLOAD) throw new Error('payload redigido')
    payload = JSON.parse(decryptField(msg.payload_ciphertext, keyring, `outbox.payload:${msg.id}`)) as Payload
  } catch {
    await finish(ctx, msg, 'failed', 'payload_unavailable')
    return
  }

  const blocked = await blockReason(ctx, msg, recipient)
  if (blocked) {
    await finish(ctx, msg, 'cancelled', blocked)
    return
  }

  try {
    let providerMessageId: string | null = null
    if (msg.channel === 'halai') {
      const template = payload.template
      if (!recipient || !template?.name) {
        await finish(ctx, msg, 'failed', 'invalid_message')
        return
      }
      const result = await ctx.halai.sendTemplate({
        to: recipient,
        templateName: template.name,
        language: template.language,
        bodyVariables: template.bodyVariables ?? [],
      })
      providerMessageId = result.providerMessageId
    } else {
      await deliverInternalWebhook(ctx, payload.event ?? {}, msg.idempotency_key)
    }
    await markSent(ctx, msg, providerMessageId)
  } catch (err) {
    const known = err instanceof ProviderError
    const reason = known ? sanitizeError(err.message) : 'unexpected_error'
    // Erros inesperados também são retentados, sempre dentro do limite de tentativas.
    const retry = (known ? err.retryable : true) && msg.attempts < msg.max_attempts
    if (retry) await scheduleRetry(ctx, msg, reason)
    else await finish(ctx, msg, 'failed', reason)
    ctx.logger.warn({ outboxId: msg.id, kind: msg.kind, attempt: msg.attempts, reason, retry }, 'outbox: envio não concluído')
  }
}

/** Processa um lote de mensagens pendentes (usado pelo loop do worker e pelos testes). Retorna quantas tentou. */
export async function processOutboxBatch(ctx: AppContext, limit = 20): Promise<number> {
  const now = ctx.now()
  await recoverStuck(ctx, now)
  const claimed = await claim(ctx, now, limit)
  for (const msg of claimed) await deliver(ctx, msg)
  return claimed.length
}

/**
 * Loop do worker: intervalo curto, timer `unref` (não segura o processo) e parada graciosa que espera o
 * lote em andamento. Lote cheio continua sem esperar; falhas de banco espaçam as tentativas.
 */
export function startOutboxWorker(ctx: AppContext, options: OutboxWorkerOptions = {}): WorkerHandle {
  const intervalMs = options.intervalMs ?? 1000
  const batchSize = options.batchSize ?? 20
  let stopped = false
  let failures = 0
  let timer: NodeJS.Timeout | undefined
  let running: Promise<void> | undefined

  const schedule = (ms: number) => {
    if (stopped) return
    timer = setTimeout(() => {
      running = tick()
    }, ms)
    timer.unref()
  }

  const tick = async () => {
    let next = intervalMs
    try {
      const processed = await processOutboxBatch(ctx, batchSize)
      const pushed = await processPushBatch(ctx, Math.min(batchSize, 10))
      failures = 0
      if (processed >= batchSize || pushed >= Math.min(batchSize, 10)) next = 0
    } catch (err) {
      failures++
      next = Math.min(60_000, intervalMs * 2 ** Math.min(failures, 6))
      const e = err as { code?: unknown; message?: unknown }
      ctx.logger.error(
        { code: typeof e?.code === 'string' ? e.code : undefined, reason: sanitizeError(String(e?.message ?? 'erro')) },
        'outbox: falha ao processar lote',
      )
    }
    schedule(next)
  }

  schedule(0)
  return {
    async stop() {
      stopped = true
      if (timer) clearTimeout(timer)
      await running
    },
  }
}
