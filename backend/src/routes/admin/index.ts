import { Router } from 'express'
import { adminNotificationsRoutes } from './notifications.js'
import { adminSession } from '../../middleware/admin-auth.js'
import { authRoutes } from './auth.js'
import { collectionRoutes } from './collection.js'
import { insightsRoutes } from './insights.js'
import { leadsRoutes } from './leads.js'
import { privacyRoutes } from './privacy.js'
import { supportRoutes } from './support.js'
import { usersRoutes } from './users.js'
import type { AppContext } from '../../context.js'

/**
 * /api/admin — já passa por originGuard (JSON + origem) em routes/index.ts.
 * Autenticação: /auth/* cuida de login, MFA e senha. Todo o resto exige sessão completa
 * (MFA concluído, sem troca de senha pendente), CSRF nos métodos inseguros e permissão por rota.
 */
export function adminRoutes(ctx: AppContext): Router {
  const router = Router()
  router.use('/auth', authRoutes(ctx))

  const protectedRoutes = Router()
  protectedRoutes.use(adminSession(ctx, { stage: 'full' }))
  protectedRoutes.use(leadsRoutes(ctx))
  protectedRoutes.use(supportRoutes(ctx))
  protectedRoutes.use(privacyRoutes(ctx))
  protectedRoutes.use(insightsRoutes(ctx))
  protectedRoutes.use(usersRoutes(ctx))
  protectedRoutes.use(collectionRoutes(ctx))
  protectedRoutes.use(adminNotificationsRoutes(ctx))
  router.use(protectedRoutes)
  return router
}
