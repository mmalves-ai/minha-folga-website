import { randomUUID } from 'node:crypto'
import type { AppContext } from '../context.js'
import type { Queryable } from '../db/database.js'
import { ANTI_BOT_ATTEMPTS_RETENTION_MS } from '../services/anti-bot.service.js'
import { recordAudit } from '../services/audit.service.js'
import { REDACTED_PAYLOAD } from './outbox-worker.js'

/**
 * Revisão de retenção (seção 9 — proposta operacional a validar com a equipe de privacidade).
 *
 * - Cadastros sem interação há 180 dias são marcados `expired` (com lead_events), sinalizando revisão.
 *   Exclusão ou anonimização é DECISÃO da equipe de privacidade, tomada no painel administrativo; este job
 *   não apaga nem anonimiza cadastros. O estado `expired` não revoga consentimentos: o titular que pediu o
 *   aviso de abertura continua elegível a recebê-lo até a decisão da equipe ou a própria revogação.
 * - Artefatos técnicos vencidos há mais de 30 dias são removidos: desafios de verificação (legado, sem uso desde a
 *   D1), sessões e links de acesso; eventos de replay das chamadas da Bia; conteúdo e destinatário de mensagens já
 *   finalizadas; submissões guardadas para revisão (cifradas) com mais de 30 dias.
 * - Anti-robô: usos de token já vencidos e tentativas com mais de 2 dias (fora de qualquer janela de limite).
 * - Simulação por padrão: nada muda sem `apply: true`.
 */

export interface RetentionOptions {
  apply?: boolean
  inactivityDays?: number
  purgeAfterDays?: number
}

export interface RetentionReport {
  mode: 'dry_run' | 'apply'
  now: string
  inactivityCutoff: string
  purgeCutoff: string
  staleLeads: { total: number; byState: Record<string, number> }
  expiredLeads: number
  challenges: number
  sessions: number
  accessTokens: number
  outboxRedacted: number
  webhookEvents: number
  heldSubmissions: number
  formTokens: number
  formAttempts: number
}

export type RetentionDeps = Pick<AppContext, 'db' | 'now' | 'logger'>

const DAY_MS = 24 * 60 * 60 * 1000
const BATCH = 500

const STALE_WHERE = `anonymized_at IS NULL AND state <> 'expired' AND last_interaction_at < $1`
const CHALLENGES_WHERE = `expires_at < $1`
const SESSIONS_WHERE = `expires_at < $1 OR revoked_at < $1`
const TOKENS_WHERE = `expires_at < $1 OR used_at < $1`
const OUTBOX_WHERE = `status IN ('sent', 'failed', 'cancelled') AND updated_at < $1
  AND (payload_ciphertext <> '${REDACTED_PAYLOAD}' OR recipient_ciphertext IS NOT NULL)`
const WEBHOOK_WHERE = `received_at < $1`
const SUBMISSIONS_WHERE = `created_at < $1`
const FORM_TOKENS_WHERE = `expires_at < $1`
const FORM_ATTEMPTS_WHERE = `created_at < $1`

async function count(q: Queryable, table: string, where: string, cutoff: Date): Promise<number> {
  const r = await q.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`, [cutoff])
  return r.rows[0]?.n ?? 0
}

async function expireStaleLeads(deps: RetentionDeps, cutoff: Date, now: Date): Promise<number> {
  let total = 0
  for (;;) {
    const done = await deps.db.transaction(async (tx) => {
      const r = await tx.query<{ id: string; state: string }>(
        `SELECT id, state FROM leads WHERE ${STALE_WHERE} ORDER BY last_interaction_at LIMIT ${BATCH} FOR UPDATE SKIP LOCKED`,
        [cutoff],
      )
      for (const lead of r.rows) {
        await tx.query(`UPDATE leads SET state = 'expired', updated_at = $2 WHERE id = $1`, [lead.id, now])
        await tx.query(
          `INSERT INTO lead_events (id, lead_id, event_type, from_state, to_state, source, actor_type, created_at)
           VALUES ($1, $2, 'state_changed', $3, 'expired', 'retencao', 'system', $4)`,
          [randomUUID(), lead.id, lead.state, now],
        )
      }
      return r.rows.length
    })
    total += done
    if (done < BATCH) return total
  }
}

export async function runRetention(deps: RetentionDeps, options: RetentionOptions = {}): Promise<RetentionReport> {
  const now = deps.now()
  const inactivityCutoff = new Date(now.getTime() - (options.inactivityDays ?? 180) * DAY_MS)
  const purgeCutoff = new Date(now.getTime() - (options.purgeAfterDays ?? 30) * DAY_MS)
  const attemptsCutoff = new Date(now.getTime() - ANTI_BOT_ATTEMPTS_RETENTION_MS)
  const db = deps.db

  const byStateRows = await db.query<{ state: string; n: number }>(
    `SELECT state, count(*)::int AS n FROM leads WHERE ${STALE_WHERE} GROUP BY state ORDER BY state`,
    [inactivityCutoff],
  )
  const byState = Object.fromEntries(byStateRows.rows.map((r) => [r.state, r.n]))
  const report: RetentionReport = {
    mode: options.apply ? 'apply' : 'dry_run',
    now: now.toISOString(),
    inactivityCutoff: inactivityCutoff.toISOString(),
    purgeCutoff: purgeCutoff.toISOString(),
    staleLeads: { total: byStateRows.rows.reduce((sum, r) => sum + r.n, 0), byState },
    expiredLeads: 0,
    challenges: await count(db, 'verification_challenges', CHALLENGES_WHERE, purgeCutoff),
    sessions: await count(db, 'contact_sessions', SESSIONS_WHERE, purgeCutoff),
    accessTokens: await count(db, 'contact_access_tokens', TOKENS_WHERE, purgeCutoff),
    outboxRedacted: await count(db, 'outbox_messages', OUTBOX_WHERE, purgeCutoff),
    webhookEvents: await count(db, 'webhook_events', WEBHOOK_WHERE, purgeCutoff),
    heldSubmissions: await count(db, 'lead_submissions', SUBMISSIONS_WHERE, purgeCutoff),
    formTokens: await count(db, 'form_token_uses', FORM_TOKENS_WHERE, now),
    formAttempts: await count(db, 'form_attempts', FORM_ATTEMPTS_WHERE, attemptsCutoff),
  }
  if (!options.apply) return report

  report.expiredLeads = await expireStaleLeads(deps, inactivityCutoff, now)
  await db.transaction(async (tx) => {
    report.challenges = (await tx.query(`DELETE FROM verification_challenges WHERE ${CHALLENGES_WHERE}`, [purgeCutoff])).rowCount
    report.sessions = (await tx.query(`DELETE FROM contact_sessions WHERE ${SESSIONS_WHERE}`, [purgeCutoff])).rowCount
    report.accessTokens = (await tx.query(`DELETE FROM contact_access_tokens WHERE ${TOKENS_WHERE}`, [purgeCutoff])).rowCount
    report.outboxRedacted = (
      await tx.query(
        `UPDATE outbox_messages SET payload_ciphertext = '${REDACTED_PAYLOAD}', recipient_ciphertext = NULL WHERE ${OUTBOX_WHERE}`,
        [purgeCutoff],
      )
    ).rowCount
    report.webhookEvents = (await tx.query(`DELETE FROM webhook_events WHERE ${WEBHOOK_WHERE}`, [purgeCutoff])).rowCount
    report.heldSubmissions = (await tx.query(`DELETE FROM lead_submissions WHERE ${SUBMISSIONS_WHERE}`, [purgeCutoff])).rowCount
    report.formTokens = (await tx.query(`DELETE FROM form_token_uses WHERE ${FORM_TOKENS_WHERE}`, [now])).rowCount
    report.formAttempts = (await tx.query(`DELETE FROM form_attempts WHERE ${FORM_ATTEMPTS_WHERE}`, [attemptsCutoff])).rowCount
    await recordAudit(tx, {
      actorType: 'system',
      action: 'retention.applied',
      metadata: {
        inactivityCutoff: report.inactivityCutoff,
        purgeCutoff: report.purgeCutoff,
        expiredLeads: report.expiredLeads,
        challenges: report.challenges,
        sessions: report.sessions,
        accessTokens: report.accessTokens,
        outboxRedacted: report.outboxRedacted,
        webhookEvents: report.webhookEvents,
        heldSubmissions: report.heldSubmissions,
        formTokens: report.formTokens,
        formAttempts: report.formAttempts,
      },
    })
  })
  deps.logger.info({ ...report, staleLeads: report.staleLeads.total }, 'retenção aplicada')
  return report
}
