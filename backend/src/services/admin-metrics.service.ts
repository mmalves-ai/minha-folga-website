import { z } from 'zod'
import { Errors } from '../lib/errors.js'
import { ADMIN_TIME_ZONE, addDateRange, dateParam } from './admin-common.js'
import type { AppContext } from '../context.js'

/**
 * Métricas agregadas de cadastro, preferências e atendimento. Somente contagens: nenhuma consulta
 * aqui lê nome, contato, mensagem ou nota, e o papel marketing só enxerga este endpoint.
 */
export const MetricsQuerySchema = z.strictObject({ from: dateParam.optional(), to: dateParam.optional() })

const DEFAULT_DAYS = 30
const MAX_DAYS = 366
/** Vínculos compatíveis com a proposta inicial (autodeclarados). */
export const ELIGIBLE_EMPLOYMENT_TYPES = ['clt', 'domestico', 'rural'] as const

function localToday(now: Date): string {
  // en-CA formata como AAAA-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: ADMIN_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

function shiftDays(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1
}

export interface AdminMetricsView {
  period: { from: string; to: string }
  leads: {
    created: number
    /** Números validados no período (contact_verified_at): desde a D1, sempre pela Bia. */
    verified: number
    /** Validados pela Bia no período (evento contact_verified registrado pela ferramenta da Bia). */
    verifiedByBia: number
    verifiedWithEligibleIntent: number
    unsubscribed: number
    /** Submissões do site/Bia guardadas para revisão no período (não aplicadas a cadastros existentes). */
    pendingReview: number
    byState: Record<string, number>
    byEmploymentType: Record<string, number>
    bySource: Record<string, number>
    /** Distribuições dos cadastros criados no período; `sem_registro` = cadastro anterior à D1. */
    byUf: Record<string, number>
    byIncomeRange: Record<string, number>
    byJobTenure: Record<string, number>
    byDay: Array<{ day: string; created: number; verified: number }>
  }
  preferences: { launchNoticeGranted: number; marketingGranted: number }
  support: { created: number; byStatus: Record<string, number>; medianFirstResponseHours: number | null }
  /** Eventos de produto (POST /api/events), pelo nome do contrato, com as N dimensões mais frequentes. */
  events: MetricRow[]
  /** Eventos com mais dimensões do que o limite: o que ficou de fora, somado. */
  eventsOmitted: OmittedRow[]
  /** Contadores internos (cadastro, envios, atendimento, Bia), também limitados às N dimensões mais frequentes. */
  counters: MetricRow[]
  countersOmitted: OmittedRow[]
  /** N: dimensões devolvidas por nome de evento ou contador. */
  dimensionsPerName: number
}

export interface MetricRow {
  name: string
  dimension: string
  count: number
}

export interface OmittedRow {
  name: string
  dimensions: number
  count: number
}

/** Dimensões devolvidas por nome (top-N por contagem): a resposta tem tamanho limitado em qualquer período. */
export const METRIC_DIMENSIONS_PER_NAME = 25
const EVENT_PREFIX = 'event:'

interface RankedRow {
  name: string
  dimension: string
  count: number
  dims: number
  name_total: number
}

/** Separa eventos de produto e contadores internos e resume o que passou do top-N. */
function splitCounters(rows: RankedRow[]) {
  const events: MetricRow[] = []
  const counters: MetricRow[] = []
  const kept = new Map<string, { dims: number; total: number; keptCount: number; keptDims: number }>()
  for (const row of rows) {
    const isEvent = row.name.startsWith(EVENT_PREFIX)
    const name = isEvent ? row.name.slice(EVENT_PREFIX.length) : row.name
    ;(isEvent ? events : counters).push({ name, dimension: row.dimension, count: row.count })
    const key = row.name
    const k = kept.get(key) ?? { dims: row.dims, total: row.name_total, keptCount: 0, keptDims: 0 }
    k.keptCount += row.count
    k.keptDims += 1
    kept.set(key, k)
  }
  const eventsOmitted: OmittedRow[] = []
  const countersOmitted: OmittedRow[] = []
  for (const [key, k] of kept) {
    if (k.dims <= k.keptDims) continue
    const isEvent = key.startsWith(EVENT_PREFIX)
    const omitted = { name: isEvent ? key.slice(EVENT_PREFIX.length) : key, dimensions: k.dims - k.keptDims, count: k.total - k.keptCount }
    ;(isEvent ? eventsOmitted : countersOmitted).push(omitted)
  }
  return { events, eventsOmitted, counters, countersOmitted }
}

export async function getAdminMetrics(ctx: AppContext, query: z.infer<typeof MetricsQuerySchema>): Promise<AdminMetricsView> {
  const to = query.to ?? localToday(ctx.now())
  const from = query.from ?? shiftDays(to, -(DEFAULT_DAYS - 1))
  if (from > to) throw Errors.validation({ to: 'A data final precisa ser igual ou posterior à inicial.' })
  if (daysBetween(from, to) > MAX_DAYS) throw Errors.validation({ from: `Escolha um período de até ${MAX_DAYS} dias.` })

  const db = ctx.db
  const count = async (sql: string, params: unknown[]) => (await db.query<{ n: number }>(sql, params)).rows[0]?.n ?? 0
  const grouped = async (column: string, table: string, dateColumn: string, nullAs?: string) => {
    const where: string[] = []
    const params: unknown[] = []
    addDateRange(where, params, dateColumn, from, to)
    const key = nullAs ? `COALESCE(${column}, '${nullAs}')` : column
    const r = await db.query<{ key: string; n: number }>(
      `SELECT ${key} AS key, count(*)::int AS n FROM ${table} WHERE ${where.join(' AND ')} GROUP BY 1 ORDER BY 1`,
      params,
    )
    return Object.fromEntries(r.rows.map((row) => [row.key, row.n]))
  }
  const range = (column: string, extra: string[] = [], baseParams: unknown[] = []) => {
    const where = [...extra]
    const params = [...baseParams]
    addDateRange(where, params, column, from, to)
    return { where: where.join(' AND '), params }
  }

  const created = range('l.created_at')
  const verified = range('l.contact_verified_at')
  // Métrica principal: número validado (pela Bia) no período, vínculo compatível e aviso de abertura autorizado.
  const eligible = range(
    'l.contact_verified_at',
    [`l.employment_type IN (${ELIGIBLE_EMPLOYMENT_TYPES.map((t) => `'${t}'`).join(', ')})`, 'l.anonymized_at IS NULL', 'p.granted'],
  )
  const unsub = range('e.created_at', [`e.to_state = 'unsubscribed'`])
  const byBia = range('e.created_at', [`e.event_type = 'contact_verified'`, `e.actor_type = 'agent'`])
  const held = range('s.created_at')
  const support = range('r.created_at')

  const [
    leadsCreated,
    leadsVerified,
    verifiedWithEligibleIntent,
    unsubscribed,
    launchNoticeGranted,
    marketingGranted,
    supportCreated,
    verifiedByBia,
    pendingReview,
  ] = await Promise.all([
    count(`SELECT count(*)::int AS n FROM leads l WHERE ${created.where}`, created.params),
    count(`SELECT count(*)::int AS n FROM leads l WHERE ${verified.where}`, verified.params),
    count(
      `SELECT count(*)::int AS n FROM leads l
         JOIN lead_preferences p ON p.lead_id = l.id AND p.purpose = 'launch_notice'
        WHERE ${eligible.where}`,
      eligible.params,
    ),
    count(`SELECT count(DISTINCT e.lead_id)::int AS n FROM lead_events e WHERE ${unsub.where}`, unsub.params),
    count(
      `SELECT count(*)::int AS n FROM leads l JOIN lead_preferences p ON p.lead_id = l.id AND p.purpose = 'launch_notice' AND p.granted
        WHERE ${created.where}`,
      created.params,
    ),
    count(
      `SELECT count(*)::int AS n FROM leads l JOIN lead_preferences p ON p.lead_id = l.id AND p.purpose = 'marketing' AND p.granted
        WHERE ${created.where}`,
      created.params,
    ),
    count(`SELECT count(*)::int AS n FROM support_requests r WHERE ${support.where}`, support.params),
    count(`SELECT count(DISTINCT e.lead_id)::int AS n FROM lead_events e WHERE ${byBia.where}`, byBia.params),
    count(`SELECT count(*)::int AS n FROM lead_submissions s WHERE ${held.where}`, held.params),
  ])

  const [byState, byEmploymentType, bySource, byStatus, byUf, byIncomeRange, byJobTenure] = await Promise.all([
    grouped('state', 'leads', 'created_at'),
    grouped('employment_type', 'leads', 'created_at'),
    grouped('source', 'leads', 'created_at'),
    grouped('status', 'support_requests', 'created_at'),
    grouped('uf', 'leads', 'created_at', 'sem_registro'),
    grouped('income_range', 'leads', 'created_at', 'sem_registro'),
    grouped('job_tenure', 'leads', 'created_at', 'sem_registro'),
  ])

  const tz = ADMIN_TIME_ZONE
  const byDay = await db.query<{ day: string; created: number; verified: number }>(
    `WITH days AS (
       SELECT d::date AS day FROM generate_series($1::date::timestamp, $2::date::timestamp, interval '1 day') AS d
     ), c AS (
       SELECT (created_at AT TIME ZONE '${tz}')::date AS day, count(*)::int AS n FROM leads
        WHERE created_at >= ($1::date::timestamp AT TIME ZONE '${tz}') AND created_at < (($2::date + 1)::timestamp AT TIME ZONE '${tz}')
        GROUP BY 1
     ), v AS (
       SELECT (contact_verified_at AT TIME ZONE '${tz}')::date AS day, count(*)::int AS n FROM leads
        WHERE contact_verified_at >= ($1::date::timestamp AT TIME ZONE '${tz}') AND contact_verified_at < (($2::date + 1)::timestamp AT TIME ZONE '${tz}')
        GROUP BY 1
     )
     SELECT to_char(days.day, 'YYYY-MM-DD') AS day, COALESCE(c.n, 0)::int AS created, COALESCE(v.n, 0)::int AS verified
       FROM days LEFT JOIN c ON c.day = days.day LEFT JOIN v ON v.day = days.day
      ORDER BY days.day`,
    [from, to],
  )

  const median = await db.query<{ hours: number | string | null }>(
    `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (r.first_response_at - r.created_at)) / 3600.0) AS hours
       FROM support_requests r WHERE ${support.where} AND r.first_response_at IS NOT NULL`,
    support.params,
  )
  const hours = median.rows[0]?.hours
  const medianFirstResponseHours = hours === null || hours === undefined ? null : Math.round(Number(hours) * 100) / 100

  // Contadores (metric_counters) usam o dia UTC em que foram gravados. Só as N dimensões mais frequentes de
  // cada nome saem; o restante vem somado em *Omitted.
  const ranked = await db.query<RankedRow>(
    `WITH totals AS (
       SELECT name, dimension, sum(count)::int AS count FROM metric_counters
        WHERE day >= $1::date AND day <= $2::date
        GROUP BY name, dimension
     ), ranked AS (
       SELECT name, dimension, count,
              row_number() OVER (PARTITION BY name ORDER BY count DESC, dimension) AS rank,
              count(*) OVER (PARTITION BY name) AS dims,
              sum(count) OVER (PARTITION BY name) AS name_total
         FROM totals
     )
     SELECT name, dimension, count, dims::int AS dims, name_total::int AS name_total
       FROM ranked WHERE rank <= $3
      ORDER BY name, rank`,
    [from, to, METRIC_DIMENSIONS_PER_NAME],
  )
  const split = splitCounters(ranked.rows)

  return {
    period: { from, to },
    leads: {
      created: leadsCreated,
      verified: leadsVerified,
      verifiedByBia,
      verifiedWithEligibleIntent,
      unsubscribed,
      pendingReview,
      byState,
      byEmploymentType,
      bySource,
      byUf,
      byIncomeRange,
      byJobTenure,
      byDay: byDay.rows,
    },
    preferences: { launchNoticeGranted, marketingGranted },
    support: { created: supportCreated, byStatus, medianFirstResponseHours },
    ...split,
    dimensionsPerName: METRIC_DIMENSIONS_PER_NAME,
  }
}
