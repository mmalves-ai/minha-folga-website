import type { AppConfig } from '../config/index.js'

/**
 * Fonte única das decisões de fase financeira no servidor.
 * PRE_LAUNCH: nenhuma capacidade financeira. PILOT/LIVE: dependem também de
 * CREDIT_OPERATIONS_ENABLED e de integração homologada com parceiro (ainda inexistente nesta entrega).
 */
export type FinancialCapability =
  | 'eligibility_check'
  | 'margin_query'
  | 'proposal_view'
  | 'simulation'
  | 'contract_signature'

export interface CapabilityDecision {
  allowed: boolean
  reason: 'pre_launch' | 'operations_disabled' | 'integration_not_available' | 'allowed'
}

export function financialCapability(config: AppConfig, _capability: FinancialCapability): CapabilityDecision {
  if (config.credit.phase === 'PRE_LAUNCH') return { allowed: false, reason: 'pre_launch' }
  if (!config.credit.operationsEnabled) return { allowed: false, reason: 'operations_disabled' }
  // Nenhuma integração financeira homologada existe nesta entrega. Quando existir, a decisão
  // passa a consultar a integração, a autorização específica do titular e o grupo do piloto.
  return { allowed: false, reason: 'integration_not_available' }
}
