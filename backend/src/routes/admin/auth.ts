import { Router, type Request } from 'express'
import { ipKeyGenerator } from 'express-rate-limit'
import { z } from 'zod'
import {
  adminSession,
  clearAdminCookie,
  csrfError,
  principalOf,
  readAdminToken,
  requestMeta,
  setAdminCookie,
} from '../../middleware/admin-auth.js'
import { limiter } from '../../middleware/rate-limit.js'
import { parseOrThrow } from '../../middleware/validate.js'
import { hmacHex, safeEqual, sha256Hex } from '../../lib/crypto.js'
import { PASSWORD_MAX_LENGTH } from '../../lib/password.js'
import { recordAudit } from '../../services/audit.service.js'
import {
  changeOwnPassword,
  completeMfa,
  loadSession,
  login,
  loginStep,
  revokeSession,
  sessionView,
  startMfaSetup,
} from '../../services/admin-auth.service.js'
import type { AppContext } from '../../context.js'

const LoginSchema = z.strictObject({
  email: z.string().trim().min(1).max(200),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
})

const MfaVerifySchema = z.strictObject({ code: z.string().regex(/^\d{6}$/) })

const PasswordSchema = z.strictObject({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  newPassword: z.string().max(PASSWORD_MAX_LENGTH),
})

const ACCESS_WINDOW_MS = 15 * 60_000

/**
 * Limite por origem das rotas de acesso, em 15 min; só falhas contam (login legítimo não consome a cota).
 * IPv6 é agrupado pela sub-rede /56 (ipKeyGenerator): trocar de endereço na mesma rede não renova a cota.
 * A chave em memória é só o HMAC da origem, como req.ipHash.
 */
function accessLimit(ctx: AppContext, name: string, limit: number) {
  const origin = (req: Request) =>
    hmacHex(ipKeyGenerator(req.ip ?? 'unknown'), ctx.config.secrets.sessionSecret, 'ip-limit').slice(0, 32)
  return limiter(name, ACCESS_WINDOW_MS, limit, {
    skipSuccessfulRequests: true,
    keyGenerator: (req: Request) => `${name}:${origin(req)}`,
  })
}

export function authRoutes(ctx: AppContext): Router {
  const router = Router()
  const loginLimit = accessLimit(ctx, 'admin-login', 20)
  const mfaLimit = accessLimit(ctx, 'admin-mfa', 20)
  const passwordLimit = accessLimit(ctx, 'admin-password', 10)

  router.post('/login', loginLimit, async (req, res) => {
    const body = parseOrThrow(LoginSchema, req.body, {
      email: 'Informe o e-mail.',
      password: 'Informe a senha.',
    })
    const meta = requestMeta(req)
    const result = await login(ctx, body.email, body.password, meta)
    // Um novo login substitui a sessão anterior deste navegador.
    const previous = readAdminToken(req)
    if (previous) await revokeSession(ctx.db, sha256Hex(previous), ctx.now())
    setAdminCookie(ctx, res, result)
    res.json({ status: result.status, csrfToken: result.csrfToken })
  })

  router.post('/mfa/setup', adminSession(ctx, { stage: 'any' }), async (req, res) => {
    parseOrThrow(z.strictObject({}), req.body ?? {})
    res.json(await startMfaSetup(ctx, principalOf(req), requestMeta(req)))
  })

  router.post('/mfa/verify', mfaLimit, adminSession(ctx, { stage: 'any' }), async (req, res) => {
    const { code } = parseOrThrow(MfaVerifySchema, req.body, { code: 'Informe os 6 dígitos do aplicativo autenticador.' })
    const principal = principalOf(req)
    if (principal.mfaVerified) {
      res.json(sessionView(principal))
      return
    }
    const { session, view } = await completeMfa(ctx, principal, code, requestMeta(req))
    setAdminCookie(ctx, res, session)
    res.json(view)
  })

  router.get('/me', adminSession(ctx, { stage: 'any' }), (req, res) => {
    const principal = principalOf(req)
    res.json(principal.mfaVerified ? sessionView(principal) : loginStep(principal))
  })

  // Encerrar é idempotente: sem sessão válida, apenas limpa o cookie.
  router.post('/logout', async (req, res) => {
    const token = readAdminToken(req)
    const principal = token ? await loadSession(ctx, token) : null
    if (principal) {
      const given = req.get('x-csrf-token') ?? ''
      if (!given || !safeEqual(given, principal.csrfToken)) throw csrfError()
      await revokeSession(ctx.db, principal.sessionHash, ctx.now())
      await recordAudit(ctx.db, {
        actorType: 'admin',
        actorId: principal.user.id,
        action: 'admin.logout',
        resourceType: 'admin_user',
        resourceId: principal.user.id,
        ipHash: req.ipHash,
      })
    }
    clearAdminCookie(ctx, res)
    res.status(204).end()
  })

  router.post(
    '/password',
    passwordLimit,
    adminSession(ctx, { stage: 'full', allowPendingPasswordChange: true }),
    async (req, res) => {
      const body = parseOrThrow(PasswordSchema, req.body, {
        currentPassword: 'Informe a senha atual.',
        newPassword: 'Confira a nova senha.',
      })
      await changeOwnPassword(ctx, principalOf(req), body.currentPassword, body.newPassword, requestMeta(req))
      res.status(204).end()
    },
  )

  return router
}
