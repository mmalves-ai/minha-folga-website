import { Router } from 'express'
import type { AppContext } from '../context.js'
import { limiter } from '../middleware/rate-limit.js'
import { parseOrThrow } from '../middleware/validate.js'
import { PUSH_FIELD_MESSAGES, SubscribePushSchema, UnsubscribePushSchema, pushConfig, subscribePush, unsubscribePush } from '../services/push.service.js'

export function notificationsRoutes(ctx: AppContext): Router {
  const router = Router()
  router.get('/config', (_req, res) => res.json(pushConfig(ctx)))
  router.post('/subscriptions', limiter('push-subscribe', 3_600_000, 30), async (req, res) => {
    const input = parseOrThrow(SubscribePushSchema, req.body, PUSH_FIELD_MESSAGES)
    res.status(201).json(await subscribePush(ctx, input, req.ipHash))
  })
  router.delete('/subscriptions', limiter('push-unsubscribe', 60_000, 30), async (req, res) => {
    const input = parseOrThrow(UnsubscribePushSchema, req.body, PUSH_FIELD_MESSAGES)
    await unsubscribePush(ctx, input.subscriptionId, input.unsubscribeToken)
    res.status(204).end()
  })
  return router
}
