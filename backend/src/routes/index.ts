import { Router } from 'express'
import { notificationsRoutes } from './notifications.js'
import { originGuard } from '../middleware/origin-guard.js'
import { adminRoutes } from './admin/index.js'
import { agentRoutes } from './agent.js'
import { antiBotRoutes } from './anti-bot.js'
import { creditRoutes } from './credit.js'
import { eventsRoutes } from './events.js'
import { healthRoutes } from './health.js'
import { preferencesRoutes } from './preferences.js'
import { publicRoutes } from './public.js'
import { supportRoutes } from './support.js'
import { waitlistRoutes } from './waitlist.js'
import type { AppContext } from '../context.js'

/** Todas as rotas vivem sob /api. Chamadas do navegador passam pelo originGuard. */
export function apiRouter(ctx: AppContext): Router {
  const api = Router()
  const browser = originGuard(ctx)

  api.use(healthRoutes(ctx))
  api.use(publicRoutes(ctx))
  api.use(antiBotRoutes(ctx))
  api.use('/credit', creditRoutes(ctx))
  api.use('/notifications', browser, notificationsRoutes(ctx))
  api.use('/waitlist', browser, waitlistRoutes(ctx))
  api.use('/preferences', browser, preferencesRoutes(ctx))
  api.use('/support', browser, supportRoutes(ctx))
  api.use('/events', browser, eventsRoutes(ctx))
  api.use('/admin', browser, adminRoutes(ctx))
  // Servidor-a-servidor (Hal-AI): X-API-Key (+ assinatura opcional), sem originGuard. Não há webhooks de
  // mensagem: o WhatsApp é todo da Hal-AI (decisão D1).
  api.use('/agent', agentRoutes(ctx))
  return api
}
