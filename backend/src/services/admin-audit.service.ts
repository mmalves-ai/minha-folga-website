import { z } from 'zod'
import { addDateRange, checkRange, dateParam, iso, pageParam, pageSizeParam, userRef, type AdminUserRef, type Page } from './admin-common.js'
import type { AdminRole } from './admin-permissions.js'
import type { AppContext } from '../context.js'

export const AuditQuerySchema = z.strictObject({
  action: z.string().trim().min(1).max(80).optional(),
  actorId: z.string().trim().min(1).max(64).optional(),
  from: dateParam.optional(),
  to: dateParam.optional(),
  page: pageParam,
  pageSize: pageSizeParam,
})

export interface AuditEntryView {
  id: string
  actorType: string
  actor: AdminUserRef | null
  action: string
  resourceType: string | null
  resourceId: string | null
  metadata: Record<string, unknown>
  at: string
}

/** Trilha de auditoria, mais recente primeiro. `metadata` nunca contém contato ou mensagem. */
export async function listAudit(ctx: AppContext, query: z.infer<typeof AuditQuerySchema>): Promise<Page<AuditEntryView>> {
  checkRange(query.from, query.to)
  const where: string[] = []
  const params: unknown[] = []
  if (query.action) {
    params.push(query.action)
    where.push(`a.action = $${params.length}`)
  }
  if (query.actorId) {
    params.push(query.actorId)
    where.push(`a.actor_id = $${params.length}`)
  }
  addDateRange(where, params, 'a.created_at', query.from, query.to)
  const sql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const total = await ctx.db.query<{ total: number }>(`SELECT count(*)::int AS total FROM audit_log a ${sql}`, params)
  const rows = await ctx.db.query<{
    id: string
    actor_type: string
    action: string
    resource_type: string | null
    resource_id: string | null
    metadata: Record<string, unknown> | string | null
    created_at: Date
    uid: string | null
    display_name: string | null
    role: AdminRole | null
  }>(
    `SELECT a.id, a.actor_type, a.action, a.resource_type, a.resource_id, a.metadata, a.created_at,
            u.id AS uid, u.display_name, u.role
       FROM audit_log a LEFT JOIN admin_users u ON a.actor_type = 'admin' AND u.id::text = a.actor_id
       ${sql}
      ORDER BY a.created_at DESC, a.id
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, query.pageSize, (query.page - 1) * query.pageSize],
  )
  return {
    items: rows.rows.map((r) => ({
      id: r.id,
      actorType: r.actor_type,
      actor: userRef(r.uid, r.display_name, r.role),
      action: r.action,
      resourceType: r.resource_type,
      resourceId: r.resource_id,
      metadata: typeof r.metadata === 'string' ? (JSON.parse(r.metadata) as Record<string, unknown>) : (r.metadata ?? {}),
      at: iso(r.created_at)!,
    })),
    total: total.rows[0]?.total ?? 0,
    page: query.page,
    pageSize: query.pageSize,
  }
}
