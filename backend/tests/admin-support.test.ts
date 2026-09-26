import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { decryptField } from '../src/lib/crypto.js'
import { SUPPORT_CIPHER_CONTEXT } from '../src/services/support.service.js'
import { auditRows, call, insertSupportRequest, seedUser, signIn, type AdminClient } from './admin-fixtures.js'
import { createTestHarness, type TestHarness } from './helpers.js'

let h: TestHarness
let agentA: AdminClient
let agentB: AdminClient
let privacy: AdminClient

beforeAll(async () => {
  h = await createTestHarness()
  agentA = await signIn(h, await seedUser(h, { role: 'support', name: 'Ana Atendimento' }))
  agentB = await signIn(h, await seedUser(h, { role: 'support', name: 'Bruno Atendimento' }))
  privacy = await signIn(h, await seedUser(h, { role: 'privacy' }))
})
afterAll(async () => {
  await h.close()
})

describe('atendimento pelo painel', () => {
  it('detalhe decifra contato e mensagem e a visualização fica auditada', async () => {
    const t = await insertSupportRequest(h, { contact: '+5521998877665', message: 'Recebi um link estranho em nome de vocês.' })
    const list = await call(agentA, 'get', '/support')
    const item = list.body.items.find((i: { id: string }) => i.id === t.id)
    expect(item).toMatchObject({ protocol: t.protocol, status: 'received', contactHint: '(21) •••••-••65', assignee: null })
    expect(JSON.stringify(list.body)).not.toContain('Recebi um link')

    const detail = await call(agentA, 'get', `/support/${t.id}`)
    expect(detail.status).toBe(200)
    expect(detail.body).toMatchObject({ contact: '+5521998877665', message: 'Recebi um link estranho em nome de vocês.', requesterName: t.name })
    const views = await auditRows(h, 'admin.support_viewed')
    expect(views.some((r) => r.actor_id === agentA.user.id && r.resource_id === t.id)).toBe(true)
  })

  it('transições permitidas registram responsável e horário; as demais são recusadas', async () => {
    const t = await insertSupportRequest(h)
    const invalid = await call(agentA, 'patch', `/support/${t.id}`, { status: 'answered' })
    expect(invalid.status).toBe(400)
    expect(invalid.body.error.code).toBe('invalid_transition')
    expect((await call(agentA, 'patch', `/support/${t.id}`, { status: 'closed' })).status).toBe(400)

    const t0 = h.clock.current.toISOString()
    const start = await call(agentA, 'patch', `/support/${t.id}`, { status: 'in_progress', assigneeId: agentB.user.id })
    expect(start.status).toBe(200)
    expect(start.body.assignee).toEqual({ id: agentB.user.id, displayName: 'Bruno Atendimento', role: 'support' })
    const assigned = start.body.events.find((e: { type: string }) => e.type === 'assigned')
    expect(assigned).toMatchObject({ actor: { id: agentA.user.id }, actorType: 'admin', at: t0, assignee: { id: agentB.user.id } })
    const changed = start.body.events.find((e: { type: string }) => e.type === 'status_changed')
    expect(changed).toMatchObject({ fromStatus: 'received', toStatus: 'in_progress', actor: { id: agentA.user.id }, at: t0 })

    // Avanços curtos: sessões ociosas por mais de 30 minutos expiram.
    h.clock.advance(20 * 60_000)
    const answeredAt = h.clock.current.toISOString()
    const answered = await call(agentB, 'patch', `/support/${t.id}`, { status: 'answered' })
    expect(answered.body.firstResponseAt).toBe(answeredAt)

    h.clock.advance(60_000)
    const closed = await call(agentB, 'patch', `/support/${t.id}`, { status: 'closed' })
    expect(closed.body.closedAt).toBe(h.clock.current.toISOString())

    // Reabrir: closed → in_progress limpa closed_at e preserva a primeira resposta.
    h.clock.advance(60_000)
    const reopened = await call(agentA, 'patch', `/support/${t.id}`, { status: 'in_progress' })
    expect(reopened.body).toMatchObject({ status: 'in_progress', closedAt: null, firstResponseAt: answeredAt })
    h.clock.advance(60_000)
    const again = await call(agentA, 'patch', `/support/${t.id}`, { status: 'answered' })
    expect(again.body.firstResponseAt).toBe(answeredAt)

    // A trilha no banco guarda quem fez cada mudança e quando.
    const events = await h.ctx.db.query<{ from_status: string; to_status: string; actor_id: string; actor_type: string }>(
      `SELECT from_status, to_status, actor_id, actor_type FROM support_events
        WHERE support_request_id = $1 AND event_type = 'status_changed' ORDER BY created_at`,
      [t.id],
    )
    expect(events.rows.map((e) => [e.from_status, e.to_status, e.actor_id])).toEqual([
      ['received', 'in_progress', agentA.user.id],
      ['in_progress', 'answered', agentB.user.id],
      ['answered', 'closed', agentB.user.id],
      ['closed', 'in_progress', agentA.user.id],
      ['in_progress', 'answered', agentA.user.id],
    ])
    expect((await auditRows(h, 'admin.support_updated')).filter((r) => r.resource_id === t.id)).toHaveLength(5)
  })

  it('responsável precisa ser pessoa ativa da equipe de atendimento', async () => {
    const t = await insertSupportRequest(h)
    const marketing = await seedUser(h, { role: 'marketing' })
    const disabled = await seedUser(h, { role: 'support', disabled: true })
    for (const id of [marketing.id, disabled.id, '00000000-0000-4000-8000-000000000000']) {
      const res = await call(agentA, 'patch', `/support/${t.id}`, { assigneeId: id })
      expect(res.status).toBe(400)
      expect(res.body.error.fields.assigneeId).toBeDefined()
    }
    const team = await call(agentA, 'get', '/team')
    const ids = team.body.items.map((u: { id: string }) => u.id)
    expect(ids).toEqual(expect.arrayContaining([agentA.user.id, agentB.user.id]))
    expect(ids).not.toContain(marketing.id)
    expect(ids).not.toContain(disabled.id)
    expect(ids).not.toContain(privacy.user.id)
  })

  it('fila filtra por responsável ("me", "none") e status', async () => {
    const mine = await insertSupportRequest(h)
    const nobody = await insertSupportRequest(h)
    await call(agentA, 'patch', `/support/${mine.id}`, { assigneeId: agentA.user.id })
    const me = await call(agentA, 'get', '/support?assignee=me')
    expect(me.body.items.map((i: { id: string }) => i.id)).toContain(mine.id)
    expect(me.body.items.every((i: { assignee: { id: string } | null }) => i.assignee?.id === agentA.user.id)).toBe(true)
    const none = await call(agentA, 'get', '/support?assignee=none&status=received')
    const noneIds = none.body.items.map((i: { id: string }) => i.id)
    expect(noneIds).toContain(nobody.id)
    expect(noneIds).not.toContain(mine.id)
    expect((await call(agentA, 'get', '/support?assignee=qualquer')).status).toBe(400)
  })

  it('notas ficam cifradas no banco; respostas visíveis ao titular são marcadas', async () => {
    const t = await insertSupportRequest(h)
    const internal = await call(agentA, 'post', `/support/${t.id}/notes`, { note: 'Conferir com a equipe de privacidade.' })
    expect(internal.status).toBe(201)
    h.clock.advance(1000)
    const reply = await call(agentA, 'post', `/support/${t.id}/notes`, { note: 'Olá! Seu cadastro está ativo.', visibleToRequester: true })
    const events = reply.body.events.filter((e: { note: string | null }) => e.note)
    expect(events.map((e: { type: string; visibleToRequester: boolean }) => [e.type, e.visibleToRequester])).toEqual([
      ['note_added', false],
      ['reply_recorded', true],
    ])
    const rows = await h.ctx.db.query<{ id: string; note_ciphertext: string }>(
      'SELECT id, note_ciphertext FROM support_events WHERE support_request_id = $1 AND note_ciphertext IS NOT NULL ORDER BY created_at',
      [t.id],
    )
    expect(rows.rows).toHaveLength(2)
    for (const row of rows.rows) {
      expect(row.note_ciphertext).not.toMatch(/Conferir|Olá/)
      expect(() => decryptField(row.note_ciphertext, h.ctx.config.secrets.encryption, SUPPORT_CIPHER_CONTEXT.note(row.id))).not.toThrow()
    }
    const privacyNow = await signIn(h, privacy.user)
    expect((await call(privacyNow, 'post', `/support/${t.id}/notes`, { note: 'tentativa' })).status).toBe(403)
  })
})
