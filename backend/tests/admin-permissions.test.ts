import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  auditRows,
  call,
  insertLead,
  insertSupportRequest,
  seedUser,
  signIn,
  type AdminClient,
  type SeedLead,
  type SeedSupport,
} from './admin-fixtures.js'
import { createTestHarness, type TestHarness } from './helpers.js'

let h: TestHarness
let admin: AdminClient
let support: AdminClient
let privacy: AdminClient
let marketing: AdminClient
let maria: SeedLead
let formula: SeedLead
let ticket: SeedSupport

beforeAll(async () => {
  h = await createTestHarness()
  admin = await signIn(h, await seedUser(h, { role: 'admin' }))
  support = await signIn(h, await seedUser(h, { role: 'support' }))
  privacy = await signIn(h, await seedUser(h, { role: 'privacy' }))
  marketing = await signIn(h, await seedUser(h, { role: 'marketing' }))
  maria = await insertLead(h, {
    name: 'Maria Teste Souza',
    phone: '+5511987654321',
    cpf: '52998224725',
    email: 'maria.teste@exemplo-mf.com.br',
    employerName: 'Padaria Central',
    employmentType: 'clt',
    incomeRange: '4000_a_7000',
    uf: 'MG',
    city: 'Belo Horizonte',
    marketing: true,
  })
  formula = await insertLead(h, { name: '=HYPERLINK("http://golpe.test","clique")', employmentType: 'outro', source: 'home', email: null })
  await insertLead(h, { name: 'Sem Confirmar', employmentType: 'rural', verifiedAt: null, launch: false, jobTenure: 'menos_3_meses' })
  ticket = await insertSupportRequest(h, { message: 'Mensagem sigilosa do titular sobre a conta.' })
})
afterAll(async () => {
  await h.close()
})

async function forbiddenFor(c: AdminClient) {
  return (await auditRows(h, 'admin.forbidden')).filter((r) => r.actor_id === c.user.id).map((r) => r.metadata.permission)
}

describe('matriz de permissões (aplicada no backend)', () => {
  it('marketing não vê cadastros, contatos, atendimentos nem auditoria; só métricas agregadas', async () => {
    const denied: Array<[string, 'get' | 'post' | 'patch', string, unknown?]> = [
      ['leads:read', 'get', '/leads'],
      ['leads:read', 'get', `/leads/${maria.id}`],
      ['leads:read_contact', 'post', `/leads/${maria.id}/reveal-contact`, { reason: 'curiosidade de campanha' }],
      ['leads:export', 'post', '/leads/export', { reason: 'lista para campanha' }],
      ['support:read', 'get', '/support'],
      ['support:read', 'get', `/support/${ticket.id}`],
      ['team:read', 'get', '/team'],
      ['audit:read', 'get', '/audit'],
      ['privacy:manage', 'get', '/privacy-requests'],
      ['users:manage', 'get', '/users'],
    ]
    for (const [, method, path, body] of denied) {
      const res = await call(marketing, method, path, body)
      expect(res.status, `${method} ${path}`).toBe(403)
      expect(res.body.error.code).toBe('forbidden')
      expect(JSON.stringify(res.body)).not.toContain('Maria')
    }
    // Cada negativa fica auditada com a permissão que faltou.
    expect((await forbiddenFor(marketing)).sort()).toEqual(denied.map(([p]) => p).sort())

    const metrics = await call(marketing, 'get', '/metrics')
    expect(metrics.status).toBe(200)
    expect(metrics.body.leads.created).toBe(3)
    const text = JSON.stringify(metrics.body)
    for (const secret of ['Maria', '987654321', '•', 'sigilosa', ticket.protocol, '529.982', 'Padaria']) expect(text).not.toContain(secret)
  })

  it('atendimento vê cadastros com telefone, CPF e e-mail mascarados; empregador, faixas e UF/cidade visíveis; não revela nem exporta', async () => {
    const list = await call(support, 'get', '/leads')
    expect(list.status).toBe(200)
    const item = list.body.items.find((i: { id: string }) => i.id === maria.id)
    expect(item).toMatchObject({
      fullName: 'Maria Teste Souza',
      preferredName: 'Maria',
      phoneHint: '(11) •••••-••21',
      phoneVerified: true,
      cpfHint: '***.***.***-25',
      emailHint: 'm•••@e•••.com.br',
      employerName: 'Padaria Central',
      incomeRange: '4000_a_7000',
      jobTenure: '1_a_3_anos',
      uf: 'MG',
      city: 'Belo Horizonte',
      pendingReview: 0,
    })
    const listed = JSON.stringify(list.body)
    expect(listed).not.toMatch(/98765|5511987654321|52998224725|529\.982\.247|maria\.teste@/)

    const detail = await call(support, 'get', `/leads/${maria.id}`)
    expect(detail.status).toBe(200)
    expect(detail.body.pendingSubmissions).toEqual([])
    expect(JSON.stringify(detail.body)).not.toMatch(/987654321|52998224725|maria\.teste@/)

    expect((await call(support, 'post', `/leads/${maria.id}/reveal-contact`, { reason: 'retornar a ligação' })).status).toBe(403)
    expect((await call(support, 'post', '/leads/export', { reason: 'relatório semanal' })).status).toBe(403)
    expect((await call(support, 'get', '/audit')).status).toBe(403)
    expect((await call(support, 'get', '/privacy-requests')).status).toBe(403)
    expect((await call(support, 'patch', `/users/${support.user.id}`, { role: 'admin' })).status).toBe(403)
    expect(await forbiddenFor(support)).toEqual(expect.arrayContaining(['leads:read_contact', 'leads:export', 'audit:read', 'users:manage']))
    expect((await auditRows(h, 'admin.lead_contact_revealed')).some((r) => r.actor_id === support.user.id)).toBe(false)
  })

  it('privacidade revela telefone, e-mail e CPF com justificativa, e a leitura fica auditada (sem os valores)', async () => {
    const noReason = await call(privacy, 'post', `/leads/${maria.id}/reveal-contact`, {})
    expect(noReason.status).toBe(400)
    const res = await call(privacy, 'post', `/leads/${maria.id}/reveal-contact`, { reason: 'Pedido de acesso do titular' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ phone: '+5511987654321', email: 'maria.teste@exemplo-mf.com.br', cpf: '529.982.247-25' })
    const audit = (await auditRows(h, 'admin.lead_contact_revealed')).find((r) => r.actor_id === privacy.user.id)
    expect(audit?.resource_id).toBe(maria.id)
    expect(audit?.metadata).toEqual({ reason: 'Pedido de acesso do titular', fields: ['phone', 'email', 'cpf'] })
    // A justificativa fica na trilha; telefone, e-mail e CPF não.
    expect(JSON.stringify(audit)).not.toMatch(/987654321|maria\.teste|529\.982|52998224725/)
    const noEmail = await call(privacy, 'post', `/leads/${formula.id}/reveal-contact`, { reason: 'Pedido de acesso do titular' })
    expect(noEmail.body).toMatchObject({ email: null, cpf: expect.stringMatching(/^\d{3}\.\d{3}\.\d{3}-\d{2}$/) })
    // Privacidade lê a fila de atendimento, mas não altera.
    expect((await call(privacy, 'get', '/support')).status).toBe(200)
    expect((await call(privacy, 'patch', `/support/${ticket.id}`, { status: 'in_progress' })).status).toBe(403)
  })

  it('privacidade exporta CSV com telefone, CPF e e-mail mascarados, protegido contra fórmulas e auditado', async () => {
    const res = await call(privacy, 'post', '/leads/export', { reason: 'Atender pedido de portabilidade', filters: { employmentType: 'outro' } })
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/^text\/csv; charset=utf-8/)
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="cadastros-\d{12}\.csv"$/)
    const csv = res.text.replace(/^﻿/, '')
    const lines = csv.trim().split('\r\n')
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain(formula.id)
    // Nome iniciado por "=" vira texto (prefixo ') e nenhuma célula começa com caractere de fórmula.
    expect(lines[1]).toContain(`"'=HYPERLINK(""http://golpe.test"",""clique"")"`)
    for (const cell of lines[1]!.split('","')) expect(cell.replace(/^"/, '')).not.toMatch(/^[=+\-@]/)
    expect(csv).not.toContain(formula.phone)
    expect(csv).not.toContain(formula.cpf)
    expect(csv).toContain('•••••')
    expect(lines[0]).toContain('"cpf_mascarado"')
    expect(lines[1]).toContain(`"***.***.***-${formula.cpf.slice(-2)}"`)
    const all = await call(privacy, 'post', '/leads/export', { reason: 'Atender pedido de portabilidade' })
    expect(all.text).not.toMatch(/52998224725|529\.982\.247|maria\.teste@/)
    expect(all.text).toContain('"Padaria Central"')

    const audit = (await auditRows(h, 'admin.leads_exported')).find((r) => r.actor_id === privacy.user.id)
    expect(audit?.metadata).toMatchObject({ reason: 'Atender pedido de portabilidade', rowCount: 1, filters: { employmentType: 'outro' } })

    const badFilter = await call(privacy, 'post', '/leads/export', { reason: 'Atender pedido', filters: { phone: '11987654321' } })
    expect(badFilter.status).toBe(400)
  })

  it('administração alcança tudo; filtros e paginação dos cadastros funcionam', async () => {
    for (const path of ['/leads', '/support', '/team', '/audit', '/privacy-requests', '/users', '/metrics']) {
      expect((await call(admin, 'get', path)).status, path).toBe(200)
    }
    const mkt = await call(admin, 'get', '/leads?purpose=marketing&granted=true')
    expect(mkt.body.items.map((i: { id: string }) => i.id)).toEqual([maria.id])
    const notVerified = await call(admin, 'get', '/leads?state=received')
    expect(notVerified.body.total).toBe(1)
    expect((await call(admin, 'get', '/leads?phoneVerified=false')).body.total).toBe(1)
    expect((await call(admin, 'get', '/leads?phoneVerified=true')).body.total).toBe(2)
    expect((await call(admin, 'get', '/leads?uf=MG')).body.items.map((i: { id: string }) => i.id)).toEqual([maria.id])
    expect((await call(admin, 'get', '/leads?incomeRange=4000_a_7000')).body.total).toBe(1)
    expect((await call(admin, 'get', '/leads?jobTenure=menos_3_meses')).body.total).toBe(1)
    expect((await call(admin, 'get', '/leads?uf=XX')).status).toBe(400)
    const page = await call(admin, 'get', '/leads?pageSize=1&page=2')
    expect(page.body).toMatchObject({ total: 3, page: 2, pageSize: 1 })
    expect(page.body.items).toHaveLength(1)
    const unknown = await call(admin, 'get', '/leads?telefone=11987654321')
    expect(unknown.status).toBe(400)
    expect(unknown.body.error.code).toBe('validation_error')
    expect((await call(admin, 'get', '/leads/nao-e-uuid')).status).toBe(404)
  })

  it('sem sessão, nenhuma rota administrativa responde dados', async () => {
    const anon = { ...admin, agent: (await import('supertest')).default.agent(h.app) }
    for (const path of ['/leads', `/leads/${maria.id}`, '/support', '/metrics', '/users', '/audit']) {
      const res = await call(anon, 'get', path)
      expect(res.status).toBe(401)
      expect(res.body.error.code).toBe('session_required')
    }
  })
})
