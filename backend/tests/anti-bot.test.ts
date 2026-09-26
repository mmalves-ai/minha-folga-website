import { createHmac } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { VALIDATION } from '../src/config/contracts.js'
import { sha256Hex } from '../src/lib/crypto.js'
import { checkProofOfWork, leadingZeroBits, proofDigest, solveFormToken, solveProofOfWork } from '../src/lib/proof-of-work.js'
import { RECEIVED_MESSAGE } from '../src/services/waitlist.service.js'
import { createTestHarness, SITE, type TestHarness } from './helpers.js'
import { antiBotFor, dedupFor, newIp, newPerson, seedAttempts, waitlistBody, type Person } from './lead-flow.js'

/**
 * Anti-robô próprio (D1): token HMAC com SESSION_SECRET, prova de trabalho SHA-256, idade mínima e validade,
 * uso único, campo-armadilha e limites por IP/CPF/telefone (contracts/validation.json → waitlist).
 */
const AB = VALIDATION.waitlist.antiBot
const LIMITS = VALIDATION.waitlist.limits

let h: TestHarness
beforeAll(async () => {
  h = await createTestHarness()
})
afterAll(async () => {
  await h.close()
})

const leadCount = async () => (await h.ctx.db.query<{ n: number }>('SELECT count(*)::int AS n FROM leads')).rows[0]!.n

async function freshToken(headers: Record<string, string> = SITE) {
  const res = await h.api.get('/api/form-token').set(headers)
  expect(res.status).toBe(200)
  return res.body as { token: string; challenge: string; difficultyBits: number; expiresInSeconds: number; minFillSeconds: number }
}

const post = (headers: Record<string, string>, person: Person, antiBot: unknown, extra: Record<string, unknown> = {}) =>
  h.api.post('/api/waitlist').set(headers).send({ ...waitlistBody(person), antiBot, ...extra })

describe('prova de trabalho (lib)', () => {
  it('conta bits zero à esquerda e resolve/confere a prova como o navegador', () => {
    expect(leadingZeroBits(Uint8Array.from([0, 0, 0x0f, 0xff]))).toBe(20)
    expect(leadingZeroBits(Uint8Array.from([0x80]))).toBe(0)
    expect(leadingZeroBits(Uint8Array.from([0x01]))).toBe(7)
    const nonce = solveProofOfWork('desafio-teste', 12)
    expect(checkProofOfWork('desafio-teste', nonce, 12)).toBe(true)
    expect(leadingZeroBits(proofDigest('desafio-teste', nonce))).toBeGreaterThanOrEqual(12)
    expect(checkProofOfWork('desafio-teste', `${nonce}x`, 12)).toBe(false)
    expect(checkProofOfWork('desafio-teste', '-1', 1)).toBe(false)
  })
})

describe('GET /api/form-token', () => {
  it('entrega token assinado, desafio de 16 bytes e os parâmetros do contrato, sem gravar nada', async () => {
    const t = await freshToken()
    expect(t).toMatchObject({ difficultyBits: AB.difficultyBits, expiresInSeconds: AB.tokenTtlSeconds, minFillSeconds: AB.minFillSeconds })
    expect(t.challenge).toMatch(/^[A-Za-z0-9_-]{22}$/)
    const [encoded, sig] = t.token.split('.')
    const payload = JSON.parse(Buffer.from(encoded!, 'base64url').toString('utf8'))
    expect(payload).toEqual({ v: 1, c: t.challenge, d: AB.difficultyBits, iat: h.clock.current.getTime() })
    expect(sig).toBe(createHmac('sha256', h.ctx.config.secrets.sessionSecret).update(encoded!).digest('base64url'))
    const uses = await h.ctx.db.query<{ n: number }>('SELECT count(*)::int AS n FROM form_token_uses')
    expect(uses.rows[0]!.n).toBe(0)
  })
})

describe('conferência no envio', () => {
  it('prova válida depois da idade mínima → 201', async () => {
    const ip = newIp()
    const res = await post(ip, newPerson(), await antiBotFor(h, ip))
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ status: 'received', message: RECEIVED_MESSAGE })
  })

  it('nonce inválido → 400 form_expired e nada gravado', async () => {
    const ip = newIp()
    const t = await freshToken(ip)
    h.clock.advance(4_000)
    let nonce = 0
    while (checkProofOfWork(t.challenge, String(nonce), t.difficultyBits)) nonce++
    const before = await leadCount()
    const res = await post(ip, newPerson(), { token: t.token, nonce: String(nonce) })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatchObject({ code: 'form_expired', message: 'O formulário expirou. Tente enviar de novo.' })
    expect(await leadCount()).toBe(before)
  })

  it('token reutilizado → form_expired (uso único gravado); um token novo funciona', async () => {
    const ip = newIp()
    const antiBot = await antiBotFor(h, ip)
    expect((await post(ip, newPerson(), antiBot)).status).toBe(201)
    const again = await post(ip, newPerson(), antiBot)
    expect(again.status).toBe(400)
    expect(again.body.error.code).toBe('form_expired')
    expect((await post(ip, newPerson(), await antiBotFor(h, ip))).status).toBe(201)
  })

  it('antes da idade mínima → form_expired; depois dela, o mesmo token ainda vale', async () => {
    const ip = newIp()
    const t = await freshToken(ip)
    const antiBot = solveFormToken(t)
    h.clock.advance(AB.minFillSeconds * 1000 - 1)
    const early = await post(ip, newPerson(), antiBot)
    expect(early.status).toBe(400)
    expect(early.body.error.code).toBe('form_expired')
    h.clock.advance(2)
    expect((await post(ip, newPerson(), antiBot)).status).toBe(201)
  })

  it('token vencido → form_expired', async () => {
    const ip = newIp()
    const t = await freshToken(ip)
    h.clock.advance(AB.tokenTtlSeconds * 1000 + 1)
    const res = await post(ip, newPerson(), solveFormToken(t))
    expect(res.body.error.code).toBe('form_expired')
  })

  it('assinatura adulterada, dificuldade rebaixada ou antiBot ausente → form_expired', async () => {
    const ip = newIp()
    const t = await freshToken(ip)
    h.clock.advance(4_000)
    const [encoded] = t.token.split('.')
    const payload = JSON.parse(Buffer.from(encoded!, 'base64url').toString('utf8'))
    const easier = Buffer.from(JSON.stringify({ ...payload, d: 1 })).toString('base64url')
    const forged = `${easier}.${t.token.split('.')[1]}`
    const res1 = await post(ip, newPerson(), { token: forged, nonce: solveProofOfWork(t.challenge, 1) })
    expect(res1.body.error.code).toBe('form_expired')
    // Mesmo com HMAC correto, dificuldade abaixo da vigente não vale.
    const signed = `${easier}.${createHmac('sha256', h.ctx.config.secrets.sessionSecret).update(easier).digest('base64url')}`
    const res2 = await post(ip, newPerson(), { token: signed, nonce: solveProofOfWork(t.challenge, 1) })
    expect(res2.body.error.code).toBe('form_expired')
    const res3 = await h.api.post('/api/waitlist').set(ip).send(waitlistBody(newPerson()))
    expect(res3.status).toBe(400)
    expect(res3.body.error.code).toBe('form_expired')
    // O nonce também pode vir como número.
    const numeric = solveFormToken(t)
    expect((await post(ip, newPerson(), { token: t.token, nonce: Number(numeric.nonce) })).status).toBe(201)
  })

  it('erro de validação não queima o token: corrigido o campo, o mesmo token é aceito', async () => {
    const ip = newIp()
    const antiBot = await antiBotFor(h, ip)
    const person = newPerson()
    const bad = await post(ip, person, antiBot, { cpf: '000.000.000-00' })
    expect(bad.status).toBe(400)
    expect(bad.body.error.code).toBe('validation_error')
    expect((await post(ip, person, antiBot)).status).toBe(201)
  })
})

describe('campo-armadilha', () => {
  it('"website" preenchido → 201 genérico sem gravar, mesmo sem token e com dados válidos', async () => {
    const before = await leadCount()
    const person = newPerson()
    const res = await h.api.post('/api/waitlist').set(newIp()).send({ ...waitlistBody(person), website: 'https://spam.example' })
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ status: 'received', message: RECEIVED_MESSAGE })
    expect(await leadCount()).toBe(before)
    const attempts = await h.ctx.db.query('SELECT 1 FROM form_attempts WHERE phone_key = $1', [dedupFor(h, person.phone.e164)])
    expect(attempts.rows).toHaveLength(0)
    // Vazio (humano) segue o fluxo normal.
    const ip = newIp()
    expect((await post(ip, person, await antiBotFor(h, ip), { website: '' })).status).toBe(201)
  })
})

describe('limites (contracts/validation.json → waitlist.limits)', () => {
  it('rede compartilhada (CGNAT): a partir do limiar a prova fica mais difícil em vez de barrar; token fácil antigo → form_expired', async () => {
    expect(LIMITS.elevatedAfterPerIpPerHour).toBeLessThan(LIMITS.submissionsPerIpPerHour)
    expect(AB.elevatedDifficultyBits).toBeGreaterThan(AB.difficultyBits)
    const ip = newIp()
    await seedAttempts(h, ip, LIMITS.elevatedAfterPerIpPerHour - 1)
    // Ainda abaixo do limiar: dificuldade normal. Este token fica guardado para depois.
    const easy = await freshToken(ip)
    expect(easy.difficultyBits).toBe(AB.difficultyBits)
    expect((await post(ip, newPerson(), await antiBotFor(h, ip))).status).toBe(201)
    // Limiar atingido: tokens novos já saem mais difíceis e continuam aceitos.
    const hard = await freshToken(ip)
    expect(hard.difficultyBits).toBe(AB.elevatedDifficultyBits)
    expect(JSON.parse(Buffer.from(hard.token.split('.')[0]!, 'base64url').toString('utf8')).d).toBe(AB.elevatedDifficultyBits)
    const accepted = await antiBotFor(h, ip)
    expect(checkProofOfWork(JSON.parse(Buffer.from(accepted.token.split('.')[0]!, 'base64url').toString('utf8')).c, String(accepted.nonce), AB.elevatedDifficultyBits)).toBe(true)
    expect((await post(ip, newPerson(), accepted)).status).toBe(201)
    // O token fácil emitido antes do limiar não vale mais: o site pega outro (já difícil) e reenvia.
    const person = newPerson()
    const stale = await post(ip, person, solveFormToken(easy))
    expect(stale.status).toBe(400)
    expect(stale.body.error.code).toBe('form_expired')
    expect(await h.ctx.db.query('SELECT 1 FROM leads WHERE dedup_key = $1', [dedupFor(h, person.phone.e164)])).toMatchObject({ rows: [] })
    const metric = await h.ctx.db.query<{ n: number }>(
      `SELECT coalesce(sum(count), 0)::int AS n FROM metric_counters WHERE name = 'antibot_rejected' AND dimension = 'waitlist:needs_elevated'`,
    )
    expect(metric.rows[0]!.n).toBeGreaterThanOrEqual(1)
    expect((await post(ip, person, await antiBotFor(h, ip))).status).toBe(201)
  })

  it(`por IP: ${LIMITS.submissionsPerIpPerHour} submissões aceitas por hora; a seguinte → 429, e passa depois de 1 h (com a dificuldade normal)`, async () => {
    const ip = newIp()
    await seedAttempts(h, ip, LIMITS.submissionsPerIpPerHour - 1)
    expect((await post(ip, newPerson(), await antiBotFor(h, ip))).status).toBe(201)
    const person = newPerson()
    const blocked = await post(ip, person, await antiBotFor(h, ip))
    expect(blocked.status).toBe(429)
    expect(blocked.body.error.code).toBe('rate_limited')
    expect(await h.ctx.db.query('SELECT 1 FROM leads WHERE dedup_key = $1', [dedupFor(h, person.phone.e164)])).toMatchObject({ rows: [] })
    h.clock.advance(60 * 60 * 1000)
    expect((await freshToken(ip)).difficultyBits).toBe(AB.difficultyBits)
    expect((await post(ip, person, await antiBotFor(h, ip))).status).toBe(201)
  })

  it(`por CPF: ${LIMITS.submissionsPerCpfPerDay} por dia, mesmo de IPs e telefones diferentes`, async () => {
    const cpf = newPerson().cpf
    for (let i = 0; i < LIMITS.submissionsPerCpfPerDay; i++) {
      const ip = newIp()
      expect((await post(ip, { cpf, phone: newPerson().phone }, await antiBotFor(h, ip))).status).toBe(201)
    }
    const ip = newIp()
    const res = await post(ip, { cpf, phone: newPerson().phone }, await antiBotFor(h, ip))
    expect(res.status).toBe(429)
  })

  it(`por telefone: ${LIMITS.submissionsPerPhonePerDay} por dia, mesmo com CPFs e IPs diferentes`, async () => {
    const phone = newPerson().phone
    for (let i = 0; i < LIMITS.submissionsPerPhonePerDay; i++) {
      const ip = newIp()
      expect((await post(ip, { phone, cpf: newPerson().cpf }, await antiBotFor(h, ip))).status).toBe(201)
    }
    const ip = newIp()
    expect((await post(ip, { phone, cpf: newPerson().cpf }, await antiBotFor(h, ip))).status).toBe(429)
    h.clock.advance(24 * 60 * 60 * 1000)
    expect((await post(ip, { phone, cpf: newPerson().cpf }, await antiBotFor(h, ip))).status).toBe(201)
  })

  it('o limite não queima o token: depois da janela, o mesmo token ainda vale (se não venceu)', async () => {
    const phone = newPerson().phone
    for (let i = 0; i < LIMITS.submissionsPerPhonePerDay; i++) {
      const ip = newIp()
      expect((await post(ip, { phone, cpf: newPerson().cpf }, await antiBotFor(h, ip))).status).toBe(201)
    }
    const ip = newIp()
    const antiBot = await antiBotFor(h, ip)
    expect((await post(ip, { phone, cpf: newPerson().cpf }, antiBot)).status).toBe(429)
    const uses = await h.ctx.db.query('SELECT 1 FROM form_token_uses WHERE token_hash = $1', [sha256Hex(antiBot.token)])
    expect(uses.rows).toHaveLength(0)
  })
})
