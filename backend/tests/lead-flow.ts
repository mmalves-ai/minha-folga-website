import { randomUUID } from 'node:crypto'
import { Writable } from 'node:stream'
import { ipKeyGenerator } from 'express-rate-limit'
import { pino } from 'pino'
import { CONSENTS } from '../src/config/contracts.js'
import { cpfKey } from '../src/lib/cpf.js'
import { hmacHex } from '../src/lib/crypto.js'
import { solveFormToken } from '../src/lib/proof-of-work.js'
import { contactDedupKey } from '../src/repositories/leads.repo.js'
import { SITE, TEST_INBOUND_KEY, type TestHarness } from './helpers.js'

/** Utilidades dos testes de cadastro, preferências, anti-robô e ferramentas da Bia. */

export const VERSIONS = {
  launch_notice: CONSENTS.purposes.launch_notice.version,
  marketing: CONSENTS.purposes.marketing.version,
}

let seq = 0
/** Celular válido e único por chamada (DDD 11), em E.164 e com máscara. */
export function newPhone(): { e164: string; masked: string } {
  seq++
  const tail = '8' + String(1_000_000 + seq * 7919).slice(-7)
  return { e164: `+55119${tail}`, masked: `(11) 9${tail.slice(0, 4)}-${tail.slice(4)}` }
}

let cpfSeq = 0
/** CPF válido (dígitos verificadores corretos) e único por chamada, com e sem máscara. */
export function newCpf(): { digits: string; masked: string } {
  cpfSeq++
  const base = String(100_000_000 + ((cpfSeq * 7_654_321) % 800_000_000)).slice(0, 9)
  const calc = (s: string, len: number) => {
    let sum = 0
    for (let i = 0; i < len; i++) sum += Number(s[i]) * (len + 1 - i)
    const rest = (sum * 10) % 11
    return rest === 10 ? 0 : rest
  }
  const d1 = calc(base, 9)
  const d2 = calc(base + d1, 10)
  const digits = `${base}${d1}${d2}`
  if (/^(\d)\1{10}$/.test(digits)) return newCpf()
  return { digits, masked: `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}` }
}

/** IP distinto por teste (X-Forwarded-For com trust proxy loopback) para isolar os limites por IP. */
let ipSeq = 0
export function newIp(): Record<string, string> {
  ipSeq++
  return { 'X-Forwarded-For': `198.51.${100 + Math.floor(ipSeq / 250)}.${ipSeq % 250}`, ...SITE }
}

/** Mesma chave da rede de origem que a API calcula (middleware/request-context.ts → req.originHash). */
export function originKeyFor(h: TestHarness, headers: Record<string, string>): string {
  return hmacHex(ipKeyGenerator(headers['X-Forwarded-For']!), h.ctx.config.secrets.sessionSecret, 'origin').slice(0, 32)
}

/** Simula `n` submissões aceitas do cadastro vindas desta rede, agora (sem passar pelo formulário). */
export async function seedAttempts(h: TestHarness, headers: Record<string, string>, n: number): Promise<void> {
  const ip = originKeyFor(h, headers)
  for (let i = 0; i < n; i++) {
    await h.ctx.db.query(`INSERT INTO form_attempts (id, purpose, ip_key, created_at) VALUES ($1, 'waitlist', $2, $3)`, [randomUUID(), ip, h.clock.current])
  }
}

export type Agent = TestHarness['api']

/** Pede o token do formulário, espera a idade mínima no relógio de teste e resolve a prova de trabalho. */
export async function antiBotFor(h: TestHarness, headers: Record<string, string> = SITE, agent: Agent = h.api, waitMs = 4_000) {
  const res = await agent.get('/api/form-token').set(headers)
  if (res.status !== 200) throw new Error(`form-token falhou: ${res.status}`)
  h.clock.advance(waitMs)
  return solveFormToken(res.body)
}

export interface Person {
  phone: { e164: string; masked: string }
  cpf: { digits: string; masked: string }
}

export function newPerson(): Person {
  return { phone: newPhone(), cpf: newCpf() }
}

/** Corpo válido do cadastro pelo site (sem antiBot). */
export function waitlistBody(person: Person, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fullName: 'Ana Paula de Souza',
    cpf: person.cpf.masked,
    phone: person.phone.masked,
    email: 'ana.souza@exemplo-mf.com.br',
    employerName: 'Mercado Bom Preço Ltda',
    employmentType: 'clt',
    jobTenure: '1_a_3_anos',
    incomeRange: '2000_a_4000',
    city: 'São Paulo',
    uf: 'SP',
    ageConfirmed: true,
    consents: { launch_notice: true, marketing: false },
    consentVersions: { ...VERSIONS },
    source: 'avise-me',
    ...overrides,
  }
}

/** Envia o cadastro pelo site com anti-robô válido. */
export async function submitSite(
  h: TestHarness,
  person: Person,
  headers: Record<string, string> = newIp(),
  overrides: Record<string, unknown> = {},
  agent: Agent = h.api,
) {
  const antiBot = await antiBotFor(h, headers, agent)
  return agent.post('/api/waitlist').set(headers).send({ ...waitlistBody(person, overrides), antiBot })
}

/** Cadastro pelo site que precisa dar certo; devolve o id do cadastro criado. */
export async function registerSite(h: TestHarness, person: Person = newPerson(), overrides: Record<string, unknown> = {}): Promise<string> {
  const res = await submitSite(h, person, newIp(), overrides)
  if (res.status !== 201) throw new Error(`cadastro falhou: ${res.status} ${JSON.stringify(res.body)}`)
  const id = await leadIdByPhone(h, person.phone.e164)
  if (!id) throw new Error('cadastro não gravado')
  return id
}

export function dedupFor(h: TestHarness, e164: string): string {
  return contactDedupKey(e164, h.ctx.config.secrets.dedupKey)
}

export function cpfKeyFor(h: TestHarness, digits: string): string {
  return cpfKey(digits, h.ctx.config.secrets.dedupKey)
}

export async function leadIdByPhone(h: TestHarness, e164: string): Promise<string | undefined> {
  const r = await h.ctx.db.query<{ id: string }>('SELECT id FROM leads WHERE dedup_key = $1', [dedupFor(h, e164)])
  return r.rows[0]?.id
}

// Bia ------------------------------------------------------------------------------------------------------

export const envelope = (input: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  conversationRef: `conv-${randomUUID()}`,
  input,
  ...extra,
})

export const attested = (phone: string) => ({ senderPhone: phone, senderVerified: true })

/** Chamada de ferramenta como a Hal-AI faz (X-API-Key). */
export function callTool(h: TestHarness, tool: string, body: unknown, headers: Record<string, string> = {}) {
  return h.api
    .post(`/api/agent/tools/${tool}`)
    .set('content-type', 'application/json')
    .set('x-api-key', TEST_INBOUND_KEY)
    .set(headers)
    .send(JSON.stringify(body))
}

/** Dados completos para upsert_customer (sem telefone: vem do remetente atestado). */
export function customerInput(person: Person, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fullName: 'Carla Mendes Ribeiro',
    cpf: person.cpf.digits,
    employerName: 'Hospital Santa Luzia',
    employmentType: 'clt',
    jobTenure: 'mais_3_anos',
    incomeRange: '4000_a_7000',
    city: 'Recife',
    uf: 'PE',
    ageConfirmed: true,
    consents: { launch_notice: true, marketing: true },
    consentVersions: { ...VERSIONS },
    ...overrides,
  }
}

/** Cadastro pela Bia com número atestado; devolve o id. */
export async function registerByBia(h: TestHarness, person: Person = newPerson(), overrides: Record<string, unknown> = {}): Promise<string> {
  const res = await callTool(h, 'upsert_customer', envelope(customerInput(person, overrides), attested(person.phone.e164)))
  if (res.status !== 200 || res.body.result.status !== 'created') throw new Error(`upsert falhou: ${res.status} ${JSON.stringify(res.body)}`)
  return (await leadIdByPhone(h, person.phone.e164))!
}

/** Abre a sessão de /preferencias no agente pelo link seguro emitido pela Bia. */
export async function openPreferences(h: TestHarness, person: Person, agent: Agent, headers: Record<string, string> = SITE): Promise<string> {
  const link = await callTool(h, 'issue_preferences_link', envelope({}, attested(person.phone.e164)))
  if (link.status !== 200) throw new Error(`link falhou: ${link.status} ${JSON.stringify(link.body)}`)
  const token = String(link.body.result.url).split('#token=')[1]!
  const res = await agent.post('/api/preferences/token').set(headers).send({ token })
  if (res.status !== 200) throw new Error(`sessão falhou: ${res.status} ${JSON.stringify(res.body)}`)
  return token
}

/** Logger que guarda todas as linhas (nível trace, SEM redação) para provar que o código não registra PII. */
export function captureLogger(): { logger: ReturnType<typeof pino>; lines: string[] } {
  const lines: string[] = []
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(String(chunk))
      cb()
    },
  })
  return { logger: pino({ level: 'trace', base: undefined, timestamp: false }, stream), lines }
}

export function cookieFrom(res: { headers: Record<string, unknown> }): string | undefined {
  const raw = res.headers['set-cookie']
  const list = Array.isArray(raw) ? (raw as string[]) : typeof raw === 'string' ? [raw] : []
  return list.find((c) => c.startsWith('mf_contact='))
}
