import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Queryable } from '../db/database.js'
import { Errors } from '../lib/errors.js'
import { generateTemporaryPassword, hashPassword } from '../lib/password.js'
import { recordAudit, type ActorType } from './audit.service.js'
import { revokeUserSessions, toAdminUser, USER_COLUMNS, type AdminPrincipal, type AdminUserRow, type AdminUserView } from './admin-auth.service.js'
import { ADMIN_ROLES, type AdminRole } from './admin-permissions.js'
import type { AppContext } from '../context.js'

export const CreateUserSchema = z.strictObject({
  email: z.email().max(200),
  displayName: z.string().trim().min(2).max(80),
  role: z.enum(ADMIN_ROLES),
})

export const PatchUserSchema = z
  .strictObject({
    role: z.enum(ADMIN_ROLES).optional(),
    disabled: z.boolean().optional(),
    resetPassword: z.boolean().optional(),
    resetMfa: z.boolean().optional(),
  })
  .refine((v) => v.role !== undefined || v.disabled !== undefined || v.resetPassword === true || v.resetMfa === true, {
    message: 'Informe ao menos uma alteração.',
    path: ['role'],
  })

export const USER_MESSAGES = {
  email: 'Confira o e-mail.',
  displayName: 'Use um nome entre 2 e 80 caracteres.',
  role: 'Escolha um papel válido.',
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export async function listUsers(ctx: AppContext): Promise<{ items: AdminUserView[] }> {
  const r = await ctx.db.query<AdminUserRow>(`SELECT ${USER_COLUMNS} FROM admin_users u ORDER BY u.disabled_at IS NOT NULL, u.display_name, u.id`)
  return { items: r.rows.map(toAdminUser) }
}

export interface CreatedUser {
  user: AdminUserView
  /** Exibida uma única vez; o banco guarda só o hash. */
  temporaryPassword: string
}

/**
 * Cria uma pessoa usuária com senha temporária aleatória. Primeiro acesso exige cadastrar MFA
 * e trocar a senha. Usado pela API (users:manage) e pela CLI admin-create (primeiro usuário).
 */
export async function createAdminUser(
  db: Queryable,
  now: Date,
  input: { email: string; displayName: string; role: AdminRole },
  actor: { type: ActorType; id: string | null; ipHash?: string | null; via: 'api' | 'cli' },
): Promise<CreatedUser> {
  const email = normalizeEmail(input.email)
  const existing = await db.query('SELECT 1 FROM admin_users WHERE email = $1', [email])
  if (existing.rows[0]) throw Errors.conflict('email_in_use', 'Já existe uma pessoa usuária com este e-mail.')
  const temporaryPassword = generateTemporaryPassword()
  const hash = await hashPassword(temporaryPassword)
  const id = randomUUID()
  let row: AdminUserRow | undefined
  try {
    const r = await db.query<AdminUserRow>(
      `INSERT INTO admin_users AS u (id, email, display_name, role, password_hash, must_change_password,
                                     password_changed_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, true, $6, $6, $6)
       RETURNING ${USER_COLUMNS}`,
      [id, email, input.displayName.trim(), input.role, hash, now],
    )
    row = r.rows[0]
  } catch (err) {
    if ((err as { code?: string }).code === '23505') throw Errors.conflict('email_in_use', 'Já existe uma pessoa usuária com este e-mail.')
    throw err
  }
  await recordAudit(db, {
    actorType: actor.type,
    actorId: actor.id,
    action: 'admin.user_created',
    resourceType: 'admin_user',
    resourceId: id,
    metadata: { role: input.role, via: actor.via },
    ipHash: actor.ipHash ?? null,
  })
  return { user: toAdminUser(row!), temporaryPassword }
}

const LAST_ADMIN_MESSAGE = 'É preciso manter pelo menos uma pessoa ativa com papel de administração.'

export async function updateAdminUser(
  ctx: AppContext,
  principal: AdminPrincipal,
  userId: string,
  change: z.infer<typeof PatchUserSchema>,
  ipHash: string,
): Promise<{ user: AdminUserView; temporaryPassword?: string }> {
  // O hash é calculado fora da transação para não segurar bloqueios durante o scrypt.
  const temporaryPassword = change.resetPassword ? generateTemporaryPassword() : undefined
  const newHash = temporaryPassword ? await hashPassword(temporaryPassword) : undefined

  return ctx.db.transaction(async (tx) => {
    const now = ctx.now()
    const r = await tx.query<AdminUserRow>(`SELECT ${USER_COLUMNS} FROM admin_users u WHERE u.id = $1 FOR UPDATE`, [userId])
    const target = r.rows[0]
    if (!target) throw Errors.notFound('Pessoa usuária não encontrada.')

    const audit = (action: string, metadata: Record<string, unknown> = {}) =>
      recordAudit(tx, {
        actorType: 'admin',
        actorId: principal.user.id,
        action,
        resourceType: 'admin_user',
        resourceId: userId,
        metadata,
        ipHash,
      })

    const isActiveAdmin = target.role === 'admin' && target.disabled_at === null
    const demotes = change.role !== undefined && change.role !== 'admin'
    if (isActiveAdmin && (demotes || change.disabled === true)) {
      // Bloqueia as linhas de administração ativas para evitar corrida entre duas alterações.
      const admins = await tx.query<{ id: string }>(
        "SELECT id FROM admin_users WHERE role = 'admin' AND disabled_at IS NULL FOR UPDATE",
      )
      if (admins.rows.length <= 1) throw Errors.conflict('last_admin', LAST_ADMIN_MESSAGE)
    }

    let endSessions = false
    if (change.role !== undefined && change.role !== target.role) {
      await tx.query('UPDATE admin_users SET role = $2, updated_at = $3 WHERE id = $1', [userId, change.role, now])
      await audit('admin.user_role_changed', { from: target.role, to: change.role })
    }
    if (change.disabled === true && target.disabled_at === null) {
      await tx.query('UPDATE admin_users SET disabled_at = $2, updated_at = $2 WHERE id = $1', [userId, now])
      await audit('admin.user_disabled')
      endSessions = true
    } else if (change.disabled === false && target.disabled_at !== null) {
      await tx.query(
        `UPDATE admin_users SET disabled_at = NULL, failed_login_count = 0, locked_until = NULL, mfa_failed_count = 0,
                mfa_failed_since = NULL, updated_at = $2 WHERE id = $1`,
        [userId, now],
      )
      await audit('admin.user_enabled')
    }
    if (newHash) {
      await tx.query(
        `UPDATE admin_users SET password_hash = $2, must_change_password = true, password_changed_at = $3,
                failed_login_count = 0, locked_until = NULL, mfa_failed_count = 0, mfa_failed_since = NULL, updated_at = $3
          WHERE id = $1`,
        [userId, newHash, now],
      )
      await audit('admin.user_password_reset')
      endSessions = true
    }
    if (change.resetMfa) {
      await tx.query(
        `UPDATE admin_users SET mfa_secret_ciphertext = NULL, mfa_enabled_at = NULL, mfa_last_step = NULL, mfa_failed_count = 0,
                mfa_failed_since = NULL, updated_at = $2 WHERE id = $1`,
        [userId, now],
      )
      await audit('admin.user_mfa_reset')
      endSessions = true
    }
    if (endSessions) {
      const ended = await revokeUserSessions(tx, userId, now)
      if (ended) await audit('admin.user_sessions_ended', { count: ended })
    }

    const fresh = await tx.query<AdminUserRow>(`SELECT ${USER_COLUMNS} FROM admin_users u WHERE u.id = $1`, [userId])
    const user = toAdminUser(fresh.rows[0]!)
    return temporaryPassword ? { user, temporaryPassword } : { user }
  })
}

/** Quantidade de pessoas ativas com papel admin (usado pela CLI para orientar o primeiro acesso). */
export async function countActiveAdmins(db: Queryable): Promise<number> {
  const r = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM admin_users WHERE role = 'admin' AND disabled_at IS NULL")
  return r.rows[0]?.n ?? 0
}
