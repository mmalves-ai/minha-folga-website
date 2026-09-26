import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { auditRows, call, seedUser, signIn, type AdminClient } from './admin-fixtures.js'
import { createTestHarness, HALAI_ENV, type TestHarness } from './helpers.js'
import { attested, callTool, customerInput, dedupFor, envelope, leadIdByPhone, newIp, newPerson, submitSite } from './lead-flow.js'

/**
 * O painel sobre dados criados pelos fluxos públicos reais (cadastro pelo site, Bia e atendimento), sem fixtures:
 * prova que cifragem, chaves de deduplicação, submissões retidas e trilha são as mesmas dos dois lados.
 */
let h: TestHarness
let privacy: AdminClient
let support: AdminClient

beforeAll(async () => {
  h = await createTestHarness(HALAI_ENV)
  privacy = await signIn(h, await seedUser(h, { role: 'privacy' }))
  support = await signIn(h, await seedUser(h, { role: 'support' }))
})
afterAll(async () => {
  await h.close()
})

describe('painel sobre os fluxos públicos', () => {
  it('cadastro pelo site → validado pela Bia → submissão retida visível → revelação auditada → supressão respeitada no recadastro', async () => {
    const person = newPerson()
    expect((await submitSite(h, person, newIp(), { fullName: 'Rita de Cássia Lima' })).status).toBe(201)
    const leadId = (await leadIdByPhone(h, person.phone.e164))!

    const list = await call(privacy, 'get', '/leads?phoneVerified=false')
    const item = list.body.items.find((i: { id: string }) => i.id === leadId)
    expect(item).toMatchObject({ fullName: 'Rita de Cássia Lima', state: 'received', phoneVerified: false, purposes: { launch_notice: true, marketing: false } })
    expect(JSON.stringify(list.body)).not.toContain(person.phone.e164.slice(3))
    expect(JSON.stringify(list.body)).not.toContain(person.cpf.digits)

    // A Bia atesta o número e o cadastro passa a verified.
    const upsert = await callTool(h, 'upsert_customer', envelope({ incomeRange: 'acima_7000' }, attested(person.phone.e164)))
    expect(upsert.body.result).toMatchObject({ status: 'updated', state: 'verified' })
    const verified = await call(privacy, 'get', '/leads?phoneVerified=true&state=verified')
    expect(verified.body.items.map((i: { id: string }) => i.id)).toContain(leadId)

    // Outra submissão pelo site com o mesmo telefone: não sobrescreve; aparece mascarada no detalhe.
    expect((await submitSite(h, { phone: person.phone, cpf: newPerson().cpf }, newIp(), { fullName: 'Mallory Invasora Silva' })).status).toBe(201)
    const detail = await call(support, 'get', `/leads/${leadId}`)
    expect(detail.status).toBe(200)
    expect(detail.body).toMatchObject({ fullName: 'Rita de Cássia Lima', incomeRange: 'acima_7000', pendingReview: 1 })
    expect(detail.body.pendingSubmissions).toEqual([
      expect.objectContaining({
        channel: 'site',
        reason: 'existing_phone',
        data: expect.objectContaining({ fullName: 'Mallory Invasora Silva', phoneHint: expect.stringMatching(/^\(11\) •••••-••\d{2}$/), cpfHint: expect.stringMatching(/^\*\*\*\.\*\*\*\.\*\*\*-\d{2}$/) }),
      }),
    ])
    expect(JSON.stringify(detail.body)).not.toContain(person.phone.e164.slice(3))

    // A listagem devolve nomes: fica na auditoria (quem, filtros, página, quantidade), sem dados do titular.
    const listed = (await auditRows(h, 'admin.leads_listed')).filter((r) => r.actor_id === privacy.user.id)
    expect(listed).toHaveLength(2)
    expect(listed[1]!.metadata).toMatchObject({ filters: { phoneVerified: 'true', state: 'verified' } })
    expect(JSON.stringify(listed)).not.toMatch(/Rita|•/)

    const reveal = await call(privacy, 'post', `/leads/${leadId}/reveal-contact`, { reason: 'Retorno do pedido de exclusão' })
    expect(reveal.status).toBe(200)
    expect(reveal.body).toEqual({ phone: person.phone.e164, email: 'ana.souza@exemplo-mf.com.br', cpf: person.cpf.masked })
    expect((await auditRows(h, 'admin.lead_contact_revealed')).some((r) => r.resource_id === leadId)).toBe(true)

    // Exclusão completa: supressão (chaves originais de telefone e CPF) e anonimização.
    const req = await call(privacy, 'post', '/privacy-requests', {
      requestType: 'deletion',
      leadId,
      channel: 'e-mail do encarregado',
      summary: 'Pedido de exclusão recebido por e-mail.',
      receivedAt: h.clock.current.toISOString(),
    })
    expect(req.status).toBe(201)
    expect((await call(privacy, 'patch', `/privacy-requests/${req.body.id}`, { action: 'suppress_contact' })).status).toBe(200)
    const done = await call(privacy, 'patch', `/privacy-requests/${req.body.id}`, { action: 'anonymize_lead', confirm: true, status: 'fulfilled' })
    expect(done.status).toBe(200)

    // O mesmo número (ou o mesmo CPF) volta pelo site: resposta genérica, nenhum cadastro nem submissão.
    expect((await submitSite(h, person, newIp())).status).toBe(201)
    expect((await submitSite(h, { phone: newPerson().phone, cpf: person.cpf }, newIp())).status).toBe(201)
    const leads = await h.ctx.db.query('SELECT id FROM leads WHERE dedup_key = $1', [dedupFor(h, person.phone.e164)])
    expect(leads.rows).toHaveLength(0)
    const held = await h.ctx.db.query('SELECT 1 FROM lead_submissions WHERE phone_key = $1', [dedupFor(h, person.phone.e164)])
    expect(held.rows).toHaveLength(0)
    // Pela Bia também não: fica para revisão.
    const bia = await callTool(h, 'upsert_customer', envelope(customerInput(person), attested(person.phone.e164)))
    expect(bia.body.result.status).toBe('needs_review')
  })

  it('atendimento aberto pelo site: detalhe decifrado no painel e só a resposta visível chega ao acompanhamento', async () => {
    const contact = 'titular.integracao@exemplo-mf.com.br'
    const message = 'Quero confirmar se meu cadastro para o aviso de abertura está ativo.'
    const created = await h.api
      .post('/api/support')
      .set(newIp())
      .send({ name: 'Paula Integração', contactMethod: 'email', contact, subject: 'cadastro_avisos', message })
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    const { protocol, trackingToken } = created.body as { protocol: string; trackingToken: string }

    const queue = await call(support, 'get', '/support?status=received')
    const item = queue.body.items.find((i: { protocol: string }) => i.protocol === protocol)
    expect(item).toBeDefined()
    const listed = (await auditRows(h, 'admin.support_listed')).filter((r) => r.actor_id === support.user.id)
    expect(listed.at(-1)?.metadata).toMatchObject({ filters: { status: 'received' }, page: 1, returned: queue.body.items.length })
    expect(JSON.stringify(listed)).not.toMatch(/Paula|exemplo-mf|•/)
    const detail = await call(support, 'get', `/support/${item.id}`)
    expect(detail.body).toMatchObject({ contact, message, requesterName: 'Paula Integração' })

    await call(support, 'patch', `/support/${item.id}`, { status: 'in_progress', assigneeId: support.user.id })
    await call(support, 'post', `/support/${item.id}/notes`, { note: 'Conferido internamente.' })
    await call(support, 'post', `/support/${item.id}/notes`, { note: 'Seu cadastro está ativo.', visibleToRequester: true })

    const track = await h.api.get(`/api/support/${protocol}`).set(newIp()).set('X-Support-Token', trackingToken)
    expect(track.status).toBe(200)
    expect(track.body.status).toBe('in_progress')
    const replies = track.body.timeline.filter((t: { type: string }) => t.type === 'reply')
    expect(replies.map((r: { text: string }) => r.text)).toEqual(['Seu cadastro está ativo.'])
    expect(JSON.stringify(track.body)).not.toContain('Conferido internamente')
  })
})
