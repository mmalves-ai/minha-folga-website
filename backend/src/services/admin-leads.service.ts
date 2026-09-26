import { z } from 'zod'
import { EMPLOYMENT_TYPES, INCOME_RANGES, JOB_TENURE_RANGES, UFS } from '../config/contracts.js'
import { cpfHint, formatCpf } from '../lib/cpf.js'
import { emailHint } from '../lib/email.js'
import { AppError, Errors } from '../lib/errors.js'
import { phoneHint } from '../lib/phone.js'
import { decryptLeadField, decryptLeadPhone } from '../repositories/leads.repo.js'
import { pendingSubmissionsOf, readSubmissionPayload } from '../repositories/submissions.repo.js'
import { isApplicable } from './admin-submissions.service.js'
import { recordAudit } from './audit.service.js'
import { addDateRange, checkRange, dateParam, iso, pageParam, pageSizeParam, type Page } from './admin-common.js'
import type { AdminPrincipal } from './admin-auth.service.js'
import type { LeadState } from './lead-lifecycle.js'
import type { AppContext } from '../context.js'

/**
 * Cadastros no painel (decisão D1). Para `leads:read`: nome, empregador, faixas, UF/cidade e origem visíveis;
 * telefone, CPF e e-mail SEMPRE mascarados. O dado completo só sai por reveal-contact (`leads:read_contact`, com
 * justificativa, auditado). Toda leitura que devolve dados pessoais fica na auditoria, sem dados do titular.
 */
export const LEAD_STATES = [
  'received',
  'verified',
  'invited',
  'unsubscribed',
  'expired',
  // Legado (antes da D1): só em cadastros antigos.
  'verification_pending',
  'waiting',
  'human_support',
] as const satisfies readonly LeadState[]

const filterShape = {
  from: dateParam.optional(),
  to: dateParam.optional(),
  state: z.enum(LEAD_STATES).optional(),
  source: z.string().trim().min(1).max(64).optional(),
  employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
  jobTenure: z.enum(JOB_TENURE_RANGES).optional(),
  incomeRange: z.enum(INCOME_RANGES).optional(),
  uf: z.enum(UFS).optional(),
  /** "telefone validado": a própria pessoa falou com a Bia (número atestado). */
  phoneVerified: z.enum(['true', 'false']).optional(),
  purpose: z.enum(['launch_notice', 'marketing']).optional(),
  granted: z.enum(['true', 'false']).optional(),
}

export const LeadFiltersSchema = z.strictObject(filterShape)
export const LeadListQuerySchema = z.strictObject({ ...filterShape, page: pageParam, pageSize: pageSizeParam })
export type LeadFilters = z.infer<typeof LeadFiltersSchema>

export const LEAD_FILTER_MESSAGES = {
  from: 'Use uma data no formato AAAA-MM-DD.',
  to: 'Use uma data no formato AAAA-MM-DD.',
  state: 'Estado desconhecido.',
  employmentType: 'Vínculo desconhecido.',
  jobTenure: 'Tempo de emprego desconhecido.',
  incomeRange: 'Faixa de renda desconhecida.',
  uf: 'UF desconhecida.',
  phoneVerified: 'Use true ou false.',
  purpose: 'Finalidade desconhecida.',
  granted: 'Use true ou false.',
}

const PURPOSE_ALIAS = { launch_notice: 'pl', marketing: 'pm' } as const

const FROM_LEADS = `FROM leads l
  LEFT JOIN lead_preferences pl ON pl.lead_id = l.id AND pl.purpose = 'launch_notice'
  LEFT JOIN lead_preferences pm ON pm.lead_id = l.id AND pm.purpose = 'marketing'`

function buildWhere(filters: LeadFilters): { sql: string; params: unknown[] } {
  checkRange(filters.from, filters.to)
  const where: string[] = []
  const params: unknown[] = []
  addDateRange(where, params, 'l.created_at', filters.from, filters.to)
  const eq = (column: string, value: unknown) => {
    params.push(value)
    where.push(`${column} = $${params.length}`)
  }
  if (filters.state) eq('l.state', filters.state)
  if (filters.source) eq('l.source', filters.source)
  if (filters.employmentType) eq('l.employment_type', filters.employmentType)
  if (filters.jobTenure) eq('l.job_tenure', filters.jobTenure)
  if (filters.incomeRange) eq('l.income_range', filters.incomeRange)
  if (filters.uf) eq('l.uf', filters.uf)
  if (filters.phoneVerified) where.push(filters.phoneVerified === 'true' ? 'l.contact_verified_at IS NOT NULL' : 'l.contact_verified_at IS NULL')
  if (filters.granted && !filters.purpose) throw Errors.validation({ purpose: 'Informe a finalidade para filtrar por autorização.' })
  if (filters.purpose) {
    // Sem registro de preferência conta como não autorizado.
    params.push((filters.granted ?? 'true') === 'true')
    where.push(`COALESCE(${PURPOSE_ALIAS[filters.purpose]}.granted, false) = $${params.length}`)
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params }
}

interface LeadRow {
  id: string
  preferred_name: string
  full_name: string | null
  phone_hint: string
  cpf_hint: string | null
  email_hint: string | null
  employer_ciphertext: string | null
  employment_type: string
  job_tenure: string | null
  income_range: string | null
  city: string | null
  uf: string | null
  interest_topic: string | null
  state: LeadState
  source: string
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  contact_verified_at: Date | null
  created_at: Date
  anonymized_at: Date | null
  launch_notice: boolean
  marketing: boolean
  pending_review: number
}

const LEAD_COLUMNS = `l.id, l.preferred_name, l.full_name, l.phone_hint, l.cpf_hint, l.email_hint, l.employer_ciphertext,
  l.employment_type, l.job_tenure, l.income_range, l.city, l.uf, l.interest_topic, l.state, l.source,
  l.utm_source, l.utm_medium, l.utm_campaign, l.contact_verified_at, l.created_at, l.anonymized_at,
  COALESCE(pl.granted, false) AS launch_notice, COALESCE(pm.granted, false) AS marketing,
  (SELECT count(*)::int FROM lead_submissions s WHERE s.lead_id = l.id AND s.status = 'pending') AS pending_review`

export interface AdminLeadView {
  id: string
  /** Primeiro nome (cadastros antigos só têm este). */
  preferredName: string
  fullName: string
  phoneHint: string
  /** true quando a própria pessoa falou com a Bia (número atestado pela plataforma). */
  phoneVerified: boolean
  cpfHint: string | null
  emailHint: string | null
  employerName: string | null
  employmentType: string
  jobTenure: string | null
  incomeRange: string | null
  city: string | null
  uf: string | null
  interestTopic: string | null
  state: LeadState
  source: string
  utmSource: string | null
  utmCampaign: string | null
  contactVerifiedAt: string | null
  createdAt: string
  purposes: { launch_notice: boolean; marketing: boolean }
  /** Submissões guardadas para revisão (não aplicadas ao cadastro). */
  pendingReview: number
}

function toView(ctx: AppContext, row: LeadRow): AdminLeadView {
  return {
    id: row.id,
    preferredName: row.preferred_name,
    fullName: row.full_name ?? row.preferred_name,
    // Contato e documento sempre mascarados; o dado completo só sai por reveal-contact.
    phoneHint: row.phone_hint,
    phoneVerified: row.contact_verified_at !== null,
    cpfHint: row.cpf_hint,
    emailHint: row.email_hint,
    employerName: decryptLeadField(row, 'employer', ctx.config.secrets.encryption),
    employmentType: row.employment_type,
    jobTenure: row.job_tenure,
    incomeRange: row.income_range,
    city: row.city,
    uf: row.uf,
    interestTopic: row.interest_topic,
    state: row.state,
    source: row.source,
    utmSource: row.utm_source,
    utmCampaign: row.utm_campaign,
    contactVerifiedAt: iso(row.contact_verified_at),
    createdAt: iso(row.created_at)!,
    purposes: { launch_notice: row.launch_notice, marketing: row.marketing },
    pendingReview: row.pending_review ?? 0,
  }
}

/**
 * Lista cadastros. Como devolve dados pessoais (nome, empregador, dicas), toda consulta fica na auditoria:
 * quem, quando, filtros, página e quantidade — sem nenhum dado do titular.
 */
export async function listLeads(
  ctx: AppContext,
  principal: AdminPrincipal,
  query: z.infer<typeof LeadListQuerySchema>,
  ipHash: string,
): Promise<Page<AdminLeadView>> {
  const { page, pageSize, ...filters } = query
  const { sql, params } = buildWhere(filters)
  const total = await ctx.db.query<{ total: number }>(`SELECT count(*)::int AS total ${FROM_LEADS} ${sql}`, params)
  const rows = await ctx.db.query<LeadRow>(
    `SELECT ${LEAD_COLUMNS} ${FROM_LEADS} ${sql}
      ORDER BY l.created_at DESC, l.id
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pageSize, (page - 1) * pageSize],
  )
  const result = { items: rows.rows.map((r) => toView(ctx, r)), total: total.rows[0]?.total ?? 0, page, pageSize }
  await recordAudit(ctx.db, {
    actorType: 'admin',
    actorId: principal.user.id,
    action: 'admin.leads_listed',
    resourceType: 'lead',
    resourceId: null,
    metadata: { filters, page, pageSize, returned: result.items.length, total: result.total },
    ipHash,
  })
  return result
}

/** Submissão guardada para revisão, mascarada como o cadastro (nunca CPF, telefone ou e-mail completos). */
export interface AdminSubmissionView {
  id: string
  channel: string
  source: string
  reason: string
  createdAt: string
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
  consents: { launch_notice: boolean | null; marketing: boolean | null }
  /** Pode ser aplicada ao cadastro (`privacy:manage`); `false` = só descartar (admin-submissions.service.ts). */
  applicable: boolean
}

export interface AdminLeadDetailView extends AdminLeadView {
  anonymized: boolean
  events: Array<{
    type: string
    fromState: string | null
    toState: string | null
    purpose: string | null
    granted: boolean | null
    source: string
    actorType: string
    at: string
  }>
  pendingSubmissions: AdminSubmissionView[]
}

export async function getLeadDetail(ctx: AppContext, principal: AdminPrincipal, leadId: string, ipHash: string): Promise<AdminLeadDetailView> {
  const r = await ctx.db.query<LeadRow>(`SELECT ${LEAD_COLUMNS} ${FROM_LEADS} WHERE l.id = $1`, [leadId])
  const row = r.rows[0]
  if (!row) throw Errors.notFound('Cadastro não encontrado.')
  const events = await ctx.db.query<{
    event_type: string
    from_state: string | null
    to_state: string | null
    purpose: string | null
    granted: boolean | null
    source: string
    actor_type: string
    created_at: Date
  }>(
    `SELECT event_type, from_state, to_state, purpose, granted, source, actor_type, created_at
       FROM lead_events WHERE lead_id = $1 ORDER BY created_at, id`,
    [leadId],
  )
  const keyring = ctx.config.secrets.encryption
  const submissions = (await pendingSubmissionsOf(ctx.db, leadId)).map((s): AdminSubmissionView => {
    const p = readSubmissionPayload(s, keyring)
    const d = p?.data
    return {
      id: s.id,
      channel: s.channel,
      source: s.source,
      reason: s.reason,
      createdAt: iso(s.created_at)!,
      data: d
        ? {
            fullName: d.fullName ?? null,
            phoneHint: d.phoneE164 ? phoneHint(d.phoneE164) : null,
            cpfHint: d.cpf ? cpfHint(d.cpf) : null,
            emailHint: d.email ? emailHint(d.email) : null,
            employerName: d.employerName ?? null,
            employmentType: d.employmentType ?? null,
            jobTenure: d.jobTenure ?? null,
            incomeRange: d.incomeRange ?? null,
            city: d.city ?? null,
            uf: d.uf ?? null,
            interestTopic: d.interestTopic ?? null,
          }
        : null,
      consents: { launch_notice: p?.consents?.launch_notice ?? null, marketing: p?.consents?.marketing ?? null },
      applicable: isApplicable(s.reason, p),
    }
  })
  await recordAudit(ctx.db, {
    actorType: 'admin',
    actorId: principal.user.id,
    action: 'admin.lead_viewed',
    resourceType: 'lead',
    resourceId: leadId,
    metadata: { pendingSubmissions: submissions.length },
    ipHash,
  })
  return {
    ...toView(ctx, row),
    anonymized: row.anonymized_at !== null,
    events: events.rows.map((e) => ({
      type: e.event_type,
      fromState: e.from_state,
      toState: e.to_state,
      purpose: e.purpose,
      granted: e.granted,
      source: e.source,
      actorType: e.actor_type,
      at: iso(e.created_at)!,
    })),
    pendingSubmissions: submissions,
  }
}

export interface RevealedContact {
  phone: string
  email: string | null
  /** Formatado (000.000.000-00); null em cadastros anteriores à D1. */
  cpf: string | null
}

/**
 * Revela telefone, e-mail e CPF com justificativa (`leads:read_contact`). A auditoria (quem, motivo e quais
 * campos existiam — nunca os valores) é gravada antes da resposta.
 */
export async function revealLeadContact(
  ctx: AppContext,
  principal: AdminPrincipal,
  leadId: string,
  reason: string,
  ipHash: string,
): Promise<RevealedContact> {
  const r = await ctx.db.query<{
    id: string
    phone_ciphertext: string
    cpf_ciphertext: string | null
    email_ciphertext: string | null
    anonymized_at: Date | null
  }>('SELECT id, phone_ciphertext, cpf_ciphertext, email_ciphertext, anonymized_at FROM leads WHERE id = $1', [leadId])
  const row = r.rows[0]
  if (!row) throw Errors.notFound('Cadastro não encontrado.')
  if (row.anonymized_at) throw Errors.conflict('lead_anonymized', 'Este cadastro foi anonimizado; o contato não existe mais.')
  const keyring = ctx.config.secrets.encryption
  let revealed: RevealedContact
  try {
    // Mesmos contextos do cadastro ('lead.phone|cpf|email:<id>'), pelas funções do próprio repositório.
    const phone = decryptLeadPhone(row, keyring)
    const cpf = row.cpf_ciphertext ? decryptLeadField(row, 'cpf', keyring) : null
    const email = row.email_ciphertext ? decryptLeadField(row, 'email', keyring) : null
    if ((row.cpf_ciphertext && !cpf) || (row.email_ciphertext && !email)) throw new Error('campo ilegível')
    revealed = { phone, email, cpf: cpf ? formatCpf(cpf) : null }
  } catch (err) {
    throw new AppError(500, 'decrypt_failed', 'Não foi possível abrir este contato. Avise a equipe técnica.', { cause: err })
  }
  await recordAudit(ctx.db, {
    actorType: 'admin',
    actorId: principal.user.id,
    action: 'admin.lead_contact_revealed',
    resourceType: 'lead',
    resourceId: leadId,
    metadata: { reason, fields: ['phone', ...(revealed.email ? ['email'] : []), ...(revealed.cpf ? ['cpf'] : [])] },
    ipHash,
  })
  return revealed
}

// Exportação CSV -----------------------------------------------------------------------------------

export const EXPORT_MAX_ROWS = 50_000

/**
 * Célula CSV segura: aspas duplicadas e prefixo "'" quando o valor começa com caractere que planilhas
 * interpretam como fórmula (=, +, -, @, tabulação, retorno de carro), mesmo após espaços.
 */
export function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '""'
  let text = String(value)
  if (/^[\t\r]/.test(text) || /^\s*[=+\-@]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

const CSV_HEADER = [
  'id',
  'criado_em',
  'nome',
  'telefone_mascarado',
  'telefone_validado',
  'cpf_mascarado',
  'email_mascarado',
  'empregador',
  'vinculo',
  'tempo_emprego',
  'faixa_renda',
  'cidade',
  'uf',
  'interesse',
  'estado',
  'origem',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'contato_confirmado_em',
  'aviso_lancamento',
  'novidades',
  'revisao_pendente',
  'anonimizado',
]

/** CSV mascarado: telefone, CPF e e-mail só como dica. Justificativa obrigatória; auditado. */
export async function exportLeadsCsv(
  ctx: AppContext,
  principal: AdminPrincipal,
  filters: LeadFilters,
  reason: string,
  ipHash: string,
): Promise<{ csv: string; rowCount: number }> {
  const { sql, params } = buildWhere(filters)
  const r = await ctx.db.query<LeadRow>(
    `SELECT ${LEAD_COLUMNS} ${FROM_LEADS} ${sql} ORDER BY l.created_at, l.id LIMIT $${params.length + 1}`,
    [...params, EXPORT_MAX_ROWS + 1],
  )
  if (r.rows.length > EXPORT_MAX_ROWS) {
    throw Errors.badRequest(
      'export_too_large',
      `A exportação está limitada a ${EXPORT_MAX_ROWS.toLocaleString('pt-BR')} cadastros. Refine os filtros.`,
    )
  }
  const yes = (v: boolean) => (v ? 'sim' : 'nao')
  const lines = [CSV_HEADER.map(csvCell).join(',')]
  for (const row of r.rows) {
    const v = toView(ctx, row)
    lines.push(
      [
        v.id,
        v.createdAt,
        v.fullName,
        v.phoneHint,
        yes(v.phoneVerified),
        v.cpfHint,
        v.emailHint,
        v.employerName,
        v.employmentType,
        v.jobTenure,
        v.incomeRange,
        v.city,
        v.uf,
        v.interestTopic,
        v.state,
        v.source,
        row.utm_source,
        row.utm_medium,
        row.utm_campaign,
        v.contactVerifiedAt,
        yes(v.purposes.launch_notice),
        yes(v.purposes.marketing),
        v.pendingReview,
        yes(row.anonymized_at !== null),
      ]
        .map(csvCell)
        .join(','),
    )
  }
  await recordAudit(ctx.db, {
    actorType: 'admin',
    actorId: principal.user.id,
    action: 'admin.leads_exported',
    resourceType: 'lead',
    resourceId: null,
    metadata: { reason, filters, rowCount: r.rows.length },
    ipHash,
  })
  // BOM para planilhas reconhecerem UTF-8; quebras CRLF (RFC 4180).
  return { csv: `﻿${lines.join('\r\n')}\r\n`, rowCount: r.rows.length }
}
