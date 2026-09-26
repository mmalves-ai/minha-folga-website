import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BACKEND_ROOT } from '../src/config/paths.js'
import { createDatabase } from '../src/db/database.js'
import { migrate } from '../src/db/migrate.js'
import { randomUUID } from 'node:crypto'
import { runRetention } from '../src/jobs/retention.js'
import { enqueueMessage } from '../src/repositories/outbox.repo.js'
import { createTestHarness, HALAI_ENV, TEST_ENV, type TestHarness } from './helpers.js'
import { attested, callTool, envelope, newPerson, registerSite } from './lead-flow.js'

const DAY = 24 * 60 * 60 * 1000

let h: TestHarness
beforeAll(async () => {
  h = await createTestHarness(HALAI_ENV)
})
afterAll(async () => {
  await h.close()
})

const ago = (days: number) => new Date(h.clock.current.getTime() - days * DAY)
const one = async <T>(sql: string, params: unknown[]) => (await h.ctx.db.query<T>(sql, params)).rows[0] as T

async function leadAgedBy(days: number) {
  const person = newPerson()
  const leadId = await registerSite(h, person)
  await h.ctx.db.query('UPDATE leads SET last_interaction_at = $2 WHERE id = $1', [leadId, ago(days)])
  return { phone: person.phone, person, leadId }
}

describe('revisão de retenção', () => {
  it('simulação por padrão (nada muda); --apply marca expired só quem passou de 180 dias, com trilha', async () => {
    const stale = await leadAgedBy(181)
    const fresh = await leadAgedBy(179)
    const anonymized = await leadAgedBy(400)
    await h.ctx.db.query('UPDATE leads SET anonymized_at = $2 WHERE id = $1', [anonymized.leadId, ago(10)])

    const dry = await runRetention(h.ctx)
    expect(dry.mode).toBe('dry_run')
    expect(dry.staleLeads).toEqual({ total: 1, byState: { received: 1 } })
    expect(dry.expiredLeads).toBe(0)
    expect((await one<{ state: string }>('SELECT state FROM leads WHERE id = $1', [stale.leadId])).state).toBe('received')

    const applied = await runRetention(h.ctx, { apply: true })
    expect(applied.expiredLeads).toBe(1)
    const states = await h.ctx.db.query<{ id: string; state: string }>('SELECT id, state FROM leads WHERE id = ANY($1::uuid[])', [
      [stale.leadId, fresh.leadId, anonymized.leadId],
    ])
    expect(Object.fromEntries(states.rows.map((r) => [r.id, r.state]))).toEqual({
      [stale.leadId]: 'expired',
      [fresh.leadId]: 'received',
      [anonymized.leadId]: 'received',
    })
    const event = await one<Record<string, unknown>>(
      `SELECT from_state, to_state, source, actor_type FROM lead_events WHERE lead_id = $1 AND to_state = 'expired'`,
      [stale.leadId],
    )
    expect(event).toEqual({ from_state: 'received', to_state: 'expired', source: 'retencao', actor_type: 'system' })

    // Rodar de novo não duplica a trilha.
    expect((await runRetention(h.ctx, { apply: true })).expiredLeads).toBe(0)
    const count = await one<{ n: number }>(`SELECT count(*)::int AS n FROM lead_events WHERE lead_id = $1 AND to_state = 'expired'`, [stale.leadId])
    expect(count.n).toBe(1)

    // O relatório e a auditoria só têm contagens e datas.
    const audit = await one<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM audit_log WHERE action = 'retention.applied' ORDER BY created_at DESC LIMIT 1`,
      [],
    )
    const text = JSON.stringify([applied, audit.metadata])
    expect(text).not.toContain(stale.phone.e164.slice(3))
    expect(text).not.toContain(stale.person.cpf.digits)
    expect(text).not.toContain(stale.leadId)
  })

  it('expired não revoga consentimento: o titular que volta pela Bia (número atestado) retorna para verified', async () => {
    const { phone, leadId } = await leadAgedBy(200)
    await runRetention(h.ctx, { apply: true })
    expect((await one<{ state: string }>('SELECT state FROM leads WHERE id = $1', [leadId])).state).toBe('expired')
    const granted = await one<{ granted: boolean }>(`SELECT granted FROM lead_preferences WHERE lead_id = $1 AND purpose = 'launch_notice'`, [leadId])
    expect(granted.granted).toBe(true)

    const res = await callTool(h, 'upsert_customer', envelope({ city: 'Santos' }, attested(phone.e164)))
    expect(res.body.result.status).toBe('updated')
    const lead = await one<{ state: string; last_interaction_at: Date }>('SELECT state, last_interaction_at FROM leads WHERE id = $1', [leadId])
    expect(lead.state).toBe('verified')
    expect(lead.last_interaction_at.getTime()).toBe(h.clock.current.getTime())
  })

  it('remove desafios legados, sessões, links, replays, submissões retidas e itens do anti-robô vencidos; apaga conteúdo de mensagens finalizadas', async () => {
    const { leadId, phone } = await leadAgedBy(1)
    const oldChallenge = { id: randomUUID() }
    await h.ctx.db.query(
      `INSERT INTO verification_challenges (id, purpose, dedup_key, lead_id, code_hash, expires_at, max_attempts) VALUES ($1, 'waitlist', 'chave', $2, 'h', $3, 5)`,
      [oldChallenge.id, leadId, ago(31)],
    )
    await h.ctx.db.query(
      `INSERT INTO lead_submissions (id, lead_id, channel, source, reason, payload_ciphertext, status, created_at)
       VALUES ($1, $2, 'site', 'avise-me', 'existing_phone', 'cifrado', 'pending', $3), ($4, $2, 'site', 'avise-me', 'existing_phone', 'cifrado', 'pending', $5)`,
      [randomUUID(), leadId, ago(31), randomUUID(), ago(2)],
    )
    await h.ctx.db.query(
      `INSERT INTO form_token_uses (token_hash, purpose, used_at, expires_at) VALUES ('tok-old', 'waitlist', $1, $1), ('tok-live', 'waitlist', $2, $3)`,
      [ago(1), h.clock.current, new Date(h.clock.current.getTime() + DAY)],
    )
    await h.ctx.db.query(
      `INSERT INTO form_attempts (id, purpose, ip_key, created_at) VALUES ($1, 'waitlist', 'rede', $2), ($3, 'waitlist', 'rede', $4)`,
      [randomUUID(), ago(3), randomUUID(), ago(1)],
    )
    const sentId = (await enqueueMessage(h.ctx, h.ctx.db, {
      kind: 'halai_template',
      channel: 'halai',
      purpose: 'launch_notice',
      leadId,
      recipient: phone.e164,
      payload: { template: { name: 'mf_cadastro', language: 'pt_BR', bodyVariables: ['Ana'] } },
      idempotencyKey: `test:sent:${leadId}`,
    }))!
    await h.ctx.db.query("UPDATE outbox_messages SET status = 'sent' WHERE id = $1", [sentId])
    await h.ctx.db.query(
      `INSERT INTO contact_sessions (id_hash, lead_id, created_at, expires_at) VALUES ('s-old', $1, $2, $2), ('s-live', $1, $3, $4)`,
      [leadId, ago(40), h.clock.current, new Date(h.clock.current.getTime() + DAY)],
    )
    await h.ctx.db.query(
      `INSERT INTO contact_access_tokens (token_hash, lead_id, purpose, expires_at, used_at, created_at)
       VALUES ('t-used', $1, 'preferences', $2, $3, $3), ('t-live', $1, 'preferences', $4, NULL, $5)`,
      [leadId, ago(30.5), ago(31), new Date(h.clock.current.getTime() + DAY), h.clock.current],
    )
    await h.ctx.db.query(`INSERT INTO webhook_events (provider, event_id, received_at) VALUES ('halai', 'old', $1), ('halai', 'new', $2)`, [
      ago(45),
      ago(1),
    ])
    const sent = { id: sentId }
    await h.ctx.db.query('UPDATE outbox_messages SET updated_at = $2 WHERE id = $1', [sent.id, ago(31)])

    const dry = await runRetention(h.ctx)
    expect(dry).toMatchObject({ sessions: 1, accessTokens: 1, webhookEvents: 1, heldSubmissions: 1, formTokens: 1, formAttempts: 1 })
    expect(dry.challenges).toBeGreaterThanOrEqual(1)
    expect(await one<{ n: number }>('SELECT count(*)::int AS n FROM contact_sessions WHERE lead_id = $1', [leadId])).toEqual({ n: 2 })

    const applied = await runRetention(h.ctx, { apply: true })
    expect(applied).toMatchObject({ sessions: 1, accessTokens: 1, webhookEvents: 1, heldSubmissions: 1, formTokens: 1, formAttempts: 1 })
    expect((await h.ctx.db.query('SELECT 1 FROM lead_submissions WHERE lead_id = $1', [leadId])).rows).toHaveLength(1)
    expect((await h.ctx.db.query(`SELECT token_hash FROM form_token_uses WHERE token_hash IN ('tok-old', 'tok-live')`)).rows).toEqual([{ token_hash: 'tok-live' }])
    expect(await one('SELECT id FROM verification_challenges WHERE id = $1', [oldChallenge.id])).toBeUndefined()
    const sessions = await h.ctx.db.query<{ id_hash: string }>('SELECT id_hash FROM contact_sessions WHERE lead_id = $1 ORDER BY id_hash', [leadId])
    expect(sessions.rows.map((r) => r.id_hash)).not.toContain('s-old')
    expect(sessions.rows.map((r) => r.id_hash)).toContain('s-live')
    const tokens = await h.ctx.db.query<{ token_hash: string }>('SELECT token_hash FROM contact_access_tokens WHERE lead_id = $1', [leadId])
    expect(tokens.rows.map((r) => r.token_hash)).toEqual(['t-live'])
    const webhooks = await h.ctx.db.query<{ event_id: string }>(`SELECT event_id FROM webhook_events WHERE event_id IN ('old', 'new')`)
    expect(webhooks.rows.map((r) => r.event_id)).toEqual(['new'])
    const message = await one<{ status: string; payload_ciphertext: string; recipient_ciphertext: string | null }>(
      'SELECT status, payload_ciphertext, recipient_ciphertext FROM outbox_messages WHERE id = $1',
      [sent.id],
    )
    expect(message).toEqual({ status: 'sent', payload_ciphertext: 'redacted', recipient_ciphertext: null })
    // O cadastro em si continua (a decisão de excluir é da equipe de privacidade).
    expect(await one('SELECT id FROM leads WHERE id = $1', [leadId])).toBeDefined()
  })

  it('CLI retention-review: simulação por padrão e --apply, com saída só de contagens', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mf-retention-'))
    try {
      const dbDir = join(dir, 'db')
      const db = await createDatabase(`pglite://${dbDir}`)
      await migrate(db)
      await db.close()
      const envFile = join(dir, 'test.env')
      const env = { ...TEST_ENV, DATABASE_URL: `pglite://${dbDir}`, LOG_LEVEL: 'silent' }
      await writeFile(envFile, Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n'))

      const run = promisify(execFile)
      const cli = [resolve(BACKEND_ROOT, 'node_modules/tsx/dist/cli.mjs'), resolve(BACKEND_ROOT, 'src/cli/retention-review.ts')]
      const dry = await run(process.execPath, [...cli, '--json', '--env-file', envFile], { cwd: BACKEND_ROOT })
      expect(JSON.parse(dry.stdout)).toMatchObject({ mode: 'dry_run', expiredLeads: 0 })
      const text = await run(process.execPath, [...cli, '--env-file', envFile, '--apply'], { cwd: BACKEND_ROOT })
      expect(text.stdout).toContain('alterações APLICADAS')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)
})
