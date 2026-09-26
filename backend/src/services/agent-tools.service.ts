import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { CONSENTS, VALIDATION, type ConsentPurpose } from '../config/contracts.js'
import type { CreditPhase } from '../config/index.js'
import type { AppContext } from '../context.js'
import { hmacHex } from '../lib/crypto.js'
import { AppError, Errors } from '../lib/errors.js'
import { normalizeBrazilianMobile } from '../lib/phone.js'
import { decryptLeadField, findActiveLead, type LeadRow } from '../repositories/leads.repo.js'
import {
  cityField,
  cpfField,
  emailField,
  employerField,
  employmentTypeField,
  FIELD_MESSAGES,
  fullNameField,
  incomeRangeField,
  interestTopicField,
  jobTenureField,
  nameHint,
  ufField,
} from './customer-data.js'
import { upsertCustomer, type CustomerFields } from './customer.service.js'
import { faqBaseUsable, faqBaseVersion, loadFaqBase, searchFaq } from './faq.service.js'
import {
  EMPLOYMENT_OTHER_NOTICE,
  type EmploymentType,
  type IncomeRange,
  type InterestTopic,
  type JobTenure,
  type LifecycleActor,
  type PreferencesChange,
  type PreferencesView,
} from './lead-lifecycle.js'
import { incrementMetric } from './metrics.service.js'
import { financialCapability, type FinancialCapability } from './phase.service.js'
import {
  findLeadIdByPhone,
  getPreferences,
  issuePreferencesLink,
  PREFERENCES_LINK_TTL_SECONDS,
  revokeAllCommunication,
  updatePreferences,
} from './preferences.service.js'

/**
 * Ferramentas da Bia (Hal-AI → esta API), decisão D1 (docs/DECISOES.md → Ferramentas da Bia). Contrato PROPOSTO
 * em contracts/agent-tools.json — nomes e formatos a confirmar com o fornecedor. Regras:
 * - entradas estritamente validadas; campos inesperados recusados;
 * - o telefone é SEMPRE o do remetente atestado pela plataforma (senderPhone + senderVerified, preenchidos a partir
 *   do canal, nunca pelo modelo); ferramentas de cadastro e preferências exigem esse atestado;
 * - ferramentas financeiras seguem phase.service (403 em PRE_LAUNCH, 503 sem integração homologada),
 *   sem cálculo próprio de preço e sem proposta inventada;
 * - nenhuma ferramenta devolve configuração, segredos ou dados de terceiros; dados do titular saem mascarados;
 * - toda chamada autenticada gera uma linha em agent_tool_calls (ferramenta, resultado, fase e HMAC da
 *   conversa), sem conteúdo de conversa, telefone ou entrada.
 * Atendimento humano do WhatsApp é da Hal-AI (filas, operadores): não há ferramenta de transbordo aqui.
 */

export const AGENT_TOOL_NAMES = [
  'get_approved_faq',
  'upsert_customer',
  'get_customer_status',
  'update_contact_preferences',
  'issue_preferences_link',
  'check_eligibility',
  'query_margin',
  'get_proposal',
  'simulate_credit',
] as const
export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number]

export const isAgentToolName = (name: string): name is AgentToolName => (AGENT_TOOL_NAMES as readonly string[]).includes(name)

/** Quem chama, conforme atestado pela plataforma (nunca inferido do texto da conversa). */
export interface AgentCaller {
  conversationRefHash: string
  /** E.164 do remetente no canal WhatsApp, quando informado pela plataforma. */
  senderPhone: string | null
  senderVerified: boolean
}

export interface ToolRun {
  outcome: string
  result: Record<string, unknown>
}

export interface ToolAvailability {
  enabled: boolean
  reason: string
}

interface RegisteredTool {
  name: AgentToolName
  kind: 'information' | 'relationship' | 'financial'
  requiresSenderVerified: boolean
  /** Ferramentas financeiras não têm execução nesta entrega: a decisão de fase responde por elas. */
  financial?: FinancialCapability
  availability(ctx: AppContext): ToolAvailability
  /** Validação pura da entrada (sem efeito), também usada para conferir os exemplos do contrato. */
  validate?(rawInput: unknown): unknown
  execute?(ctx: AppContext, caller: AgentCaller & { senderPhone: string }, rawInput: unknown): Promise<ToolRun>
}

// ------------------------------------------------------------------------------------ mensagens

const linkMinutes = Math.round(PREFERENCES_LINK_TTL_SECONDS / 60)

export const AGENT_MESSAGES = {
  senderNotVerified:
    'Esta ação só pode ser feita pelo próprio titular, numa conversa pelo WhatsApp oficial. Também é possível usar o site da Minha Folga.',
  consentOutdated:
    'O texto de consentimento mudou. Apresente o texto atual (ver capacidades) e peça a confirmação novamente.',
  collectionUnavailable: 'O cadastro de interesse está indisponível no momento.',
  knowledgeUnavailable: 'A base de respostas aprovadas não está disponível agora.',
  creditUnavailable: 'Esta função de crédito ainda não está disponível.',
  created: 'Pronto, seu cadastro ficou registrado. Vamos avisar quando a análise estiver disponível.',
  updated: 'Pronto, seus dados foram atualizados.',
  needsReview:
    'Recebi seus dados, mas a equipe da Minha Folga precisa conferir algumas informações antes de concluir. Não é preciso enviar de novo.',
  notRegistered: 'Não encontrei um cadastro ativo para este número de WhatsApp.',
  revoked:
    'Pronto, registramos seu pedido. Você não vai mais receber os avisos nem as novidades da Minha Folga. Se mudar de ideia, é só pedir.',
  preferencesUpdated: 'Pronto, suas preferências foram atualizadas.',
  linkIssued: `Este é o seu link seguro para ver e alterar suas preferências. Ele vale por ${linkMinutes} minutos e só pode ser usado uma vez.`,
  faqEmpty:
    'Não há resposta aprovada para esta pergunta. Diga que não tem essa confirmação, não crie regra nem cite norma, e ofereça o atendimento.',
  faqFound: 'Responda somente com base nestes itens, em linguagem simples, e ofereça o link quando fizer sentido.',
} as const

// ------------------------------------------------------------------------------------ validação

const NO_CONTROL = /^[^\p{Cc}\p{Cf}]*$/u

function toolValidationError(error: z.ZodError, messages: Record<string, string>): AppError {
  const fields: Record<string, string> = {}
  for (const issue of error.issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) fields[['input', ...issue.path.map(String), key].join('.')] = 'Campo não esperado.'
      continue
    }
    const key = issue.path.map(String).join('.')
    const full = key ? `input.${key}` : 'input'
    fields[full] ??= messages[key] ?? 'Confira este campo.'
  }
  return Errors.validation(fields)
}

function parseInput<S extends z.ZodType>(schema: S, raw: unknown, messages: Record<string, string> = {}): z.output<S> {
  const r = schema.safeParse(raw)
  if (!r.success) throw toolValidationError(r.error, messages)
  return r.data
}

function fieldError(field: string, message: string): AppError {
  return Errors.validation({ [field]: message })
}

function checkConsentVersions(versions: Partial<Record<ConsentPurpose, string>>, granted: Partial<Record<ConsentPurpose, boolean>>) {
  for (const purpose of Object.keys(CONSENTS.purposes) as ConsentPurpose[]) {
    if (!granted[purpose]) continue
    const given = versions[purpose]
    if (!given) throw fieldError(`input.consentVersions.${purpose}`, 'Informe a versão do texto de consentimento apresentado.')
    if (given !== CONSENTS.purposes[purpose].version) throw Errors.conflict('consent_version_outdated', AGENT_MESSAGES.consentOutdated)
  }
}

const actorOf = (caller: AgentCaller): Extract<LifecycleActor, { type: 'agent' }> => ({ type: 'agent', conversationRefHash: caller.conversationRefHash })

function purposesSummary(view: PreferencesView) {
  return {
    state: view.state,
    purposes: { launch_notice: view.purposes.launch_notice.granted, marketing: view.purposes.marketing.granted },
    interestTopic: view.interestTopic,
  }
}

/** Dados do próprio titular, mascarados, para a Bia confirmar o cadastro na conversa. */
function customerSummary(ctx: AppContext, lead: LeadRow) {
  return {
    nameHint: nameHint(lead.full_name ?? lead.preferred_name),
    cpfHint: lead.cpf_hint,
    emailHint: lead.email_hint,
    employerName: decryptLeadField(lead, 'employer', ctx.config.secrets.encryption),
    employmentType: lead.employment_type,
    jobTenure: lead.job_tenure,
    incomeRange: lead.income_range,
    city: lead.city,
    uf: lead.uf,
  }
}

function defineTool<S extends z.ZodType>(def: {
  name: AgentToolName
  kind: RegisteredTool['kind']
  requiresSenderVerified: boolean
  schema: S
  messages?: Record<string, string>
  availability(ctx: AppContext): ToolAvailability
  run(ctx: AppContext, caller: AgentCaller & { senderPhone: string }, input: z.output<S>): Promise<ToolRun>
}): RegisteredTool {
  return {
    name: def.name,
    kind: def.kind,
    requiresSenderVerified: def.requiresSenderVerified,
    availability: def.availability,
    validate: (raw) => parseInput(def.schema, raw, def.messages),
    execute: (ctx, caller, raw) => def.run(ctx, caller, parseInput(def.schema, raw, def.messages)),
  }
}

/** Ferramenta financeira: a decisão é sempre do phase.service; nada é calculado ou inventado aqui. */
function financialTool(name: AgentToolName, capability: FinancialCapability): RegisteredTool {
  return {
    name,
    kind: 'financial',
    requiresSenderVerified: true,
    financial: capability,
    availability: (ctx) => {
      const d = financialCapability(ctx.config, capability)
      // Nenhuma integração homologada existe nesta entrega: mesmo "allowed" não executa.
      return { enabled: false, reason: d.allowed ? 'integration_not_available' : d.reason }
    },
  }
}

/** Erro devolvido por uma ferramenta financeira: 403 em PRE_LAUNCH; 503 enquanto não houver integração homologada. */
function financialDenial(ctx: AppContext, capability: FinancialCapability): AppError {
  const d = financialCapability(ctx.config, capability)
  if (d.reason === 'pre_launch') return Errors.creditPhaseLocked()
  return Errors.unavailable('credit_unavailable', AGENT_MESSAGES.creditUnavailable)
}

const available = (): ToolAvailability => ({ enabled: true, reason: 'available' })
const collectionAvailability = (ctx: AppContext): ToolAvailability =>
  ctx.config.collection.waitlistEnabled ? available() : { enabled: false, reason: 'collection_unavailable' }

// ------------------------------------------------------------------------------------ ferramentas

const PurposeFlags = z.strictObject({ launch_notice: z.boolean().optional(), marketing: z.boolean().optional() })
const PurposeVersions = z.strictObject({
  launch_notice: z.string().min(1).max(64).optional(),
  marketing: z.string().min(1).max(64).optional(),
})

const CUSTOMER_MESSAGES: Record<string, string> = {
  fullName: FIELD_MESSAGES.fullName,
  cpf: FIELD_MESSAGES.cpf,
  email: FIELD_MESSAGES.email,
  employerName: FIELD_MESSAGES.employerName,
  employmentType: `Use um vínculo de validation.json: ${VALIDATION.waitlist.employmentTypes.map((o) => o.value).join(', ')}.`,
  jobTenure: `Use uma faixa de validation.json: ${VALIDATION.waitlist.jobTenureRanges.map((o) => o.value).join(', ')}.`,
  incomeRange: `Use uma faixa de validation.json: ${VALIDATION.waitlist.incomeRanges.map((o) => o.value).join(', ')}.`,
  city: FIELD_MESSAGES.city,
  uf: 'Use a sigla da UF (ex.: SP).',
  ageConfirmed: 'É preciso a confirmação explícita de 18 anos ou mais (true).',
  interestTopic: FIELD_MESSAGES.interestTopic,
}

const TOOLS: RegisteredTool[] = [
  defineTool({
    name: 'get_approved_faq',
    kind: 'information',
    requiresSenderVerified: false,
    schema: z.strictObject({
      query: z.string().trim().min(1).max(200).regex(NO_CONTROL).optional(),
      category: z.string().trim().min(1).max(40).optional(),
      limit: z.number().int().min(1).max(5).optional(),
    }),
    messages: { query: 'Informe a pergunta com até 200 caracteres.', limit: 'Use um limite de 1 a 5.' },
    availability(ctx) {
      try {
        return faqBaseUsable(ctx, loadFaqBase(ctx)) ? available() : { enabled: false, reason: 'knowledge_base_not_approved' }
      } catch {
        return { enabled: false, reason: 'knowledge_base_unavailable' }
      }
    },
    async run(ctx, _caller, input) {
      const base = loadFaqBase(ctx)
      if (!faqBaseUsable(ctx, base)) throw Errors.unavailable('knowledge_base_unavailable', AGENT_MESSAGES.knowledgeUnavailable)
      if (input.category && !base.categories.some((c) => c.id === input.category)) {
        throw fieldError('input.category', `Categoria inexistente na base aprovada. Use: ${base.categories.map((c) => c.id).join(', ')}.`)
      }
      const items = searchFaq(base, input.query, input.category, input.limit ?? 3)
      const found = items.length > 0
      return {
        outcome: found ? 'ok' : 'empty',
        result: {
          found,
          baseVersion: faqBaseVersion(base),
          baseStatus: base.revision.status,
          items,
          categories: base.categories,
          note: found ? AGENT_MESSAGES.faqFound : AGENT_MESSAGES.faqEmpty,
        },
      }
    },
  }),

  defineTool({
    name: 'upsert_customer',
    kind: 'relationship',
    requiresSenderVerified: true,
    schema: z.strictObject({
      fullName: fullNameField.optional(),
      cpf: cpfField.optional(),
      email: emailField.nullable().optional(),
      employerName: employerField.optional(),
      employmentType: employmentTypeField.optional(),
      jobTenure: jobTenureField.optional(),
      incomeRange: incomeRangeField.optional(),
      city: cityField.optional(),
      uf: ufField.optional(),
      interestTopic: interestTopicField.nullable().optional(),
      ageConfirmed: z.literal(true).optional(),
      consents: PurposeFlags.optional(),
      consentVersions: PurposeVersions.optional(),
    }),
    messages: CUSTOMER_MESSAGES,
    availability: collectionAvailability,
    async run(ctx, caller, input) {
      if (!ctx.config.collection.waitlistEnabled) throw Errors.unavailable('collection_unavailable', AGENT_MESSAGES.collectionUnavailable)
      const data: CustomerFields = {}
      if (input.fullName !== undefined) data.fullName = input.fullName
      if (input.cpf !== undefined) data.cpf = input.cpf
      if (input.email !== undefined) data.email = input.email
      if (input.employerName !== undefined) data.employerName = input.employerName
      if (input.employmentType !== undefined) data.employmentType = input.employmentType as EmploymentType
      if (input.jobTenure !== undefined) data.jobTenure = input.jobTenure as JobTenure
      if (input.incomeRange !== undefined) data.incomeRange = input.incomeRange as IncomeRange
      if (input.city !== undefined) data.city = input.city
      if (input.uf !== undefined) data.uf = input.uf
      if (input.interestTopic !== undefined) data.interestTopic = input.interestTopic as InterestTopic | null
      checkConsentVersions(input.consentVersions ?? {}, input.consents ?? {})
      const r = await upsertCustomer(
        ctx,
        caller.senderPhone,
        { data, ageConfirmed: input.ageConfirmed, consents: input.consents, consentVersions: input.consentVersions },
        actorOf(caller),
      )
      if (r.status === 'needs_review') {
        return { outcome: 'needs_review', result: { status: 'needs_review', message: AGENT_MESSAGES.needsReview } }
      }
      const view = await getPreferences(ctx, r.lead.id)
      return {
        outcome: r.status,
        result: {
          status: r.status,
          message: r.status === 'created' ? AGENT_MESSAGES.created : AGENT_MESSAGES.updated,
          employmentNotice: r.lead.employment_type === 'outro' ? EMPLOYMENT_OTHER_NOTICE : null,
          contactVerified: true,
          ...purposesSummary(view),
          customer: customerSummary(ctx, r.lead),
        },
      }
    },
  }),

  defineTool({
    name: 'get_customer_status',
    kind: 'relationship',
    requiresSenderVerified: true,
    schema: z.strictObject({}),
    availability: available,
    async run(ctx, caller) {
      const leadId = await findLeadIdByPhone(ctx, caller.senderPhone)
      const lead = leadId ? await findActiveLead(ctx.db, leadId) : null
      if (!lead) return { outcome: 'not_registered', result: { status: 'not_registered', message: AGENT_MESSAGES.notRegistered } }
      const view = await getPreferences(ctx, lead.id)
      return {
        outcome: 'registered',
        result: {
          status: 'registered',
          contactVerified: lead.contact_verified_at !== null,
          ...purposesSummary(view),
          customer: customerSummary(ctx, lead),
        },
      }
    },
  }),

  defineTool({
    name: 'update_contact_preferences',
    kind: 'relationship',
    requiresSenderVerified: true,
    schema: z.discriminatedUnion('action', [
      z.strictObject({ action: z.literal('view') }),
      z.strictObject({ action: z.literal('revoke_all') }),
      z.strictObject({
        action: z.literal('set'),
        purposes: PurposeFlags.optional(),
        consentVersions: PurposeVersions.optional(),
        interestTopic: interestTopicField.nullable().optional(),
      }),
    ]),
    messages: { action: 'Use view, revoke_all ou set.' },
    availability: available,
    async run(ctx, caller, input) {
      const leadId = await findLeadIdByPhone(ctx, caller.senderPhone)
      if (!leadId) return { outcome: 'not_registered', result: { status: 'not_registered', message: AGENT_MESSAGES.notRegistered } }
      const actor = actorOf(caller)

      if (input.action === 'view') {
        return { outcome: 'ok', result: { status: 'current', ...purposesSummary(await getPreferences(ctx, leadId)) } }
      }
      if (input.action === 'revoke_all') {
        // "Sair", "pare", "não me mande": revoga tudo, sem pedir justificativa.
        await revokeAllCommunication(ctx, leadId, actor, 'bia')
        return { outcome: 'revoked', result: { status: 'revoked', message: AGENT_MESSAGES.revoked } }
      }

      const purposes = input.purposes ?? {}
      if (!Object.keys(purposes).length && input.interestTopic === undefined) {
        throw fieldError('input', 'Informe ao menos uma mudança (purposes ou interestTopic).')
      }
      checkConsentVersions(input.consentVersions ?? {}, purposes)
      const change: PreferencesChange = { purposes, consentVersions: input.consentVersions }
      if (input.interestTopic !== undefined) change.interestTopic = input.interestTopic as PreferencesChange['interestTopic']
      const view = await updatePreferences(ctx, leadId, change, actor, 'bia')
      return { outcome: 'updated', result: { status: 'updated', message: AGENT_MESSAGES.preferencesUpdated, ...purposesSummary(view) } }
    },
  }),

  defineTool({
    name: 'issue_preferences_link',
    kind: 'relationship',
    requiresSenderVerified: true,
    schema: z.strictObject({}),
    availability: available,
    async run(ctx, caller) {
      const leadId = await findLeadIdByPhone(ctx, caller.senderPhone)
      if (!leadId) return { outcome: 'not_registered', result: { status: 'not_registered', message: AGENT_MESSAGES.notRegistered } }
      const link = await issuePreferencesLink(ctx, leadId, actorOf(caller), 'bia')
      return {
        outcome: 'issued',
        result: { status: 'issued', url: link.url, expiresInSeconds: link.expiresInSeconds, message: AGENT_MESSAGES.linkIssued },
      }
    },
  }),

  financialTool('check_eligibility', 'eligibility_check'),
  financialTool('query_margin', 'margin_query'),
  financialTool('get_proposal', 'proposal_view'),
  financialTool('simulate_credit', 'simulation'),
]

const REGISTRY = new Map(TOOLS.map((t) => [t.name, t]))

export function agentTool(name: AgentToolName): RegisteredTool {
  return REGISTRY.get(name)!
}

/** Valida a entrada de uma ferramenta sem executá-la. Lança validation_error como a chamada real. */
export function validateAgentToolInput(name: AgentToolName, input: unknown): void {
  agentTool(name).validate?.(input)
}

// ------------------------------------------------------------------------------------ envelope

const ToolCallSchema = z.strictObject({
  conversationRef: z.string().min(1).max(128).regex(/^[\x21-\x7e]+$/),
  senderPhone: z.string().min(1).max(20).optional(),
  senderVerified: z.boolean().optional(),
  input: z.record(z.string(), z.unknown()),
})

export function conversationHash(ctx: AppContext, conversationRef: string): string {
  return hmacHex(conversationRef, ctx.config.secrets.sessionSecret, 'halai.conversation')
}

/** Valida o envelope da chamada (AgentToolCall). O telefone do remetente é normalizado para E.164. */
export function parseToolCall(ctx: AppContext, body: unknown): { caller: AgentCaller; input: Record<string, unknown> } {
  const r = ToolCallSchema.safeParse(body)
  if (!r.success) {
    const fields: Record<string, string> = {}
    for (const issue of r.error.issues) {
      if (issue.code === 'unrecognized_keys') {
        for (const key of issue.keys) fields[key] = 'Campo não esperado.'
        continue
      }
      const key = issue.path.map(String).join('.') || '_'
      fields[key] ??= key === 'input' ? 'Envie input como objeto.' : 'Confira este campo.'
    }
    throw Errors.validation(fields)
  }
  const { conversationRef, senderPhone, senderVerified, input } = r.data
  const phone = senderPhone ? normalizeBrazilianMobile(senderPhone) : null
  if (senderPhone && !phone) throw fieldError('senderPhone', 'Use o número do remetente em E.164 (+55DDNNNNNNNNN).')
  if (senderVerified && !phone) throw fieldError('senderPhone', 'senderVerified exige o número atestado do remetente.')
  return {
    caller: { conversationRefHash: conversationHash(ctx, conversationRef), senderPhone: phone, senderVerified: Boolean(senderVerified && phone) },
    input,
  }
}

// ------------------------------------------------------------------------------------ execução

async function recordToolCall(ctx: AppContext, tool: string, outcome: string, conversationRefHash: string | null): Promise<void> {
  try {
    await ctx.db.query(
      `INSERT INTO agent_tool_calls (id, tool, outcome, credit_phase, conversation_ref_hash, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), tool, outcome.slice(0, 64), ctx.config.credit.phase, conversationRefHash, ctx.now()],
    )
    await incrementMetric(ctx.db, ctx.now(), 'agent_tool_call', `${tool}:${outcome}`)
  } catch (err) {
    // O registro não pode desfazer o efeito já aplicado (ex.: cadastro criado); falha vai para o log técnico.
    ctx.logger.error({ err, tool }, 'falha ao registrar chamada de ferramenta da Bia')
  }
}

/** Executa uma ferramenta a partir do corpo bruto já autenticado. Registra o desfecho em qualquer caso. */
export async function executeAgentTool(ctx: AppContext, name: AgentToolName, body: unknown): Promise<ToolRun> {
  const tool = agentTool(name)
  if (tool.financial || !tool.execute) {
    // Fase antes de tudo: a entrada de ferramenta financeira nem é lida (pode conter CPF ou dados de crédito).
    const denial = financialDenial(ctx, tool.financial ?? 'proposal_view')
    await recordToolCall(ctx, name, denial.code, safeConversationHash(ctx, body))
    throw denial
  }

  let conversationRefHash: string | null = null
  try {
    const { caller, input } = parseToolCall(ctx, body)
    conversationRefHash = caller.conversationRefHash
    if (tool.requiresSenderVerified && !(caller.senderVerified && caller.senderPhone)) {
      throw new AppError(403, 'sender_not_verified', AGENT_MESSAGES.senderNotVerified, {
        extra: { alternativeUrl: `${ctx.config.siteUrl}${name === 'upsert_customer' ? '/avise-me' : '/preferencias'}` },
      })
    }
    // Ferramentas sem atestado (FAQ) não usam o telefone; as demais recebem o número atestado.
    const run = await tool.execute(ctx, { ...caller, senderPhone: caller.senderPhone ?? '' }, input)
    await recordToolCall(ctx, name, run.outcome, conversationRefHash)
    return run
  } catch (err) {
    await recordToolCall(ctx, name, err instanceof AppError ? err.code : 'error', conversationRefHash ?? safeConversationHash(ctx, body))
    throw err
  }
}

function safeConversationHash(ctx: AppContext, body: unknown): string | null {
  const ref = (body as { conversationRef?: unknown } | null)?.conversationRef
  return typeof ref === 'string' && ref.length >= 1 && ref.length <= 128 ? conversationHash(ctx, ref) : null
}

// ------------------------------------------------------------------------------------ capacidades

export interface AgentCapabilities {
  phase: CreditPhase
  tools: { name: AgentToolName; enabled: boolean; reason: string; kind: RegisteredTool['kind']; requiresSenderVerified: boolean }[]
  knowledgeBase: { version: string; status: string } | null
  consents: Record<ConsentPurpose, { version: string; text: string }>
  /** Códigos e rótulos aceitos por upsert_customer (contracts/validation.json → waitlist). */
  options: {
    employmentTypes: { value: string; label: string }[]
    jobTenureRanges: { value: string; label: string }[]
    incomeRanges: { value: string; label: string }[]
    interestTopics: { value: string; label: string }[]
    ufs: string[]
  }
  humanSupport: { available: boolean; hours: string | null; responseTime: string | null }
  links: Record<string, string>
}

/**
 * Capacidades na fase vigente, para a Bia decidir o que oferecer. Tudo aqui é público:
 * nenhuma chave, URL interna, segredo ou dado de pessoa.
 */
export function agentCapabilities(ctx: AppContext): AgentCapabilities {
  let knowledgeBase: AgentCapabilities['knowledgeBase'] = null
  try {
    const base = loadFaqBase(ctx)
    knowledgeBase = { version: faqBaseVersion(base), status: base.revision.status }
  } catch {
    knowledgeBase = null
  }
  const site = ctx.config.siteUrl
  const w = VALIDATION.waitlist
  return {
    phase: ctx.config.credit.phase,
    tools: TOOLS.map((t) => ({ name: t.name, kind: t.kind, requiresSenderVerified: t.requiresSenderVerified, ...t.availability(ctx) })),
    knowledgeBase,
    consents: {
      launch_notice: { version: CONSENTS.purposes.launch_notice.version, text: CONSENTS.purposes.launch_notice.text },
      marketing: { version: CONSENTS.purposes.marketing.version, text: CONSENTS.purposes.marketing.text },
    },
    options: {
      employmentTypes: w.employmentTypes,
      jobTenureRanges: w.jobTenureRanges,
      incomeRanges: w.incomeRanges,
      interestTopics: w.interestTopics,
      ufs: w.ufs,
    },
    humanSupport: {
      available: ctx.config.humanSupport.enabled,
      hours: ctx.config.identity.supportHours ?? null,
      responseTime: ctx.config.identity.supportResponseTime ?? null,
    },
    links: {
      site,
      atendimento: `${site}/atendimento`,
      ajuda: `${site}/ajuda`,
      aviseMe: `${site}/avise-me`,
      preferencias: `${site}/preferencias`,
      privacidade: `${site}/privacidade`,
      seguranca: `${site}/seguranca`,
      lancamento: `${site}/lancamento`,
      bia: `${site}/bia`,
    },
  }
}
