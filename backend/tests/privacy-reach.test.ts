import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { auditRows, call, insertSupportRequest, seedUser, signIn, type AdminClient } from './admin-fixtures.js'
import { createTestHarness, HALAI_ENV, type TestHarness } from './helpers.js'
import { leadIdByPhone, newIp, newPerson, newPhone, submitSite } from './lead-flow.js'

/**
 * PRIV-2: o pedido de exclusão alcança todos os atendimentos do titular — os abertos pelo site com o mesmo WhatsApp,
 * com o mesmo e-mail do cadastro (D1) ou com o mesmo e-mail de outro atendimento, e os gravados antes da chave de
 * contato existir. (O atendimento humano do WhatsApp é da Hal-AI: não há mais atendimento aberto pela Bia aqui.)
 */
let h: TestHarness
let privacy: AdminClient

beforeAll(async () => {
  h = await createTestHarness({ ...HALAI_ENV, HUMAN_SUPPORT_ENABLED: 'true' })
  privacy = await signIn(h, await seedUser(h, { role: 'privacy' }))
})
afterAll(async () => {
  await h.close()
})

async function siteSupport(contactMethod: 'email' | 'whatsapp', contact: string, name: string) {
  const res = await h.api
    .post('/api/support')
    .set(newIp())
    .send({ name, contactMethod, contact, subject: 'cadastro_avisos', message: 'Quero saber se o meu cadastro está ativo.' })
  expect(res.status, JSON.stringify(res.body)).toBe(201)
  const r = await h.ctx.db.query<{ id: string }>('SELECT id FROM support_requests WHERE protocol = $1', [res.body.protocol])
  return r.rows[0]!.id
}

async function openDeletion(leadId: string | null, supportRequestId: string | null = null) {
  const res = await call(privacy, 'post', '/privacy-requests', {
    requestType: 'deletion',
    leadId,
    supportRequestId,
    channel: 'e-mail do encarregado',
    summary: 'Pedido de exclusão de todos os dados.',
    receivedAt: h.clock.current.toISOString(),
  })
  expect(res.status, JSON.stringify(res.body)).toBe(201)
  return res.body.id as string
}

const anonymizedIds = async (ids: string[]) =>
  (
    await h.ctx.db.query<{ id: string }>('SELECT id FROM support_requests WHERE id = ANY($1::uuid[]) AND anonymized_at IS NOT NULL', [ids])
  ).rows.map((r) => r.id)

describe('PRIV-2: exclusão alcança todos os atendimentos do titular', () => {
  it('anonimizar o cadastro anonimiza os atendimentos do site com o mesmo WhatsApp ou o mesmo e-mail do cadastro, e só eles', async () => {
    const person = newPerson()
    expect((await submitSite(h, person, newIp(), { fullName: 'Carla Pereira Souto', email: 'Carla.Souto@exemplo-mf.com.br' })).status).toBe(201)
    const leadId = (await leadIdByPhone(h, person.phone.e164))!
    const byPhone = await siteSupport('whatsapp', person.phone.masked, 'Carla Pelo Site')
    const byEmail = await siteSupport('email', 'carla.souto@exemplo-mf.com.br', 'Carla Por E-mail')
    const unrelated = await siteSupport('whatsapp', newPhone().masked, 'Outra Pessoa')
    const legacy = await insertSupportRequest(h, { contact: person.phone.e164, name: 'Carla Antiga', message: 'Pedido gravado antes da chave de contato.' })

    const req = await openDeletion(leadId)
    const done = await call(privacy, 'patch', `/privacy-requests/${req}`, { action: 'anonymize_lead', confirm: true, status: 'fulfilled' })
    expect(done.status).toBe(200)

    expect((await anonymizedIds([byPhone, byEmail, legacy.id, unrelated])).sort()).toEqual([byPhone, byEmail, legacy.id].sort())
    const rows = await h.ctx.db.query<{ requester_name: string; contact_key: string | null; contact_ciphertext: string }>(
      'SELECT requester_name, contact_key, contact_ciphertext FROM support_requests WHERE id = ANY($1::uuid[])',
      [[byPhone, byEmail, legacy.id]],
    )
    for (const row of rows.rows) expect(row).toEqual({ requester_name: 'Titular anonimizado', contact_key: null, contact_ciphertext: '' })
    const dump = JSON.stringify((await h.ctx.db.query('SELECT * FROM support_requests WHERE id = ANY($1::uuid[])', [[byPhone, byEmail, legacy.id]])).rows)
    expect(dump).not.toMatch(/Carla/)

    const audit = (await auditRows(h, 'admin.privacy_anonymize_lead')).find((r) => r.resource_id === leadId)!
    expect(audit.metadata).toMatchObject({ supportRequestsAnonymized: 3 })
    expect([...(audit.metadata.supportRequestIds as string[])].sort()).toEqual([byPhone, byEmail, legacy.id].sort())
  })

  it('pedido ligado só a um atendimento alcança os outros com o mesmo e-mail', async () => {
    const first = await siteSupport('email', 'Titular.Email@exemplo-mf.com.br', 'Dora')
    const second = await siteSupport('email', 'titular.email@exemplo-mf.com.br', 'Dora de Novo')
    const other = await siteSupport('email', 'outra.pessoa@exemplo-mf.com.br', 'Outra')
    const req = await openDeletion(null, first)
    const done = await call(privacy, 'patch', `/privacy-requests/${req}`, { action: 'anonymize_lead', confirm: true })
    expect(done.status).toBe(200)
    expect((await anonymizedIds([first, second, other])).sort()).toEqual([first, second].sort())
  })
})
