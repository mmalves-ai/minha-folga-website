import { Router } from 'express'
import { z } from 'zod'
import { can, principalOf } from '../../middleware/admin-auth.js'
import { parseOrThrow } from '../../middleware/validate.js'
import { getCollectionView, setWaitlistFormPaused } from '../../services/collection-switch.service.js'
import type { AppContext } from '../../context.js'

const SwitchSchema = z.strictObject({ paused: z.boolean(), reason: z.string().trim().min(5).max(200) })
const SWITCH_MESSAGES = { paused: 'Informe se o formulário fica pausado (true) ou aberto (false).', reason: 'Descreva o motivo em 5 a 200 caracteres.' }

/** Interruptor do formulário de cadastro do site (collection-switch.service.ts). Só o papel admin. */
export function collectionRoutes(ctx: AppContext): Router {
  const router = Router()

  router.get('/collection', can(ctx, 'collection:manage'), async (_req, res) => {
    res.json(await getCollectionView(ctx))
  })

  router.put('/collection/waitlist-form', can(ctx, 'collection:manage'), async (req, res) => {
    const { paused, reason } = parseOrThrow(SwitchSchema, req.body, SWITCH_MESSAGES)
    res.json(await setWaitlistFormPaused(ctx, principalOf(req), paused, reason, req.ipHash))
  })

  return router
}
