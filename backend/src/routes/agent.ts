import { Router, type NextFunction, type Request, type Response } from 'express'
import { rejectReplay, requireAgentEnabled, verifyAgentApiKey, verifyAgentSignature } from '../integrations/halai/request-auth.js'
import { AppError, Errors } from '../lib/errors.js'
import { handler } from '../middleware/async.js'
import { limiter } from '../middleware/rate-limit.js'
import { agentCapabilities, executeAgentTool, isAgentToolName } from '../services/agent-tools.service.js'
import type { AppContext } from '../context.js'

/**
 * /api/agent — ferramentas da Bia (Hal-AI), servidor-a-servidor. Contrato PROPOSTO (contracts/agent-tools.json).
 * Ordem: limite por IP → integração ligada → X-API-Key → assinatura (se configurada) → (ferramentas) ferramenta
 * conhecida → replay → execução.
 */
function requireJson(req: Request, _res: Response, next: NextFunction) {
  if (!req.is('application/json')) return next(new AppError(415, 'unsupported_media_type', 'Envie os dados em JSON.'))
  next()
}

export function agentRoutes(ctx: AppContext): Router {
  const router = Router()
  router.use(limiter('agent', 60_000, 600))
  router.use(requireAgentEnabled(ctx))
  router.use(verifyAgentApiKey(ctx))

  router.get('/capabilities', verifyAgentSignature(ctx), (_req, res) => {
    res.json(agentCapabilities(ctx))
  })

  router.post(
    '/tools/:tool',
    requireJson,
    verifyAgentSignature(ctx),
    (req, _res, next) => {
      // Ferramenta desconhecida não consome o id da requisição.
      if (!isAgentToolName(String(req.params.tool))) return next(Errors.notFound('Ferramenta inexistente.'))
      next()
    },
    rejectReplay(ctx),
    handler(async (req, res) => {
      const tool = String(req.params.tool)
      if (!isAgentToolName(tool)) throw Errors.notFound('Ferramenta inexistente.')
      const run = await executeAgentTool(ctx, tool, req.body)
      res.json({ ok: true, tool, result: run.result })
    }),
  )

  return router
}
