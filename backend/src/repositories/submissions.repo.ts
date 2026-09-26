import { randomUUID } from 'node:crypto'
import type { Queryable } from '../db/database.js'
import { decryptField, encryptField, type Keyring } from '../lib/crypto.js'
import type { CustomerData } from '../services/lead-lifecycle.js'

/**
 * Submissões guardadas para revisão (lead_submissions, migração 003). Um cadastro existente nunca é sobrescrito
 * pelo site: a nova submissão fica aqui, cifrada, até a equipe de privacidade revisar (ou a revisão de retenção
 * removê-la). Também guarda o que a Bia enviou quando o CPF pertence a outro cadastro, diverge do cadastrado ou o
 * número está suprimido. O painel mostra só dados mascarados.
 */
export type SubmissionChannel = 'site' | 'bia'
export type SubmissionReason =
  | 'existing_phone'
  | 'existing_cpf'
  | 'existing_phone_and_cpf'
  | 'cpf_conflict'
  | 'cpf_mismatch'
  | 'suppressed'

/** Conteúdo cifrado da submissão. Campos ausentes = não enviados (a Bia pode mandar só parte dos dados). */
export interface SubmissionPayload {
  v: 1
  data: Partial<CustomerData>
  consents?: Partial<Record<'launch_notice' | 'marketing', boolean>>
  source: string
}

export const submissionContext = (id: string) => `lead_submission:${id}`

export interface NewSubmission {
  leadId: string | null
  channel: SubmissionChannel
  source: string
  reason: SubmissionReason
  phoneKey: string | null
  cpfKey: string | null
  payload: SubmissionPayload
  at: Date
}

export async function insertSubmission(q: Queryable, keyring: Keyring, s: NewSubmission): Promise<string> {
  const id = randomUUID()
  await q.query(
    `INSERT INTO lead_submissions (id, lead_id, channel, source, reason, phone_key, cpf_key, payload_ciphertext, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9)`,
    [id, s.leadId, s.channel, s.source, s.reason, s.phoneKey, s.cpfKey, encryptField(JSON.stringify(s.payload), keyring, submissionContext(id)), s.at],
  )
  return id
}

export interface SubmissionRow {
  id: string
  lead_id: string | null
  channel: SubmissionChannel
  source: string
  reason: SubmissionReason
  payload_ciphertext: string
  status: string
  created_at: Date
}

export async function pendingSubmissionsOf(q: Queryable, leadId: string): Promise<SubmissionRow[]> {
  const r = await q.query<SubmissionRow>(
    `SELECT id, lead_id, channel, source, reason, payload_ciphertext, status, created_at
       FROM lead_submissions WHERE lead_id = $1 AND status = 'pending' ORDER BY created_at, id`,
    [leadId],
  )
  return r.rows
}

export function readSubmissionPayload(row: Pick<SubmissionRow, 'id' | 'payload_ciphertext'>, keyring: Keyring): SubmissionPayload | null {
  if (!row.payload_ciphertext) return null
  try {
    return JSON.parse(decryptField(row.payload_ciphertext, keyring, submissionContext(row.id))) as SubmissionPayload
  } catch {
    return null
  }
}
