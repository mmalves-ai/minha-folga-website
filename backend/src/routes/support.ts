import { Router } from 'express'
import { Errors } from '../lib/errors.js'
import { handler } from '../middleware/async.js'
import { limiter } from '../middleware/rate-limit.js'
import { createSupportRequest, getSupportStatus, parseSupportForm, SUPPORT_MESSAGES } from '../services/support.service.js'
import type { AppContext } from '../context.js'

const MINUTE = 60_000

/**
 * /api/support — formulário de /atendimento e acompanhamento pelo titular.
 * O protocolo sozinho não autoriza leitura: o acompanhamento exige o token devolvido na criação.
 */
export function supportRoutes(ctx: AppContext): Router {
  const router = Router()

  router.post(
    '/',
    limiter('support_create_burst', 10 * MINUTE, 5),
    limiter('support_create_day', 24 * 60 * MINUTE, 20),
    handler(async (req, res) => {
      if (!ctx.config.collection.supportEnabled) throw Errors.unavailable('support_unavailable', SUPPORT_MESSAGES.unavailable)
      const input = parseSupportForm(ctx, req.body)
      const created = await createSupportRequest(ctx, input, { type: 'titular', ipHash: req.ipHash })
      res.status(201).json({
        protocol: created.protocol,
        trackingToken: created.trackingToken,
        status: created.status,
        message: created.message,
      })
    }),
  )

  router.get(
    '/:protocol',
    limiter('support_track', 10 * MINUTE, 30),
    handler(async (req, res) => {
      const status = await getSupportStatus(ctx, String(req.params.protocol ?? ''), req.get('x-support-token'))
      res.json(status)
    }),
  )

  return router
}
