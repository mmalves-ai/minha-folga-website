import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import supertest from 'supertest'
import { parse } from 'yaml'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CONSENTS, VALIDATION } from '../src/config/contracts.js'
import { CONTRACTS_DIR } from '../src/config/paths.js'
import { signV1 } from '../src/integrations/halai/signature.js'
import { decryptField, hmacHex } from '../src/lib/crypto.js'
import { LEAD_CIPHER_CONTEXT } from '../src/repositories/leads.repo.js'
import { AGENT_TOOL_NAMES, validateAgentToolInput, type AgentToolName } from '../src/services/agent-tools.service.js'
import { buildFaqBase, loadFaqBase, markdownToPlainText, searchFaq } from '../src/services/faq.service.js'
import { createTestHarness, HALAI_ENV, TEST_INBOUND_KEY, type TestHarness } from './helpers.js'
import {
  attested,
  callTool,
  cpfKeyFor,
  customerInput,
  dedupFor,
  envelope,
  newIp,
  newPerson,
  registerByBia,
  submitSite,
  VERSIONS,
} from './lead-flow.js'

const SITE_URL = 'https://www.minhafolga.com.br'
const HMAC_SECRET = 'test-only-halai-webhook-secret-0123456789abcdef'

function getCapabilities(h: TestHarness, headers: Record<string, string> = { 'x-api-key': TEST_INBOUND_KEY }) {
  return h.api.get('/api/agent/capabilities').set(headers)
}

async function toolCalls(h: TestHarness) {
  const r = await h.ctx.db.query<{ tool: string; outcome: string; credit_phase: string; conversation_ref_hash: string | null }>(
    'SELECT tool, outcome, credit_phase, conversation_ref_hash FROM agent_tool_calls ORDER BY created_at',
  )
  return r.rows
}

const leadRow = async (h: TestHarness, e164: string) =>
  (await h.ctx.db.query<Record<string, any>>('SELECT * FROM leads WHERE dedup_key = $1', [dedupFor(h, e164)])).rows[0] as Record<string, any>

// ---------------------------------------------------------------------------------------------------

describe('Bia desligada', () => {
  let off: TestHarness
  beforeAll(async () => {
    off = await createTestHarness()
  })
  afterAll(async () => {
    await off.close()
  })

  it('HALAI_ENABLED=false: capacidades e ferramentas → 503 agent_disabled, mesmo com a chave', async () => {
    const caps = await getCapabilities(off)
    expect(caps.status).toBe(503)
    expect(caps.body.error.code).toBe('agent_disabled')
    const tool = await callTool(off, 'get_approved_faq', envelope({ query: 'cadastro' }))
    expect(tool.status).toBe(503)
    expect(tool.body.error.code).toBe('agent_disabled')
    expect(await toolCalls(off)).toEqual([])
  })

  it('sem HALAI_INBOUND_API_KEY a chamada é recusada (segunda barreira além da validação de configuração)', async () => {
    const saved = off.ctx.config.halai.enabled
    off.ctx.config.halai.enabled = true
    try {
      const res = await callTool(off, 'get_approved_faq', envelope({ query: 'cadastro' }))
      expect(res.status).toBe(503)
      expect(res.body.error.code).toBe('agent_disabled')
    } finally {
      off.ctx.config.halai.enabled = saved
    }
  })
})

describe('Bia ligada (X-API-Key)', () => {
  let h: TestHarness
  beforeAll(async () => {
    h = await createTestHarness(HALAI_ENV)
  })
  afterAll(async () => {
    await h.close()
  })

  describe('autenticação', () => {
    const body = () => envelope({ query: 'Como saio da lista?' })

    it('chave correta é aceita; ausente ou errada → 401 invalid_api_key', async () => {
      expect((await callTool(h, 'get_approved_faq', body())).status).toBe(200)
      const missing = await h.api.post('/api/agent/tools/get_approved_faq').set('content-type', 'application/json').send(JSON.stringify(body()))
      expect(missing.status).toBe(401)
      expect(missing.body.error.code).toBe('invalid_api_key')
      const wrong = await callTool(h, 'get_approved_faq', body(), { 'x-api-key': `${TEST_INBOUND_KEY}x` })
      expect(wrong.status).toBe(401)
      expect(wrong.body.error.code).toBe('invalid_api_key')
      const caps = await getCapabilities(h, { 'x-api-key': 'outra-chave' })
      expect(caps.status).toBe(401)
    })

    it('X-MF-Request-Id é opcional sem assinatura; repetido → 409 replayed_request', async () => {
      const requestId = `req-${randomUUID()}`
      expect((await callTool(h, 'get_approved_faq', body(), { 'x-mf-request-id': requestId })).status).toBe(200)
      const again = await callTool(h, 'get_approved_faq', body(), { 'x-mf-request-id': requestId })
      expect(again.status).toBe(409)
      expect(again.body.error.code).toBe('replayed_request')
      const bad = await callTool(h, 'get_approved_faq', body(), { 'x-mf-request-id': 'x' })
      expect(bad.status).toBe(400)
    })

    it('ferramenta inexistente → 404; removidas pela D1 também não existem mais', async () => {
      for (const tool of ['delete_all_leads', 'create_waitlist_interest', 'verify_contact', 'request_human_support']) {
        expect((await callTool(h, tool, body())).status, tool).toBe(404)
      }
    })

    it('corpo não JSON → 415', async () => {
      const res = await h.api.post('/api/agent/tools/get_approved_faq').set('x-api-key', TEST_INBOUND_KEY).type('form').send('a=1')
      expect(res.status).toBe(415)
    })
  })

  describe('capacidades', () => {
    it('refletem a fase, trazem textos de consentimento e opções do formulário e não expõem segredos', async () => {
      const res = await getCapabilities(h)
      expect(res.status).toBe(200)
      expect(res.body.phase).toBe('PRE_LAUNCH')
      const byName = Object.fromEntries(res.body.tools.map((t: { name: string }) => [t.name, t]))
      expect(Object.keys(byName).sort()).toEqual([...AGENT_TOOL_NAMES].sort())
      for (const name of ['check_eligibility', 'query_margin', 'get_proposal', 'simulate_credit']) {
        expect(byName[name]).toMatchObject({ enabled: false, reason: 'pre_launch', kind: 'financial' })
      }
      expect(byName.get_approved_faq).toMatchObject({ enabled: true, requiresSenderVerified: false })
      for (const name of ['upsert_customer', 'get_customer_status', 'update_contact_preferences', 'issue_preferences_link']) {
        expect(byName[name]).toMatchObject({ enabled: true, requiresSenderVerified: true, kind: 'relationship' })
      }
      expect(res.body.consents.launch_notice).toEqual({ version: CONSENTS.purposes.launch_notice.version, text: CONSENTS.purposes.launch_notice.text })
      expect(res.body.options.ufs).toEqual(VALIDATION.waitlist.ufs)
      expect(res.body.options.incomeRanges.map((o: { value: string }) => o.value)).toContain('nao_informar')
      expect(res.body.links.preferencias).toBe(`${SITE_URL}/preferencias`)
      const text = JSON.stringify(res.body)
      for (const secret of [TEST_INBOUND_KEY, 'pglite', h.ctx.config.secrets.sessionSecret.toString()]) expect(text).not.toContain(secret)
    })
  })

  describe('get_approved_faq', () => {
    it.each([
      ['A Minha Folga já está liberando empréstimo?', 'ja-libera-emprestimos'],
      ['preciso pagar alguma coisa para entrar na lista?', 'preciso-pagar'],
      ['Sou MEI, posso participar?', 'mei-aplicativo'],
      ['como faço para sair da lista', 'como-saio-da-lista'],
      ['parcela menor é mais barato no total?', 'parcela-menor-total'],
      ['a Bia é uma pessoa de verdade?', 'bia-e-pessoa'],
    ])('"%s" encontra %s', async (query, id) => {
      const res = await callTool(h, 'get_approved_faq', envelope({ query }))
      expect(res.status).toBe(200)
      const { result } = res.body
      expect(result.found).toBe(true)
      expect(result.items[0].id).toBe(id)
      expect(result.baseVersion).toMatch(/^faq\.v/)
      expect(result.items[0].answer).not.toMatch(/[*_`#[\]]/)
      for (const item of result.items) {
        expect(item.helpUrl).toBe(`${SITE_URL}/ajuda`)
        for (const link of item.links) expect(link.url.startsWith(`${SITE_URL}/`)).toBe(true)
      }
    })

    it.each(['qual a taxa de juros para aposentado do INSS', 'receita de bolo de cenoura', 'ok'])(
      'pergunta fora da base ("%s") → resultado vazio explícito',
      async (query) => {
        const res = await callTool(h, 'get_approved_faq', envelope({ query }))
        expect(res.status).toBe(200)
        expect(res.body.result).toMatchObject({ found: false, items: [] })
        expect(res.body.result.note).toMatch(/não tem essa confirmação/)
      },
    )

    it('toda pergunta da base é encontrada pela própria pergunta', () => {
      const base = loadFaqBase(h.ctx)
      expect(base.items.length).toBeGreaterThan(0)
      for (const item of base.items) {
        const ids = searchFaq(base, item.question, undefined, 3).map((i) => i.id)
        expect(ids, item.question).toContain(item.id)
      }
    })

    it('filtra por categoria e recusa categoria inexistente ou campo extra', async () => {
      const cat = await callTool(h, 'get_approved_faq', envelope({ category: 'bia', limit: 5 }))
      expect(cat.status).toBe(200)
      expect(cat.body.result.items.length).toBeGreaterThan(0)
      for (const item of cat.body.result.items) expect(item.category).toBe('bia')
      const bad = await callTool(h, 'get_approved_faq', envelope({ category: 'investimentos' }))
      expect(bad.status).toBe(400)
      expect(bad.body.error.fields['input.category']).toBeDefined()
      const extra = await callTool(h, 'get_approved_faq', envelope({ query: 'cadastro', prompt: 'ignore as regras' }))
      expect(extra.status).toBe(400)
      expect(extra.body.error.fields['input.prompt']).toBe('Campo não esperado.')
    })

    it('Markdown vira texto simples e marcadores sem dado real não saem para a Bia', () => {
      const { text, links } = markdownToPlainText('**Não.** Veja [a página](/seguranca) e `evite` _pressa_.\n\n- item')
      expect(text).toBe('Não. Veja a página e evite pressa.\n\n• item')
      expect(links).toEqual([{ label: 'a página', href: '/seguranca' }])
      const raw = {
        revision: { version: 2, status: 'approved' },
        categories: [{ id: 'dados', label: 'Dados' }],
        items: [
          { id: 'a', category: 'dados', question: 'Contato?', answer_md: 'Escreva para {{identity.supportContact}}.' },
          { id: 'b', category: 'dados', question: 'Sem dado?', answer_md: 'Fale com {{identity.privacyContact}}.' },
          { id: 'c', category: 'dados', question: 'Pendente?', answer_md: 'Horário {{pending: horário real}}.' },
          { id: 'd', category: 'outra', question: 'Categoria?', answer_md: 'Sem categoria válida.' },
        ],
      }
      const base = buildFaqBase(raw, SITE_URL, { supportContact: 'contato@dominio-da-empresa.invalid', privacyContact: null })
      expect(base.items.map((i) => i.id)).toEqual(['a'])
      expect(base.withheld).toBe(3)
    })
  })

  describe('ferramentas financeiras em PRE_LAUNCH', () => {
    it.each(['check_eligibility', 'query_margin', 'get_proposal', 'simulate_credit'])(
      '%s → 403 credit_phase_locked, sem ler nem guardar a entrada',
      async (tool) => {
        const ref = `conv-${randomUUID()}`
        const res = await callTool(h, tool, { conversationRef: ref, ...attested('+5511987650001'), input: { cpf: '529.982.247-25', valor: 5000 } })
        expect(res.status).toBe(403)
        expect(res.body.error.code).toBe('credit_phase_locked')
        const rows = (await toolCalls(h)).filter((r) => r.tool === tool)
        expect(rows.at(-1)).toMatchObject({ outcome: 'credit_phase_locked', credit_phase: 'PRE_LAUNCH' })
        expect(rows.at(-1)!.conversation_ref_hash).toBe(hmacHex(ref, h.ctx.config.secrets.sessionSecret, 'halai.conversation'))
        const everything = JSON.stringify(await h.ctx.db.query('SELECT * FROM agent_tool_calls'))
        expect(everything).not.toContain('529.982.247-25')
        expect(everything).not.toContain(ref)
      },
    )

    it('em PILOT sem integração homologada → 503 credit_unavailable', async () => {
      const pilot = await createTestHarness({ ...HALAI_ENV, CREDIT_PHASE: 'PILOT', CREDIT_OPERATIONS_ENABLED: 'true' })
      try {
        const res = await callTool(pilot, 'simulate_credit', envelope({ valor: 1000 }))
        expect(res.status).toBe(503)
        expect(res.body.error.code).toBe('credit_unavailable')
        const caps = await getCapabilities(pilot)
        expect(caps.body.tools.find((t: { name: string }) => t.name === 'simulate_credit')).toMatchObject({ enabled: false, reason: 'integration_not_available' })
      } finally {
        await pilot.close()
      }
    })
  })

  describe('upsert_customer (telefone atestado)', () => {
    it('sem remetente atestado → 403 sender_not_verified e nada é gravado', async () => {
      const person = newPerson()
      const notAttested = await callTool(h, 'upsert_customer', envelope(customerInput(person), { senderPhone: person.phone.e164 }))
      expect(notAttested.status).toBe(403)
      expect(notAttested.body.error.code).toBe('sender_not_verified')
      expect(notAttested.body.error.alternativeUrl).toBe(`${SITE_URL}/avise-me`)
      expect(await leadRow(h, person.phone.e164)).toBeUndefined()
      const noPhone = await callTool(h, 'upsert_customer', envelope(customerInput(person), { senderVerified: true }))
      expect(noPhone.status).toBe(400)
      expect(noPhone.body.error.fields.senderPhone).toBeDefined()
    })

    it('cria o cadastro com os campos do formulário, já com o número validado (verified), cifrado como no site', async () => {
      const person = newPerson()
      const res = await callTool(h, 'upsert_customer', envelope(customerInput(person, { email: 'carla@exemplo-mf.com.br' }), attested(person.phone.e164)))
      expect(res.status).toBe(200)
      expect(res.body.result).toMatchObject({
        status: 'created',
        contactVerified: true,
        state: 'verified',
        purposes: { launch_notice: true, marketing: true },
        employmentNotice: null,
        customer: {
          nameHint: 'Carla M. R.',
          cpfHint: `***.***.***-${person.cpf.digits.slice(-2)}`,
          emailHint: 'c•••@e•••.com.br',
          employerName: 'Hospital Santa Luzia',
          jobTenure: 'mais_3_anos',
          incomeRange: '4000_a_7000',
          city: 'Recife',
          uf: 'PE',
        },
      })
      expect(JSON.stringify(res.body)).not.toContain(person.cpf.digits)
      const lead = await leadRow(h, person.phone.e164)
      expect(lead).toMatchObject({ state: 'verified', source: 'bia', full_name: 'Carla Mendes Ribeiro', cpf_key: cpfKeyFor(h, person.cpf.digits) })
      expect(lead.contact_verified_at).not.toBeNull()
      expect(decryptField(lead.cpf_ciphertext, h.ctx.config.secrets.encryption, LEAD_CIPHER_CONTEXT.cpf(lead.id))).toBe(person.cpf.digits)
      const events = await h.ctx.db.query<{ event_type: string; to_state: string | null; actor_type: string }>(
        'SELECT event_type, to_state, actor_type FROM lead_events WHERE lead_id = $1 ORDER BY created_at',
        [lead.id],
      )
      expect(events.rows.map((e) => `${e.event_type}:${e.to_state ?? ''}`)).toEqual([
        'state_changed:received',
        'preference_changed:',
        'preference_changed:',
        'contact_verified:',
        'state_changed:verified',
      ])
      expect(events.rows.every((e) => e.actor_type === 'agent')).toBe(true)
    })

    it('criação exige os campos do formulário, 18+, consentimentos explícitos e as versões vigentes', async () => {
      const person = newPerson()
      const missing = await callTool(h, 'upsert_customer', envelope({ fullName: 'Pessoa Sem Dados' }, attested(person.phone.e164)))
      expect(missing.status).toBe(400)
      expect(Object.keys(missing.body.error.fields).sort()).toEqual(
        [
          'input.ageConfirmed',
          'input.city',
          'input.consents.launch_notice',
          'input.consents.marketing',
          'input.cpf',
          'input.employerName',
          'input.employmentType',
          'input.incomeRange',
          'input.jobTenure',
          'input.uf',
        ].sort(),
      )
      const badCpf = await callTool(h, 'upsert_customer', envelope(customerInput(person, { cpf: '111.111.111-11' }), attested(person.phone.e164)))
      expect(badCpf.status).toBe(400)
      expect(badCpf.body.error.fields['input.cpf']).toBe('Confira o CPF.')
      const outdated = await callTool(
        h,
        'upsert_customer',
        envelope(customerInput(person, { consentVersions: { launch_notice: 'launch_notice.2020-01-01.1', marketing: VERSIONS.marketing } }), attested(person.phone.e164)),
      )
      expect(outdated.status).toBe(409)
      expect(outdated.body.error.code).toBe('consent_version_outdated')
      expect(await leadRow(h, person.phone.e164)).toBeUndefined()
    })

    it('cadastro feito pelo site (received): a Bia valida o número e atualiza os dados informados na conversa', async () => {
      const person = newPerson()
      expect((await submitSite(h, person, newIp())).status).toBe(201)
      expect((await leadRow(h, person.phone.e164)).state).toBe('received')
      const res = await callTool(h, 'upsert_customer', envelope({ email: 'novo.email@exemplo-mf.com.br', incomeRange: 'nao_informar' }, attested(person.phone.e164)))
      expect(res.status).toBe(200)
      expect(res.body.result).toMatchObject({ status: 'updated', contactVerified: true, state: 'verified', customer: { incomeRange: 'nao_informar', emailHint: 'n•••@e•••.com.br' } })
      const lead = await leadRow(h, person.phone.e164)
      expect(lead.contact_verified_at).not.toBeNull()
      expect(lead.full_name).toBe('Ana Paula de Souza')
      const audit = await h.ctx.db.query<{ metadata: Record<string, unknown> }>(
        `SELECT metadata FROM audit_log WHERE action = 'lead.customer_upserted' AND resource_id = $1`,
        [lead.id],
      )
      expect(audit.rows[0]!.metadata).toMatchObject({ outcome: 'updated', fieldsChanged: ['email', 'incomeRange'] })
      expect(JSON.stringify(audit.rows)).not.toContain('novo.email')
    })

    it('CPF de OUTRO cadastro (outro telefone) → needs_review, sem mesclar e sem criar; submissão guardada', async () => {
      const owner = newPerson()
      await registerByBia(h, owner)
      const other = { phone: newPerson().phone, cpf: owner.cpf }
      const res = await callTool(h, 'upsert_customer', envelope(customerInput(other, { fullName: 'Outra Pessoa Qualquer' }), attested(other.phone.e164)))
      expect(res.status).toBe(200)
      expect(res.body.result.status).toBe('needs_review')
      expect(res.body.result.message).toMatch(/equipe/)
      expect(await leadRow(h, other.phone.e164)).toBeUndefined()
      const ownerLead = await leadRow(h, owner.phone.e164)
      expect(ownerLead.full_name).toBe('Carla Mendes Ribeiro')
      const held = await h.ctx.db.query<{ channel: string; reason: string; lead_id: string; payload_ciphertext: string }>(
        'SELECT channel, reason, lead_id, payload_ciphertext FROM lead_submissions WHERE lead_id = $1',
        [ownerLead.id],
      )
      expect(held.rows).toEqual([expect.objectContaining({ channel: 'bia', reason: 'cpf_conflict', lead_id: ownerLead.id })])
      expect(held.rows[0]!.payload_ciphertext).not.toContain('Outra Pessoa')
      const calls = (await toolCalls(h)).filter((c) => c.tool === 'upsert_customer')
      expect(calls.at(-1)!.outcome).toBe('needs_review')
    })

    it('CPF diferente do já cadastrado para o mesmo número → needs_review e nada muda', async () => {
      const person = newPerson()
      await registerByBia(h, person)
      const res = await callTool(h, 'upsert_customer', envelope({ cpf: newPerson().cpf.digits, city: 'Olinda' }, attested(person.phone.e164)))
      expect(res.body.result.status).toBe('needs_review')
      const lead = await leadRow(h, person.phone.e164)
      expect(lead).toMatchObject({ city: 'Recife', cpf_key: cpfKeyFor(h, person.cpf.digits) })
    })

    it('número suprimido pela equipe de privacidade → needs_review', async () => {
      const person = newPerson()
      await h.ctx.db.query(`INSERT INTO suppression_list (dedup_key, reason) VALUES ($1, 'opposition')`, [dedupFor(h, person.phone.e164)])
      const res = await callTool(h, 'upsert_customer', envelope(customerInput(person), attested(person.phone.e164)))
      expect(res.body.result.status).toBe('needs_review')
      expect(await leadRow(h, person.phone.e164)).toBeUndefined()
    })
  })

  describe('get_customer_status', () => {
    it('não cadastrado → not_registered; cadastrado → estado, finalidades e dados mascarados', async () => {
      const unknown = await callTool(h, 'get_customer_status', envelope({}, attested(newPerson().phone.e164)))
      expect(unknown.body.result.status).toBe('not_registered')
      const person = newPerson()
      expect((await submitSite(h, person, newIp())).status).toBe(201)
      const res = await callTool(h, 'get_customer_status', envelope({}, attested(person.phone.e164)))
      expect(res.status).toBe(200)
      expect(res.body.result).toMatchObject({
        status: 'registered',
        contactVerified: false,
        state: 'received',
        purposes: { launch_notice: true, marketing: false },
        customer: { nameHint: 'Ana P. S.', employerName: 'Mercado Bom Preço Ltda', uf: 'SP' },
      })
      expect(JSON.stringify(res.body)).not.toContain(person.cpf.digits)
      expect(JSON.stringify(res.body)).not.toContain('ana.souza@')
      const notAttested = await callTool(h, 'get_customer_status', envelope({}, { senderPhone: person.phone.e164 }))
      expect(notAttested.status).toBe(403)
    })
  })

  describe('update_contact_preferences', () => {
    it('view, "pare" (revoke_all) e set com a versão vigente', async () => {
      const person = newPerson()
      await registerByBia(h, person)
      const phone = person.phone.e164
      const view = await callTool(h, 'update_contact_preferences', envelope({ action: 'view' }, attested(phone)))
      expect(view.body.result).toMatchObject({ status: 'current', purposes: { launch_notice: true, marketing: true } })
      const stop = await callTool(h, 'update_contact_preferences', envelope({ action: 'revoke_all' }, attested(phone)))
      expect(stop.body.result.status).toBe('revoked')
      expect((await leadRow(h, phone)).state).toBe('unsubscribed')
      const back = await callTool(
        h,
        'update_contact_preferences',
        envelope({ action: 'set', purposes: { launch_notice: true }, consentVersions: { launch_notice: VERSIONS.launch_notice } }, attested(phone)),
      )
      expect(back.body.result).toMatchObject({ status: 'updated', state: 'verified', purposes: { launch_notice: true, marketing: false } })
      const noVersion = await callTool(h, 'update_contact_preferences', envelope({ action: 'set', purposes: { marketing: true } }, attested(phone)))
      expect(noVersion.status).toBe(400)
      expect(noVersion.body.error.fields['input.consentVersions.marketing']).toBeDefined()
    })

    it('sem remetente atestado → 403; número sem cadastro → not_registered', async () => {
      const res = await callTool(h, 'update_contact_preferences', envelope({ action: 'revoke_all' }, { senderPhone: '+5511987650001' }))
      expect(res.status).toBe(403)
      const none = await callTool(h, 'update_contact_preferences', envelope({ action: 'revoke_all' }, attested(newPerson().phone.e164)))
      expect(none.body.result.status).toBe('not_registered')
    })
  })

  describe('issue_preferences_link', () => {
    it('gera link de uso único para /preferencias#token=…, válido por waitlist.preferencesLinkTtlSeconds', async () => {
      const person = newPerson()
      await registerByBia(h, person)
      const res = await callTool(h, 'issue_preferences_link', envelope({}, attested(person.phone.e164)))
      expect(res.status).toBe(200)
      const { result } = res.body
      expect(result).toMatchObject({ status: 'issued', expiresInSeconds: VALIDATION.waitlist.preferencesLinkTtlSeconds })
      expect(result.url).toMatch(/^https:\/\/www\.minhafolga\.com\.br\/preferencias#token=[A-Za-z0-9_-]{43}$/)
      expect(result.message).toMatch(/30 minutos/)
      const token = result.url.split('#token=')[1]
      const stored = await h.ctx.db.query<{ token_hash: string }>(
        'SELECT token_hash FROM contact_access_tokens t JOIN leads l ON l.id = t.lead_id WHERE l.dedup_key = $1',
        [dedupFor(h, person.phone.e164)],
      )
      expect(stored.rows[0]!.token_hash).not.toBe(token)
      // Nada é enviado por este sistema: a Bia mostra o link na conversa.
      expect(h.halai.sent).toHaveLength(0)

      const browser = supertest.agent(h.app)
      const ok = await browser.post('/api/preferences/token').set(newIp()).send({ token })
      expect(ok.status).toBe(200)
      expect((await browser.get('/api/preferences').set(newIp())).status).toBe(200)
      const reused = await supertest.agent(h.app).post('/api/preferences/token').set(newIp()).send({ token })
      expect(reused.status).toBe(401)
      expect(reused.body.error.code).toBe('invalid_or_expired_link')

      const second = (await callTool(h, 'issue_preferences_link', envelope({}, attested(person.phone.e164)))).body.result.url.split('#token=')[1]
      h.clock.advance(VALIDATION.waitlist.preferencesLinkTtlSeconds * 1000 + 1000)
      expect((await supertest.agent(h.app).post('/api/preferences/token').set(newIp()).send({ token: second })).status).toBe(401)
    })

    it('número sem cadastro → not_registered; sem atestado → 403', async () => {
      const none = await callTool(h, 'issue_preferences_link', envelope({}, attested(newPerson().phone.e164)))
      expect(none.body.result.status).toBe('not_registered')
      const res = await callTool(h, 'issue_preferences_link', envelope({}, { senderPhone: '+5511987650001' }))
      expect(res.status).toBe(403)
    })
  })

  describe('registro minimizado', () => {
    it('toda chamada autenticada registra ferramenta, resultado, fase e HMAC da conversa, sem conteúdo', async () => {
      const ref = `conv-${randomUUID()}`
      await callTool(h, 'get_approved_faq', { conversationRef: ref, input: { query: 'receita de bolo' } })
      await callTool(h, 'get_approved_faq', { conversationRef: ref, input: { query: 'x'.repeat(300) } })
      const hash = hmacHex(ref, h.ctx.config.secrets.sessionSecret, 'halai.conversation')
      const rows = (await toolCalls(h)).filter((r) => r.conversation_ref_hash === hash)
      expect(rows.map((r) => r.outcome)).toEqual(['empty', 'validation_error'])
      const all = JSON.stringify((await h.ctx.db.query('SELECT * FROM agent_tool_calls')).rows)
      expect(all).not.toContain('receita')
      expect(all).not.toContain(ref)
    })
  })

  describe('contrato contracts/agent-tools.json e OpenAPI', () => {
    const contract = JSON.parse(readFileSync(resolve(CONTRACTS_DIR, 'agent-tools.json'), 'utf8')) as {
      transport: { authentication: { headers: Record<string, string> } }
      tools: Record<string, { allowedPhases: string[]; kind: string; requiresSenderVerified: boolean; examples?: { input: unknown }[] }>
    }
    const openapi = parse(readFileSync(resolve(CONTRACTS_DIR, 'openapi.yaml'), 'utf8')) as {
      paths: Record<string, { post?: { parameters?: { name: string; required?: boolean }[] } }>
    }

    it('lista as mesmas ferramentas do servidor e do OpenAPI (uma rota explícita por ferramenta, X-API-Key obrigatório)', () => {
      const prefix = '/api/agent/tools/'
      const openapiTools = Object.keys(openapi.paths)
        .filter((p) => p.startsWith(prefix))
        .map((p) => p.slice(prefix.length))
      expect(Object.keys(contract.tools).sort()).toEqual([...AGENT_TOOL_NAMES].sort())
      expect(openapiTools.sort()).toEqual([...AGENT_TOOL_NAMES].sort())
      for (const name of openapiTools) {
        const headers = openapi.paths[`${prefix}${name}`]?.post?.parameters ?? []
        expect(headers.filter((h) => h.required).map((h) => h.name)).toEqual(['X-API-Key'])
        expect(headers.map((h) => h.name).sort()).toEqual(['X-API-Key', 'X-MF-Request-Id', 'X-MF-Signature', 'X-MF-Timestamp'])
      }
      expect(Object.keys(contract.transport.authentication.headers)).toContain('X-API-Key')
      for (const removed of ['/api/webhooks/whatsapp', '/api/waitlist/verify', '/api/waitlist/resend', '/api/preferences/access', '/api/preferences/access/verify']) {
        expect(openapi.paths[removed], removed).toBeUndefined()
      }
      for (const added of ['/api/form-token', '/api/preferences/opt-out']) expect(openapi.paths[added], added).toBeDefined()
    })

    it('ferramentas financeiras não são permitidas em PRE_LAUNCH; as demais valem em todas as fases', () => {
      for (const [name, def] of Object.entries(contract.tools)) {
        if (def.kind === 'financial') expect(def.allowedPhases, name).not.toContain('PRE_LAUNCH')
        else expect(def.allowedPhases, name).toEqual(['PRE_LAUNCH', 'PILOT', 'LIVE'])
      }
    })

    it('os exemplos de entrada do contrato passam na validação do servidor', () => {
      for (const [name, def] of Object.entries(contract.tools)) {
        for (const example of def.examples ?? []) {
          expect(() => validateAgentToolInput(name as AgentToolName, example.input), `${name}: ${JSON.stringify(example.input)}`).not.toThrow()
        }
      }
    })
  })
})

describe('Bia com assinatura HMAC opcional configurada (HALAI_WEBHOOK_SECRET)', () => {
  let s: TestHarness
  beforeAll(async () => {
    s = await createTestHarness({ ...HALAI_ENV, HALAI_WEBHOOK_SECRET: HMAC_SECRET })
  })
  afterAll(async () => {
    await s.close()
  })

  function signedCall(body: unknown, opts: { ts?: number; requestId?: string | null; secret?: string; rawBody?: string } = {}) {
    const raw = opts.rawBody ?? JSON.stringify(body)
    const ts = String(opts.ts ?? Math.floor(s.clock.current.getTime() / 1000))
    const req = s.api
      .post('/api/agent/tools/get_approved_faq')
      .set('content-type', 'application/json')
      .set('x-api-key', TEST_INBOUND_KEY)
      .set('x-mf-timestamp', ts)
      .set('x-mf-signature', signV1(opts.secret ?? HMAC_SECRET, ts, raw))
    if (opts.requestId !== null) req.set('x-mf-request-id', opts.requestId ?? `req-${randomUUID()}`)
    return req.send(raw)
  }

  it('com a assinatura configurada, só a chave não basta', async () => {
    const res = await callTool(s, 'get_approved_faq', envelope({ query: 'cadastro' }))
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('invalid_signature')
  })

  it('assinatura válida é aceita; errada, alterada ou fora da janela é recusada', async () => {
    expect((await signedCall(envelope({ query: 'cadastro' }))).status).toBe(200)
    expect((await signedCall(envelope({ query: 'cadastro' }), { secret: 'outro-segredo' })).status).toBe(401)
    const stale = await signedCall(envelope({ query: 'cadastro' }), { ts: Math.floor(s.clock.current.getTime() / 1000) - 301 })
    expect(stale.body.error.code).toBe('stale_request')
  })

  it('X-MF-Request-Id obrigatório; mesma chamada assinada com outro id também é replay', async () => {
    expect((await signedCall(envelope({ query: 'cadastro' }), { requestId: null })).status).toBe(400)
    const raw = JSON.stringify(envelope({ query: 'cadastro' }))
    const ts = Math.floor(s.clock.current.getTime() / 1000)
    expect((await signedCall(null, { rawBody: raw, ts })).status).toBe(200)
    const copy = await signedCall(null, { rawBody: raw, ts })
    expect(copy.status).toBe(409)
    expect(copy.body.error.code).toBe('replayed_request')
  })

  it('a chave continua obrigatória mesmo com assinatura válida', async () => {
    const raw = JSON.stringify(envelope({ query: 'cadastro' }))
    const ts = String(Math.floor(s.clock.current.getTime() / 1000))
    const res = await s.api
      .post('/api/agent/tools/get_approved_faq')
      .set('content-type', 'application/json')
      .set('x-mf-timestamp', ts)
      .set('x-mf-signature', signV1(HMAC_SECRET, ts, raw))
      .set('x-mf-request-id', `req-${randomUUID()}`)
      .send(raw)
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('invalid_api_key')
  })
})
