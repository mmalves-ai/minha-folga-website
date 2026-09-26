import { Router } from 'express'
import { toPublicConfig } from '../config/public.js'
import { handler } from '../middleware/async.js'
import { waitlistFormOpen } from '../services/collection-switch.service.js'
import type { AppContext } from '../context.js'

export function publicRoutes(ctx: AppContext): Router {
  const router = Router()
  const payload = toPublicConfig(ctx.config)
  router.get(
    '/public-config',
    handler(async (_req, res) => {
      // A pausa do formulário pelo painel vale em até ~30 s (cache do navegador + cache do serviço). Sem banco, vale a
      // configuração (o envio do formulário confere de novo e responde 503 se estiver fechado).
      const open = await waitlistFormOpen(ctx).catch(() => payload.collection.waitlistEnabled)
      res.setHeader('Cache-Control', 'public, max-age=25')
      res.json(open === payload.collection.waitlistEnabled ? payload : { ...payload, collection: { ...payload.collection, waitlistEnabled: open } })
    }),
  )
  return router
}
