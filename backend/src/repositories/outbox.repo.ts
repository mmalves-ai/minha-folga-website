import { randomUUID } from 'node:crypto'
import type { Queryable } from '../db/database.js'
import { encryptField } from '../lib/crypto.js'
import type { AppContext } from '../context.js'

/**
 * Outbox de comunicação (decisão D1: este sistema não envia WhatsApp). Usos atuais:
 * - `support_notification` (canal `webhook`): aviso interno de nova solicitação de atendimento;
 * - `halai_template` (canal `halai`): PLACEHOLDER do template de cadastro pela API da Hal-AI, desligado por padrão.
 * Itens antigos do canal `whatsapp` (códigos, links, avisos) são cancelados pelo worker.
 */
export type OutboxKind = 'support_notification' | 'halai_template'
export type OutboxChannel = 'webhook' | 'halai'

export interface HalaiTemplatePayload {
  name: string
  language: string
  bodyVariables: string[]
}

export interface EnqueueMessage {
  kind: OutboxKind
  channel: OutboxChannel
  purpose: 'transactional' | 'launch_notice' | 'marketing' | 'internal'
  leadId?: string | null
  supportRequestId?: string | null
  /** E.164 para a Hal-AI; ausente para webhook interno. Cifrado antes de gravar. */
  recipient?: string | null
  /** HMAC do telefone (chave de deduplicação): limite de um template por número em 30 dias. */
  recipientKey?: string | null
  /** Conteúdo do envio (template ou evento interno). Cifrado antes de gravar. */
  payload: { template?: HalaiTemplatePayload; event?: Record<string, unknown> }
  idempotencyKey: string
  maxAttempts?: number
}

/**
 * Grava a mensagem na outbox dentro da transação do evento que a originou.
 * O envio real é feito pelo worker (jobs/outbox-worker.ts) com retentativa limitada e idempotência.
 * Chave de idempotência repetida não duplica a mensagem.
 */
export async function enqueueMessage(ctx: AppContext, tx: Queryable, msg: EnqueueMessage): Promise<string | null> {
  const id = randomUUID()
  const keyring = ctx.config.secrets.encryption
  const r = await tx.query<{ id: string }>(
    `INSERT INTO outbox_messages
       (id, kind, channel, purpose, lead_id, support_request_id, recipient_ciphertext, recipient_key, payload_ciphertext,
        idempotency_key, status, max_attempts, next_attempt_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', $11, $12, $12, $12)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [
      id,
      msg.kind,
      msg.channel,
      msg.purpose,
      msg.leadId ?? null,
      msg.supportRequestId ?? null,
      msg.recipient ? encryptField(msg.recipient, keyring, `outbox.recipient:${id}`) : null,
      msg.recipientKey ?? null,
      encryptField(JSON.stringify(msg.payload), keyring, `outbox.payload:${id}`),
      msg.idempotencyKey,
      msg.maxAttempts ?? 5,
      ctx.now(),
    ],
  )
  return r.rows[0]?.id ?? null
}
