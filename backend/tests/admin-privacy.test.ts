import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { REDACTED_PAYLOAD } from '../src/jobs/outbox-worker.js'
import { randomToken, sha256Hex } from '../src/lib/crypto.js'
import { enqueueMessage } from '../src/repositories/outbox.repo.js'
import { insertSubmission } from '../src/repositories/submissions.repo.js'
import { auditRows, call, insertLead, insertSupportRequest, seedUser, signIn, type AdminClient } from './admin-fixtures.js'
import { createTestHarness, type TestHarness } from './helpers.js'

let h: TestHarness
let privacy: AdminClient
let support: AdminClient

beforeAll(async () => {
  h = await createTestHarness()
  privacy = await signIn(h, await seedUser(h, { role: 'privacy' }))
  support = await signIn(h, await seedUser(h, { role: 'support' }))
})
afterAll(async () => {
  await h.close()
})

async function openRequest(leadId: string | null, requestType = 'deletion', supportRequestId: string | null = null) {
  const res = await call(privacy, 'post', '/privacy-requests', {
    requestType,
    leadId,
    supportRequestId,
    channel: 'e-mail do encarregado',
    summary: 'Titular pediu exclusão dos dados cadastrados.',
    receivedAt: h.clock.current.toISOString(),
  })
  expect(res.status, JSON.stringify(res.body)).toBe(201)
  return res.body as { id: string; status: string; handledBy: { id: string } | null }
}

async function queue(leadId: string, purpose: 'launch_notice' | 'marketing', phone: string, recipientKey: string | null = null) {
  await enqueueMessage(h.ctx, h.ctx.db, {
    kind: 'halai_template',
    channel: 'halai',
    purpose,
    leadId,
    recipient: phone,
    recipientKey,
    payload: { template: { name: purpose === 'marketing' ? 'novidades' : 'mf_cadastro', language: 'pt_BR', bodyVariables: ['Joana'] } },
    idempotencyKey: `${purpose}:${leadId}:${randomUUID()}`,
  })
}

describe('pedidos de privacidade', () => {
  it('registra pedido recebido por outro canal e lista por status', async () => {
    const lead = await insertLead(h)
    const created = await openRequest(lead.id, 'access')
    expect(created).toMatchObject({ status: 'open', handledBy: { id: privacy.user.id } })
    const future = await call(privacy, 'post', '/privacy-requests', {
      requestType: 'access',
      channel: 'telefone',
      summary: 'Pedido de acesso',
      receivedAt: new Date(h.clock.current.getTime() + 86_400_000).toISOString(),
    })
    expect(future.status).toBe(400)
    const open = await call(privacy, 'get', '/privacy-requests?status=open')
    expect(open.body.items.map((i: { id: string }) => i.id)).toContain(created.id)
    expect((await call(support, 'get', '/privacy-requests')).status).toBe(403)
  })

  it('revoke_all revoga todas as finalidades, registra eventos e cancela envios pendentes', async () => {
    const lead = await insertLead(h, { launch: true, marketing: true })
    await queue(lead.id, 'launch_notice', lead.phone)
    await queue(lead.id, 'marketing', lead.phone)
    const req = await openRequest(lead.id, 'revocation')
    const res = await call(privacy, 'patch', `/privacy-requests/${req.id}`, { action: 'revoke_all', status: 'fulfilled', resolution: 'Comunicações encerradas.' })
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('fulfilled')
    expect(res.body.fulfilledAt).toBe(h.clock.current.toISOString())

    const prefs = await h.ctx.db.query<{ granted: boolean }>('SELECT granted FROM lead_preferences WHERE lead_id = $1', [lead.id])
    expect(prefs.rows.map((p) => p.granted)).toEqual([false, false])
    const state = await h.ctx.db.query<{ state: string }>('SELECT state FROM leads WHERE id = $1', [lead.id])
    expect(state.rows[0]?.state).toBe('unsubscribed')
    const events = await h.ctx.db.query<{ event_type: string; purpose: string | null; granted: boolean | null; actor_type: string; actor_id: string }>(
      'SELECT event_type, purpose, granted, actor_type, actor_id FROM lead_events WHERE lead_id = $1 ORDER BY event_type, purpose',
      [lead.id],
    )
    expect(events.rows.map((e) => [e.event_type, e.purpose, e.granted])).toEqual([
      ['preference_changed', 'launch_notice', false],
      ['preference_changed', 'marketing', false],
      ['state_changed', null, null],
    ])
    expect(events.rows.every((e) => e.actor_type === 'admin' && e.actor_id === privacy.user.id)).toBe(true)
    const outbox = await h.ctx.db.query<{ status: string }>('SELECT status FROM outbox_messages WHERE lead_id = $1', [lead.id])
    expect(outbox.rows.map((o) => o.status)).toEqual(['cancelled', 'cancelled'])
    expect((await auditRows(h, 'admin.privacy_revoke_all')).some((r) => r.resource_id === lead.id)).toBe(true)
  })

  it('anonimização exige confirmação e remove nome, telefone, CPF, e-mail, empregador, submissões e atendimento', async () => {
    const name = 'Joana Anonimizável Prado'
    const lead = await insertLead(h, { name, launch: true, marketing: true, email: 'joana.prado@exemplo-mf.com.br', employerName: 'Metalúrgica Joana' })
    const ticket = await insertSupportRequest(h, { leadId: lead.id, name, contact: lead.phone, message: 'Meu nome é Joana e quero sair da lista.' })
    await call(support, 'post', `/support/${ticket.id}/notes`, { note: 'Joana confirmou por telefone.' })
    const now = h.clock.current
    const later = new Date(now.getTime() + 3_600_000)
    await h.ctx.db.query('INSERT INTO contact_sessions (id_hash, lead_id, created_at, expires_at) VALUES ($1, $2, $3, $4)', [sha256Hex(randomToken()), lead.id, now, later])
    await h.ctx.db.query(
      "INSERT INTO contact_access_tokens (token_hash, lead_id, purpose, expires_at, created_at) VALUES ($1, $2, 'preferences', $3, $4)",
      [sha256Hex(randomToken()), lead.id, later, now],
    )
    // Submissões guardadas para revisão: uma ligada ao cadastro e outra, sem vínculo, com o mesmo CPF.
    const held = await insertSubmission(h.ctx.db, h.ctx.config.secrets.encryption, {
      leadId: lead.id,
      channel: 'site',
      source: 'avise-me',
      reason: 'existing_phone',
      phoneKey: lead.dedupKey,
      cpfKey: lead.cpfKey,
      payload: { v: 1, data: { fullName: name, cpf: lead.cpf, phoneE164: lead.phone }, source: 'avise-me' },
      at: now,
    })
    const loose = await insertSubmission(h.ctx.db, h.ctx.config.secrets.encryption, {
      leadId: null,
      channel: 'bia',
      source: 'bia',
      reason: 'suppressed',
      phoneKey: 'outra-chave',
      cpfKey: lead.cpfKey,
      payload: { v: 1, data: { fullName: name }, source: 'bia' },
      at: now,
    })
    await h.ctx.db.query(
      `INSERT INTO form_attempts (id, purpose, ip_key, cpf_key, phone_key, created_at) VALUES ($1, 'waitlist', 'rede', $2, $3, $4)`,
      [randomUUID(), lead.cpfKey, lead.dedupKey, now],
    )
    // Desafio legado (anterior à D1) do mesmo número, ainda guardado.
    await h.ctx.db.query(
      `INSERT INTO verification_challenges (id, purpose, dedup_key, code_hash, expires_at, max_attempts) VALUES ($1, 'waitlist', $2, 'h', $3, 5)`,
      [randomUUID(), lead.dedupKey, later],
    )
    await queue(lead.id, 'launch_notice', lead.phone, lead.dedupKey)
    await h.ctx.db.query("UPDATE outbox_messages SET status = 'sent' WHERE lead_id = $1", [lead.id])
    await queue(lead.id, 'marketing', lead.phone, lead.dedupKey)

    const req = await openRequest(lead.id, 'deletion')
    // Supressão primeiro, com a chave original.
    expect((await call(privacy, 'patch', `/privacy-requests/${req.id}`, { action: 'suppress_contact' })).status).toBe(200)

    const unconfirmed = await call(privacy, 'patch', `/privacy-requests/${req.id}`, { action: 'anonymize_lead' })
    expect(unconfirmed.status).toBe(400)
    expect(unconfirmed.body.error.code).toBe('confirmation_required')
    expect((await h.ctx.db.query('SELECT 1 FROM leads WHERE id = $1 AND anonymized_at IS NULL', [lead.id])).rows).toHaveLength(1)

    const done = await call(privacy, 'patch', `/privacy-requests/${req.id}`, { action: 'anonymize_lead', confirm: true, status: 'fulfilled' })
    expect(done.status).toBe(200)

    const row = await h.ctx.db.query<Record<string, unknown>>('SELECT * FROM leads WHERE id = $1', [lead.id])
    expect(row.rows[0]).toMatchObject({
      preferred_name: 'Titular anonimizado',
      full_name: null,
      phone_ciphertext: '',
      phone_hint: '—',
      dedup_key: `anon:${lead.id}`,
      cpf_ciphertext: null,
      cpf_hint: null,
      cpf_key: null,
      email_ciphertext: null,
      email_hint: null,
      employer_ciphertext: null,
      city: null,
      state: 'unsubscribed',
    })
    // Códigos agregáveis continuam para as métricas.
    expect(row.rows[0]).toMatchObject({ uf: 'SP', income_range: '2000_a_4000' })
    expect(row.rows[0]?.anonymized_at).not.toBeNull()
    // Supressão pelas chaves originais: telefone e CPF.
    const suppressed = await h.ctx.db.query<{ dedup_key: string; reason: string }>('SELECT dedup_key, reason FROM suppression_list WHERE dedup_key = ANY($1::text[])', [
      [lead.dedupKey, lead.cpfKey],
    ])
    expect(suppressed.rows.map((r) => r.reason)).toEqual(['deletion_request', 'deletion_request'])
    const submissions = await h.ctx.db.query('SELECT id FROM lead_submissions WHERE id = ANY($1::uuid[])', [[held, loose]])
    expect(submissions.rows).toHaveLength(0)
    const attempts = await h.ctx.db.query('SELECT 1 FROM form_attempts WHERE phone_key = $1 OR cpf_key = $2', [lead.dedupKey, lead.cpfKey])
    expect(attempts.rows).toHaveLength(0)
    for (const table of ['contact_sessions', 'contact_access_tokens']) {
      expect((await h.ctx.db.query(`SELECT 1 FROM ${table} WHERE lead_id = $1`, [lead.id])).rows, table).toHaveLength(0)
    }
    expect((await h.ctx.db.query('SELECT 1 FROM verification_challenges WHERE dedup_key = $1', [lead.dedupKey])).rows).toHaveLength(0)
    const outbox = await h.ctx.db.query<{ status: string; recipient_ciphertext: string | null; recipient_key: string | null; payload_ciphertext: string }>(
      'SELECT status, recipient_ciphertext, recipient_key, payload_ciphertext FROM outbox_messages WHERE lead_id = $1 ORDER BY status',
      [lead.id],
    )
    expect(outbox.rows).toEqual([
      { status: 'cancelled', recipient_ciphertext: null, recipient_key: null, payload_ciphertext: REDACTED_PAYLOAD },
      { status: 'sent', recipient_ciphertext: null, recipient_key: null, payload_ciphertext: REDACTED_PAYLOAD },
    ])
    const sr = await h.ctx.db.query<Record<string, unknown>>(
      'SELECT requester_name, contact_ciphertext, message_ciphertext, tracking_token_hash, anonymized_at FROM support_requests WHERE id = $1',
      [ticket.id],
    )
    expect(sr.rows[0]).toMatchObject({ requester_name: 'Titular anonimizado', contact_ciphertext: '', message_ciphertext: '' })
    expect(sr.rows[0]?.tracking_token_hash).not.toBe(ticket.trackingHash)
    const notes = await h.ctx.db.query('SELECT 1 FROM support_events WHERE support_request_id = $1 AND note_ciphertext IS NOT NULL', [ticket.id])
    expect(notes.rows).toHaveLength(0)
    const anonymizedEvent = await h.ctx.db.query("SELECT 1 FROM lead_events WHERE lead_id = $1 AND event_type = 'anonymized'", [lead.id])
    expect(anonymizedEvent.rows).toHaveLength(1)

    // Nenhuma tabela guarda mais nome, telefone, CPF, e-mail ou empregador em claro.
    const tables = await h.ctx.db.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
    )
    for (const { table_name } of tables.rows) {
      const dump = JSON.stringify((await h.ctx.db.query(`SELECT * FROM ${table_name}`)).rows)
      for (const secret of ['Joana', lead.phone.slice(3), lead.cpf, 'joana.prado', 'Metalúrgica']) expect(dump, `${table_name}: ${secret}`).not.toContain(secret)
    }

    // Depois de anonimizado: sem contato para revelar, sem nova anonimização, sem supressão possível.
    const admin = await signIn(h, await seedUser(h, { role: 'admin' }))
    const reveal = await call(admin, 'post', `/leads/${lead.id}/reveal-contact`, { reason: 'verificar anonimização' })
    expect(reveal.status).toBe(409)
    expect((await call(privacy, 'patch', `/privacy-requests/${req.id}`, { action: 'anonymize_lead', confirm: true })).status).toBe(409)
    expect((await call(privacy, 'patch', `/privacy-requests/${req.id}`, { action: 'suppress_contact' })).status).toBe(409)
    const detail = await call(support, 'get', `/support/${ticket.id}`)
    expect(detail.status).toBe(200)
    expect(detail.body.requesterName).toBe('Titular anonimizado')
    expect(JSON.stringify(detail.body)).not.toContain('Joana')

    expect((await auditRows(h, 'admin.privacy_anonymize_lead')).some((r) => r.resource_id === lead.id)).toBe(true)
    expect((await auditRows(h, 'admin.privacy_suppress_contact')).some((r) => r.resource_id === lead.id)).toBe(true)
  })

  it('ações de cadastro exigem pedido vinculado a um cadastro', async () => {
    const req = await openRequest(null, 'information')
    const res = await call(privacy, 'patch', `/privacy-requests/${req.id}`, { action: 'revoke_all' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('lead_required')
  })
})
