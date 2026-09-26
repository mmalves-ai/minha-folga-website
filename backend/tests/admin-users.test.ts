import supertest from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { auditRows, call, nextCode, seedUser, signIn, type AdminClient } from './admin-fixtures.js'
import { createTestHarness, SITE, type TestHarness } from './helpers.js'

let h: TestHarness
let admin: AdminClient

beforeAll(async () => {
  h = await createTestHarness()
  admin = await signIn(h, await seedUser(h, { role: 'admin' }))
})
afterAll(async () => {
  await h.close()
})

describe('gestão de usuários', () => {
  it('cria pessoa com senha temporária exibida uma vez; o banco guarda só o hash', async () => {
    const res = await call(admin, 'post', '/users', { email: 'Carla.Suporte@Equipe.test', displayName: 'Carla Suporte', role: 'support' })
    expect(res.status).toBe(201)
    const { user, temporaryPassword } = res.body as { user: { id: string; email: string; mustChangePassword: boolean; mfaEnabled: boolean }; temporaryPassword: string }
    expect(user).toMatchObject({ email: 'carla.suporte@equipe.test', mustChangePassword: true, mfaEnabled: false })
    expect(temporaryPassword.length).toBeGreaterThanOrEqual(12)
    const stored = await h.ctx.db.query<{ password_hash: string }>('SELECT password_hash FROM admin_users WHERE id = $1', [user.id])
    expect(stored.rows[0]?.password_hash).toMatch(/^scrypt\$/)
    expect(stored.rows[0]?.password_hash).not.toContain(temporaryPassword)

    const list = await call(admin, 'get', '/users')
    expect(JSON.stringify(list.body)).not.toMatch(new RegExp(`${temporaryPassword}|password_hash|scrypt`))

    const first = await supertest.agent(h.app).post('/api/admin/auth/login').set(SITE).send({ email: 'carla.suporte@equipe.test', password: temporaryPassword })
    expect(first.body.status).toBe('mfa_setup_required')

    const dup = await call(admin, 'post', '/users', { email: 'CARLA.SUPORTE@equipe.test', displayName: 'Outra', role: 'support' })
    expect(dup.status).toBe(409)
    expect(dup.body.error.code).toBe('email_in_use')
    expect((await auditRows(h, 'admin.user_created')).some((r) => r.resource_id === user.id && r.actor_id === admin.user.id)).toBe(true)
  })

  it('o último admin ativo não pode ser rebaixado nem desativado', async () => {
    for (const change of [{ role: 'support' }, { disabled: true }]) {
      const res = await call(admin, 'patch', `/users/${admin.user.id}`, change)
      expect(res.status).toBe(409)
      expect(res.body.error.code).toBe('last_admin')
    }
    const second = await seedUser(h, { role: 'admin' })
    const demote = await call(admin, 'patch', `/users/${second.id}`, { role: 'privacy' })
    expect(demote.status).toBe(200)
    expect(demote.body.user.role).toBe('privacy')
    // Com o segundo rebaixado, o primeiro volta a ser o único.
    expect((await call(admin, 'patch', `/users/${admin.user.id}`, { disabled: true })).status).toBe(409)
    const roles = await h.ctx.db.query<{ n: number }>("SELECT count(*)::int AS n FROM admin_users WHERE role = 'admin' AND disabled_at IS NULL")
    expect(roles.rows[0]?.n).toBe(1)
  })

  it('desativar encerra as sessões e impede novo login', async () => {
    const person = await seedUser(h, { role: 'support' })
    const c = await signIn(h, person)
    expect((await call(c, 'get', '/support')).status).toBe(200)
    const res = await call(admin, 'patch', `/users/${person.id}`, { disabled: true })
    expect(res.body.user.disabled).toBe(true)
    expect((await call(c, 'get', '/support')).status).toBe(401)
    const again = await supertest.agent(h.app).post('/api/admin/auth/login').set(SITE).send({ email: person.email, password: person.password })
    expect(again.status).toBe(401)
    expect(again.body.error.code).toBe('invalid_credentials')
  })

  it('redefinir senha e MFA encerra sessões e exige novo cadastro no próximo acesso', async () => {
    const person = await seedUser(h, { role: 'privacy' })
    const c = await signIn(h, person)
    const res = await call(admin, 'patch', `/users/${person.id}`, { resetPassword: true, resetMfa: true })
    expect(res.status).toBe(200)
    expect(res.body.user).toMatchObject({ mustChangePassword: true, mfaEnabled: false })
    const temp = res.body.temporaryPassword as string
    expect((await call(c, 'get', '/audit')).status).toBe(401)

    const oldPassword = await supertest.agent(h.app).post('/api/admin/auth/login').set(SITE).send({ email: person.email, password: person.password })
    expect(oldPassword.status).toBe(401)
    const agent = supertest.agent(h.app)
    const fresh = await agent.post('/api/admin/auth/login').set(SITE).send({ email: person.email, password: temp })
    expect(fresh.body.status).toBe('mfa_setup_required')
    // O segredo antigo não vale mais.
    const oldCode = await agent.post('/api/admin/auth/mfa/verify').set(SITE).set('X-CSRF-Token', fresh.body.csrfToken).send({ code: nextCode(h, person) })
    expect(oldCode.status).toBe(400)
    expect((await auditRows(h, 'admin.user_mfa_reset')).some((r) => r.resource_id === person.id)).toBe(true)
  })

  it('mudança de papel vale na próxima requisição, sem depender da interface', async () => {
    const person = await seedUser(h, { role: 'support' })
    const c = await signIn(h, person)
    expect((await call(c, 'get', '/support')).status).toBe(200)
    await call(admin, 'patch', `/users/${person.id}`, { role: 'marketing' })
    expect((await call(c, 'get', '/support')).status).toBe(403)
    const me = await call(c, 'get', '/auth/me')
    expect(me.body.permissions).toEqual(['metrics:read'])
  })

  it('auditoria filtra por ação e pessoa', async () => {
    const res = await call(admin, 'get', `/audit?action=admin.user_created&actorId=${admin.user.id}`)
    expect(res.status).toBe(200)
    expect(res.body.total).toBeGreaterThan(0)
    for (const item of res.body.items) {
      expect(item.action).toBe('admin.user_created')
      expect(item.actor).toMatchObject({ id: admin.user.id, role: 'admin' })
    }
    expect((await call(admin, 'get', '/audit?from=2026-09-30&to=2026-09-01')).status).toBe(400)
  })
})
