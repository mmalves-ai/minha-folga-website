import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ConfigError, loadConfig } from '../src/config/index.js'
import { buildSendTemplateBody, createHalaiClient, HALAI_SEND_TEMPLATE_PATH } from '../src/integrations/halai/client.js'
import { ProviderError } from '../src/integrations/provider-error.js'
import { processOutboxBatch } from '../src/jobs/outbox-worker.js'
import { createTestHarness, HALAI_ENV, TEST_ENV, type TestHarness } from './helpers.js'
import { antiBotFor, dedupFor, leadIdByPhone, newIp, newPerson, submitSite, waitlistBody, type Person } from './lead-flow.js'

/**
 * PLACEHOLDER: agente Hal-AI ainda não provisionado. Cliente de saída (POST /api/v1/smart-crm/send-template) e as
 * travas do template de cadastro: desligado por padrão; ligado, nunca para robô, uma vez por número em 30 dias e
 * com teto diário global.
 */
const DAY = 24 * 60 * 60 * 1000
const TEMPLATE_ENV = {
  ...HALAI_ENV,
  HALAI_API_KEY: 'test-only-halai-api-key-000000',
  HALAI_CHANNEL: 'canal-teste',
  HALAI_SIGNUP_TEMPLATE_ENABLED: 'true',
  HALAI_SIGNUP_TEMPLATE: 'mf_cadastro',
  HALAI_TEMPLATE_DAILY_CAP: '2',
}

const templatesFor = async (h: TestHarness, e164: string) =>
  (
    await h.ctx.db.query<{ id: string; status: string; purpose: string; channel: string; recipient_key: string | null; lead_id: string | null }>(
      `SELECT id, status, purpose, channel, recipient_key, lead_id FROM outbox_messages WHERE kind = 'halai_template' AND recipient_key = $1 ORDER BY created_at`,
      [dedupFor(h, e164)],
    )
  ).rows

const counter = async (h: TestHarness, name: string, dimension: string) =>
  (await h.ctx.db.query<{ n: number }>('SELECT COALESCE(sum(count), 0)::int AS n FROM metric_counters WHERE name = $1 AND dimension = $2', [name, dimension])).rows[0]!.n

describe('cliente de saída da Hal-AI', () => {
  const message = { to: '+5511987654321', templateName: 'mf_cadastro', language: 'pt_BR', bodyVariables: ['Ana\nPaula'] }

  function client(status: number, body: unknown, calls: { url: string; init: RequestInit }[] = []) {
    return createHalaiClient({
      baseUrl: 'https://api.halai.invalid/',
      apiKey: 'hal_test_chave',
      channel: 'canal-teste',
      fetchImpl: (async (url: string, init: RequestInit) => {
        calls.push({ url, init })
        return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
      }) as unknown as typeof fetch,
    })
  }
  const outcome = (p: Promise<unknown>) => p.then(() => 'ok', (e: ProviderError) => `${e.message}|${e.retryable}`)

  it('POST /api/v1/smart-crm/send-template com Bearer, canal e variáveis limpas; envelope de sucesso', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const c = client(200, { success: true, data: { messageId: 'msg-1' }, meta: {} }, calls)
    expect(c.configured).toBe(true)
    expect(await c.sendTemplate(message)).toEqual({ providerMessageId: 'msg-1' })
    expect(calls[0]!.url).toBe(`https://api.halai.invalid${HALAI_SEND_TEMPLATE_PATH}`)
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer hal_test_chave')
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      to: '5511987654321',
      channel: 'canal-teste',
      templateName: 'mf_cadastro',
      language: 'pt_BR',
      bodyVariables: ['Ana Paula'],
    })
    expect(buildSendTemplateBody(message, 'x').to).toBe('5511987654321')
  })

  it('429 e 5xx retentáveis; 401/400 e sucesso sem envelope definitivos; mensagem sem o número', async () => {
    expect(await outcome(client(429, { success: false, error: { code: 'rate_limited' } }).sendTemplate(message))).toBe('http_429:rate_limited|true')
    expect(await outcome(client(503, {}).sendTemplate(message))).toBe('http_503|true')
    expect(await outcome(client(401, { success: false, error: { code: 'unauthorized', message: 'Missing or invalid API key' } }).sendTemplate(message))).toBe('http_401:unauthorized|false')
    const invalid = await outcome(client(400, { success: false, error: { code: 'invalid_request', message: 'to +5511987654321 inválido' } }).sendTemplate(message))
    expect(invalid).toBe('http_400:invalid_request|false')
    expect(invalid).not.toContain('987654321')
    expect(await outcome(client(200, { success: false, error: { code: 'template_not_found' } }).sendTemplate(message))).toBe('halai_rejected:template_not_found|false')
  })

  it('tempo esgotado e rede indisponível são retentáveis; sem configuração, definitivo sem chamada', async () => {
    const slow = createHalaiClient({
      baseUrl: 'https://api.halai.invalid',
      apiKey: 'k',
      channel: 'c',
      timeoutMs: 20,
      fetchImpl: ((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal!.reason)))) as unknown as typeof fetch,
    })
    expect(await outcome(slow.sendTemplate(message))).toBe('timeout|true')
    const offline = createHalaiClient({
      baseUrl: 'https://api.halai.invalid',
      apiKey: 'k',
      channel: 'c',
      fetchImpl: (async () => {
        throw new TypeError('fetch failed')
      }) as unknown as typeof fetch,
    })
    expect(await outcome(offline.sendTemplate(message))).toBe('network_error|true')
    let called = false
    const unconfigured = createHalaiClient({
      baseUrl: 'https://api.halai.invalid',
      fetchImpl: (async () => {
        called = true
        return new Response('{}')
      }) as unknown as typeof fetch,
    })
    expect(unconfigured.configured).toBe(false)
    expect(await outcome(unconfigured.sendTemplate(message))).toBe('halai_not_configured|false')
    expect(called).toBe(false)
  })
})

describe('configuração do placeholder', () => {
  const issuesOf = (source: Record<string, string>) => {
    try {
      loadConfig({ source })
      return []
    } catch (err) {
      return (err as ConfigError).issues.map((i) => i.key)
    }
  }

  it('desligado por padrão; ligado exige agente, chave, canal, template e teto diário', () => {
    const config = loadConfig({ source: TEST_ENV })
    expect(config.halai.signupTemplate).toEqual({ enabled: false, name: undefined, dailyCap: undefined })
    expect(issuesOf({ ...TEST_ENV, HALAI_SIGNUP_TEMPLATE_ENABLED: 'true' }).sort()).toEqual(
      ['HALAI_API_KEY', 'HALAI_CHANNEL', 'HALAI_SIGNUP_TEMPLATE', 'HALAI_SIGNUP_TEMPLATE_ENABLED', 'HALAI_TEMPLATE_DAILY_CAP'].sort(),
    )
    expect(issuesOf({ ...TEMPLATE_ENV, ...TEST_ENV, ...TEMPLATE_ENV })).toEqual([])
    expect(issuesOf({ ...TEST_ENV, ...TEMPLATE_ENV, HALAI_TEMPLATE_DAILY_CAP: '0' })).toContain('HALAI_TEMPLATE_DAILY_CAP')
  })
})

describe('placeholder desligado (padrão)', () => {
  let h: TestHarness
  beforeAll(async () => {
    h = await createTestHarness()
  })
  afterAll(async () => {
    await h.close()
  })

  it('cadastro novo pelo site não enfileira nem envia nada', async () => {
    const person = newPerson()
    expect((await submitSite(h, person)).status).toBe(201)
    expect(await templatesFor(h, person.phone.e164)).toEqual([])
    await processOutboxBatch(h.ctx)
    expect(h.halai.sent).toEqual([])
  })
})

describe('placeholder ligado: travas', () => {
  let h: TestHarness
  beforeAll(async () => {
    h = await createTestHarness(TEMPLATE_ENV)
  })
  afterAll(async () => {
    await h.close()
  })

  // Teto de 2 por dia neste arquivo: cada teste começa num dia novo para não disputar o teto com os anteriores.
  it('cadastro novo que passou pelo anti-robô: um template na outbox (idempotente) e envio pela Hal-AI', async () => {
    h.clock.advance(DAY)
    const person = newPerson()
    expect((await submitSite(h, person)).status).toBe(201)
    const leadId = await leadIdByPhone(h, person.phone.e164)
    const rows = await templatesFor(h, person.phone.e164)
    expect(rows).toEqual([expect.objectContaining({ status: 'pending', purpose: 'launch_notice', channel: 'halai', lead_id: leadId })])
    await processOutboxBatch(h.ctx)
    expect(h.halai.sent.filter((m) => m.to === person.phone.e164)).toEqual([
      { to: person.phone.e164, templateName: 'mf_cadastro', language: 'pt_BR', bodyVariables: ['Ana'] },
    ])
    expect((await templatesFor(h, person.phone.e164))[0]!.status).toBe('sent')
  })

  it('robô: campo-armadilha, token inválido ou reutilizado → nenhum template', async () => {
    const bot = newPerson()
    await h.api.post('/api/waitlist').set(newIp()).send({ ...waitlistBody(bot), website: 'http://spam.example' })
    await h.api.post('/api/waitlist').set(newIp()).send({ ...waitlistBody(bot), antiBot: { token: 'x.y', nonce: '1' } })
    const ip = newIp()
    const antiBot = await antiBotFor(h, ip)
    const human = newPerson()
    expect((await h.api.post('/api/waitlist').set(ip).send({ ...waitlistBody(human), antiBot })).status).toBe(201)
    const replay = await h.api.post('/api/waitlist').set(ip).send({ ...waitlistBody(bot), antiBot })
    expect(replay.body.error.code).toBe('form_expired')
    expect(await templatesFor(h, bot.phone.e164)).toEqual([])
    expect(await leadIdByPhone(h, bot.phone.e164)).toBeUndefined()
  })

  it('submissão sobre cadastro existente não dispara template (nem para o número do cadastro)', async () => {
    h.clock.advance(DAY)
    const person = newPerson()
    expect((await submitSite(h, person)).status).toBe(201)
    expect(await templatesFor(h, person.phone.e164)).toHaveLength(1)
    const again: Person = { phone: person.phone, cpf: newPerson().cpf }
    expect((await submitSite(h, again)).status).toBe(201)
    expect(await templatesFor(h, person.phone.e164)).toHaveLength(1)
  })

  it('no máximo um template por número em 30 dias', async () => {
    h.clock.advance(DAY)
    const person = newPerson()
    expect((await submitSite(h, person)).status).toBe(201)
    // O cadastro é anonimizado e o mesmo número volta como cadastro NOVO dentro de 30 dias.
    const first = await leadIdByPhone(h, person.phone.e164)
    const release = () =>
      h.ctx.db.query(`UPDATE leads SET anonymized_at = $2, dedup_key = 'anon:' || id::text, cpf_key = NULL WHERE dedup_key = $1`, [
        dedupFor(h, person.phone.e164),
        h.clock.current,
      ])
    await release()
    h.clock.advance(DAY)
    expect((await submitSite(h, { phone: person.phone, cpf: newPerson().cpf })).status).toBe(201)
    const second = await leadIdByPhone(h, person.phone.e164)
    expect(second).not.toBe(first)
    expect(await templatesFor(h, person.phone.e164)).toHaveLength(1)
    expect(await counter(h, 'halai_template_withheld', 'recent')).toBeGreaterThanOrEqual(1)

    await release()
    h.clock.advance(30 * DAY)
    expect((await submitSite(h, { phone: person.phone, cpf: newPerson().cpf })).status).toBe(201)
    expect(await templatesFor(h, person.phone.e164)).toHaveLength(2)
  })

  it('teto diário global (HALAI_TEMPLATE_DAILY_CAP): acima dele, o cadastro é aceito e nada é enfileirado', async () => {
    // Começa um dia novo (horário de Brasília) para contar só os deste teste.
    h.clock.advance(2 * DAY)
    const people = [newPerson(), newPerson(), newPerson()]
    for (const p of people) expect((await submitSite(h, p)).status).toBe(201)
    const queued = await Promise.all(people.map(async (p) => (await templatesFor(h, p.phone.e164)).length))
    expect(queued).toEqual([1, 1, 0])
    expect(await leadIdByPhone(h, people[2]!.phone.e164)).toBeDefined()
    expect(await counter(h, 'halai_template_withheld', 'daily_cap')).toBe(1)
    h.clock.advance(DAY)
    const next = newPerson()
    expect((await submitSite(h, next)).status).toBe(201)
    expect(await templatesFor(h, next.phone.e164)).toHaveLength(1)
  })

  it('cadastro pela Bia não dispara template (o número já está em conversa na Hal-AI)', async () => {
    const { callTool, envelope, attested, customerInput } = await import('./lead-flow.js')
    const person = newPerson()
    const res = await callTool(h, 'upsert_customer', envelope(customerInput(person), attested(person.phone.e164)))
    expect(res.body.result.status).toBe('created')
    expect(await templatesFor(h, person.phone.e164)).toEqual([])
  })
})
