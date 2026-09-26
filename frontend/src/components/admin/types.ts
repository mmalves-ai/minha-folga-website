/**
 * Tipos da área administrativa, espelhando contracts/openapi.yaml (seção admin).
 * Qualquer mudança de formato começa pelo contrato.
 */
export type AdminRole = 'admin' | 'support' | 'privacy' | 'marketing'

export type AdminPermission =
  | 'leads:read'
  | 'leads:read_contact'
  | 'leads:export'
  | 'support:read'
  | 'support:update'
  | 'privacy:manage'
  | 'metrics:read'
  | 'audit:read'
  | 'users:manage'
  | 'team:read'
  /** Pausar e reabrir o formulário de cadastro do site (só o papel admin). */
  | 'collection:manage'
  | 'notifications:send'
  | 'notifications:manage'

/**
 * Estados do cadastro (decisão D1): received (pelo site, telefone não validado) → verified (telefone
 * atestado pela Bia no WhatsApp) → invited; laterais unsubscribed e expired. Os demais são do fluxo
 * anterior (confirmação por código) e só aparecem em dados antigos.
 */
export type LeadState =
  | 'received'
  | 'verified'
  | 'invited'
  | 'unsubscribed'
  | 'expired'
  | 'verification_pending'
  | 'waiting'
  | 'human_support'

export type EmploymentType = 'clt' | 'domestico' | 'rural' | 'outro'
export type JobTenure = 'menos_3_meses' | '3_a_12_meses' | '1_a_3_anos' | 'mais_3_anos'
export type IncomeRange = 'ate_2000' | '2000_a_4000' | '4000_a_7000' | 'acima_7000' | 'nao_informar'
export type SupportState = 'received' | 'in_progress' | 'answered' | 'closed'
export type PrivacyStatus = 'open' | 'in_progress' | 'fulfilled' | 'rejected'
export type PrivacyRequestType =
  | 'access'
  | 'correction'
  | 'deletion'
  | 'revocation'
  | 'opposition'
  | 'portability'
  | 'information'
  | 'other'
export type PrivacyAction = 'revoke_all' | 'anonymize_lead' | 'suppress_contact'

export interface AdminUser {
  id: string
  email: string
  displayName: string
  role: AdminRole
  mfaEnabled: boolean
  mustChangePassword: boolean
  disabled: boolean
  lastLoginAt: string | null
  createdAt: string
}

export interface AdminUserRef {
  id: string
  displayName: string
  role: AdminRole
}

export interface AdminLoginStep {
  status: 'mfa_required' | 'mfa_setup_required'
  csrfToken: string
}

export interface AdminSession {
  status: 'authenticated'
  user: AdminUser
  permissions: AdminPermission[]
  csrfToken: string
}

export interface MfaSetup {
  secret: string
  otpauthUrl: string
  qrSvg: string
}

export interface Page<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

/**
 * Cadastro na lista do painel (decisão D1; backend/src/services/admin-leads.service.ts → AdminLeadView).
 * Identificadores sempre mascarados (`phoneHint`, `cpfHint`, `emailHint`); faixas e UF em códigos do
 * contrato. `preferredName` é o primeiro nome (cadastros anteriores à D1 só têm este).
 */
export interface AdminLead {
  id: string
  fullName?: string
  preferredName?: string
  phoneHint: string
  /** true quando a própria pessoa falou com a Bia pelo WhatsApp (número atestado). */
  phoneVerified?: boolean
  cpfHint?: string | null
  emailHint?: string | null
  employerName?: string | null
  employmentType: EmploymentType | null
  jobTenure?: JobTenure | null
  incomeRange?: IncomeRange | null
  city?: string | null
  uf?: string | null
  interestTopic: string | null
  state: LeadState
  source: string
  utmSource: string | null
  utmCampaign: string | null
  /** Momento em que a Bia atestou o telefone no WhatsApp (null = não validado). */
  contactVerifiedAt: string | null
  createdAt: string
  purposes: { launch_notice?: boolean; marketing?: boolean }
  /** Submissões para este CPF/telefone guardadas à parte, aguardando revisão. */
  pendingReview?: number
}

export interface AdminLeadEvent {
  type: string
  fromState: string | null
  toState: string | null
  purpose: string | null
  granted: boolean | null
  source: string
  actorType: string
  at: string
}

/**
 * Submissão guardada para revisão (decisão D1): novo envio do site (ou da Bia) para CPF ou telefone já
 * cadastrado, cifrado e sem sobrescrever o cadastro. Os dados chegam mascarados como os do cadastro.
 */
export interface AdminLeadSubmission {
  id: string
  channel: 'site' | 'bia' | string
  source: string
  /** existing_phone, existing_cpf, existing_phone_and_cpf, cpf_conflict, cpf_mismatch, suppressed. */
  reason: string
  createdAt: string
  /**
   * Pode ser aplicada ao cadastro (privacy:manage). false com `cpf_conflict` (CPF de outro cadastro),
   * `suppressed` (contato com pedido de exclusão/oposição) ou conteúdo ilegível: só pode ser descartada.
   * Ausente em versões anteriores da API (a tela deduz pelo motivo e pelo conteúdo).
   */
  applicable?: boolean
  data: {
    fullName: string | null
    phoneHint: string | null
    cpfHint: string | null
    emailHint: string | null
    employerName: string | null
    employmentType: string | null
    jobTenure: string | null
    incomeRange: string | null
    city: string | null
    uf: string | null
    interestTopic: string | null
  } | null
  consents?: { launch_notice: boolean | null; marketing: boolean | null }
}

export interface AdminLeadDetail extends AdminLead {
  anonymized: boolean
  pendingSubmissions?: AdminLeadSubmission[]
  events: AdminLeadEvent[]
}

/** POST /api/admin/leads/{id}/submissions/{submissionId}/apply (privacy:manage), com justificativa auditada. */
export interface SubmissionApplied {
  status: 'applied'
  /** Campos do cadastro alterados (nomes do contrato: fullName, cpf, email, …); vazio se nada mudou. */
  changed: string[]
}

/** POST /api/admin/leads/{id}/submissions/{submissionId}/discard (privacy:manage), com justificativa auditada. */
export interface SubmissionDiscarded {
  status: 'discarded'
}

/** POST /api/admin/leads/{id}/reveal-contact (leads:read_contact), com justificativa auditada. */
export interface RevealedContact {
  phone: string
  email?: string | null
  /** Já formatado (000.000.000-00); null em cadastros anteriores à D1. */
  cpf?: string | null
}

export interface AdminSupportItem {
  id: string
  protocol: string
  subject: string
  status: SupportState
  source: 'web_form' | 'agent'
  contactMethod: string
  contactHint: string
  assignee: AdminUserRef | null
  createdAt: string
  updatedAt: string
}

export interface AdminSupportEvent {
  type: string
  fromStatus: string | null
  toStatus: string | null
  note: string | null
  visibleToRequester: boolean
  /** Pessoa atribuída em eventos `assigned` (null = sem responsável). Acréscimo do backend ao contrato. */
  assignee?: AdminUserRef | null
  actor: AdminUserRef | null
  actorType: string
  at: string
}

export interface AdminSupportDetail extends AdminSupportItem {
  requesterName: string
  contact: string
  message: string
  firstResponseAt: string | null
  closedAt: string | null
  events: AdminSupportEvent[]
}

export interface PrivacyRequest {
  id: string
  requestType: PrivacyRequestType
  leadId: string | null
  supportRequestId: string | null
  channel: string
  status: PrivacyStatus
  summary: string
  resolution: string | null
  receivedAt: string
  fulfilledAt: string | null
  handledBy: AdminUserRef | null
}

export interface AdminMetrics {
  period: { from: string; to: string }
  leads: {
    created: number
    /** Telefones validados no período (contact_verified_at; desde a D1, sempre pela Bia). */
    verified: number
    /** Validações registradas pela ferramenta da Bia no período. */
    verifiedByBia?: number
    verifiedWithEligibleIntent: number
    unsubscribed: number
    byState: Record<string, number>
    byEmploymentType: Record<string, number>
    bySource: Record<string, number>
    /** Distribuições da decisão D1 (faltam em versões anteriores da API). */
    byUf?: Record<string, number>
    byIncomeRange?: Record<string, number>
    byJobTenure?: Record<string, number>
    /** Submissões do site guardadas para revisão (CPF ou telefone já cadastrado). */
    pendingReview?: number
    /** `verified` = telefones atestados pela Bia no dia. */
    byDay: { day: string; created: number; verified: number }[]
  }
  preferences: { launchNoticeGranted: number; marketingGranted: number }
  support: {
    created: number
    byStatus: Record<string, number>
    medianFirstResponseHours: number | null
  }
  /** Eventos de produto agregados, pelo nome do contrato (contracts/validation.json → events), top-N dimensões. */
  events: { name: string; dimension: string; count: number }[]
  /** Dimensões além do limite, somadas por evento. */
  eventsOmitted?: { name: string; dimensions: number; count: number }[]
  /** Contadores operacionais internos (cadastro, envios, atendimento, Bia). */
  counters?: { name: string; dimension: string; count: number }[]
  countersOmitted?: { name: string; dimensions: number; count: number }[]
  dimensionsPerName?: number
}

/**
 * GET /api/admin/collection e PUT /api/admin/collection/waitlist-form (collection:manage): interruptor do
 * formulário de cadastro do site. A Bia e o pedido de saída não dependem dele.
 */
export interface WaitlistFormSwitch {
  /** O formulário do site aceita cadastros agora. */
  open: boolean
  /** Pausado pelo painel. */
  paused: boolean
  /** Fechado no servidor (WAITLIST_FORM_ENABLED=false): o painel não reabre. */
  lockedByEnvironment: boolean
  /** Outros motivos de configuração que fecham o cadastro (ex.: identity_incomplete). */
  reasons: string[]
  changedAt: string | null
  /** Nome de exibição de quem mudou por último. */
  changedBy: string | null
}

export interface AdminCollection {
  waitlistForm: WaitlistFormSwitch
}

export interface AuditEntry {
  id: string
  actorType: string
  actor: AdminUserRef | null
  action: string
  resourceType: string | null
  resourceId: string | null
  metadata: Record<string, unknown>
  at: string
}

export interface UserWithPassword {
  user: AdminUser
  temporaryPassword?: string
}
