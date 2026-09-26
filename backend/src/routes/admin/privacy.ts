import { Router } from 'express'
import { can, principalOf } from '../../middleware/admin-auth.js'
import { parseOrThrow } from '../../middleware/validate.js'
import { Errors } from '../../lib/errors.js'
import { uuidParam } from '../../services/admin-common.js'
import {
  createPrivacyRequest,
  listPrivacyRequests,
  PrivacyCreateSchema,
  PrivacyListQuerySchema,
  PrivacyPatchSchema,
  updatePrivacyRequest,
} from '../../services/admin-privacy.service.js'
import type { AppContext } from '../../context.js'

export function privacyRoutes(ctx: AppContext): Router {
  const router = Router()

  router.get('/privacy-requests', can(ctx, 'privacy:manage'), async (req, res) => {
    const query = parseOrThrow(PrivacyListQuerySchema, req.query, { status: 'Status desconhecido.' })
    res.json(await listPrivacyRequests(ctx, query))
  })

  router.post('/privacy-requests', can(ctx, 'privacy:manage'), async (req, res) => {
    const input = parseOrThrow(PrivacyCreateSchema, req.body, {
      requestType: 'Escolha o tipo de pedido.',
      leadId: 'Identificador de cadastro inválido.',
      supportRequestId: 'Identificador de atendimento inválido.',
      channel: 'Informe o canal de recebimento (até 60 caracteres).',
      summary: 'Resuma o pedido em 5 a 1.000 caracteres, sem dados de contato.',
      receivedAt: 'Informe data e hora de recebimento.',
    })
    res.status(201).json(await createPrivacyRequest(ctx, principalOf(req), input, req.ipHash))
  })

  router.patch('/privacy-requests/:id', can(ctx, 'privacy:manage'), async (req, res) => {
    const parsed = uuidParam.safeParse(req.params.id)
    if (!parsed.success) throw Errors.notFound('Pedido não encontrado.')
    const patch = parseOrThrow(PrivacyPatchSchema, req.body, {
      status: 'Informe o status, a resolução ou a ação.',
      resolution: 'Use até 1.000 caracteres.',
      action: 'Ação desconhecida.',
    })
    res.json(await updatePrivacyRequest(ctx, principalOf(req), parsed.data, patch, req.ipHash))
  })

  return router
}
