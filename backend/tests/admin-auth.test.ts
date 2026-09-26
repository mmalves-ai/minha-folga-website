import supertest from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sha256Hex } from '../src/lib/crypto.js'
import { hashPassword, passwordPolicyError, verifyPassword } from '../src/lib/password.js'
import { base32Encode, totpCode, totpStep, verifyTotp } from '../src/lib/totp.js'
import { auditRows, call, cookieToken, nextCode, seedUser, signIn } from './admin-fixtures.js'
import { createTestHarness, SITE, type TestHarness } from './helpers.js'

let h: TestHarness
beforeAll(async () => {
  h = await createTestHarness()
})
afterAll(async () => {
  await h.close()
})

const login = (agent: supertest.Agent | ReturnType<typeof supertest.agent>, email: string, password: string) =>
  agent.post('/api/admin/auth/login').set(SITE).send({ email, password })

describe('credenciais: TOTP e hash de senha', () => {
  it('TOTP confere com os vetores SHA-1 da RFC 6238 e respeita janela e reuso', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'))
    const vectors: Array<[number, string]> = [
      [59, '287082'],
      [1111111109, '081804'],
      [1111111111, '050471'],
      [1234567890, '005924'],
      [2000000000, '279037'],
      [20000000000, '353130'],
    ]
    for (const [t, code] of vectors) expect(totpCode(secret, new Date(t * 1000))).toBe(code)

    const now = new Date(1_234_567_890_000)
    const step = totpStep(now)
    const previous = totpCode(secret, new Date(now.getTime() - 30_000))
    const tooOld = totpCode(secret, new Date(now.getTime() - 60_000))
    expect(verifyTotp(secret, previous, now, null)).toBe(step - 1)
    expect(verifyTotp(secret, tooOld, now, null)).toBeNull()
    // Mesmo passo já usado: recusado.
    expect(verifyTotp(secret, totpCode(secret, now), now, step)).toBeNull()
  })

  it('hash de senha é versionado, com sal aleatório, e recusa senha errada ou hash adulterado', async () => {
    const a = await hashPassword('senha-bem-comprida-1')
    const b = await hashPassword('senha-bem-comprida-1')
    expect(a).toMatch(/^scrypt\$v1\$32768\$8\$1\$/)
    expect(a).not.toBe(b)
    expect(await verifyPassword(a, 'senha-bem-comprida-1')).toBe(true)
    expect(await verifyPassword(a, 'senha-bem-comprida-2')).toBe(false)
    const tampered = a.slice(0, -2) + (a.endsWith('AA') ? 'BB' : 'AA')
    expect(await verifyPassword(tampered, 'senha-bem-comprida-1')).toBe(false)
    expect(await verifyPassword('scrypt$v1$2$1$1$x$y', 'qualquer')).toBe(false)
    expect(passwordPolicyError('curta', 'ana.souza@x.test')).toMatch(/12/)
    expect(passwordPolicyError('minha-ana.souza@x.test!', 'ana.souza@x.test')).toMatch(/e-mail/)
    expect(passwordPolicyError('ana.souza-2026-segura', 'Ana.Souza@x.test')).toMatch(/e-mail/)
  })
})

describe('login', () => {
  it('banco novo não tem usuário: nenhuma credencial padrão funciona', async () => {
    const users = await h.ctx.db.query<{ n: number }>('SELECT count(*)::int AS n FROM admin_users')
    expect(users.rows[0]?.n).toBe(0)
    for (const [email, password] of [
      ['admin@minhafolga.com.br', 'admin'],
      ['admin', 'admin123456789'],
    ]) {
      const res = await login(supertest.agent(h.app), email!, password!)
      expect(res.status).toBe(401)
      expect(res.body.error).toEqual({ code: 'invalid_credentials', message: 'E-mail ou senha incorretos.' })
      expect(cookieToken(res)).toBeUndefined()
    }
  })

  it('senha errada e e-mail inexistente recebem a mesma resposta genérica', async () => {
    const user = await seedUser(h, { role: 'support' })
    const wrong = await login(supertest.agent(h.app), user.email, 'senha-errada-mas-longa')
    const unknown = await login(supertest.agent(h.app), 'ninguem@equipe.test', 'senha-errada-mas-longa')
    expect(wrong.status).toBe(401)
    expect(unknown.status).toBe(401)
    expect(wrong.body.error).toEqual(unknown.body.error)
    expect(cookieToken(wrong)).toBeUndefined()
  })

  it('cinco falhas seguidas bloqueiam a conta por 15 minutos, inclusive para a senha certa', async () => {
    const user = await seedUser(h, { role: 'support' })
    for (let i = 0; i < 5; i++) expect((await login(supertest.agent(h.app), user.email, `errada-${i}-senha-longa`)).status).toBe(401)
    const locked = await login(supertest.agent(h.app), user.email, user.password)
    expect(locked.status).toBe(401)
    expect(locked.body.error.message).toBe('E-mail ou senha incorretos.')
    expect((await auditRows(h, 'admin.account_locked')).some((r) => r.resource_id === user.id)).toBe(true)

    h.clock.advance(15 * 60_000 + 1000)
    const ok = await login(supertest.agent(h.app), user.email.toUpperCase(), user.password)
    expect(ok.status).toBe(200)
    expect(ok.body.status).toBe('mfa_required')
  })

  it('conta desativada recebe a mesma resposta genérica', async () => {
    const user = await seedUser(h, { role: 'privacy', disabled: true })
    const res = await login(supertest.agent(h.app), user.email, user.password)
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('invalid_credentials')
  })

  it('limite por IP: trocar de endereço IPv6 na mesma sub-rede /56 não renova a cota', async () => {
    // O proxy de confiança (loopback) informa a origem em X-Forwarded-For.
    const from = (ip: string) =>
      supertest.agent(h.app).post('/api/admin/auth/login').set(SITE).set('X-Forwarded-For', ip)
        .send({ email: 'ninguem@equipe.test', password: 'senha-errada-mas-longa' })
    for (let i = 1; i <= 20; i++) expect((await from(`2001:db8:77:1${(i % 16).toString(16)}${i % 10}::${i}`)).status).toBe(401)
    const blocked = await from('2001:db8:77:1ff:abcd::9')
    expect(blocked.status).toBe(429)
    expect(blocked.body.error.code).toBe('rate_limited')
    // Outra sub-rede e outro IPv4 seguem com a própria cota.
    expect((await from('2001:db8:77:200::1')).status).toBe(401)
    expect((await from('203.0.113.9')).status).toBe(401)
  })
})

describe('MFA e primeiro acesso', () => {
  it('sessão parcial não alcança dados; cadastro do TOTP e troca de senha obrigatória', async () => {
    const temp = 'Temporaria-abcde-fghij'
    const user = await seedUser(h, { role: 'admin', mfa: false, mustChange: true, password: temp, email: 'primeira.pessoa@equipe.test' })
    const agent = supertest.agent(h.app)

    const first = await login(agent, user.email, temp)
    expect(first.status).toBe(200)
    expect(first.body.status).toBe('mfa_setup_required')
    const csrf = first.body.csrfToken as string
    const setCookie = (first.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('mf_admin='))!
    expect(setCookie).toMatch(/HttpOnly/i)
    expect(setCookie).toMatch(/SameSite=Strict/i)
    expect(setCookie).toMatch(/Path=\/api\/admin/)
    // O banco guarda o hash do token, nunca o token.
    const partialToken = cookieToken(first)!
    const stored = await h.ctx.db.query('SELECT 1 FROM admin_sessions WHERE id_hash = $1', [sha256Hex(partialToken)])
    expect(stored.rows).toHaveLength(1)
    expect((await h.ctx.db.query('SELECT 1 FROM admin_sessions WHERE id_hash = $1', [partialToken])).rows).toHaveLength(0)

    // Antes do MFA: nenhum dado.
    const leads = await agent.get('/api/admin/leads').set(SITE)
    expect(leads.status).toBe(401)
    expect(leads.body.error.code).toBe('mfa_required')
    expect((await agent.get('/api/admin/support').set(SITE)).status).toBe(401)
    expect((await agent.get('/api/admin/auth/me').set(SITE)).body).toEqual({ status: 'mfa_setup_required', csrfToken: csrf })
    expect((await agent.post('/api/admin/auth/password').set(SITE).set('X-CSRF-Token', csrf).send({ currentPassword: temp, newPassword: 'outra-senha-bem-longa' })).status).toBe(401)

    const early = await agent.post('/api/admin/auth/mfa/verify').set(SITE).set('X-CSRF-Token', csrf).send({ code: '123456' })
    expect(early.body.error.code).toBe('mfa_setup_required')

    expect((await agent.post('/api/admin/auth/mfa/setup').set(SITE).send({})).status).toBe(403)
    const setup = await agent.post('/api/admin/auth/mfa/setup').set(SITE).set('X-CSRF-Token', csrf).send({})
    expect(setup.status).toBe(200)
    expect(setup.body.secret).toMatch(/^[A-Z2-7]{32}$/)
    expect(setup.body.otpauthUrl).toContain('issuer=Minha%20Folga')
    expect(setup.body.qrSvg).toMatch(/^<svg/)
    const row = await h.ctx.db.query<{ mfa_secret_ciphertext: string; mfa_enabled_at: Date | null }>(
      'SELECT mfa_secret_ciphertext, mfa_enabled_at FROM admin_users WHERE id = $1',
      [user.id],
    )
    expect(row.rows[0]?.mfa_secret_ciphertext).not.toContain(setup.body.secret)
    expect(row.rows[0]?.mfa_enabled_at).toBeNull()

    const bad = await agent.post('/api/admin/auth/mfa/verify').set(SITE).set('X-CSRF-Token', csrf).send({ code: '000000' })
    expect(bad.status).toBe(400)
    expect(bad.body.error.code).toBe('invalid_code')

    const ok = await agent
      .post('/api/admin/auth/mfa/verify')
      .set(SITE)
      .set('X-CSRF-Token', csrf)
      .send({ code: nextCode(h, user, setup.body.secret) })
    expect(ok.status).toBe(200)
    expect(ok.body.status).toBe('authenticated')
    expect(ok.body.user.mfaEnabled).toBe(true)
    expect(ok.body.user.mustChangePassword).toBe(true)
    expect(ok.body.csrfToken).not.toBe(csrf)
    // Sessão parcial substituída: o token antigo não vale mais.
    const old = await supertest(h.app).get('/api/admin/auth/me').set(SITE).set('Cookie', `mf_admin=${partialToken}`)
    expect(old.status).toBe(401)

    const full = { agent, csrf: ok.body.csrfToken as string, user }
    const blocked = await call(full, 'get', '/leads')
    expect(blocked.status).toBe(403)
    expect(blocked.body.error.code).toBe('password_change_required')
    expect((await call(full, 'get', '/auth/me')).status).toBe(200)

    const short = await call(full, 'post', '/auth/password', { currentPassword: temp, newPassword: 'curta' })
    expect(short.status).toBe(400)
    expect(short.body.error.fields.newPassword).toBeDefined()
    const withEmail = await call(full, 'post', '/auth/password', { currentPassword: temp, newPassword: `${user.email}#2026` })
    expect(withEmail.body.error.fields.newPassword).toMatch(/e-mail/)
    const wrongCurrent = await call(full, 'post', '/auth/password', { currentPassword: 'nao-e-a-atual-123', newPassword: 'nova-senha-muito-segura' })
    expect(wrongCurrent.body.error.fields.currentPassword).toBeDefined()
    expect((await call(full, 'post', '/auth/password', { currentPassword: temp, newPassword: 'nova-senha-muito-segura' })).status).toBe(204)

    expect((await call(full, 'get', '/leads')).status).toBe(200)
    expect((await auditRows(h, 'admin.mfa_enabled')).some((r) => r.actor_id === user.id)).toBe(true)
    expect((await auditRows(h, 'admin.password_changed')).some((r) => r.actor_id === user.id)).toBe(true)
  })

  it('o mesmo código TOTP não serve duas vezes; o do passo seguinte serve', async () => {
    const user = await seedUser(h, { role: 'support' })
    const code = nextCode(h, user)
    const a = supertest.agent(h.app)
    const la = await login(a, user.email, user.password)
    expect((await a.post('/api/admin/auth/mfa/verify').set(SITE).set('X-CSRF-Token', la.body.csrfToken).send({ code })).status).toBe(200)

    const b = supertest.agent(h.app)
    const lb = await login(b, user.email, user.password)
    const reuse = await b.post('/api/admin/auth/mfa/verify').set(SITE).set('X-CSRF-Token', lb.body.csrfToken).send({ code })
    expect(reuse.status).toBe(400)
    expect(reuse.body.error.code).toBe('invalid_code')

    const fresh = await b.post('/api/admin/auth/mfa/verify').set(SITE).set('X-CSRF-Token', lb.body.csrfToken).send({ code: nextCode(h, user) })
    expect(fresh.status).toBe(200)
  })

  it('cinco códigos errados bloqueiam a conta e encerram a sessão parcial', async () => {
    const user = await seedUser(h, { role: 'support' })
    const agent = supertest.agent(h.app)
    const l = await login(agent, user.email, user.password)
    const statuses: number[] = []
    for (let i = 0; i < 5; i++) {
      statuses.push((await agent.post('/api/admin/auth/mfa/verify').set(SITE).set('X-CSRF-Token', l.body.csrfToken).send({ code: '000001' })).status)
    }
    expect(statuses).toEqual([400, 400, 400, 400, 429])
    expect((await agent.get('/api/admin/auth/me').set(SITE)).status).toBe(401)
    expect((await login(supertest.agent(h.app), user.email, user.password)).status).toBe(401)
  })

  /** Código de 6 dígitos fora da janela aceita (passo anterior, atual e seguinte). */
  function wrongCode(secret: string): string {
    const now = h.clock.current.getTime()
    const valid = new Set([-1, 0, 1].map((d) => totpCode(secret, new Date(now + d * 30_000))))
    for (let i = 0; ; i++) {
      const code = String(100_000 + i)
      if (!valid.has(code)) return code
    }
  }

  it('login com senha correta não zera as falhas de MFA: a quinta falha em 15 minutos bloqueia a conta', async () => {
    const user = await seedUser(h, { role: 'admin' })
    // Origem própria: o limite por IP das rotas de acesso não interfere na conta.
    const origin = { ...SITE, 'X-Forwarded-For': '203.0.113.61' }
    const statuses: number[] = []
    for (let cycle = 0; cycle < 3; cycle++) {
      const agent = supertest.agent(h.app)
      const l = await agent.post('/api/admin/auth/login').set(origin).send({ email: user.email, password: user.password })
      statuses.push(l.status)
      for (let i = 0; i < 2; i++) {
        const r = await agent.post('/api/admin/auth/mfa/verify').set(origin).set('X-CSRF-Token', l.body.csrfToken).send({ code: wrongCode(user.totpSecret!) })
        statuses.push(r.status)
      }
    }
    // 2 + 2 falhas com novos logins no meio; a quinta bloqueia e encerra a sessão parcial.
    expect(statuses).toEqual([200, 400, 400, 200, 400, 400, 200, 429, 401])
    const row = await h.ctx.db.query<{ locked_until: Date | null; mfa_failed_count: number }>(
      'SELECT locked_until, mfa_failed_count FROM admin_users WHERE id = $1',
      [user.id],
    )
    expect(row.rows[0]!.locked_until).not.toBeNull()
    const locks = (await auditRows(h, 'admin.account_locked')).filter((r) => r.resource_id === user.id)
    expect(locks).toHaveLength(1)
    expect(locks[0]!.metadata).toMatchObject({ after: 'mfa', minutes: 15 })
    // Bloqueada: nem a senha certa entra, até o fim do bloqueio.
    expect((await supertest.agent(h.app).post('/api/admin/auth/login').set(origin).send({ email: user.email, password: user.password })).status).toBe(401)

    h.clock.advance(15 * 60_000 + 1000)
    const agent = supertest.agent(h.app)
    const l = await agent.post('/api/admin/auth/login').set(origin).send({ email: user.email, password: user.password })
    expect(l.status).toBe(200)
    const ok = await agent.post('/api/admin/auth/mfa/verify').set(origin).set('X-CSRF-Token', l.body.csrfToken).send({ code: nextCode(h, user) })
    expect(ok.status).toBe(200)
  })

  it('o contador de MFA recomeça quando a janela de 15 minutos vence ou quando um código certo é aceito', async () => {
    const user = await seedUser(h, { role: 'support' })
    const origin = { ...SITE, 'X-Forwarded-For': '203.0.113.62' }
    const fail = async (n: number) => {
      const agent = supertest.agent(h.app)
      const l = await agent.post('/api/admin/auth/login').set(origin).send({ email: user.email, password: user.password })
      expect(l.status).toBe(200)
      const out: number[] = []
      for (let i = 0; i < n; i++) {
        out.push((await agent.post('/api/admin/auth/mfa/verify').set(origin).set('X-CSRF-Token', l.body.csrfToken).send({ code: wrongCode(user.totpSecret!) })).status)
      }
      return { agent, csrf: l.body.csrfToken as string, out }
    }
    expect((await fail(4)).out).toEqual([400, 400, 400, 400])
    h.clock.advance(15 * 60_000 + 1000)
    const second = await fail(4)
    expect(second.out).toEqual([400, 400, 400, 400])
    const ok = await second.agent.post('/api/admin/auth/mfa/verify').set(origin).set('X-CSRF-Token', second.csrf).send({ code: nextCode(h, user) })
    expect(ok.status).toBe(200)
    expect((await fail(4)).out).toEqual([400, 400, 400, 400])
    const row = await h.ctx.db.query<{ locked_until: Date | null }>('SELECT locked_until FROM admin_users WHERE id = $1', [user.id])
    expect(row.rows[0]!.locked_until).toBeNull()
  })
})

describe('sessão', () => {
  it('CSRF ausente ou errado é recusado em métodos inseguros', async () => {
    const admin = await signIn(h, await seedUser(h, { role: 'admin' }))
    const body = { email: 'nova@equipe.test', displayName: 'Nova Pessoa', role: 'support' }
    const missing = await admin.agent.post('/api/admin/users').set(SITE).send(body)
    expect(missing.status).toBe(403)
    expect(missing.body.error.code).toBe('csrf_invalid')
    const wrong = await admin.agent.post('/api/admin/users').set(SITE).set('X-CSRF-Token', 'x'.repeat(43)).send(body)
    expect(wrong.status).toBe(403)
    const users = await h.ctx.db.query('SELECT 1 FROM admin_users WHERE email = $1', ['nova@equipe.test'])
    expect(users.rows).toHaveLength(0)
    expect((await admin.agent.post('/api/admin/auth/logout').set(SITE).send({})).status).toBe(403)
    expect((await call(admin, 'post', '/users', body)).status).toBe(201)
  })

  it('30 minutos sem uso encerram a sessão', async () => {
    const c = await signIn(h, await seedUser(h, { role: 'support' }))
    h.clock.advance(29 * 60_000)
    expect((await call(c, 'get', '/auth/me')).status).toBe(200)
    h.clock.advance(30 * 60_000 + 1000)
    const res = await call(c, 'get', '/auth/me')
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('session_required')
  })

  it('validade absoluta de 8 horas, mesmo com uso contínuo', async () => {
    const c = await signIn(h, await seedUser(h, { role: 'support' }))
    for (let i = 0; i < 16; i++) {
      h.clock.advance(29 * 60_000)
      expect((await call(c, 'get', '/support')).status).toBe(200)
    }
    h.clock.advance(20 * 60_000)
    expect((await call(c, 'get', '/support')).status).toBe(401)
  })

  it('trocar a senha encerra as outras sessões e mantém a atual', async () => {
    const user = await seedUser(h, { role: 'support' })
    const a = await signIn(h, user)
    const b = await signIn(h, user)
    expect((await call(b, 'get', '/support')).status).toBe(200)
    expect((await call(a, 'post', '/auth/password', { currentPassword: user.password, newPassword: 'outra-senha-bem-longa-9' })).status).toBe(204)
    expect((await call(b, 'get', '/support')).status).toBe(401)
    expect((await call(a, 'get', '/support')).status).toBe(200)
  })

  it('logout encerra a sessão no servidor, não só no navegador', async () => {
    const user = await seedUser(h, { role: 'support' })
    const agent = supertest.agent(h.app)
    const l = await login(agent, user.email, user.password)
    const v = await agent.post('/api/admin/auth/mfa/verify').set(SITE).set('X-CSRF-Token', l.body.csrfToken).send({ code: nextCode(h, user) })
    const token = cookieToken(v)!
    expect((await agent.post('/api/admin/auth/logout').set(SITE).set('X-CSRF-Token', v.body.csrfToken).send({})).status).toBe(204)
    const replay = await supertest(h.app).get('/api/admin/support').set(SITE).set('Cookie', `mf_admin=${token}`)
    expect(replay.status).toBe(401)
  })
})
