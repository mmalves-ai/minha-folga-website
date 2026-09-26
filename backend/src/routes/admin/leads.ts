import { Router } from 'express'
import { z } from 'zod'
import { can, principalOf } from '../../middleware/admin-auth.js'
import { parseOrThrow } from '../../middleware/validate.js'
import { Errors } from '../../lib/errors.js'
import { uuidParam } from '../../services/admin-common.js'
import {
  exportLeadsCsv,
  getLeadDetail,
  LEAD_FILTER_MESSAGES,
  LeadFiltersSchema,
  LeadListQuerySchema,
  listLeads,
  revealLeadContact,
} from '../../services/admin-leads.service.js'
import { reviewSubmission } from '../../services/admin-submissions.service.js'
import type { AppContext } from '../../context.js'

const ReasonSchema = z.strictObject({ reason: z.string().trim().min(5).max(200) })
const ExportSchema = z.strictObject({
  reason: z.string().trim().min(5).max(200),
  filters: z.record(z.string(), z.string().max(100)).optional(),
})
const REASON_MESSAGE = { reason: 'Descreva o motivo em 5 a 200 caracteres.' }

function leadId(raw: unknown): string {
  const parsed = uuidParam.safeParse(raw)
  if (!parsed.success) throw Errors.notFound('Cadastro não encontrado.')
  return parsed.data
}

function submissionId(raw: unknown): string {
  const parsed = uuidParam.safeParse(raw)
  if (!parsed.success) throw Errors.notFound('Submissão não encontrada.')
  return parsed.data
}

export function leadsRoutes(ctx: AppContext): Router {
  const router = Router()

  router.get('/leads', can(ctx, 'leads:read'), async (req, res) => {
    const query = parseOrThrow(LeadListQuerySchema, req.query, LEAD_FILTER_MESSAGES)
    res.json(await listLeads(ctx, principalOf(req), query, req.ipHash))
  })

  // Antes de /leads/:id para "export" não ser lido como identificador.
  router.post('/leads/export', can(ctx, 'leads:export'), async (req, res) => {
    const body = parseOrThrow(ExportSchema, req.body, REASON_MESSAGE)
    const filters = parseOrThrow(LeadFiltersSchema, body.filters ?? {}, LEAD_FILTER_MESSAGES)
    const { csv } = await exportLeadsCsv(ctx, principalOf(req), filters, body.reason, req.ipHash)
    const stamp = ctx.now().toISOString().slice(0, 16).replace(/[-:T]/g, '')
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="cadastros-${stamp}.csv"`)
    res.send(csv)
  })

  router.get('/leads/:id', can(ctx, 'leads:read'), async (req, res) => {
    res.json(await getLeadDetail(ctx, principalOf(req), leadId(req.params.id), req.ipHash))
  })

  router.post('/leads/:id/reveal-contact', can(ctx, 'leads:read_contact'), async (req, res) => {
    const id = leadId(req.params.id)
    const { reason } = parseOrThrow(ReasonSchema, req.body, REASON_MESSAGE)
    res.json(await revealLeadContact(ctx, principalOf(req), id, reason, req.ipHash))
  })

  // Submissões guardadas para revisão: aplicar ao cadastro ou descartar (equipe de privacidade, com justificativa).
  for (const action of ['apply', 'discard'] as const) {
    router.post(`/leads/:id/submissions/:submissionId/${action}`, can(ctx, 'privacy:manage'), async (req, res) => {
      const id = leadId(req.params.id)
      const sid = submissionId(req.params.submissionId)
      const { reason } = parseOrThrow(ReasonSchema, req.body, REASON_MESSAGE)
      res.json(await reviewSubmission(ctx, principalOf(req), id, sid, action, reason, req.ipHash))
    })
  }

  return router
}
