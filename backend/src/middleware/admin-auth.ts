import type { NextFunction, Request, Response } from 'express'
import { safeEqual } from '../lib/crypto.js'
import { AppError, Errors } from '../lib/errors.js'
import { recordAudit } from '../services/audit.service.js'
import { loadSession, type AdminPrincipal, type IssuedSession } from '../services/admin-auth.service.js'
import type { AdminPermission } from '../services/admin-permissions.js'
import type { AppContext } from '../context.js'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Sessão administrativa válida (parcial ou completa), anexada por adminSession(). */
      admin?: AdminPrincipal
    }
  }
}

/**
 * Sessão administrativa: token aleatório no cookie mf_admin (HttpOnly, SameSite=Strict, Path=/api/admin),
 * banco guarda só o sha256. Métodos inseguros exigem X-CSRF-Token igual ao da sessão.
 */
export const ADMIN_COOKIE = 'mf_admin'
const COOKIE_PATH = '/api/admin'
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export function setAdminCookie(ctx: AppContext, res: Response, session: IssuedSession): void {
  res.cookie(ADMIN_COOKIE, session.token, {
    httpOnly: true,
    secure: ctx.config.cookieSecure,
    sameSite: 'strict',
    path: COOKIE_PATH,
    maxAge: session.maxAgeMs,
  })
}

export function clearAdminCookie(ctx: AppContext, res: Response): void {
  res.clearCookie(ADMIN_COOKIE, { path: COOKIE_PATH, httpOnly: true, secure: ctx.config.cookieSecure, sameSite: 'strict' })
}

export function readAdminToken(req: Request): string | null {
  const token = req.cookies?.[ADMIN_COOKIE]
  return typeof token === 'string' && token.length >= 20 && token.length <= 100 ? token : null
}

export function requestMeta(req: Request): { ipHash: string; userAgent?: string } {
  const userAgent = req.get('user-agent')
  return userAgent ? { ipHash: req.ipHash, userAgent } : { ipHash: req.ipHash }
}

function csrfValid(req: Request, principal: AdminPrincipal): boolean {
  const given = req.get('x-csrf-token')
  return typeof given === 'string' && given.length > 0 && safeEqual(given, principal.csrfToken)
}

export function csrfError(): AppError {
  return new AppError(403, 'csrf_invalid', 'Não foi possível confirmar esta ação. Recarregue a página e tente novamente.')
}

interface SessionOptions {
  /** 'any': aceita sessão parcial (MFA pendente); 'full': exige MFA concluído. */
  stage: 'any' | 'full'
  /** Permite a rota mesmo com troca de senha pendente (somente senha, me e logout). */
  allowPendingPasswordChange?: boolean
}

/**
 * Exige sessão válida. Ordem: sessão → CSRF (métodos inseguros) → MFA → troca de senha obrigatória.
 * Sessão parcial só alcança mfa/setup, mfa/verify, me e logout.
 */
export function adminSession(ctx: AppContext, options: SessionOptions) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = readAdminToken(req)
    const principal = token ? await loadSession(ctx, token) : null
    if (!principal) {
      if (token) clearAdminCookie(ctx, res)
      return next(new AppError(401, 'session_required', 'Sua sessão terminou ou não existe. Entre novamente.'))
    }
    if (UNSAFE.has(req.method) && !csrfValid(req, principal)) return next(csrfError())
    if (options.stage === 'full') {
      if (!principal.mfaVerified) {
        return next(new AppError(401, 'mfa_required', 'Confirme o código do aplicativo autenticador para continuar.'))
      }
      if (principal.user.must_change_password && !options.allowPendingPasswordChange) {
        return next(new AppError(403, 'password_change_required', 'Troque a senha temporária para continuar.'))
      }
    }
    req.admin = principal
    next()
  }
}

/** Autorização por permissão, sempre no backend. Negativas são auditadas. */
export function can(ctx: AppContext, permission: AdminPermission) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const principal = req.admin
    if (!principal) return next(Errors.unauthorized())
    if (principal.permissions.has(permission)) return next()
    await recordAudit(ctx.db, {
      actorType: 'admin',
      actorId: principal.user.id,
      action: 'admin.forbidden',
      resourceType: 'admin_route',
      resourceId: null,
      metadata: { permission, method: req.method, route: `${req.baseUrl}${req.route?.path ?? ''}`, role: principal.user.role },
      ipHash: req.ipHash,
    })
    next(Errors.forbidden())
  }
}

/** Pessoa autenticada (uso após adminSession). */
export function principalOf(req: Request): AdminPrincipal {
  if (!req.admin) throw Errors.unauthorized()
  return req.admin
}
