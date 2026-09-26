import { Router } from 'express'
import { can, principalOf } from '../../middleware/admin-auth.js'
import { parseOrThrow } from '../../middleware/validate.js'
import { Errors } from '../../lib/errors.js'
import { uuidParam } from '../../services/admin-common.js'
import {
  createAdminUser,
  CreateUserSchema,
  listUsers,
  PatchUserSchema,
  updateAdminUser,
  USER_MESSAGES,
} from '../../services/admin-users.service.js'
import type { AppContext } from '../../context.js'

export function usersRoutes(ctx: AppContext): Router {
  const router = Router()

  router.get('/users', can(ctx, 'users:manage'), async (_req, res) => {
    res.json(await listUsers(ctx))
  })

  router.post('/users', can(ctx, 'users:manage'), async (req, res) => {
    const input = parseOrThrow(CreateUserSchema, req.body, USER_MESSAGES)
    const principal = principalOf(req)
    const created = await createAdminUser(ctx.db, ctx.now(), input, {
      type: 'admin',
      id: principal.user.id,
      ipHash: req.ipHash,
      via: 'api',
    })
    res.status(201).json(created)
  })

  router.patch('/users/:id', can(ctx, 'users:manage'), async (req, res) => {
    const parsed = uuidParam.safeParse(req.params.id)
    if (!parsed.success) throw Errors.notFound('Pessoa usuária não encontrada.')
    const change = parseOrThrow(PatchUserSchema, req.body, { ...USER_MESSAGES, role: 'Informe ao menos uma alteração válida.' })
    res.json(await updateAdminUser(ctx, principalOf(req), parsed.data, change, req.ipHash))
  })

  return router
}
