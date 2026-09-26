import { Router } from 'express'
import { z } from 'zod'
import type { AppContext } from '../../context.js'
import { can, principalOf } from '../../middleware/admin-auth.js'
import { limiter } from '../../middleware/rate-limit.js'
import { parseOrThrow } from '../../middleware/validate.js'
import { PUSH_FIELD_MESSAGES, SendPushSchema, GrantPushSchema, pushOverview, listPushGrants, setPushGrant, queuePushCampaign, cancelPushCampaign } from '../../services/push.service.js'

export function adminNotificationsRoutes(ctx: AppContext): Router {
  const router = Router()
  router.get('/notifications', can(ctx, 'notifications:send'), async (_req, res) => res.json(await pushOverview(ctx)))
  router.post('/notifications/campaigns', can(ctx, 'notifications:send'), limiter('push-campaign', 60_000, 5), async (req, res) => {
    const input = parseOrThrow(SendPushSchema, req.body, PUSH_FIELD_MESSAGES)
    res.status(202).json(await queuePushCampaign(ctx, principalOf(req), input, req.ipHash))
  })
  router.post('/notifications/campaigns/:id/cancel', can(ctx, 'notifications:send'), async (req, res) => {
    const id = parseOrThrow(z.uuid(), req.params.id)
    await cancelPushCampaign(ctx, principalOf(req), id, req.ipHash)
    res.json({ status: 'cancelled' })
  })
  router.get('/notifications/grants', can(ctx, 'notifications:manage'), async (_req, res) => res.json(await listPushGrants(ctx)))
  router.put('/notifications/grants/:id', can(ctx, 'notifications:manage'), async (req, res) => {
    const id = parseOrThrow(z.uuid(), req.params.id)
    const input = parseOrThrow(GrantPushSchema, req.body, PUSH_FIELD_MESSAGES)
    res.json(await setPushGrant(ctx, principalOf(req), id, input.enabled, input.reason, req.ipHash))
  })
  return router
}
