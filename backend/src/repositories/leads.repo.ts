import { randomUUID } from 'node:crypto'
import type { ConsentPurpose } from '../config/contracts.js'
import type { Queryable } from '../db/database.js'
import { cpfHint, cpfKey } from '../lib/cpf.js'
import { decryptField, encryptField, hmacHex, type Keyring } from '../lib/crypto.js'
import { phoneHint } from '../lib/phone.js'
import { emailHint } from '../lib/email.js'
import type {
  CustomerData,
  EmploymentType,
  IncomeRange,
  InterestTopic,
  JobTenure,
  LeadState,
  LifecycleActor,
} from '../services/lead-lifecycle.js'

/**
 * Acesso a dados do cadastro (leads, preferências, trilha do titular e supressão).
 * Regras: telefone, CPF, e-mail e empregador só cifrados (contexto por campo e por cadastro), deduplicação por
 * HMAC (telefone: domínio 'phone'; CPF: domínio 'cpf'), datas sempre vindas de `ctx.now()` (nunca `now()` do
 * banco) para que expiração e retenção sejam testáveis.
 */

export const PURPOSES: readonly ConsentPurpose[] = ['launch_notice', 'marketing']

export interface LeadRow {
  id: string
  preferred_name: string
  full_name: string | null
  phone_ciphertext: string
  phone_hint: string
  dedup_key: string
  cpf_ciphertext: string | null
  cpf_hint: string | null
  cpf_key: string | null
  email_ciphertext: string | null
  email_hint: string | null
  employer_ciphertext: string | null
  employment_type: EmploymentType
  job_tenure: JobTenure | null
  income_range: IncomeRange | null
  city: string | null
  uf: string | null
  interest_topic: InterestTopic | null
  state: LeadState
  contact_verified_at: Date | null
  source: string
  created_at: Date
  updated_at: Date
  last_interaction_at: Date
  anonymized_at: Date | null
}

export const LEAD_COLUMNS =
  'id, preferred_name, full_name, phone_ciphertext, phone_hint, dedup_key, cpf_ciphertext, cpf_hint, cpf_key, email_ciphertext, email_hint, employer_ciphertext, employment_type, job_tenure, income_range, city, uf, interest_topic, state, contact_verified_at, source, created_at, updated_at, last_interaction_at, anonymized_at'

/** Contextos de cifragem dos campos do cadastro (também usados pelo painel para revelar o contato). */
export const LEAD_CIPHER_CONTEXT = {
  phone: (leadId: string) => `lead.phone:${leadId}`,
  cpf: (leadId: string) => `lead.cpf:${leadId}`,
  email: (leadId: string) => `lead.email:${leadId}`,
  employer: (leadId: string) => `lead.employer:${leadId}`,
} as const

/** Compatibilidade: contexto do telefone. */
export const leadPhoneContext = LEAD_CIPHER_CONTEXT.phone

export function contactDedupKey(e164: string, key: Buffer): string {
  return hmacHex(e164, key, 'phone')
}

export function decryptLeadPhone(row: Pick<LeadRow, 'id' | 'phone_ciphertext'>, keyring: Keyring): string {
  return decryptField(row.phone_ciphertext, keyring, LEAD_CIPHER_CONTEXT.phone(row.id))
}

/** Decifra um campo opcional; null quando ausente ou ilegível (quem chama decide se isso é erro). */
export function decryptLeadField(
  row: Pick<LeadRow, 'id'> & Partial<Record<'cpf_ciphertext' | 'email_ciphertext' | 'employer_ciphertext', string | null>>,
  field: 'cpf' | 'email' | 'employer',
  keyring: Keyring,
): string | null {
  const ciphertext = row[`${field}_ciphertext`]
  if (!ciphertext) return null
  try {
    return decryptField(ciphertext, keyring, LEAD_CIPHER_CONTEXT[field](row.id))
  } catch {
    return null
  }
}

export async function findLeadByDedup(q: Queryable, dedupKey: string, options: { forUpdate?: boolean } = {}): Promise<LeadRow | null> {
  const r = await q.query<LeadRow>(
    `SELECT ${LEAD_COLUMNS} FROM leads WHERE dedup_key = $1${options.forUpdate ? ' FOR UPDATE' : ''}`,
    [dedupKey],
  )
  return r.rows[0] ?? null
}

/** Cadastro ativo (não anonimizado) com este CPF. */
export async function findLeadByCpfKey(q: Queryable, key: string, options: { forUpdate?: boolean } = {}): Promise<LeadRow | null> {
  const r = await q.query<LeadRow>(
    `SELECT ${LEAD_COLUMNS} FROM leads WHERE cpf_key = $1 AND anonymized_at IS NULL${options.forUpdate ? ' FOR UPDATE' : ''}`,
    [key],
  )
  return r.rows[0] ?? null
}

/** Cadastro ativo (não anonimizado) pelo id. */
export async function findActiveLead(q: Queryable, leadId: string, options: { forUpdate?: boolean } = {}): Promise<LeadRow | null> {
  const r = await q.query<LeadRow>(
    `SELECT ${LEAD_COLUMNS} FROM leads WHERE id = $1 AND anonymized_at IS NULL${options.forUpdate ? ' FOR UPDATE' : ''}`,
    [leadId],
  )
  return r.rows[0] ?? null
}

/**
 * Um cadastro anonimizado que ainda guarde a chave de deduplicação não pode impedir um novo cadastro
 * do mesmo número: a chave antiga é substituída por um valor sem relação com o telefone.
 */
export async function releaseAnonymizedDedupKey(q: Queryable, leadId: string): Promise<void> {
  await q.query(`UPDATE leads SET dedup_key = $2, cpf_key = NULL WHERE id = $1 AND anonymized_at IS NOT NULL`, [leadId, `anonymized:${leadId}`])
}

const LOCK_NAMESPACE = 7_107_311

/**
 * Serializa pedidos do mesmo telefone/CPF dentro da transação (dois cliques, abas, processos, site e Bia).
 * Chaves em ordem fixa para não haver impasse entre transações. No PGlite (conexão única) as transações já são
 * sequenciais; o comando é o mesmo nos dois bancos.
 */
export async function lockKeys(tx: Queryable, keys: Array<string | null | undefined>): Promise<void> {
  const unique = [...new Set(keys.filter((k): k is string => Boolean(k)))].sort()
  for (const key of unique) {
    const n = Number.parseInt(key.slice(0, 8), 16) | 0
    await tx.query('SELECT pg_advisory_xact_lock($1::int, $2::int)', [LOCK_NAMESPACE, n])
  }
}

export interface NewLead {
  id: string
  data: CustomerData
  dedupKey: string
  cpfKey: string
  source: string
  utm: Partial<Record<UtmKey, string>>
  privacyNoticeVersion: string
  at: Date
}

export type UtmKey = 'utm_source' | 'utm_medium' | 'utm_campaign' | 'utm_content' | 'utm_term'

export function firstNameOf(fullName: string): string {
  return (fullName.split(' ')[0] ?? fullName).slice(0, 80)
}

export async function insertLead(q: Queryable, keyring: Keyring, lead: NewLead): Promise<LeadRow> {
  const d = lead.data
  const r = await q.query<LeadRow>(
    `INSERT INTO leads (id, preferred_name, full_name, phone_ciphertext, phone_hint, dedup_key, cpf_ciphertext, cpf_hint, cpf_key,
        email_ciphertext, email_hint, employer_ciphertext, employment_type, job_tenure, income_range, city, uf, interest_topic,
        age_confirmed, state, source, utm_source, utm_medium, utm_campaign, utm_content, utm_term, privacy_notice_version,
        created_at, updated_at, last_interaction_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, true, 'received',
        $19, $20, $21, $22, $23, $24, $25, $26, $26, $26)
     RETURNING ${LEAD_COLUMNS}`,
    [
      lead.id,
      firstNameOf(d.fullName),
      d.fullName,
      encryptField(d.phoneE164, keyring, LEAD_CIPHER_CONTEXT.phone(lead.id)),
      phoneHint(d.phoneE164),
      lead.dedupKey,
      encryptField(d.cpf, keyring, LEAD_CIPHER_CONTEXT.cpf(lead.id)),
      cpfHint(d.cpf),
      lead.cpfKey,
      d.email ? encryptField(d.email, keyring, LEAD_CIPHER_CONTEXT.email(lead.id)) : null,
      d.email ? emailHint(d.email) : null,
      encryptField(d.employerName, keyring, LEAD_CIPHER_CONTEXT.employer(lead.id)),
      d.employmentType,
      d.jobTenure,
      d.incomeRange,
      d.city,
      d.uf,
      d.interestTopic,
      lead.source,
      lead.utm.utm_source ?? null,
      lead.utm.utm_medium ?? null,
      lead.utm.utm_campaign ?? null,
      lead.utm.utm_content ?? null,
      lead.utm.utm_term ?? null,
      lead.privacyNoticeVersion,
      lead.at,
    ],
  )
  return r.rows[0]!
}

/** Campos do cadastro que podem mudar (Bia com número atestado, titular em /preferencias). */
export interface LeadDataUpdate {
  fullName?: string
  cpf?: string
  email?: string | null
  employerName?: string
  employmentType?: EmploymentType
  jobTenure?: JobTenure
  incomeRange?: IncomeRange
  city?: string
  uf?: string
  interestTopic?: InterestTopic | null
}

/**
 * Aplica as mudanças que de fato alteram o cadastro (compara com os valores atuais, decifrando os cifrados).
 * Retorna os nomes dos campos alterados (sem valores), para a trilha. `lead` é atualizado em memória.
 */
export async function updateLeadData(
  q: Queryable,
  keyring: Keyring,
  dedupHmacKey: Buffer,
  lead: LeadRow,
  change: LeadDataUpdate,
  at: Date,
): Promise<string[]> {
  const sets: string[] = []
  const params: unknown[] = [lead.id]
  const changed: string[] = []
  const set = (column: string, value: unknown) => {
    params.push(value)
    sets.push(`${column} = $${params.length}`)
    ;(lead as unknown as Record<string, unknown>)[column] = value
  }

  if (change.fullName !== undefined && change.fullName !== lead.full_name) {
    set('full_name', change.fullName)
    set('preferred_name', firstNameOf(change.fullName))
    changed.push('fullName')
  }
  if (change.cpf !== undefined && decryptLeadField(lead, 'cpf', keyring) !== change.cpf) {
    set('cpf_ciphertext', encryptField(change.cpf, keyring, LEAD_CIPHER_CONTEXT.cpf(lead.id)))
    set('cpf_hint', cpfHint(change.cpf))
    set('cpf_key', cpfKey(change.cpf, dedupHmacKey))
    changed.push('cpf')
  }
  if (change.email !== undefined && decryptLeadField(lead, 'email', keyring) !== change.email) {
    set('email_ciphertext', change.email ? encryptField(change.email, keyring, LEAD_CIPHER_CONTEXT.email(lead.id)) : null)
    set('email_hint', change.email ? emailHint(change.email) : null)
    changed.push('email')
  }
  if (change.employerName !== undefined && decryptLeadField(lead, 'employer', keyring) !== change.employerName) {
    set('employer_ciphertext', encryptField(change.employerName, keyring, LEAD_CIPHER_CONTEXT.employer(lead.id)))
    changed.push('employerName')
  }
  const plain: Array<[keyof LeadDataUpdate, keyof LeadRow]> = [
    ['employmentType', 'employment_type'],
    ['jobTenure', 'job_tenure'],
    ['incomeRange', 'income_range'],
    ['city', 'city'],
    ['uf', 'uf'],
    ['interestTopic', 'interest_topic'],
  ]
  for (const [field, column] of plain) {
    const value = change[field]
    if (value !== undefined && value !== lead[column]) {
      set(column, value)
      changed.push(field)
    }
  }
  if (!sets.length) return []
  params.push(at)
  sets.push(`updated_at = $${params.length}`)
  await q.query(`UPDATE leads SET ${sets.join(', ')} WHERE id = $1`, params)
  return changed
}

export async function setLeadState(q: Queryable, leadId: string, state: LeadState, at: Date): Promise<void> {
  await q.query('UPDATE leads SET state = $2, updated_at = $3 WHERE id = $1', [leadId, state, at])
}

export async function touchInteraction(q: Queryable, leadId: string, at: Date): Promise<void> {
  await q.query('UPDATE leads SET last_interaction_at = $2, updated_at = $2 WHERE id = $1', [leadId, at])
}

// Preferências ------------------------------------------------------------------------------------

export interface PreferenceRow {
  purpose: ConsentPurpose
  granted: boolean
  consent_text_version: string
  source: string
  updated_at: Date
}

export async function readPreferences(q: Queryable, leadId: string): Promise<Map<ConsentPurpose, PreferenceRow>> {
  const r = await q.query<PreferenceRow>(
    'SELECT purpose, granted, consent_text_version, source, updated_at FROM lead_preferences WHERE lead_id = $1',
    [leadId],
  )
  return new Map(r.rows.map((row) => [row.purpose, row]))
}

export async function upsertPreference(
  q: Queryable,
  leadId: string,
  purpose: ConsentPurpose,
  granted: boolean,
  version: string,
  source: string,
  at: Date,
): Promise<void> {
  await q.query(
    `INSERT INTO lead_preferences (lead_id, purpose, granted, consent_text_version, source, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (lead_id, purpose) DO UPDATE
       SET granted = EXCLUDED.granted, consent_text_version = EXCLUDED.consent_text_version,
           source = EXCLUDED.source, updated_at = EXCLUDED.updated_at`,
    [leadId, purpose, granted, version, source, at],
  )
}

// Trilha do titular (lead_events) -----------------------------------------------------------------

export type LeadEventType =
  | 'state_changed'
  | 'preference_changed'
  | 'contact_verified'
  | 'interest_updated'
  | 'profile_updated'
  | 'submission_held'
  | 'anonymized'
  | 'invited'

export interface LeadEventInput {
  type: LeadEventType
  fromState?: LeadState | null
  toState?: LeadState | null
  purpose?: ConsentPurpose | null
  granted?: boolean | null
  consentTextVersion?: string | null
}

export function actorColumns(actor: LifecycleActor): { actorType: LifecycleActor['type']; actorId: string | null } {
  switch (actor.type) {
    case 'admin':
      return { actorType: 'admin', actorId: actor.adminId }
    case 'agent':
      return { actorType: 'agent', actorId: actor.conversationRefHash }
    default:
      return { actorType: actor.type, actorId: null }
  }
}

/**
 * Registra eventos de um mesmo ato (mesma origem e autor). Cada evento recebe +1 ms para que a trilha
 * mantenha a ordem das transições quando lida pelo painel.
 */
export class LeadEventLog {
  private seq = 0
  constructor(
    private readonly q: Queryable,
    private readonly actor: LifecycleActor,
    private readonly source: string,
    private readonly at: Date,
  ) {}

  async add(leadId: string, event: LeadEventInput): Promise<void> {
    const { actorType, actorId } = actorColumns(this.actor)
    const at = new Date(this.at.getTime() + this.seq++)
    await this.q.query(
      `INSERT INTO lead_events (id, lead_id, event_type, from_state, to_state, purpose, granted, consent_text_version,
          source, actor_type, actor_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        randomUUID(),
        leadId,
        event.type,
        event.fromState ?? null,
        event.toState ?? null,
        event.purpose ?? null,
        event.granted ?? null,
        event.consentTextVersion ?? null,
        this.source,
        actorType,
        actorId,
        at,
      ],
    )
  }

  /** Muda o estado e registra a transição (sem evento quando o estado já é o desejado). */
  async transition(lead: { id: string; state: LeadState }, to: LeadState): Promise<void> {
    if (lead.state === to) return
    await setLeadState(this.q, lead.id, to, this.at)
    await this.add(lead.id, { type: 'state_changed', fromState: lead.state, toState: to })
    lead.state = to
  }
}

// Supressão e mensagens pendentes ---------------------------------------------------------------------

/** Chave suprimida (telefone ou CPF): pedido de exclusão/oposição registrado pela equipe de privacidade. */
export async function isSuppressed(q: Queryable, ...keys: Array<string | null | undefined>): Promise<boolean> {
  const list = keys.filter((k): k is string => Boolean(k))
  if (!list.length) return false
  const r = await q.query('SELECT 1 FROM suppression_list WHERE dedup_key = ANY($1::text[]) LIMIT 1', [list])
  return r.rows.length > 0
}

/** Cancela mensagens ainda não enviadas de finalidades revogadas. Mensagens em envio seguem o próprio ciclo. */
export async function cancelPendingMessages(
  q: Queryable,
  leadId: string,
  purposes: readonly string[],
  reason: string,
  at: Date,
): Promise<number> {
  if (!purposes.length) return 0
  const r = await q.query(
    `UPDATE outbox_messages SET status = 'cancelled', last_error = $3, locked_until = NULL, updated_at = $4
      WHERE lead_id = $1 AND purpose = ANY($2::text[]) AND status = 'pending'`,
    [leadId, [...purposes], reason, at],
  )
  return r.rowCount
}
