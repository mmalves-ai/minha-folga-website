/**
 * CONTRATO INTERNO do ciclo de vida do cadastro (decisão D1, docs/DECISOES.md).
 * Implementado em services/waitlist.service.ts, customer.service.ts e preferences.service.ts; consumido pelas
 * rotas públicas, pelo painel e pelas ferramentas da Bia. Não alterar assinaturas sem alinhar os consumidores.
 *
 * Estados: `received` (site; telefone não validado) → `verified` (a Bia atestou o número) → `invited`;
 * laterais `unsubscribed` e `expired`. Os estados `verification_pending`, `waiting` e `human_support` são de
 * cadastros anteriores à D1 (confirmação por código) e só aparecem em dados antigos.
 */
import type { ConsentPurpose } from '../config/contracts.js'

export type EmploymentType = 'clt' | 'domestico' | 'rural' | 'outro'
export type JobTenure = 'menos_3_meses' | '3_a_12_meses' | '1_a_3_anos' | 'mais_3_anos'
export type IncomeRange = 'ate_2000' | '2000_a_4000' | '4000_a_7000' | 'acima_7000' | 'nao_informar'
export type InterestTopic = 'organizar_compromissos' | 'entender_alternativa' | 'entender_portabilidade' | 'so_conhecer'

export type LeadState =
  | 'received'
  | 'verified'
  | 'invited'
  | 'unsubscribed'
  | 'expired'
  /** Legado (antes da D1). */
  | 'verification_pending'
  | 'waiting'
  | 'human_support'

/** Estados do fluxo atual (D1). */
export const CURRENT_LEAD_STATES = ['received', 'verified', 'invited', 'unsubscribed', 'expired'] as const

export type LifecycleActor =
  | { type: 'titular'; ipHash?: string }
  | { type: 'agent'; conversationRefHash: string }
  | { type: 'admin'; adminId: string; ipHash?: string }
  | { type: 'system' }

/** Dados do cadastro já normalizados e validados (services/customer-data.ts). */
export interface CustomerData {
  fullName: string
  /** 11 dígitos, dígitos verificadores conferidos. */
  cpf: string
  /** E.164 (+55DDNNNNNNNNN). */
  phoneE164: string
  /** Minúsculas; ausente = não informado. */
  email: string | null
  employerName: string
  employmentType: EmploymentType
  jobTenure: JobTenure
  incomeRange: IncomeRange
  city: string
  uf: string
  interestTopic: InterestTopic | null
}

export interface WaitlistSubmission {
  data: CustomerData
  consents: Record<ConsentPurpose, boolean>
  consentVersions: Record<ConsentPurpose, string>
  source: string
  utm?: Partial<Record<'utm_source' | 'utm_medium' | 'utm_campaign' | 'utm_content' | 'utm_term', string>>
}

/** Resposta do cadastro pelo site: idêntica para novo, existente, suprimido ou campo-armadilha. */
export interface WaitlistReceived {
  status: 'received'
  message: string
}

export interface PreferencesView {
  /** Primeiro nome (saudação). */
  preferredName: string
  /** Nome completo mascarado: primeiro nome e iniciais (ex.: "Ana P. S."). */
  nameHint: string
  /** Telefone mascarado: "(11) •••••-••34". */
  contactHint: string
  /** true depois que a própria pessoa falou com a Bia pelo WhatsApp (número atestado). */
  contactVerified: boolean
  cpfHint: string | null
  emailHint: string | null
  employerName: string | null
  employmentType: EmploymentType
  jobTenure: JobTenure | null
  incomeRange: IncomeRange | null
  city: string | null
  uf: string | null
  interestTopic: InterestTopic | null
  state: LeadState
  purposes: Record<ConsentPurpose, { granted: boolean; updatedAt: string; consentTextVersion: string }>
}

/** Mudanças que o titular (sessão de /preferencias) ou a Bia podem fazer. CPF e telefone não mudam por aqui. */
export interface PreferencesChange {
  purposes?: Partial<Record<ConsentPurpose, boolean>>
  consentVersions?: Partial<Record<ConsentPurpose, string>>
  interestTopic?: InterestTopic | null
  profile?: ProfileChange
}

/** Dados gerais não identificadores (e e-mail opcional). */
export interface ProfileChange {
  employmentType?: EmploymentType
  jobTenure?: JobTenure
  incomeRange?: IncomeRange
  city?: string
  uf?: string
  /** null remove o e-mail. */
  email?: string | null
}

export const EMPLOYMENT_OTHER_NOTICE =
  'O produto inicial será voltado a vínculos formais elegíveis. Seu cadastro não confirma acesso a crédito. Você pode continuar recebendo as novidades escolhidas.'
