import supertest from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { processOutboxBatch } from '../src/jobs/outbox-worker.js'
import { decryptField } from '../src/lib/crypto.js'
import { LEAD_CIPHER_CONTEXT } from '../src/repositories/leads.repo.js'
import { enqueueMessage } from '../src/repositories/outbox.repo.js'
import { OPT_OUT_RECEIVED } from '../src/services/opt-out.service.js'
import { createTestHarness, HALAI_ENV, SITE, type TestHarness } from './helpers.js'
import {
  antiBotFor,
  cookieFrom,
  newIp,
  newPerson,
  openPreferences,
  registerByBia,
  registerSite,
  VERSIONS,
  type Agent,
  type Person,
} from './lead-flow.js'

let h: TestHarness
beforeAll(async () => {
  // Template ligado só para existir um envio pendente a cancelar na revogação (dublê da Hal-AI em memória).
  h = await createTestHarness({
    ...HALAI_ENV,
    HALAI_API_KEY: 'test-only-halai-api-key-000000',
    HALAI_CHANNEL: 'canal-teste',
    HALAI_SIGNUP_TEMPLATE_ENABLED: 'true',
    HALAI_SIGNUP_TEMPLATE: 'mf_cadastro',
    HALAI_TEMPLATE_DAILY_CAP: '1000',
  })
})
afterAll(async () => {
  await h.close()
})

/** Navegador novo, sem cookie de sessão. */
const fresh = (): Agent => supertest.agent(h.app)

const leadRow = async (leadId: string) =>
  (await h.ctx.db.query<Record<string, any>>('SELECT * FROM leads WHERE id = $1', [leadId])).rows[0] as Record<string, any>

async function sessionFor(person: Person = newPerson(), via: 'site' | 'bia' = 'site') {
  const leadId = via === 'site' ? await registerSite(h, person) : await registerByBia(h, person)
  const agent = fresh()
  await openPreferences(h, person, agent)
  return { leadId, agent, person }
}

describe('sessão do titular (link seguro gerado pela Bia)', () => {
  it('sem sessão (ou com cookie inventado): leitura, alteração e exclusão → 401 session_required orientando a Bia', async () => {
    for (const agent of [fresh(), fresh()]) {
      const get = await agent.get('/api/preferences').set(SITE).set('Cookie', 'mf_contact=' + 'x'.repeat(43))
      expect(get.status).toBe(401)
      expect(get.body.error.code).toBe('session_required')
      expect(get.body.error.message).toMatch(/Bia/)
      expect(get.body).not.toHaveProperty('preferredName')
      expect((await agent.patch('/api/preferences').set(SITE).send({ purposes: { marketing: false } })).status).toBe(401)
      expect((await agent.post('/api/preferences/deletion-request').set(SITE).send({})).status).toBe(401)
    }
  })

  it('rotas de acesso por código não existem mais', async () => {
    for (const path of ['/api/preferences/access', '/api/preferences/access/verify', '/api/waitlist/verify', '/api/waitlist/resend']) {
      const res = await fresh().post(path).set(SITE).send({ phone: '(11) 98765-4321' })
      expect(res.status, path).toBe(404)
    }
  })

  it('o token do link abre a sessão uma única vez (cookie HttpOnly/Strict); logout e expiração encerram a sessão', async () => {
    const person = newPerson()
    await registerSite(h, person)
    const agent = fresh()
    const link = await openPreferences(h, person, agent)
    expect((await agent.get('/api/preferences').set(SITE)).status).toBe(200)
    const reuse = await fresh().post('/api/preferences/token').set(SITE).send({ token: link })
    expect(reuse.status).toBe(401)
    expect(reuse.body.error.code).toBe('invalid_or_expired_link')

    const out = await agent.post('/api/preferences/logout').set(SITE).send({})
    expect(out.status).toBe(204)
    expect(cookieFrom(out)).toMatch(/^mf_contact=;/)
    expect((await agent.get('/api/preferences').set(SITE)).status).toBe(401)

    const other = fresh()
    await openPreferences(h, person, other)
    h.clock.advance(31 * 60 * 1000)
    expect((await other.get('/api/preferences').set(SITE)).status).toBe(401)
  })

  it('cadastro anonimizado pela equipe de privacidade invalida a sessão aberta', async () => {
    const { leadId, agent } = await sessionFor()
    await h.ctx.db.query('UPDATE leads SET anonymized_at = $2 WHERE id = $1', [leadId, h.clock.current])
    expect((await agent.get('/api/preferences').set(SITE)).status).toBe(401)
  })
})

describe('visão do titular', () => {
  it('mostra dados mascarados (nome, telefone, CPF, e-mail), empregador, faixas, UF/cidade e finalidades', async () => {
    const person = newPerson()
    const { agent } = await sessionFor(person)
    const res = await agent.get('/api/preferences').set(SITE)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      preferredName: 'Ana',
      nameHint: 'Ana P. S.',
      contactHint: `(11) •••••-••${person.phone.e164.slice(-2)}`,
      contactVerified: false,
      cpfHint: `***.***.***-${person.cpf.digits.slice(-2)}`,
      emailHint: 'a•••@e•••.com.br',
      employerName: 'Mercado Bom Preço Ltda',
      employmentType: 'clt',
      jobTenure: '1_a_3_anos',
      incomeRange: '2000_a_4000',
      city: 'São Paulo',
      uf: 'SP',
      interestTopic: null,
      state: 'received',
      purposes: {
        launch_notice: { granted: true, consentTextVersion: VERSIONS.launch_notice },
        marketing: { granted: false, consentTextVersion: VERSIONS.marketing },
      },
    })
    const text = JSON.stringify(res.body)
    for (const secret of [person.cpf.digits, person.cpf.masked, person.phone.e164.slice(3), 'ana.souza@', 'Paula de Souza']) expect(text).not.toContain(secret)
  })
})

describe('alteração de finalidades e dos dados gerais', () => {
  it('revogar o aviso tira o contato da lista e cancela o envio pendente; reconceder exige a versão atual', async () => {
    const { leadId, agent } = await sessionFor()
    // O placeholder do template (ligado neste arquivo) deixou um envio pendente para o cadastro novo.
    const pending = await h.ctx.db.query<{ id: string; status: string }>(`SELECT id, status FROM outbox_messages WHERE lead_id = $1`, [leadId])
    expect(pending.rows).toEqual([expect.objectContaining({ status: 'pending' })])

    const revoked = await agent.patch('/api/preferences').set(SITE).send({ purposes: { launch_notice: false } })
    expect(revoked.status).toBe(200)
    expect(revoked.body.state).toBe('unsubscribed')
    expect(revoked.body.purposes.launch_notice.granted).toBe(false)
    const after = await h.ctx.db.query<{ status: string; last_error: string | null }>('SELECT status, last_error FROM outbox_messages WHERE id = $1', [pending.rows[0]!.id])
    expect(after.rows[0]).toEqual({ status: 'cancelled', last_error: 'purpose_revoked' })

    const trail = await h.ctx.db.query<{ event_type: string; purpose: string | null; granted: boolean | null; to_state: string | null; actor_type: string }>(
      `SELECT event_type, purpose, granted, to_state, actor_type FROM lead_events WHERE lead_id = $1 AND source = 'preferencias' ORDER BY created_at`,
      [leadId],
    )
    expect(trail.rows).toEqual([
      { event_type: 'preference_changed', purpose: 'launch_notice', granted: false, to_state: null, actor_type: 'titular' },
      { event_type: 'state_changed', purpose: null, granted: null, to_state: 'unsubscribed', actor_type: 'titular' },
    ])

    const noVersion = await agent.patch('/api/preferences').set(SITE).send({ purposes: { launch_notice: true } })
    expect(noVersion.status).toBe(400)
    expect(noVersion.body.error.fields).toHaveProperty(['consentVersions.launch_notice'])
    const outdated = await agent.patch('/api/preferences').set(SITE).send({ purposes: { launch_notice: true }, consentVersions: { launch_notice: 'launch_notice.2020-01-01.1' } })
    expect(outdated.status).toBe(409)
    expect((await leadRow(leadId)).state).toBe('unsubscribed')

    const back = await agent.patch('/api/preferences').set(SITE).send({ purposes: { launch_notice: true }, consentVersions: { launch_notice: VERSIONS.launch_notice } })
    expect(back.status).toBe(200)
    // Telefone ainda não validado pela Bia: volta para received.
    expect(back.body.state).toBe('received')
  })

  it('titular muda faixas, cidade/UF, tema e e-mail (ou remove o e-mail); trilha sem valores', async () => {
    const { leadId, agent } = await sessionFor()
    const res = await agent.patch('/api/preferences').set(SITE).send({
      incomeRange: 'nao_informar',
      jobTenure: 'mais_3_anos',
      city: 'Campinas',
      uf: 'sp',
      interestTopic: 'so_conhecer',
      email: 'Novo.Email@Exemplo-MF.com.br',
    })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ incomeRange: 'nao_informar', jobTenure: 'mais_3_anos', city: 'Campinas', uf: 'SP', interestTopic: 'so_conhecer', emailHint: 'n•••@e•••.com.br' })
    const lead = await leadRow(leadId)
    expect(decryptField(lead.email_ciphertext, h.ctx.config.secrets.encryption, LEAD_CIPHER_CONTEXT.email(leadId))).toBe('novo.email@exemplo-mf.com.br')
    const events = await h.ctx.db.query<{ event_type: string }>(`SELECT event_type FROM lead_events WHERE lead_id = $1 AND source = 'preferencias' ORDER BY created_at`, [leadId])
    expect(events.rows.map((e) => e.event_type)).toEqual(['interest_updated', 'profile_updated'])

    const removed = await agent.patch('/api/preferences').set(SITE).send({ email: null })
    expect(removed.body.emailHint).toBeNull()
    expect((await leadRow(leadId)).email_ciphertext).toBeNull()

    // Repetir os mesmos valores não gera eventos novos.
    await agent.patch('/api/preferences').set(SITE).send({ incomeRange: 'nao_informar', city: 'Campinas' })
    const count = await h.ctx.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM lead_events WHERE lead_id = $1 AND source = 'preferencias'`, [leadId])
    expect(count.rows[0]!.n).toBe(3)
  })

  it('CPF, telefone, nome e empregador não mudam por aqui; valores inválidos são recusados', async () => {
    const { agent } = await sessionFor()
    for (const body of [{ cpf: '52998224725' }, { phone: '11999999999' }, { fullName: 'Outra Pessoa' }, { employerName: 'Outra Empresa' }, { purposes: { sms: true } }]) {
      const r = await agent.patch('/api/preferences').set(SITE).send(body)
      expect(r.status, JSON.stringify(body)).toBe(400)
      expect(r.body.error.code).toBe('validation_error')
    }
    const bad = await agent.patch('/api/preferences').set(SITE).send({ uf: 'ZZ', email: 'sem-arroba', incomeRange: 'muito' })
    expect(bad.body.error.fields).toEqual({ uf: 'Escolha o estado (UF).', email: 'Confira o e-mail.', incomeRange: 'Escolha a faixa de salário líquido.' })
  })
})

describe('POST /api/preferences/opt-out (sem sessão)', () => {
  const optOut = async (phone: string, headers: Record<string, string> = newIp()) => {
    const antiBot = await antiBotFor(h, headers)
    return fresh().post('/api/preferences/opt-out').set(headers).send({ phone, antiBot })
  }

  it('número cadastrado: 202 genérico, revoga aviso e novidades, com trilha e auditoria; sem cadastro: mesma resposta', async () => {
    const person = newPerson()
    const leadId = await registerByBia(h, person)
    const known = await optOut(person.phone.masked)
    const unknown = await optOut(newPerson().phone.masked)
    expect(known.status).toBe(202)
    expect(unknown.status).toBe(202)
    expect(known.body).toEqual(OPT_OUT_RECEIVED)
    expect(unknown.body).toEqual(known.body)

    const prefs = await h.ctx.db.query<{ purpose: string; granted: boolean }>('SELECT purpose, granted FROM lead_preferences WHERE lead_id = $1 ORDER BY purpose', [leadId])
    expect(prefs.rows).toEqual([
      { purpose: 'launch_notice', granted: false },
      { purpose: 'marketing', granted: false },
    ])
    expect((await leadRow(leadId)).state).toBe('unsubscribed')
    const audit = await h.ctx.db.query<{ metadata: Record<string, unknown> }>(`SELECT metadata FROM audit_log WHERE action = 'lead.communication_revoked' AND resource_id = $1`, [leadId])
    expect(audit.rows[0]!.metadata).toMatchObject({ source: 'saida_site' })
    // Pedir de novo continua genérico e não duplica a trilha.
    expect((await optOut(person.phone.masked)).status).toBe(202)
    const changes = await h.ctx.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM lead_events WHERE lead_id = $1 AND source = 'saida_site'`, [leadId])
    expect(changes.rows[0]!.n).toBe(3)
  })

  it('exige anti-robô; campo-armadilha → 202 sem efeito; telefone inválido → 400', async () => {
    const person = newPerson()
    const leadId = await registerByBia(h, person)
    const noToken = await fresh().post('/api/preferences/opt-out').set(newIp()).send({ phone: person.phone.masked })
    expect(noToken.status).toBe(400)
    expect(noToken.body.error.code).toBe('form_expired')
    const trap = await fresh().post('/api/preferences/opt-out').set(newIp()).send({ phone: person.phone.masked, website: 'x' })
    expect(trap.status).toBe(202)
    expect(trap.body).toEqual(OPT_OUT_RECEIVED)
    const prefs = await h.ctx.db.query<{ granted: boolean }>(`SELECT granted FROM lead_preferences WHERE lead_id = $1 AND purpose = 'launch_notice'`, [leadId])
    expect(prefs.rows[0]!.granted).toBe(true)
    const ip = newIp()
    const antiBot = await antiBotFor(h, ip)
    const bad = await fresh().post('/api/preferences/opt-out').set(ip).send({ phone: '(20) 1234', antiBot })
    expect(bad.status).toBe(400)
    expect(bad.body.error.fields).toEqual({ phone: 'Confira o DDD e o número.' })
  })

  it('limite por IP (waitlist.limits.optOutPerIpPerHour) → 429', async () => {
    const ip = newIp()
    for (let i = 0; i < 10; i++) expect((await optOut(newPerson().phone.masked, ip)).status).toBe(202)
    expect((await optOut(newPerson().phone.masked, ip)).status).toBe(429)
  })
})

describe('pedido de exclusão', () => {
  it('registra privacy_requests (deletion, canal preferencias), encerra comunicações e não duplica', async () => {
    const { leadId, agent, person } = await sessionFor(newPerson(), 'bia')
    const pending = await enqueueMessage(h.ctx, h.ctx.db, {
      kind: 'halai_template',
      channel: 'halai',
      purpose: 'marketing',
      leadId,
      recipient: person.phone.e164,
      payload: { template: { name: 'novidades', language: 'pt_BR', bodyVariables: ['Carla'] } },
      idempotencyKey: `test:marketing:${leadId}`,
    })

    const res = await agent.post('/api/preferences/deletion-request').set(SITE).send({})
    expect(res.status).toBe(202)
    expect(res.body.status).toBe('received')
    expect((await agent.post('/api/preferences/deletion-request').set(SITE).send({})).status).toBe(202)

    const requests = await h.ctx.db.query<{ request_type: string; channel: string; status: string }>('SELECT request_type, channel, status FROM privacy_requests WHERE lead_id = $1', [leadId])
    expect(requests.rows).toEqual([{ request_type: 'deletion', channel: 'preferencias', status: 'open' }])
    const prefs = await h.ctx.db.query<{ granted: boolean }>('SELECT granted FROM lead_preferences WHERE lead_id = $1', [leadId])
    expect(prefs.rows.every((p) => p.granted === false)).toBe(true)
    expect((await leadRow(leadId)).state).toBe('unsubscribed')
    const msg = await h.ctx.db.query<{ status: string; last_error: string }>('SELECT status, last_error FROM outbox_messages WHERE id = $1', [pending])
    expect(msg.rows[0]).toEqual({ status: 'cancelled', last_error: 'purpose_revoked' })
    await processOutboxBatch(h.ctx)
    expect(h.halai.sent.filter((m) => m.to === person.phone.e164)).toHaveLength(0)
    const audit = await h.ctx.db.query<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM audit_log WHERE action = 'privacy.deletion_requested' AND metadata->>'leadId' = $1`,
      [leadId],
    )
    expect(audit.rows).toHaveLength(1)
    expect(JSON.stringify(audit.rows[0]!.metadata)).not.toContain(person.phone.e164.slice(3))
  })
})
