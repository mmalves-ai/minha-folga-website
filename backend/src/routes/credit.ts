import { Router } from 'express'
import { AppError, Errors } from '../lib/errors.js'
import { financialCapability, type FinancialCapability } from '../services/phase.service.js'
import type { AppContext } from '../context.js'

/**
 * Rotas financeiras reservadas. Nesta entrega nenhuma delas executa operação:
 * - PRE_LAUNCH → 403 credit_phase_locked (inclusive chamadas diretas, sem passar pela interface);
 * - PILOT/LIVE sem integração homologada → 503 credit_unavailable.
 * O bloqueio fica no servidor; esconder botões no frontend não é controle de acesso.
 */
const CAPABILITY_BY_PATH: Array<[RegExp, FinancialCapability]> = [
  [/^\/eligibility/, 'eligibility_check'],
  [/^\/margin/, 'margin_query'],
  [/^\/simulations?/, 'simulation'],
  [/^\/proposals?/, 'proposal_view'],
  [/^\/contracts?/, 'contract_signature'],
]

export function creditRoutes(ctx: AppContext): Router {
  const router = Router()
  router.use((req, _res, next) => {
    const capability = CAPABILITY_BY_PATH.find(([re]) => re.test(req.path))?.[1] ?? 'proposal_view'
    const decision = financialCapability(ctx.config, capability)
    if (decision.reason === 'pre_launch') return next(Errors.creditPhaseLocked())
    if (!decision.allowed) {
      return next(
        new AppError(503, 'credit_unavailable', 'Esta função de crédito ainda não está disponível.'),
      )
    }
    next()
  })
  return router
}
