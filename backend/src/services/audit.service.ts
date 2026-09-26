import { randomUUID } from 'node:crypto'
import type { Queryable } from '../db/database.js'

export type ActorType = 'admin' | 'system' | 'titular' | 'agent'

export interface AuditEntry {
  actorType: ActorType
  actorId?: string | null
  action: string
  resourceType?: string | null
  resourceId?: string | null
  /** Nunca incluir telefone, e-mail, nome, mensagem, código ou token. */
  metadata?: Record<string, unknown>
  ipHash?: string | null
}

export async function recordAudit(db: Queryable, entry: AuditEntry): Promise<void> {
  await db.query(
    `INSERT INTO audit_log (id, actor_type, actor_id, action, resource_type, resource_id, metadata, ip_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      randomUUID(),
      entry.actorType,
      entry.actorId ?? null,
      entry.action,
      entry.resourceType ?? null,
      entry.resourceId ?? null,
      JSON.stringify(entry.metadata ?? {}),
      entry.ipHash ?? null,
    ],
  )
}
