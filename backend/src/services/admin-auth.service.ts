import QRCode from 'qrcode'
import type { Queryable } from '../db/database.js'
import { decryptField, encryptField, randomToken, sha256Hex } from '../lib/crypto.js'
import { AppError, Errors } from '../lib/errors.js'
import { hashPassword, passwordPolicyError, verifyAgainstDummy, verifyPassword } from '../lib/password.js'
import { generateTotpSecret, otpauthUrl, verifyTotp } from '../lib/totp.js'
import { recordAudit } from './audit.service.js'
import { permissionsFor, type AdminPermission, type AdminRole } from './admin-permissions.js'
import type { AppContext } from '../context.js'

/** Regras de sessão e bloqueio da área administrativa. */
export const SESSION_ABSOLUTE_MS = 8 * 60 * 60 * 1000
export const SESSION_IDLE_MS = 30 * 60 * 1000
/** Sessão parcial (senha correta, MFA pendente) dura pouco. */
export const PARTIAL_SESSION_MS = 15 * 60 * 1000
export const MAX_FAILED_ATTEMPTS = 5
export const LOCK_MS = 15 * 60 * 1000
/** Janela do contador de falhas de MFA (por conta, independente de novos logins). */
export const MFA_FAILURE_WINDOW_MS = 15 * 60 * 1000

export const INVALID_CREDENTIALS_MESSAGE = 'E-mail ou senha incorretos.'

export interface AdminUserRow {
  id: string
  email: string
  display_name: string
  role: AdminRole
  password_hash: string
  must_change_password: boolean
  mfa_secret_ciphertext: string | null
  mfa_enabled_at: Date | null
  mfa_last_step: number | null
  failed_login_count: number
  locked_until: Date | null
  disabled_at: Date | null
  last_login_at: Date | null
  created_at: Date
}

export const USER_COLUMNS = `u.id, u.email, u.display_name, u.role, u.password_hash, u.must_change_password,
  u.mfa_secret_ciphertext, u.mfa_enabled_at, u.mfa_last_step, u.failed_login_count, u.locked_until,
  u.disabled_at, u.last_login_at, u.created_at`

export interface AdminUserView {
  id: string
  email: string
  displayName: string
  role: AdminRole
  mfaEnabled: boolean
  mustChangePassword: boolean
  disabled: boolean
  lastLoginAt: string | null
  createdAt: string
}

export function toAdminUser(row: AdminUserRow): AdminUserView {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    mfaEnabled: row.mfa_enabled_at !== null,
    mustChangePassword: row.must_change_password,
    disabled: row.disabled_at !== null,
    lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
  }
}

export interface RequestMeta {
  ipHash?: string
  userAgent?: string
}

/** Pessoa autenticada na requisição atual (anexada por middleware/admin-auth.ts). */
export interface AdminPrincipal {
  sessionHash: string
  csrfToken: string
  mfaVerified: boolean
  user: AdminUserRow
  permissions: ReadonlySet<AdminPermission>
}

export type LoginStep = { status: 'mfa_required' | 'mfa_setup_required'; csrfToken: string }

export interface SessionView {
  status: 'authenticated'
  user: AdminUserView
  permissions: AdminPermission[]
  csrfToken: string
}

export function loginStep(principal: AdminPrincipal): LoginStep {
  return {
    status: principal.user.mfa_enabled_at ? 'mfa_required' : 'mfa_setup_required',
    csrfToken: principal.csrfToken,
  }
}

export function sessionView(principal: AdminPrincipal): SessionView {
  return {
    status: 'authenticated',
    user: toAdminUser(principal.user),
    permissions: [...principal.permissions],
    csrfToken: principal.csrfToken,
  }
}

/** Concessão nominal consultada a cada requisição: revogar tem efeito na próxima ação. */
async function effectivePermissions(db: Queryable, role: AdminRole, userId: string): Promise<Set<AdminPermission>> {
  const permissions = new Set(permissionsFor(role))
  if (role !== 'admin') {
    const grant = await db.query('SELECT user_id FROM push_grants WHERE user_id = $1', [userId])
    if (grant.rowCount) permissions.add('notifications:send')
  }
  return permissions
}

export function mfaContext(userId: string): string {
  return `admin.mfa:${userId}`
}

// Sessões ------------------------------------------------------------------------------------------

export interface IssuedSession {
  token: string
  csrfToken: string
  maxAgeMs: number
}

async function createSession(
  ctx: AppContext,
  db: Queryable,
  userId: string,
  mfaVerified: boolean,
  meta: RequestMeta,
): Promise<IssuedSession> {
  const token = randomToken(32)
  const csrfToken = randomToken(32)
  const now = ctx.now()
  const maxAgeMs = mfaVerified ? SESSION_ABSOLUTE_MS : PARTIAL_SESSION_MS
  await db.query(
    `INSERT INTO admin_sessions (id_hash, user_id, csrf_token, mfa_verified_at, created_at, last_seen_at, expires_at, ip_hash, user_agent)
     VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8)`,
    [
      sha256Hex(token),
      userId,
      csrfToken,
      mfaVerified ? now : null,
      now,
      new Date(now.getTime() + maxAgeMs),
      meta.ipHash ?? null,
      meta.userAgent ? meta.userAgent.slice(0, 160) : null,
    ],
  )
  return { token, csrfToken, maxAgeMs }
}

/** Encerra sessões de uma pessoa (todas ou todas menos a atual). */
export async function revokeUserSessions(db: Queryable, userId: string, now: Date, exceptHash?: string): Promise<number> {
  const r = await db.query(
    `UPDATE admin_sessions SET revoked_at = $2
      WHERE user_id = $1 AND revoked_at IS NULL AND ($3::text IS NULL OR id_hash <> $3)`,
    [userId, now, exceptHash ?? null],
  )
  return r.rowCount
}

export async function revokeSession(db: Queryable, sessionHash: string, now: Date): Promise<void> {
  await db.query('UPDATE admin_sessions SET revoked_at = $2 WHERE id_hash = $1 AND revoked_at IS NULL', [sessionHash, now])
}

/**
 * Lê a sessão pelo token do cookie. Aplica validade absoluta, ociosidade e conta desativada;
 * sessões vencidas são encerradas. Atualiza o último uso.
 */
export async function loadSession(ctx: AppContext, token: string): Promise<AdminPrincipal | null> {
  const hash = sha256Hex(token)
  const r = await ctx.db.query<
    AdminUserRow & { csrf_token: string; mfa_verified_at: Date | null; last_seen_at: Date; expires_at: Date }
  >(
    `SELECT s.csrf_token, s.mfa_verified_at, s.last_seen_at, s.expires_at, ${USER_COLUMNS}
       FROM admin_sessions s JOIN admin_users u ON u.id = s.user_id
      WHERE s.id_hash = $1 AND s.revoked_at IS NULL`,
    [hash],
  )
  const row = r.rows[0]
  if (!row) return null
  const now = ctx.now()
  const expired =
    new Date(row.expires_at).getTime() <= now.getTime() ||
    now.getTime() - new Date(row.last_seen_at).getTime() > SESSION_IDLE_MS ||
    row.disabled_at !== null
  if (expired) {
    await revokeSession(ctx.db, hash, now)
    return null
  }
  await ctx.db.query('UPDATE admin_sessions SET last_seen_at = $2 WHERE id_hash = $1', [hash, now])
  const { csrf_token, mfa_verified_at, last_seen_at: _seen, expires_at: _exp, ...user } = row
  return {
    sessionHash: hash,
    csrfToken: csrf_token,
    mfaVerified: mfa_verified_at !== null,
    user,
    permissions: await effectivePermissions(ctx.db, user.role, user.id),
  }
}

// Primeiro fator -----------------------------------------------------------------------------------

function invalidCredentials(): AppError {
  return new AppError(401, 'invalid_credentials', INVALID_CREDENTIALS_MESSAGE)
}

/**
 * Bloqueia a conta por 15 minutos: encerra sessões parciais (senha certa, MFA pendente) e registra na auditoria.
 * Os contadores de falha voltam a zero para a próxima janela.
 */
async function lockAccount(ctx: AppContext, userId: string, meta: RequestMeta, kind: 'password' | 'mfa', now: Date): Promise<void> {
  await ctx.db.query(
    `UPDATE admin_users SET locked_until = $3, failed_login_count = 0, mfa_failed_count = 0, mfa_failed_since = NULL, updated_at = $2
      WHERE id = $1`,
    [userId, now, new Date(now.getTime() + LOCK_MS)],
  )
  await ctx.db.query(
    'UPDATE admin_sessions SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL AND mfa_verified_at IS NULL',
    [userId, now],
  )
  await recordAudit(ctx.db, {
    actorType: 'system',
    action: 'admin.account_locked',
    resourceType: 'admin_user',
    resourceId: userId,
    metadata: { after: kind, minutes: LOCK_MS / 60_000 },
    ipHash: meta.ipHash ?? null,
  })
}

/**
 * Falha de senha. Na quinta falha seguida, bloqueia a conta por 15 minutos e encerra sessões parciais.
 * Retorna true quando a conta acabou de ser bloqueada. Senha correta zera este contador (e só este).
 */
async function registerPasswordFailure(ctx: AppContext, userId: string, meta: RequestMeta): Promise<boolean> {
  const now = ctx.now()
  const r = await ctx.db.query<{ failed_login_count: number }>(
    'UPDATE admin_users SET failed_login_count = failed_login_count + 1, updated_at = $2 WHERE id = $1 RETURNING failed_login_count',
    [userId, now],
  )
  if ((r.rows[0]?.failed_login_count ?? 0) < MAX_FAILED_ATTEMPTS) return false
  await lockAccount(ctx, userId, meta, 'password', now)
  return true
}

/**
 * Falha de código TOTP, com contador PRÓPRIO por conta: no máximo MAX_FAILED_ATTEMPTS códigos errados a cada
 * MFA_FAILURE_WINDOW_MS, some quantos logins com senha correta houver no meio. A quinta falha da janela bloqueia
 * a conta. Só um código aceito (ou a janela vencida) zera o contador; o primeiro fator nunca zera.
 */
async function registerMfaFailure(ctx: AppContext, userId: string, meta: RequestMeta): Promise<boolean> {
  const now = ctx.now()
  const windowStart = new Date(now.getTime() - MFA_FAILURE_WINDOW_MS)
  const r = await ctx.db.query<{ mfa_failed_count: number }>(
    `UPDATE admin_users SET
        mfa_failed_count = CASE WHEN mfa_failed_since IS NULL OR mfa_failed_since <= $3 THEN 1 ELSE mfa_failed_count + 1 END,
        mfa_failed_since = CASE WHEN mfa_failed_since IS NULL OR mfa_failed_since <= $3 THEN $2 ELSE mfa_failed_since END,
        updated_at = $2
      WHERE id = $1
      RETURNING mfa_failed_count`,
    [userId, now, windowStart],
  )
  if ((r.rows[0]?.mfa_failed_count ?? 0) < MAX_FAILED_ATTEMPTS) return false
  await lockAccount(ctx, userId, meta, 'mfa', now)
  return true
}

const isLocked = (user: Pick<AdminUserRow, 'locked_until'>, now: Date) =>
  Boolean(user.locked_until && new Date(user.locked_until).getTime() > now.getTime())

const tooManyAttempts = () => new AppError(429, 'rate_limited', 'Muitas tentativas. Aguarde alguns minutos e entre novamente.')

export async function login(ctx: AppContext, email: string, password: string, meta: RequestMeta): Promise<IssuedSession & LoginStep> {
  const normalized = email.trim().toLowerCase()
  const r = await ctx.db.query<AdminUserRow>(`SELECT ${USER_COLUMNS} FROM admin_users u WHERE u.email = $1`, [normalized])
  const user = r.rows[0]
  const audit = (reason: string, userId?: string) =>
    recordAudit(ctx.db, {
      actorType: 'system',
      action: 'admin.login_failed',
      resourceType: userId ? 'admin_user' : null,
      resourceId: userId ?? null,
      metadata: { reason },
      ipHash: meta.ipHash ?? null,
    })

  if (!user) {
    await verifyAgainstDummy(password)
    await audit('unknown_account')
    throw invalidCredentials()
  }
  // Sempre calcula o hash, mesmo para conta bloqueada ou desativada: mesmo custo, mesma resposta.
  const ok = await verifyPassword(user.password_hash, password)
  const now = ctx.now()
  if (user.disabled_at) {
    await audit('disabled', user.id)
    throw invalidCredentials()
  }
  if (isLocked(user, now)) {
    await audit('locked', user.id)
    throw invalidCredentials()
  }
  if (!ok) {
    await audit('wrong_password', user.id)
    await registerPasswordFailure(ctx, user.id, meta)
    throw invalidCredentials()
  }

  // Zera só o contador da senha: as falhas de MFA seguem contando na janela delas.
  await ctx.db.query('UPDATE admin_users SET failed_login_count = 0, locked_until = NULL, updated_at = $2 WHERE id = $1', [user.id, now])
  const session = await createSession(ctx, ctx.db, user.id, false, meta)
  await recordAudit(ctx.db, {
    actorType: 'admin',
    actorId: user.id,
    action: 'admin.login_password_ok',
    resourceType: 'admin_user',
    resourceId: user.id,
    ipHash: meta.ipHash ?? null,
  })
  return { ...session, status: user.mfa_enabled_at ? 'mfa_required' : 'mfa_setup_required' }
}

// Segundo fator ------------------------------------------------------------------------------------

export interface MfaSetupResult {
  secret: string
  otpauthUrl: string
  qrSvg: string
}

/** Gera (ou regenera, enquanto não confirmado) o segredo TOTP, guardado cifrado. */
export async function startMfaSetup(ctx: AppContext, principal: AdminPrincipal, meta: RequestMeta): Promise<MfaSetupResult> {
  if (principal.user.mfa_enabled_at) {
    throw Errors.conflict('mfa_already_enabled', 'O aplicativo autenticador já está cadastrado para esta conta.')
  }
  const secret = generateTotpSecret()
  const url = otpauthUrl(secret, principal.user.email)
  const qrSvg = await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 })
  await ctx.db.query(
    'UPDATE admin_users SET mfa_secret_ciphertext = $2, mfa_last_step = NULL, updated_at = $3 WHERE id = $1 AND mfa_enabled_at IS NULL',
    [principal.user.id, encryptField(secret, ctx.config.secrets.encryption, mfaContext(principal.user.id)), ctx.now()],
  )
  await recordAudit(ctx.db, {
    actorType: 'admin',
    actorId: principal.user.id,
    action: 'admin.mfa_setup_started',
    resourceType: 'admin_user',
    resourceId: principal.user.id,
    ipHash: meta.ipHash ?? null,
  })
  return { secret, otpauthUrl: url, qrSvg }
}

/**
 * Confere o código TOTP. Em caso de sucesso conclui o cadastro do MFA (se pendente), grava o passo
 * usado (impede reuso) e troca a sessão parcial por uma sessão completa com novo token.
 */
export async function completeMfa(
  ctx: AppContext,
  principal: AdminPrincipal,
  code: string,
  meta: RequestMeta,
): Promise<{ session: IssuedSession; view: SessionView }> {
  const user = principal.user
  if (!user.mfa_secret_ciphertext) {
    throw Errors.badRequest('mfa_setup_required', 'Cadastre o aplicativo autenticador antes de informar o código.')
  }
  const now = ctx.now()
  // Conta bloqueada não confere código (nem o certo) até o fim do bloqueio.
  if (isLocked(user, now)) throw tooManyAttempts()
  const secret = decryptField(user.mfa_secret_ciphertext, ctx.config.secrets.encryption, mfaContext(user.id))
  const step = verifyTotp(secret, code, now, user.mfa_last_step)
  if (step === null) {
    await recordAudit(ctx.db, {
      actorType: 'admin',
      actorId: user.id,
      action: 'admin.mfa_failed',
      resourceType: 'admin_user',
      resourceId: user.id,
      ipHash: meta.ipHash ?? null,
    })
    const locked = await registerMfaFailure(ctx, user.id, meta)
    if (locked) throw tooManyAttempts()
    throw Errors.badRequest('invalid_code', 'Código inválido ou expirado. Confira o aplicativo autenticador e tente novamente.')
  }

  const firstEnrollment = user.mfa_enabled_at === null
  return ctx.db.transaction(async (tx) => {
    // A condição no passo impede que duas requisições simultâneas aceitem o mesmo código.
    const updated = await tx.query<AdminUserRow>(
      `UPDATE admin_users u SET mfa_last_step = $2, mfa_enabled_at = COALESCE(mfa_enabled_at, $3),
              failed_login_count = 0, locked_until = NULL, mfa_failed_count = 0, mfa_failed_since = NULL,
              last_login_at = $3, updated_at = $3
        WHERE u.id = $1 AND (u.mfa_last_step IS NULL OR u.mfa_last_step < $2)
        RETURNING ${USER_COLUMNS}`,
      [user.id, step, now],
    )
    const fresh = updated.rows[0]
    if (!fresh) {
      throw Errors.badRequest('invalid_code', 'Código inválido ou expirado. Confira o aplicativo autenticador e tente novamente.')
    }
    // Nova sessão completa (novo token e novo CSRF); a parcial deixa de valer.
    await revokeSession(tx, principal.sessionHash, now)
    const session = await createSession(ctx, tx, user.id, true, meta)
    if (firstEnrollment) {
      await recordAudit(tx, {
        actorType: 'admin',
        actorId: user.id,
        action: 'admin.mfa_enabled',
        resourceType: 'admin_user',
        resourceId: user.id,
        ipHash: meta.ipHash ?? null,
      })
    }
    await recordAudit(tx, {
      actorType: 'admin',
      actorId: user.id,
      action: 'admin.login',
      resourceType: 'admin_user',
      resourceId: user.id,
      ipHash: meta.ipHash ?? null,
    })
    const view = sessionView({
      sessionHash: sha256Hex(session.token),
      csrfToken: session.csrfToken,
      mfaVerified: true,
      user: fresh,
      permissions: await effectivePermissions(tx, fresh.role, fresh.id),
    })
    return { session, view }
  })
}

// Senha --------------------------------------------------------------------------------------------

/** Troca a própria senha. Encerra as outras sessões da pessoa e libera o uso do painel. */
export async function changeOwnPassword(
  ctx: AppContext,
  principal: AdminPrincipal,
  currentPassword: string,
  newPassword: string,
  meta: RequestMeta,
): Promise<void> {
  const user = principal.user
  const policy = passwordPolicyError(newPassword, user.email)
  if (policy) throw Errors.validation({ newPassword: policy })
  const ok = await verifyPassword(user.password_hash, currentPassword)
  if (!ok) {
    const locked = await registerPasswordFailure(ctx, user.id, meta)
    if (locked) {
      await revokeUserSessions(ctx.db, user.id, ctx.now())
      throw Errors.unauthorized('Muitas tentativas. Entre novamente em alguns minutos.')
    }
    throw Errors.validation({ currentPassword: 'Senha atual incorreta.' })
  }
  if (await verifyPassword(user.password_hash, newPassword)) {
    throw Errors.validation({ newPassword: 'A nova senha precisa ser diferente da atual.' })
  }
  const hash = await hashPassword(newPassword)
  const now = ctx.now()
  await ctx.db.transaction(async (tx) => {
    await tx.query(
      `UPDATE admin_users SET password_hash = $2, must_change_password = false, password_changed_at = $3,
              failed_login_count = 0, locked_until = NULL, updated_at = $3
        WHERE id = $1`,
      [user.id, hash, now],
    )
    const ended = await revokeUserSessions(tx, user.id, now, principal.sessionHash)
    await recordAudit(tx, {
      actorType: 'admin',
      actorId: user.id,
      action: 'admin.password_changed',
      resourceType: 'admin_user',
      resourceId: user.id,
      metadata: { otherSessionsEnded: ended, wasTemporary: user.must_change_password },
      ipHash: meta.ipHash ?? null,
    })
  })
}
