import { Router } from 'express'
import { handler } from '../middleware/async.js'
import { limiter } from '../middleware/rate-limit.js'
import { productEventSchema, recordProductEvent, type ProductEventSchema } from '../services/product-events.service.js'
import type { AppContext } from '../context.js'

/**
 * POST /api/events — evento de produto agregado. O frontend só envia com consentimento de medição.
 * Com ANALYTICS_ENABLED=false responde 204 sem validar nem gravar (e as listas nem são lidas).
 */
export function eventsRoutes(ctx: AppContext): Router {
  const router = Router()
  // Listas fechadas montadas uma vez, na inicialização: contrato ou conteúdo inválido impede a API de
  // iniciar com a medição ligada (erro de release, não de visitante).
  const schema: ProductEventSchema | null = ctx.config.analyticsEnabled ? productEventSchema() : null

  router.post(
    '/',
    limiter('events', 60_000, 120),
    handler(async (req, res) => {
      if (schema) await recordProductEvent(ctx, req.body, schema)
      res.status(204).end()
    }),
  )

  return router
}
