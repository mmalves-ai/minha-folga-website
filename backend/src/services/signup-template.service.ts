import type { AppContext } from '../context.js'
import type { Queryable } from '../db/database.js'
import { enqueueMessage } from '../repositories/outbox.repo.js'
import type { LeadRow } from '../repositories/leads.repo.js'
import { ADMIN_TIME_ZONE } from './admin-common.js'
import { incrementMetric } from './metrics.service.js'

/**
 * PLACEHOLDER: agente Hal-AI ainda não provisionado.
 *
 * Template de WhatsApp pela API da Hal-AI depois de um cadastro NOVO feito pelo site (decisão D1). Templates são
 * pagos: um robô preenchendo números aleatórios não pode fazer a Minha Folga pagar mensagens. Por isso o envio só
 * entra na outbox quando TODAS as travas passam:
 *   1. HALAI_SIGNUP_TEMPLATE_ENABLED=true (padrão false) e HALAI_SIGNUP_TEMPLATE definido (config/env.ts também
 *      exige HALAI_ENABLED, HALAI_API_KEY, HALAI_CHANNEL e HALAI_TEMPLATE_DAILY_CAP);
 *   2. o pedido passou pelo anti-robô (quem chama só chega aqui depois de token, prova de trabalho, idade mínima,
 *      campo-armadilha e limites por IP/CPF/telefone) e criou um cadastro novo (submissão sobre cadastro existente
 *      não dispara nada);
 *   3. o aviso de abertura foi autorizado (launch_notice, conferido de novo pelo worker no envio);
 *   4. o número não recebeu template nos últimos 30 dias (outbox_messages.recipient_key = HMAC do telefone);
 *   5. o teto diário global (HALAI_TEMPLATE_DAILY_CAP, dia no horário de Brasília) não foi atingido.
 * O envio é idempotente (uma chave por cadastro) e tem retentativa limitada (MAX_ATTEMPTS). Nada é enviado por
 * padrão. As variáveis do template dependem do modelo aprovado na Hal-AI — hoje só o primeiro nome.
 */
export const SIGNUP_TEMPLATE_LANGUAGE = 'pt_BR'
export const TEMPLATE_COOLDOWN_DAYS = 30
const MAX_ATTEMPTS = 3
const DAY_MS = 24 * 60 * 60 * 1000
/** Serializa a conferência do teto diário entre requisições simultâneas. */
const CAP_LOCK = [7_107_312, 1] as const

export type SignupTemplateOutcome = 'disabled' | 'not_authorized' | 'recent' | 'daily_cap' | 'queued'

export async function maybeQueueSignupTemplate(
  ctx: AppContext,
  tx: Queryable,
  lead: LeadRow,
  phoneE164: string,
  launchNoticeGranted: boolean,
  now: Date,
): Promise<SignupTemplateOutcome> {
  const cfg = ctx.config.halai.signupTemplate
  if (!cfg.enabled || !cfg.name || !cfg.dailyCap || !ctx.halai.configured) return 'disabled'
  if (!launchNoticeGranted) return record(tx, now, 'not_authorized')

  await tx.query('SELECT pg_advisory_xact_lock($1::int, $2::int)', [...CAP_LOCK])
  const recent = await tx.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM outbox_messages
      WHERE kind = 'halai_template' AND recipient_key = $1 AND created_at > $2`,
    [lead.dedup_key, new Date(now.getTime() - TEMPLATE_COOLDOWN_DAYS * DAY_MS)],
  )
  if ((recent.rows[0]?.n ?? 0) > 0) return record(tx, now, 'recent')

  const today = await tx.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM outbox_messages
      WHERE kind = 'halai_template'
        AND created_at >= (date_trunc('day', $1::timestamptz AT TIME ZONE '${ADMIN_TIME_ZONE}') AT TIME ZONE '${ADMIN_TIME_ZONE}')`,
    [now],
  )
  if ((today.rows[0]?.n ?? 0) >= cfg.dailyCap) {
    ctx.logger.warn({ cap: cfg.dailyCap }, 'teto diário de templates da Hal-AI atingido; nada foi enfileirado')
    return record(tx, now, 'daily_cap')
  }

  await enqueueMessage(ctx, tx, {
    kind: 'halai_template',
    channel: 'halai',
    purpose: 'launch_notice',
    leadId: lead.id,
    recipient: phoneE164,
    recipientKey: lead.dedup_key,
    payload: { template: { name: cfg.name, language: SIGNUP_TEMPLATE_LANGUAGE, bodyVariables: [lead.preferred_name] } },
    idempotencyKey: `halai_template:signup:${lead.id}`,
    maxAttempts: MAX_ATTEMPTS,
  })
  return record(tx, now, 'queued')
}

async function record(tx: Queryable, now: Date, outcome: Exclude<SignupTemplateOutcome, 'disabled'>): Promise<SignupTemplateOutcome> {
  await incrementMetric(tx, now, outcome === 'queued' ? 'halai_template_queued' : 'halai_template_withheld', outcome === 'queued' ? 'signup' : outcome)
  return outcome
}
