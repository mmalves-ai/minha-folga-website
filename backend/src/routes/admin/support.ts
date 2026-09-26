import { Router } from 'express'
import { can, principalOf } from '../../middleware/admin-auth.js'
import { parseOrThrow } from '../../middleware/validate.js'
import { Errors } from '../../lib/errors.js'
import { DATE_MESSAGES, uuidParam } from '../../services/admin-common.js'
import {
  addSupportNote,
  listSupportQueue,
  listTeam,
  SupportNoteSchema,
  SupportPatchSchema,
  SupportQueueQuerySchema,
  updateSupportRequest,
  viewSupportRequest,
} from '../../services/admin-support.service.js'
import type { AppContext } from '../../context.js'

function requestId(raw: unknown): string {
  const parsed = uuidParam.safeParse(raw)
  if (!parsed.success) throw Errors.notFound('Solicitação não encontrada.')
  return parsed.data
}

export function supportRoutes(ctx: AppContext): Router {
  const router = Router()

  router.get('/support', can(ctx, 'support:read'), async (req, res) => {
    const query = parseOrThrow(SupportQueueQuerySchema, req.query, {
      ...DATE_MESSAGES,
      status: 'Status desconhecido.',
      assignee: 'Use "me", "none" ou o identificador de uma pessoa.',
    })
    res.json(await listSupportQueue(ctx, principalOf(req), query, req.ipHash))
  })

  router.get('/support/:id', can(ctx, 'support:read'), async (req, res) => {
    res.json(await viewSupportRequest(ctx, principalOf(req), requestId(req.params.id), req.ipHash))
  })

  router.patch('/support/:id', can(ctx, 'support:update'), async (req, res) => {
    const id = requestId(req.params.id)
    const change = parseOrThrow(SupportPatchSchema, req.body, {
      status: 'Informe um status válido ou um responsável.',
      assigneeId: 'Escolha uma pessoa da equipe.',
    })
    res.json(await updateSupportRequest(ctx, principalOf(req), id, change, req.ipHash))
  })

  router.post('/support/:id/notes', can(ctx, 'support:update'), async (req, res) => {
    const id = requestId(req.params.id)
    const input = parseOrThrow(SupportNoteSchema, req.body, { note: 'Escreva a nota (até 2.000 caracteres).' })
    res.status(201).json(await addSupportNote(ctx, principalOf(req), id, input, req.ipHash))
  })

  router.get('/team', can(ctx, 'team:read'), async (_req, res) => {
    res.json(await listTeam(ctx))
  })

  return router
}
