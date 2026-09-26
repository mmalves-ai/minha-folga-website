import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Queryable } from '../src/db/database.js'
import { decryptField } from '../src/lib/crypto.js'
import { LEAD_CIPHER_CONTEXT } from '../src/repositories/leads.repo.js'
import { readSubmissionPayload } from '../src/repositories/submissions.repo.js'
import { RECEIVED_MESSAGE } from '../src/services/waitlist.service.js'
import { createTestHarness, type TestHarness } from './helpers.js'
import {
  antiBotFor,
  captureLogger,
  cpfKeyFor,
  dedupFor,
  newIp,
  newPerson,
  submitSite,
  VERSIONS,
  waitlistBody,
  type Person,
} from './lead-flow.js'

let h: TestHarness
beforeAll(async () => {
  h = await createTestHarness()
})
afterAll(async () => {
  await h.close()
})

/** Linha do cadastro pelo número (undefined em tempo de execução quando não existe). */
const leadByPhone = async (e164: string) =>
  (await h.ctx.db.query<Record<string, any>>('SELECT * FROM leads WHERE dedup_key = $1', [dedupFor(h, e164)])).rows[0] as Record<string, any>

const countRows = async (sql: string, params: unknown[] = []) => (await h.ctx.db.query<{ n: number }>(sql, params)).rows[0]!.n

const RECEIVED = { status: 'received', message: RECEIVED_MESSAGE }

describe('POST /api/waitlist (D1: cadastro com CPF e empregador, sem confirmação por WhatsApp)', () => {
  it('cadastro novo: 201 genérico, estado received, dados sensíveis cifrados, dicas mascaradas e trilha', async () => {
    const person = newPerson()
    const res = await submitSite(h, person, newIp(), { utm: { utm_source: 'Instagram', utm_campaign: 'Lancamento-1' }, interestTopic: 'entender_portabilidade' })
    expect(res.status).toBe(201)
    expect(res.body).toEqual(RECEIVED)

    const lead = await leadByPhone(person.phone.e164)
    expect(lead).toMatchObject({
      state: 'received',
      contact_verified_at: null,
      full_name: 'Ana Paula de Souza',
      preferred_name: 'Ana',
      employment_type: 'clt',
      job_tenure: '1_a_3_anos',
      income_range: '2000_a_4000',
      city: 'São Paulo',
      uf: 'SP',
      interest_topic: 'entender_portabilidade',
      utm_source: 'instagram',
      utm_campaign: 'lancamento-1',
      phone_hint: `(11) •••••-••${person.phone.e164.slice(-2)}`,
      cpf_hint: `***.***.***-${person.cpf.digits.slice(-2)}`,
      email_hint: 'a•••@e•••.com.br',
      cpf_key: cpfKeyFor(h, person.cpf.digits),
    })
    // Nada sensível em claro no banco; cada campo com o próprio contexto de cifragem.
    const dump = JSON.stringify(lead)
    for (const secret of [person.cpf.digits, person.cpf.masked, person.phone.e164.slice(3), 'ana.souza@', 'Mercado Bom Preço']) {
      expect(dump).not.toContain(secret)
    }
    const keyring = h.ctx.config.secrets.encryption
    expect(decryptField(lead.cpf_ciphertext, keyring, LEAD_CIPHER_CONTEXT.cpf(lead.id))).toBe(person.cpf.digits)
    expect(decryptField(lead.email_ciphertext, keyring, LEAD_CIPHER_CONTEXT.email(lead.id))).toBe('ana.souza@exemplo-mf.com.br')
    expect(decryptField(lead.employer_ciphertext, keyring, LEAD_CIPHER_CONTEXT.employer(lead.id))).toBe('Mercado Bom Preço Ltda')
    expect(decryptField(lead.phone_ciphertext, keyring, LEAD_CIPHER_CONTEXT.phone(lead.id))).toBe(person.phone.e164)
    expect(() => decryptField(lead.cpf_ciphertext, keyring, LEAD_CIPHER_CONTEXT.email(lead.id))).toThrow()

    const events = await h.ctx.db.query<{ event_type: string; to_state: string | null; purpose: string | null }>(
      'SELECT event_type, to_state, purpose FROM lead_events WHERE lead_id = $1 ORDER BY created_at',
      [lead.id],
    )
    expect(events.rows.map((e) => e.event_type + ':' + (e.to_state ?? e.purpose ?? ''))).toEqual([
      'state_changed:received',
      'preference_changed:launch_notice',
      'preference_changed:marketing',
    ])
    const prefs = await h.ctx.db.query<{ purpose: string; granted: boolean; consent_text_version: string }>(
      'SELECT purpose, granted, consent_text_version FROM lead_preferences WHERE lead_id = $1 ORDER BY purpose',
      [lead.id],
    )
    expect(prefs.rows).toEqual([
      { purpose: 'launch_notice', granted: true, consent_text_version: VERSIONS.launch_notice },
      { purpose: 'marketing', granted: false, consent_text_version: VERSIONS.marketing },
    ])
    // Nenhuma mensagem sai por padrão (placeholder da Hal-AI desligado) e nenhum código de verificação existe.
    expect(await countRows('SELECT count(*)::int AS n FROM outbox_messages WHERE lead_id = $1', [lead.id])).toBe(0)
    expect(await countRows('SELECT count(*)::int AS n FROM verification_challenges')).toBe(0)
  })

  it('e-mail é opcional (vazio ou ausente) e CPF aceita só dígitos', async () => {
    const a = newPerson()
    const noEmail = await submitSite(h, a, newIp(), { email: '', cpf: a.cpf.digits })
    expect(noEmail.status).toBe(201)
    expect(await leadByPhone(a.phone.e164)).toMatchObject({ email_ciphertext: null, email_hint: null })
    const b = newPerson()
    const body = waitlistBody(b)
    delete body.email
    const ip = newIp()
    const antiBot = await antiBotFor(h, ip)
    expect((await h.api.post('/api/waitlist').set(ip).send({ ...body, antiBot })).status).toBe(201)
  })
})

describe('validação do cadastro', () => {
  const post = async (body: Record<string, unknown>) => {
    const ip = newIp()
    const antiBot = await antiBotFor(h, ip)
    return h.api.post('/api/waitlist').set(ip).send({ ...body, antiBot })
  }

  it('mensagens de campo em português: CPF, nome completo, DDD, faixas, UF, idade e aviso', async () => {
    const res = await post({
      ...waitlistBody(newPerson()),
      fullName: 'Ana',
      cpf: '529.982.247-24',
      phone: '(20) 91234-5678',
      email: 'sem-arroba',
      employerName: '1',
      employmentType: 'autonomo',
      jobTenure: 'dez_anos',
      incomeRange: 'muito',
      city: 'Cidade 123',
      uf: 'XX',
      ageConfirmed: false,
      consents: { launch_notice: false, marketing: false },
    })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('validation_error')
    expect(res.body.error.fields).toEqual({
      fullName: 'Informe seu nome completo (nome e sobrenome).',
      cpf: 'Confira o CPF.',
      phone: 'Confira o DDD e o número.',
      email: 'Confira o e-mail.',
      employerName: 'Informe o nome da empresa onde você trabalha.',
      employmentType: 'Escolha o tipo de vínculo.',
      jobTenure: 'Escolha há quanto tempo você está no emprego atual.',
      incomeRange: 'Escolha a faixa de salário líquido.',
      city: 'Informe a cidade.',
      uf: 'Escolha o estado (UF).',
      ageConfirmed: 'Confirme que você tem 18 anos ou mais.',
      'consents.launch_notice': 'Para entrar na lista, autorize o aviso de abertura pelo WhatsApp.',
    })
  })

  it.each(['000.000.000-00', '111.111.111-11', '99999999999', '123.456.789-00', '5299822472', '529.982.247-2a'])(
    'CPF inválido "%s" → "Confira o CPF."',
    async (cpf) => {
      const person = newPerson()
      const res = await post({ ...waitlistBody(person), cpf })
      expect(res.status).toBe(400)
      expect(res.body.error.fields).toEqual({ cpf: 'Confira o CPF.' })
      expect(await leadByPhone(person.phone.e164)).toBeUndefined()
    },
  )

  it.each(['Ana', 'Ana 123 Souza', 'ana@x.com Souza', 'A'])('nome "%s" sem nome e sobrenome válidos é recusado', async (fullName) => {
    const res = await post({ ...waitlistBody(newPerson()), fullName })
    expect(res.status).toBe(400)
    expect(Object.keys(res.body.error.fields)).toEqual(['fullName'])
  })

  it('UF em minúsculas é aceita e normalizada; telefone fixo é recusado', async () => {
    const person = newPerson()
    expect((await post({ ...waitlistBody(person), uf: 'pe', city: 'Olinda' })).status).toBe(201)
    expect((await leadByPhone(person.phone.e164)).uf).toBe('PE')
    const fixed = await post({ ...waitlistBody(newPerson()), phone: '(11) 3456-7890' })
    expect(fixed.body.error.fields).toEqual({ phone: 'Confira o DDD e o número.' })
  })

  it('campos inesperados, origem desconhecida e chaves de UTM fora da lista são recusados', async () => {
    const person = newPerson()
    const extra = await post({ ...waitlistBody(person), preferredName: 'Ana' })
    expect(extra.status).toBe(400)
    expect(extra.body.error.fields.preferredName).toBe('Campo não esperado.')
    expect((await post(waitlistBody(person, { source: 'pagina-falsa' }))).status).toBe(400)
    expect((await post(waitlistBody(person, { utm: { utm_id: 'x' } }))).status).toBe(400)
    expect(await leadByPhone(person.phone.e164)).toBeUndefined()
  })

  it('valores de UTM inválidos são descartados sem impedir o cadastro', async () => {
    const person = newPerson()
    const ok = await post(waitlistBody(person, { utm: { utm_source: 'bad value!', utm_term: '11987654321', utm_medium: 'CPC' } }))
    expect(ok.status).toBe(201)
    const lead = await leadByPhone(person.phone.e164)
    expect([lead.utm_source, lead.utm_term, lead.utm_medium]).toEqual([null, null, 'cpc'])
  })

  it('versão desatualizada do texto de consentimento → 409 e nada é gravado', async () => {
    const person = newPerson()
    const res = await post(waitlistBody(person, { consentVersions: { launch_notice: 'launch_notice.2020-01-01.1', marketing: VERSIONS.marketing } }))
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('consent_version_outdated')
    expect(await leadByPhone(person.phone.e164)).toBeUndefined()
  })
})

describe('respostas genéricas e proteção do cadastro existente', () => {
  const heldFor = async (leadId: string) =>
    (await h.ctx.db.query<Record<string, any>>('SELECT * FROM lead_submissions WHERE lead_id = $1 ORDER BY created_at', [leadId])).rows

  it('telefone já cadastrado: resposta idêntica, cadastro NÃO sobrescrito, submissão guardada cifrada para revisão', async () => {
    const person = newPerson()
    expect((await submitSite(h, person)).status).toBe(201)
    const before = await leadByPhone(person.phone.e164)

    const other: Person = { phone: person.phone, cpf: newPerson().cpf }
    const res = await submitSite(h, other, newIp(), {
      fullName: 'Mallory da Silva',
      employmentType: 'rural',
      employerName: 'Fazenda Outra',
      consents: { launch_notice: true, marketing: true },
    })
    expect(res.status).toBe(201)
    expect(res.body).toEqual(RECEIVED)

    const after = await leadByPhone(person.phone.e164)
    expect(after).toMatchObject({ id: before.id, full_name: 'Ana Paula de Souza', employment_type: 'clt', cpf_key: before.cpf_key, state: 'received' })
    const marketing = await h.ctx.db.query<{ granted: boolean }>(`SELECT granted FROM lead_preferences WHERE lead_id = $1 AND purpose = 'marketing'`, [before.id])
    expect(marketing.rows[0]!.granted).toBe(false)

    const held = await heldFor(before.id)
    expect(held).toHaveLength(1)
    expect(held[0]).toMatchObject({ channel: 'site', reason: 'existing_phone', status: 'pending', phone_key: dedupFor(h, person.phone.e164) })
    expect(held[0]!.payload_ciphertext).not.toContain('Mallory')
    expect(held[0]!.payload_ciphertext).not.toContain(other.cpf.digits)
    const payload = readSubmissionPayload(held[0] as never, h.ctx.config.secrets.encryption)!
    expect(payload.data).toMatchObject({ fullName: 'Mallory da Silva', cpf: other.cpf.digits, employerName: 'Fazenda Outra' })
    expect(payload.consents).toEqual({ launch_notice: true, marketing: true })
    const trail = await h.ctx.db.query<{ event_type: string }>(`SELECT event_type FROM lead_events WHERE lead_id = $1 ORDER BY created_at`, [before.id])
    expect(trail.rows.map((r) => r.event_type)).toContain('submission_held')
    expect(await countRows('SELECT count(*)::int AS n FROM leads WHERE dedup_key = $1', [dedupFor(h, person.phone.e164)])).toBe(1)
  })

  it('CPF já cadastrado com OUTRO telefone: resposta idêntica, nenhum cadastro novo, submissão guardada', async () => {
    const owner = newPerson()
    expect((await submitSite(h, owner)).status).toBe(201)
    const ownerLead = await leadByPhone(owner.phone.e164)
    const intruder: Person = { phone: newPerson().phone, cpf: owner.cpf }
    const res = await submitSite(h, intruder)
    expect(res.status).toBe(201)
    expect(res.body).toEqual(RECEIVED)
    expect(await leadByPhone(intruder.phone.e164)).toBeUndefined()
    const held = await heldFor(ownerLead.id)
    expect(held.map((s) => s.reason)).toEqual(['existing_cpf'])
    expect(held[0]!.phone_key).toBe(dedupFor(h, intruder.phone.e164))
  })

  it('número ou CPF na lista de supressão: resposta genérica e nada é gravado sobre o titular', async () => {
    const byPhone = newPerson()
    const byCpf = newPerson()
    await h.ctx.db.query(`INSERT INTO suppression_list (dedup_key, reason) VALUES ($1, 'opposition'), ($2, 'deletion_request')`, [
      dedupFor(h, byPhone.phone.e164),
      cpfKeyFor(h, byCpf.cpf.digits),
    ])
    for (const person of [byPhone, byCpf]) {
      const res = await submitSite(h, person)
      expect(res.status).toBe(201)
      expect(res.body).toEqual(RECEIVED)
      expect(await leadByPhone(person.phone.e164)).toBeUndefined()
    }
    expect(await countRows('SELECT count(*)::int AS n FROM lead_submissions WHERE phone_key = ANY($1::text[])', [[dedupFor(h, byPhone.phone.e164), dedupFor(h, byCpf.phone.e164)]])).toBe(0)
  })

  it('cadastro anonimizado não impede um novo cadastro do mesmo número', async () => {
    const person = newPerson()
    expect((await submitSite(h, person)).status).toBe(201)
    const old = await leadByPhone(person.phone.e164)
    await h.ctx.db.query(`UPDATE leads SET anonymized_at = $2, dedup_key = $3, cpf_key = NULL WHERE id = $1`, [old.id, h.clock.current, `anon:${old.id}`])
    expect((await submitSite(h, person)).status).toBe(201)
    const fresh = await leadByPhone(person.phone.e164)
    expect(fresh.id).not.toBe(old.id)
  })
})

describe('falhas e disponibilidade', () => {
  it('falha de banco no meio do cadastro: erro, nunca 201, e nada fica gravado (nem o uso do token)', async () => {
    const person = newPerson()
    const real = h.ctx.db
    h.ctx.db = {
      ...real,
      query: real.query.bind(real),
      exec: real.exec.bind(real),
      close: real.close.bind(real),
      transaction: (fn) =>
        real.transaction((tx) => {
          const failing: Queryable = {
            query: (sql, params) => (sql.includes('INSERT INTO lead_preferences') ? Promise.reject(new Error('conexão perdida')) : tx.query(sql, params)),
          }
          return fn(failing)
        }),
    } as typeof real
    try {
      const res = await submitSite(h, person)
      expect(res.status).toBe(500)
      expect(res.body.error.code).toBe('internal_error')
    } finally {
      h.ctx.db = real
    }
    expect(await leadByPhone(person.phone.e164)).toBeUndefined()
    expect(await countRows('SELECT count(*)::int AS n FROM form_attempts WHERE phone_key = $1', [dedupFor(h, person.phone.e164)])).toBe(0)
  })

  it('coleta indisponível (identidade incompleta em ambiente público) → 503 collection_unavailable', async () => {
    const saved = h.ctx.config.collection.waitlistEnabled
    h.ctx.config.collection.waitlistEnabled = false
    try {
      const ip = newIp()
      const antiBot = await antiBotFor(h, ip)
      const res = await h.api.post('/api/waitlist').set(ip).send({ ...waitlistBody(newPerson()), antiBot })
      expect(res.status).toBe(503)
      expect(res.body.error.code).toBe('collection_unavailable')
    } finally {
      h.ctx.config.collection.waitlistEnabled = saved
    }
  })

  it('o cadastro não depende de canal de mensagens: sem provedor algum, a coleta funciona', () => {
    expect(h.ctx.config.collection).toMatchObject({ waitlistEnabled: true, reasons: [] })
  })
})

describe('logs sem dados pessoais', () => {
  it('cadastro, duplicidade, erro de validação e form_expired não registram CPF, telefone, nome, e-mail, empregador ou token', async () => {
    const { logger, lines } = captureLogger()
    const original = h.ctx.logger
    h.ctx.logger = logger as unknown as typeof original
    const person = newPerson()
    try {
      const ip = newIp()
      const antiBot = await antiBotFor(h, ip)
      const body = { ...waitlistBody(person, { fullName: 'Josefina Teste Silva' }), antiBot }
      await h.api.post('/api/waitlist').set(ip).send(body)
      await h.api.post('/api/waitlist').set(ip).send(body) // token reutilizado
      await h.api.post('/api/waitlist').set(ip).send({ ...body, cpf: '111' })
      await submitSite(h, person)

      const text = lines.join('\n')
      expect(lines.length).toBeGreaterThan(3)
      for (const secret of [person.phone.e164, person.phone.e164.slice(3), person.phone.masked, person.cpf.digits, person.cpf.masked, 'Josefina', 'ana.souza', 'Mercado Bom', antiBot.token]) {
        expect(text).not.toContain(secret)
      }
    } finally {
      h.ctx.logger = original
    }
  })
})
