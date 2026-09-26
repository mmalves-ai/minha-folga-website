import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Queryable } from '../db/database.js'
import { decryptField, encryptField } from '../lib/crypto.js'
import { Errors } from '../lib/errors.js'
import { recordAudit } from './audit.service.js'
// Contextos de cifragem compartilhados com o atendimento público ('support.contact|message|note:<id>').
import { SUPPORT_CIPHER_CONTEXT } from './support.service.js'
import {
  addDateRange,
  checkRange,
  dateParam,
  iso,
  pageParam,
  pageSizeParam,
  userRef,
  type AdminUserRef,
  type Page,
} from './admin-common.js'
import { ASSIGNABLE_ROLES, type AdminRole } from './admin-permissions.js'
import type { AdminPrincipal } from './admin-auth.service.js'
import type { AppContext } from '../context.js'

export const SUPPORT_STATES = ['received', 'in_progress', 'answered', 'closed'] as const
export type SupportState = (typeof SUPPORT_STATES)[number]

/**
 * Transições permitidas. `closed → in_progress` reabre; `answered → in_progress` retoma quando
 * a resposta não resolveu. Toda mudança gera support_events com responsável e horário.
 */
export const SUPPORT_TRANSITIONS: Record<SupportState, readonly SupportState[]> = {
  received: ['in_progress'],
  in_progress: ['answered'],
  answered: ['in_progress', 'closed'],
  closed: ['in_progress'],
}

export const ANONYMIZED_LABEL = 'Titular anonimizado'
const REMOVED_TEXT = 'Conteúdo removido por anonimização.'

export const SupportQueueQuerySchema = z.strictObject({
  status: z.enum(SUPPORT_STATES).optional(),
  assignee: z.union([z.literal('me'), z.literal('none'), z.uuid()]).optional(),
  from: dateParam.optional(),
  to: dateParam.optional(),
  page: pageParam,
  pageSize: pageSizeParam,
})

export const SupportPatchSchema = z
  .strictObject({
    status: z.enum(SUPPORT_STATES).optional(),
    assigneeId: z.uuid().nullable().optional(),
  })
  .refine((v) => v.status !== undefined || v.assigneeId !== undefined, { message: 'Informe o status ou o responsável.', path: ['status'] })

export const SupportNoteSchema = z.strictObject({
  note: z.string().trim().min(1).max(2000),
  visibleToRequester: z.boolean().default(false),
})

interface RequestRow {
  id: string
  protocol: string
  subject: string
  status: SupportState
  source: string
  contact_method: string
  contact_hint: string
  created_at: Date
  updated_at: Date
  assignee_id: string | null
  assignee_name: string | null
  assignee_role: AdminRole | null
}

const ITEM_COLUMNS = `r.id, r.protocol, r.subject, r.status, r.source, r.contact_method, r.contact_hint, r.created_at, r.updated_at,
  a.id AS assignee_id, a.display_name AS assignee_name, a.role AS assignee_role`

export interface AdminSupportItemView {
  id: string
  protocol: string
  subject: string
  status: SupportState
  source: string
  contactMethod: string
  contactHint: string
  assignee: AdminUserRef | null
  createdAt: string
  updatedAt: string
}

function toItem(row: RequestRow): AdminSupportItemView {
  return {
    id: row.id,
    protocol: row.protocol,
    subject: row.subject,
    status: row.status,
    source: row.source,
    contactMethod: row.contact_method,
    contactHint: row.contact_hint,
    assignee: userRef(row.assignee_id, row.assignee_name, row.assignee_role),
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
  }
}

/** Fila de atendimento (com a dica mascarada do contato). A consulta fica na auditoria, sem dados do titular. */
export async function listSupportQueue(
  ctx: AppContext,
  principal: AdminPrincipal,
  query: z.infer<typeof SupportQueueQuerySchema>,
  ipHash?: string,
): Promise<Page<AdminSupportItemView>> {
  checkRange(query.from, query.to)
  const where: string[] = []
  const params: unknown[] = []
  if (query.status) {
    params.push(query.status)
    where.push(`r.status = $${params.length}`)
  }
  if (query.assignee === 'none') where.push('r.assignee_id IS NULL')
  else if (query.assignee) {
    params.push(query.assignee === 'me' ? principal.user.id : query.assignee)
    where.push(`r.assignee_id = $${params.length}`)
  }
  addDateRange(where, params, 'r.created_at', query.from, query.to)
  const sql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const total = await ctx.db.query<{ total: number }>(`SELECT count(*)::int AS total FROM support_requests r ${sql}`, params)
  const rows = await ctx.db.query<RequestRow>(
    `SELECT ${ITEM_COLUMNS} FROM support_requests r LEFT JOIN admin_users a ON a.id = r.assignee_id ${sql}
      ORDER BY r.created_at DESC, r.id
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, query.pageSize, (query.page - 1) * query.pageSize],
  )
  const result = { items: rows.rows.map(toItem), total: total.rows[0]?.total ?? 0, page: query.page, pageSize: query.pageSize }
  const { page, pageSize, ...filters } = query
  await recordAudit(ctx.db, {
    actorType: 'admin',
    actorId: principal.user.id,
    action: 'admin.support_listed',
    resourceType: 'support_request',
    resourceId: null,
    metadata: { filters, page, pageSize, returned: result.items.length, total: result.total },
    ipHash: ipHash ?? null,
  })
  return result
}

export interface SupportEventView {
  type: string
  fromStatus: string | null
  toStatus: string | null
  note: string | null
  visibleToRequester: boolean
  /** Responsável atribuído no evento `assigned` (null = sem responsável). Acréscimo ao contrato. */
  assignee: AdminUserRef | null
  actor: AdminUserRef | null
  actorType: string
  at: string
}

export interface AdminSupportDetailView extends AdminSupportItemView {
  requesterName: string
  contact: string
  message: string
  firstResponseAt: string | null
  closedAt: string | null
  events: SupportEventView[]
}

/** Detalhe com contato, mensagem e notas decifrados. Não audita (quem chama decide). */
export async function loadSupportDetail(ctx: AppContext, db: Queryable, id: string): Promise<AdminSupportDetailView> {
  const r = await db.query<
    RequestRow & {
      requester_name: string
      contact_ciphertext: string
      message_ciphertext: string
      first_response_at: Date | null
      closed_at: Date | null
      anonymized_at: Date | null
    }
  >(
    `SELECT ${ITEM_COLUMNS}, r.requester_name, r.contact_ciphertext, r.message_ciphertext, r.first_response_at,
            r.closed_at, r.anonymized_at
       FROM support_requests r LEFT JOIN admin_users a ON a.id = r.assignee_id
      WHERE r.id = $1`,
    [id],
  )
  const row = r.rows[0]
  if (!row) throw Errors.notFound('Solicitação não encontrada.')
  const keyring = ctx.config.secrets.encryption
  const anonymized = row.anonymized_at !== null

  const events = await db.query<{
    id: string
    event_type: string
    from_status: string | null
    to_status: string | null
    note_ciphertext: string | null
    visible_to_requester: boolean
    actor_type: string
    created_at: Date
    actor_uid: string | null
    actor_name: string | null
    actor_role: AdminRole | null
    assignee_uid: string | null
    assignee_name: string | null
    assignee_role: AdminRole | null
  }>(
    `SELECT e.id, e.event_type, e.from_status, e.to_status, e.note_ciphertext, e.visible_to_requester, e.actor_type,
            e.created_at, u.id AS actor_uid, u.display_name AS actor_name, u.role AS actor_role,
            g.id AS assignee_uid, g.display_name AS assignee_name, g.role AS assignee_role
       FROM support_events e
       LEFT JOIN admin_users u ON e.actor_type = 'admin' AND u.id::text = e.actor_id
       LEFT JOIN admin_users g ON g.id = e.assignee_id
      WHERE e.support_request_id = $1
      ORDER BY e.created_at, e.id`,
    [id],
  )

  return {
    ...toItem(row),
    requesterName: row.requester_name,
    contact: anonymized ? REMOVED_TEXT : decryptField(row.contact_ciphertext, keyring, SUPPORT_CIPHER_CONTEXT.contact(id)),
    message: anonymized ? REMOVED_TEXT : decryptField(row.message_ciphertext, keyring, SUPPORT_CIPHER_CONTEXT.message(id)),
    firstResponseAt: iso(row.first_response_at),
    closedAt: iso(row.closed_at),
    events: events.rows.map((e) => ({
      type: e.event_type,
      fromStatus: e.from_status,
      toStatus: e.to_status,
      note: e.note_ciphertext ? decryptField(e.note_ciphertext, keyring, SUPPORT_CIPHER_CONTEXT.note(e.id)) : null,
      visibleToRequester: e.visible_to_requester,
      assignee: userRef(e.assignee_uid, e.assignee_name, e.assignee_role),
      actor: userRef(e.actor_uid, e.actor_name, e.actor_role),
      actorType: e.actor_type,
      at: iso(e.created_at)!,
    })),
  }
}

export async function viewSupportRequest(
  ctx: AppContext,
  principal: AdminPrincipal,
  id: string,
  ipHash: string,
): Promise<AdminSupportDetailView> {
  const detail = await loadSupportDetail(ctx, ctx.db, id)
  // Leitura de contato e mensagem decifrados fica registrada.
  await recordAudit(ctx.db, {
    actorType: 'admin',
    actorId: principal.user.id,
    action: 'admin.support_viewed',
    resourceType: 'support_request',
    resourceId: id,
    ipHash,
  })
  return detail
}

async function assertAssignable(db: Queryable, userId: string): Promise<void> {
  const placeholders = ASSIGNABLE_ROLES.map((_, i) => `$${i + 2}`).join(', ')
  const r = await db.query<{ id: string }>(
    `SELECT id FROM admin_users WHERE id = $1 AND disabled_at IS NULL AND role IN (${placeholders})`,
    [userId, ...ASSIGNABLE_ROLES],
  )
  if (!r.rows[0]) throw Errors.validation({ assigneeId: 'Escolha uma pessoa ativa da equipe de atendimento.' })
}

export async function updateSupportRequest(
  ctx: AppContext,
  principal: AdminPrincipal,
  id: string,
  change: z.infer<typeof SupportPatchSchema>,
  ipHash: string,
): Promise<AdminSupportDetailView> {
  const actorId = principal.user.id
  return ctx.db.transaction(async (tx) => {
    const r = await tx.query<{ status: SupportState; assignee_id: string | null }>(
      'SELECT status, assignee_id FROM support_requests WHERE id = $1 FOR UPDATE',
      [id],
    )
    const current = r.rows[0]
    if (!current) throw Errors.notFound('Solicitação não encontrada.')
    const now = ctx.now()
    const changes: Record<string, unknown> = {}

    if (change.assigneeId !== undefined && change.assigneeId !== current.assignee_id) {
      if (change.assigneeId) await assertAssignable(tx, change.assigneeId)
      await tx.query('UPDATE support_requests SET assignee_id = $2, updated_at = $3 WHERE id = $1', [id, change.assigneeId, now])
      await tx.query(
        `INSERT INTO support_events (id, support_request_id, event_type, assignee_id, actor_type, actor_id, created_at)
         VALUES ($1, $2, 'assigned', $3, 'admin', $4, $5)`,
        [randomUUID(), id, change.assigneeId, actorId, now],
      )
      changes.assigneeFrom = current.assignee_id
      changes.assigneeTo = change.assigneeId
    }

    if (change.status !== undefined && change.status !== current.status) {
      if (!SUPPORT_TRANSITIONS[current.status].includes(change.status)) {
        throw Errors.badRequest('invalid_transition', 'Esta mudança de status não é permitida para a solicitação.')
      }
      await tx.query(
        `UPDATE support_requests SET status = $2, updated_at = $3,
                first_response_at = CASE WHEN $2 = 'answered' THEN COALESCE(first_response_at, $3) ELSE first_response_at END,
                closed_at = CASE WHEN $2 = 'closed' THEN $3::timestamptz WHEN status = 'closed' THEN NULL ELSE closed_at END
          WHERE id = $1`,
        [id, change.status, now],
      )
      await tx.query(
        `INSERT INTO support_events (id, support_request_id, event_type, from_status, to_status, actor_type, actor_id, created_at)
         VALUES ($1, $2, 'status_changed', $3, $4, 'admin', $5, $6)`,
        [randomUUID(), id, current.status, change.status, actorId, now],
      )
      changes.fromStatus = current.status
      changes.toStatus = change.status
    }

    if (Object.keys(changes).length) {
      await recordAudit(tx, {
        actorType: 'admin',
        actorId,
        action: 'admin.support_updated',
        resourceType: 'support_request',
        resourceId: id,
        metadata: changes,
        ipHash,
      })
    }
    return loadSupportDetail(ctx, tx, id)
  })
}

export async function addSupportNote(
  ctx: AppContext,
  principal: AdminPrincipal,
  id: string,
  input: z.infer<typeof SupportNoteSchema>,
  ipHash: string,
): Promise<AdminSupportDetailView> {
  return ctx.db.transaction(async (tx) => {
    const r = await tx.query<{ anonymized_at: Date | null }>('SELECT anonymized_at FROM support_requests WHERE id = $1 FOR UPDATE', [id])
    const row = r.rows[0]
    if (!row) throw Errors.notFound('Solicitação não encontrada.')
    if (row.anonymized_at) throw Errors.conflict('support_anonymized', 'Esta solicitação foi anonimizada e não recebe novas notas.')
    const now = ctx.now()
    const eventId = randomUUID()
    await tx.query(
      `INSERT INTO support_events (id, support_request_id, event_type, note_ciphertext, visible_to_requester, actor_type, actor_id, created_at)
       VALUES ($1, $2, $3, $4, $5, 'admin', $6, $7)`,
      [
        eventId,
        id,
        input.visibleToRequester ? 'reply_recorded' : 'note_added',
        encryptField(input.note, ctx.config.secrets.encryption, SUPPORT_CIPHER_CONTEXT.note(eventId)),
        input.visibleToRequester,
        principal.user.id,
        now,
      ],
    )
    await tx.query('UPDATE support_requests SET updated_at = $2 WHERE id = $1', [id, now])
    await recordAudit(tx, {
      actorType: 'admin',
      actorId: principal.user.id,
      action: 'admin.support_note_added',
      resourceType: 'support_request',
      resourceId: id,
      metadata: { visibleToRequester: input.visibleToRequester },
      ipHash,
    })
    return loadSupportDetail(ctx, tx, id)
  })
}

/** Pessoas ativas que podem ser responsáveis por atendimentos. */
export async function listTeam(ctx: AppContext): Promise<{ items: AdminUserRef[] }> {
  const placeholders = ASSIGNABLE_ROLES.map((_, i) => `$${i + 1}`).join(', ')
  const r = await ctx.db.query<{ id: string; display_name: string; role: AdminRole }>(
    `SELECT id, display_name, role FROM admin_users
      WHERE disabled_at IS NULL AND role IN (${placeholders})
      ORDER BY display_name, id`,
    [...ASSIGNABLE_ROLES],
  )
  return { items: r.rows.map((u) => ({ id: u.id, displayName: u.display_name, role: u.role })) }
}
