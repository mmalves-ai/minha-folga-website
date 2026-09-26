/**
 * Formatos usados pelos formulários de relacionamento (decisão D1, docs/DECISOES.md → Contrato
 * técnico, e contracts/validation.json). Campos marcados como opcionais podem faltar em respostas
 * de versões anteriores da API: a interface só mostra o que vier.
 */
import type { AntiBotProof } from '@/composables/useFormProof'

export type EmploymentType = 'clt' | 'domestico' | 'rural' | 'outro'
export type JobTenure = 'menos_3_meses' | '3_a_12_meses' | '1_a_3_anos' | 'mais_3_anos'
export type IncomeRange = 'ate_2000' | '2000_a_4000' | '4000_a_7000' | 'acima_7000' | 'nao_informar'
export type InterestTopic = 'organizar_compromissos' | 'entender_alternativa' | 'entender_portabilidade' | 'so_conhecer'
export type ConsentPurpose = 'launch_notice' | 'marketing'
export type SupportState = 'received' | 'in_progress' | 'answered' | 'closed'
/** received = pelo site, telefone não validado; verified = telefone atestado pela Bia no WhatsApp. */
export type LeadState = 'received' | 'verified' | 'invited' | 'unsubscribed' | 'expired'

/** POST /api/waitlist (corpo estrito). */
export interface WaitlistRequest {
  fullName: string
  cpf: string
  phone: string
  email?: string
  employerName: string
  employmentType: EmploymentType
  jobTenure: JobTenure
  incomeRange: IncomeRange
  city: string
  uf: string
  ageConfirmed: true
  interestTopic?: InterestTopic
  consents: { launch_notice: true; marketing: boolean }
  consentVersions: Record<ConsentPurpose, string>
  source: string
  utm?: Record<string, string>
  antiBot: AntiBotProof
  website: string
}

/** 201 — idêntica para cadastro novo ou existente (não revela cadastro). */
export interface WaitlistReceived {
  status: 'received'
  message: string
}

export interface PurposeState {
  granted: boolean
  updatedAt?: string
  consentTextVersion?: string
}

/** GET /api/preferences (sessão aberta pelo link seguro da Bia). Identificadores sempre mascarados. */
export interface Preferences {
  /** Primeiro nome, para a saudação (backend: PreferencesView.preferredName). */
  preferredName?: string | null
  /** Aceito também com este nome. */
  firstName?: string | null
  /** Nome completo mascarado (ex.: "Ana P. S."). */
  nameHint?: string | null
  contactHint: string
  /** true depois que a própria pessoa falou com a Bia pelo WhatsApp (número atestado). */
  contactVerified?: boolean
  cpfHint?: string | null
  emailHint?: string | null
  /** Empresa informada (só leitura aqui; muda pela Bia ou pela equipe de privacidade). */
  employerName?: string | null
  employmentType?: EmploymentType | null
  jobTenure?: JobTenure | null
  incomeRange?: IncomeRange | null
  city?: string | null
  uf?: string | null
  interestTopic?: InterestTopic | null
  state: LeadState | string
  /** Momento em que a Bia atestou o número (null = ainda não validado). */
  contactVerifiedAt?: string | null
  purposes: Partial<Record<ConsentPurpose, PurposeState>>
}

/** PATCH /api/preferences: finalidades, tema e dados gerais não identificadores. */
export interface PreferencesPatch {
  purposes?: Partial<Record<ConsentPurpose, boolean>>
  consentVersions?: Partial<Record<ConsentPurpose, string>>
  interestTopic?: InterestTopic | null
  employmentType?: EmploymentType
  jobTenure?: JobTenure
  incomeRange?: IncomeRange
  city?: string
  uf?: string
}

/** Etapa exibida pelo formulário de atendimento. */
export type SupportStage = 'form' | 'success' | 'unavailable'

export interface SupportCreated {
  protocol: string
  trackingToken: string
  status: 'received'
  message: string
}

export interface SupportTimelineItem {
  type: 'created' | 'status_changed' | 'reply'
  status?: SupportState
  text?: string | null
  at: string
}

export interface SupportStatus {
  protocol: string
  status: SupportState
  subject?: string
  subjectLabel?: string
  createdAt?: string
  updatedAt?: string
  timeline?: SupportTimelineItem[]
}

/**
 * Estado de navegação levado a /cadastro-confirmado (history.state, nunca na URL): só marca que o
 * servidor respondeu 201 nesta aba e se o vínculo escolhido foi "outro". Nenhum dado pessoal.
 */
export interface SignupConfirmedState {
  mfSignupReceived?: boolean
  mfEmploymentOther?: boolean
}
