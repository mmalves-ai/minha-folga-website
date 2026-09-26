import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Queryable } from '../db/database.js'
import { randomToken, sha256Hex } from '../lib/crypto.js'
import { Errors } from '../lib/errors.js'
import { REDACTED_PAYLOAD } from '../jobs/outbox-worker.js'
import { cancelPendingMessages, decryptLeadField, findActiveLead, LeadEventLog, PURPOSES } from '../repositories/leads.repo.js'
import { recordAudit } from './audit.service.js'
import { revokeAllCommunicationTx } from './preferences.service.js'
import { iso, pageParam, pageSizeParam, userRef, type AdminUserRef, type Page } from './admin-common.js'
import { ANONYMIZED_LABEL } from './admin-support.service.js'
import { backfillSupportContactKeys, supportContactKey } from './support.service.js'
import type { AdminPrincipal } from './admin-auth.service.js'
import type { AdminRole } from './admin-permissions.js'
import type { LeadState } from './lead-lifecycle.js'
import type { AppContext } from '../context.js'

export const PRIVACY_STATUSES = ['open', 'in_progress', 'fulfilled', 'rejected'] as const
export const PRIVACY_TYPES = ['access', 'correction', 'deletion', 'revocation', 'opposition', 'portability', 'information', 'other'] as const
export const PRIVACY_ACTIONS = ['revoke_all', 'anonymize_lead', 'suppress_contact'] as const
type PrivacyStatus = (typeof PRIVACY_STATUSES)[number]
type PrivacyType = (typeof PRIVACY_TYPES)[number]
type PrivacyAction = (typeof PRIVACY_ACTIONS)[number]

/** Origem gravada em lead_events/lead_preferences para ações da equipe de privacidade. */
const SOURCE = 'admin_privacy'
const REMOVED_HINT = '—'

export const PrivacyListQuerySchema = z.strictObject({
  status: z.enum(PRIVACY_STATUSES).optional(),
  page: pageParam,
  pageSize: pageSizeParam,
})

export const PrivacyCreateSchema = z.strictObject({
  requestType: z.enum(PRIVACY_TYPES),
  leadId: z.uuid().nullable().optional(),
  supportRequestId: z.uuid().nullable().optional(),
  channel: z.string().trim().min(1).max(60),
  summary: z.string().trim().min(5).max(1000),
  receivedAt: z.iso.datetime({ offset: true }),
})

export const PrivacyPatchSchema = z
  .strictObject({
    status: z.enum(PRIVACY_STATUSES).optional(),
    resolution: z.string().trim().max(1000).optional(),
    action: z.enum(PRIVACY_ACTIONS).optional(),
    confirm: z.boolean().optional(),
  })
  .refine((v) => v.status !== undefined || v.resolution !== undefined || v.action !== undefined, {
    message: 'Informe o status, a resolução ou a ação.',
    path: ['status'],
  })

interface PrivacyRow {
  id: string
  request_type: PrivacyType
  lead_id: string | null
  support_request_id: string | null
  channel: string
  status: PrivacyStatus
  summary: string
  resolution: string | null
  received_at: Date
  fulfilled_at: Date | null
  handler_id: string | null
  handler_name: string | null
  handler_role: AdminRole | null
}

const SELECT_PRIVACY = `SELECT p.id, p.request_type, p.lead_id, p.support_request_id, p.channel, p.status, p.summary,
    p.resolution, p.received_at, p.fulfilled_at, h.id AS handler_id, h.display_name AS handler_name, h.role AS handler_role
  FROM privacy_requests p LEFT JOIN admin_users h ON h.id = p.handled_by`

export interface PrivacyRequestView {
  id: string
  requestType: PrivacyType
  leadId: string | null
  supportRequestId: string | null
  channel: string
  status: PrivacyStatus
  summary: string
  resolution: string | null
  receivedAt: string
  fulfilledAt: string | null
  handledBy: AdminUserRef | null
}

function toView(row: PrivacyRow): PrivacyRequestView {
  return {
    id: row.id,
    requestType: row.request_type,
    leadId: row.lead_id,
    supportRequestId: row.support_request_id,
    channel: row.channel,
    status: row.status,
    summary: row.summary,
    resolution: row.resolution,
    receivedAt: iso(row.received_at)!,
    fulfilledAt: iso(row.fulfilled_at),
    handledBy: userRef(row.handler_id, row.handler_name, row.handler_role),
  }
}

async function loadRequest(db: Queryable, id: string): Promise<PrivacyRequestView> {
  const r = await db.query<PrivacyRow>(`${SELECT_PRIVACY} WHERE p.id = $1`, [id])
  const row = r.rows[0]
  if (!row) throw Errors.notFound('Pedido não encontrado.')
  return toView(row)
}

export async function listPrivacyRequests(ctx: AppContext, query: z.infer<typeof PrivacyListQuerySchema>): Promise<Page<PrivacyRequestView>> {
  const params: unknown[] = []
  let where = ''
  if (query.status) {
    params.push(query.status)
    where = `WHERE p.status = $1`
  }
  const total = await ctx.db.query<{ total: number }>(`SELECT count(*)::int AS total FROM privacy_requests p ${where}`, params)
  const rows = await ctx.db.query<PrivacyRow>(
    `${SELECT_PRIVACY} ${where} ORDER BY p.received_at DESC, p.id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, query.pageSize, (query.page - 1) * query.pageSize],
  )
  return { items: rows.rows.map(toView), total: total.rows[0]?.total ?? 0, page: query.page, pageSize: query.pageSize }
}

export async function createPrivacyRequest(
  ctx: AppContext,
  principal: AdminPrincipal,
  input: z.infer<typeof PrivacyCreateSchema>,
  ipHash: string,
): Promise<PrivacyRequestView> {
  const now = ctx.now()
  const receivedAt = new Date(input.receivedAt)
  if (receivedAt.getTime() > now.getTime() + 5 * 60_000) {
    throw Errors.validation({ receivedAt: 'A data de recebimento não pode estar no futuro.' })
  }
  if (input.leadId) {
    const r = await ctx.db.query('SELECT 1 FROM leads WHERE id = $1', [input.leadId])
    if (!r.rows[0]) throw Errors.validation({ leadId: 'Cadastro não encontrado.' })
  }
  if (input.supportRequestId) {
    const r = await ctx.db.query('SELECT 1 FROM support_requests WHERE id = $1', [input.supportRequestId])
    if (!r.rows[0]) throw Errors.validation({ supportRequestId: 'Solicitação de atendimento não encontrada.' })
  }
  const id = randomUUID()
  return ctx.db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO privacy_requests (id, request_type, lead_id, support_request_id, channel, status, summary, received_at,
                                     handled_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'open', $6, $7, $8, $9, $9)`,
      [id, input.requestType, input.leadId ?? null, input.supportRequestId ?? null, input.channel, input.summary, receivedAt, principal.user.id, now],
    )
    await recordAudit(tx, {
      actorType: 'admin',
      actorId: principal.user.id,
      action: 'admin.privacy_request_created',
      resourceType: 'privacy_request',
      resourceId: id,
      metadata: { requestType: input.requestType, channel: input.channel, linkedLead: Boolean(input.leadId) },
      ipHash,
    })
    return loadRequest(tx, id)
  })
}

// Ações ---------------------------------------------------------------------------------------------

interface ActionCtx {
  ctx: AppContext
  tx: Queryable
  actorId: string
  ipHash: string
  now: Date
}

function adminActor(a: ActionCtx) {
  return { type: 'admin' as const, adminId: a.actorId, ipHash: a.ipHash }
}

interface LockedLead {
  id: string
  state: LeadState
  dedup_key: string
  cpf_key: string | null
  anonymized_at: Date | null
}

async function lockLead(tx: Queryable, leadId: string): Promise<LockedLead> {
  const r = await tx.query<LockedLead>('SELECT id, state, dedup_key, cpf_key, anonymized_at FROM leads WHERE id = $1 FOR UPDATE', [leadId])
  const lead = r.rows[0]
  if (!lead) throw Errors.notFound('Cadastro não encontrado.')
  return lead
}

/**
 * Revoga todas as finalidades pela mesma regra do "sair" do titular (preferences.service): trilha em
 * lead_events, cancelamento de envios pendentes, saída da lista e métricas. Nada é reconcedido aqui.
 */
async function revokeAll(a: ActionCtx, leadId: string): Promise<Record<string, unknown>> {
  const lead = await findActiveLead(a.tx, leadId, { forUpdate: true })
  if (!lead) {
    await lockLead(a.tx, leadId) // 404 quando não existe
    throw Errors.conflict('already_anonymized', 'Este cadastro já foi anonimizado; não há comunicações a revogar.')
  }
  const summary = await revokeAllCommunicationTx(a.ctx, a.tx, lead, adminActor(a), SOURCE, a.now)
  // Pendências de finalidade que já estava revogada também não saem.
  const stragglers = await cancelPendingMessages(a.tx, leadId, PURPOSES, 'revoked_by_privacy_request', a.now)
  return { revokedPurposes: summary.revoked, cancelledStragglers: stragglers }
}

/** Cancela qualquer mensagem pendente do cadastro (supressão vale para todas as finalidades). */
async function cancelAllPending(a: ActionCtx, leadId: string, reason: string): Promise<number> {
  const r = await a.tx.query(
    `UPDATE outbox_messages SET status = 'cancelled', last_error = $3, locked_until = NULL, updated_at = $2
      WHERE lead_id = $1 AND status = 'pending'`,
    [leadId, a.now, reason],
  )
  return r.rowCount
}

const SUPPRESSION_REASON: Partial<Record<PrivacyType, string>> = { deletion: 'deletion_request', opposition: 'opposition' }

/**
 * Supressão pelas chaves de deduplicação ORIGINAIS (telefone e, se houver, CPF): continua valendo depois da
 * anonimização — o mesmo número ou CPF não volta a ser cadastrado pelo site nem pela Bia sem revisão.
 */
async function suppressContact(a: ActionCtx, leadId: string, requestType: PrivacyType): Promise<Record<string, unknown>> {
  const lead = await lockLead(a.tx, leadId)
  if (lead.anonymized_at) {
    throw Errors.conflict(
      'already_anonymized',
      'O cadastro já foi anonimizado e o número não pode mais ser identificado. Registre a supressão antes de anonimizar.',
    )
  }
  const reason = SUPPRESSION_REASON[requestType] ?? 'other'
  const r = await a.tx.query(
    'INSERT INTO suppression_list (dedup_key, reason, created_at) VALUES ($1, $2, $3) ON CONFLICT (dedup_key) DO NOTHING',
    [lead.dedup_key, reason, a.now],
  )
  if (lead.cpf_key) {
    await a.tx.query(
      'INSERT INTO suppression_list (dedup_key, reason, created_at) VALUES ($1, $2, $3) ON CONFLICT (dedup_key) DO NOTHING',
      [lead.cpf_key, reason, a.now],
    )
  }
  const cancelled = await cancelAllPending(a, leadId, 'contact_suppressed')
  return { reason, alreadySuppressed: r.rowCount === 0, documentSuppressed: Boolean(lead.cpf_key), cancelledMessages: cancelled }
}

/**
 * Mensagens de um titular anonimizado: pendentes são canceladas; destinatário e conteúdo cifrados são apagados
 * com o marcador do worker e da retenção (o worker nunca envia um item redigido).
 */
async function scrubOutbox(a: ActionCtx, where: string, param: unknown): Promise<number> {
  const r = await a.tx.query(
    `UPDATE outbox_messages SET status = CASE WHEN status = 'pending' THEN 'cancelled' ELSE status END,
            last_error = CASE WHEN status = 'pending' THEN 'lead_anonymized' ELSE last_error END,
            locked_until = CASE WHEN status = 'pending' THEN NULL ELSE locked_until END,
            recipient_ciphertext = NULL, recipient_key = NULL, payload_ciphertext = $3, updated_at = $2
      WHERE ${where}`,
    [param, a.now, REDACTED_PAYLOAD],
  )
  return r.rowCount
}

/** Anonimiza solicitações de atendimento: remove nome, contato (e a chave dele), mensagem, notas e o link de acompanhamento. */
async function anonymizeSupportRequests(a: ActionCtx, ids: string[]): Promise<string[]> {
  const done: string[] = []
  for (const id of ids) {
    const r = await a.tx.query(
      `UPDATE support_requests SET requester_name = $2, contact_ciphertext = '', contact_hint = $3, contact_key = NULL,
              message_ciphertext = '', tracking_token_hash = $4, anonymized_at = $5, updated_at = $5
        WHERE id = $1 AND anonymized_at IS NULL`,
      [id, ANONYMIZED_LABEL, REMOVED_HINT, sha256Hex(randomToken(32)), a.now],
    )
    if (r.rowCount === 0) continue
    done.push(id)
    await a.tx.query('UPDATE support_events SET note_ciphertext = NULL WHERE support_request_id = $1', [id])
    await scrubOutbox(a, 'support_request_id = $1', id)
  }
  return done
}

/**
 * Todos os atendimentos do titular: os vinculados ao cadastro, o do pedido e qualquer outro com a mesma chave de
 * contato — o número do cadastro (atendimentos pelo site com o mesmo WhatsApp), o e-mail do cadastro (D1) e o
 * contato de cada atendimento já encontrado (vários pedidos pelo site com o mesmo e-mail).
 */
async function supportRequestsOfTitular(
  a: ActionCtx,
  leadId: string | null,
  leadKeys: string[],
  supportRequestId: string | null,
): Promise<string[]> {
  await backfillSupportContactKeys(a.ctx, a.tx)
  const direct = await a.tx.query<{ id: string; contact_key: string | null }>(
    'SELECT id, contact_key FROM support_requests WHERE id = $1 OR ($2::uuid IS NOT NULL AND lead_id = $2::uuid)',
    [supportRequestId, leadId],
  )
  const keys = new Set<string>(leadKeys)
  for (const row of direct.rows) if (row.contact_key) keys.add(row.contact_key)
  const ids = new Set(direct.rows.map((row) => row.id))
  if (keys.size) {
    const byKey = await a.tx.query<{ id: string }>('SELECT id FROM support_requests WHERE contact_key = ANY($1::text[])', [[...keys]])
    for (const row of byKey.rows) ids.add(row.id)
  }
  return [...ids]
}

async function anonymize(a: ActionCtx, leadId: string | null, supportRequestId: string | null): Promise<Record<string, unknown>> {
  let result: Record<string, unknown> = {}
  let originalDedup: string | null = null
  const leadKeys: string[] = []

  if (leadId) {
    const lead = await lockLead(a.tx, leadId)
    if (lead.anonymized_at) throw Errors.conflict('already_anonymized', 'Este cadastro já foi anonimizado.')
    originalDedup = lead.dedup_key
    leadKeys.push(lead.dedup_key)
    const originalCpfKey = lead.cpf_key
    // E-mail do cadastro (D1): alcança atendimentos abertos pelo site com o mesmo e-mail.
    const withEmail = await a.tx.query<{ id: string; email_ciphertext: string | null }>('SELECT id, email_ciphertext FROM leads WHERE id = $1', [leadId])
    const email = withEmail.rows[0] ? decryptLeadField(withEmail.rows[0], 'email', a.ctx.config.secrets.encryption) : null
    if (email) leadKeys.push(supportContactKey(a.ctx, 'email', email))
    // Nome, telefone, CPF, e-mail, empregador e cidade saem; ficam só códigos agregáveis (vínculo, faixas, UF).
    await a.tx.query(
      `UPDATE leads SET preferred_name = $2, full_name = NULL, phone_ciphertext = '', phone_hint = $3, dedup_key = $4,
              cpf_ciphertext = NULL, cpf_hint = NULL, cpf_key = NULL, email_ciphertext = NULL, email_hint = NULL,
              employer_ciphertext = NULL, city = NULL, state = 'unsubscribed', anonymized_at = $5, updated_at = $5
        WHERE id = $1`,
      [leadId, ANONYMIZED_LABEL, REMOVED_HINT, `anon:${leadId}`, a.now],
    )
    // Submissões guardadas para revisão (do cadastro e de qualquer envio com o mesmo telefone ou CPF) e as
    // tentativas do anti-robô com as mesmas chaves.
    const submissions = await a.tx.query(
      'DELETE FROM lead_submissions WHERE lead_id = $1 OR phone_key = $2 OR ($3::text IS NOT NULL AND cpf_key = $3::text)',
      [leadId, originalDedup, originalCpfKey],
    )
    await a.tx.query(
      'DELETE FROM form_attempts WHERE phone_key = $1 OR ($2::text IS NOT NULL AND cpf_key = $2::text)',
      [originalDedup, originalCpfKey],
    )
    await a.tx.query(
      'UPDATE lead_preferences SET granted = false, source = $2, updated_at = $3 WHERE lead_id = $1 AND granted',
      [leadId, SOURCE, a.now],
    )
    const sessions = await a.tx.query('DELETE FROM contact_sessions WHERE lead_id = $1', [leadId])
    const tokens = await a.tx.query('DELETE FROM contact_access_tokens WHERE lead_id = $1', [leadId])
    // Desafios guardam o dedup original e podem ter alterações pendentes cifradas.
    const challenges = await a.tx.query<{ id: string }>(
      'DELETE FROM verification_challenges WHERE lead_id = $1 OR dedup_key = $2 RETURNING id',
      [leadId, originalDedup],
    )
    // Códigos desses desafios podem estar na outbox sem lead_id (novo envio do mesmo número).
    const codes = await scrubOutbox(
      a,
      `kind = 'verification_code' AND idempotency_key LIKE 'verification:%' AND split_part(idempotency_key, ':', 2) = ANY($1::text[])`,
      challenges.rows.map((c) => c.id),
    )
    const outbox = await scrubOutbox(a, 'lead_id = $1', leadId)
    await new LeadEventLog(a.tx, adminActor(a), SOURCE, a.now).add(leadId, {
      type: 'anonymized',
      fromState: lead.state,
      toState: 'unsubscribed',
    })
    result = {
      submissionsDeleted: submissions.rowCount,
      contactSessionsDeleted: sessions.rowCount,
      accessTokensDeleted: tokens.rowCount,
      challengesDeleted: challenges.rowCount,
      outboxScrubbed: outbox + codes,
    }
  }
  const supportIds = await supportRequestsOfTitular(a, leadId, leadKeys, supportRequestId)
  const anonymized = await anonymizeSupportRequests(a, supportIds)
  // Só identificadores: a equipe confere na trilha quais atendimentos foram alcançados.
  result.supportRequestsAnonymized = anonymized.length
  result.supportRequestIds = anonymized
  return result
}

export async function updatePrivacyRequest(
  ctx: AppContext,
  principal: AdminPrincipal,
  id: string,
  patch: z.infer<typeof PrivacyPatchSchema>,
  ipHash: string,
): Promise<PrivacyRequestView> {
  if (patch.action === 'anonymize_lead' && patch.confirm !== true) {
    throw Errors.badRequest('confirmation_required', 'Confirme a anonimização: esta ação não pode ser desfeita.')
  }
  return ctx.db.transaction(async (tx) => {
    const r = await tx.query<{ status: PrivacyStatus; request_type: PrivacyType; lead_id: string | null; support_request_id: string | null }>(
      'SELECT status, request_type, lead_id, support_request_id FROM privacy_requests WHERE id = $1 FOR UPDATE',
      [id],
    )
    const current = r.rows[0]
    if (!current) throw Errors.notFound('Pedido não encontrado.')
    const now = ctx.now()
    const a: ActionCtx = { ctx, tx, actorId: principal.user.id, ipHash, now }

    if (patch.action) {
      const action: PrivacyAction = patch.action
      let outcome: Record<string, unknown>
      let resourceId: string | null = current.lead_id
      if (action === 'anonymize_lead') {
        if (!current.lead_id && !current.support_request_id) {
          throw Errors.badRequest('lead_required', 'Vincule o pedido a um cadastro ou a uma solicitação de atendimento.')
        }
        outcome = await anonymize(a, current.lead_id, current.support_request_id)
        resourceId = current.lead_id ?? current.support_request_id
      } else {
        if (!current.lead_id) throw Errors.badRequest('lead_required', 'Vincule o pedido a um cadastro para aplicar esta ação.')
        outcome = action === 'revoke_all' ? await revokeAll(a, current.lead_id) : await suppressContact(a, current.lead_id, current.request_type)
      }
      await recordAudit(tx, {
        actorType: 'admin',
        actorId: principal.user.id,
        action: `admin.privacy_${action}`,
        resourceType: current.lead_id ? 'lead' : 'support_request',
        resourceId,
        metadata: { privacyRequestId: id, ...outcome },
        ipHash,
      })
    }

    const sets: string[] = ['handled_by = $2', 'updated_at = $3']
    const params: unknown[] = [id, principal.user.id, now]
    if (patch.status !== undefined && patch.status !== current.status) {
      params.push(patch.status)
      sets.push(`status = $${params.length}`)
      sets.push(`fulfilled_at = CASE WHEN $${params.length} = 'fulfilled' THEN $3::timestamptz ELSE NULL END`)
    }
    if (patch.resolution !== undefined) {
      params.push(patch.resolution || null)
      sets.push(`resolution = $${params.length}`)
    }
    await tx.query(`UPDATE privacy_requests SET ${sets.join(', ')} WHERE id = $1`, params)
    await recordAudit(tx, {
      actorType: 'admin',
      actorId: principal.user.id,
      action: 'admin.privacy_request_updated',
      resourceType: 'privacy_request',
      resourceId: id,
      metadata: {
        fromStatus: current.status,
        toStatus: patch.status ?? current.status,
        action: patch.action ?? null,
        resolutionChanged: patch.resolution !== undefined,
      },
      ipHash,
    })
    return loadRequest(tx, id)
  })
}
