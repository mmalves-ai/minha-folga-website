import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { call, insertLead, insertSupportRequest, seedUser, signIn, type AdminClient } from './admin-fixtures.js'
import { createTestHarness, type TestHarness } from './helpers.js'

let h: TestHarness
let marketing: AdminClient

const at = (iso: string) => new Date(iso)

beforeAll(async () => {
  h = await createTestHarness()
  marketing = await signIn(h, await seedUser(h, { role: 'marketing' }))
  const day = at('2026-03-10T15:00:00Z')
  // Contam para a métrica principal: contato confirmado + vínculo compatível + aviso autorizado.
  await insertLead(h, { employmentType: 'clt', createdAt: day, verifiedAt: day, launch: true, name: 'Ana Métrica' })
  await insertLead(h, { employmentType: 'rural', createdAt: day, verifiedAt: at('2026-03-11T15:00:00Z'), launch: true })
  // Não contam: aviso não autorizado, vínculo "outro", contato não confirmado, anonimizado.
  await insertLead(h, { employmentType: 'domestico', createdAt: day, verifiedAt: day, launch: false })
  await insertLead(h, { employmentType: 'outro', createdAt: day, verifiedAt: day, launch: true, marketing: true })
  await insertLead(h, { employmentType: 'clt', createdAt: day, verifiedAt: null, launch: true })
  await insertLead(h, { employmentType: 'clt', createdAt: day, verifiedAt: day, launch: true, anonymized: true })
  // 01:30 UTC de 10/03 ainda é 09/03 no horário de Brasília.
  await insertLead(h, { employmentType: 'clt', createdAt: at('2026-03-10T01:30:00Z'), verifiedAt: null, launch: false })
  // Fora do período.
  await insertLead(h, { employmentType: 'clt', createdAt: at('2026-04-02T12:00:00Z'), verifiedAt: at('2026-04-02T12:00:00Z') })

  // Primeiro atendimento: 1 h, 3 h e 10 h → mediana 3 h.
  for (const hours of [1, 3, 10]) {
    const created = at('2026-03-12T12:00:00Z')
    await insertSupportRequest(h, { createdAt: created, firstResponseAt: new Date(created.getTime() + hours * 3_600_000), status: 'answered', message: 'Mensagem privada' })
  }
  await insertSupportRequest(h, { createdAt: at('2026-03-12T12:00:00Z'), status: 'received' })
})
afterAll(async () => {
  await h.close()
})

describe('métricas agregadas', () => {
  it('métrica principal conta só contato confirmado, vínculo compatível e aviso autorizado', async () => {
    const res = await call(marketing, 'get', '/metrics?from=2026-03-01&to=2026-03-31')
    expect(res.status).toBe(200)
    const { leads, preferences, support, period } = res.body
    expect(period).toEqual({ from: '2026-03-01', to: '2026-03-31' })
    expect(leads.created).toBe(7)
    expect(leads.verified).toBe(5)
    expect(leads.verifiedWithEligibleIntent).toBe(2)
    expect(leads.byEmploymentType).toEqual({ clt: 4, domestico: 1, outro: 1, rural: 1 })
    expect(preferences).toEqual({ launchNoticeGranted: 5, marketingGranted: 1 })
    expect(leads.byDay).toHaveLength(31)
    const byDay = Object.fromEntries(leads.byDay.map((d: { day: string; created: number; verified: number }) => [d.day, [d.created, d.verified]]))
    expect(byDay['2026-03-09']).toEqual([1, 0])
    expect(byDay['2026-03-10']).toEqual([6, 4])
    expect(byDay['2026-03-11']).toEqual([0, 1])
    expect(support).toMatchObject({ created: 4, byStatus: { answered: 3, received: 1 }, medianFirstResponseHours: 3 })
    // Somente agregados: nenhum nome, contato ou mensagem.
    expect(JSON.stringify(res.body)).not.toMatch(/Ana Métrica|Mensagem privada|•|\+55/)
  })

  it('eventos de produto saem pelo nome do contrato, limitados às N dimensões mais frequentes; contadores internos à parte', async () => {
    // 30 dimensões do mesmo evento (1..30 ocorrências) e um contador interno, no período.
    for (let i = 1; i <= 30; i++) {
      await h.ctx.db.query('INSERT INTO metric_counters (day, name, dimension, count) VALUES ($1, $2, $3, $4)', [
        '2026-03-15',
        'event:page_section_view',
        `/rota-${String(i).padStart(2, '0')}`,
        i,
      ])
    }
    await h.ctx.db.query("INSERT INTO metric_counters (day, name, dimension, count) VALUES ('2026-03-15', 'event:article_read', 'o-que-e-cet', 7)")
    await h.ctx.db.query("INSERT INTO metric_counters (day, name, dimension, count) VALUES ('2026-03-15', 'waitlist_received', 'avise-me', 3)")
    // Fora do período: não entra.
    await h.ctx.db.query("INSERT INTO metric_counters (day, name, dimension, count) VALUES ('2026-04-15', 'event:article_read', 'o-que-e-cet', 100)")

    const res = await call(marketing, 'get', '/metrics?from=2026-03-01&to=2026-03-31')
    expect(res.status).toBe(200)
    const { events, eventsOmitted, counters, countersOmitted, dimensionsPerName } = res.body
    expect(dimensionsPerName).toBe(25)
    const views = events.filter((e: { name: string }) => e.name === 'page_section_view')
    expect(views).toHaveLength(25)
    expect(views[0]).toEqual({ name: 'page_section_view', dimension: '/rota-30', count: 30 })
    expect(views[24]).toEqual({ name: 'page_section_view', dimension: '/rota-06', count: 6 })
    // Ficaram de fora as 5 menos frequentes (1 + 2 + 3 + 4 + 5 = 15).
    expect(eventsOmitted).toEqual([{ name: 'page_section_view', dimensions: 5, count: 15 }])
    expect(events).toContainEqual({ name: 'article_read', dimension: 'o-que-e-cet', count: 7 })
    expect(events.every((e: { name: string }) => !e.name.startsWith('event:'))).toBe(true)
    expect(counters).toContainEqual({ name: 'waitlist_received', dimension: 'avise-me', count: 3 })
    expect(events.some((e: { name: string }) => e.name === 'waitlist_received')).toBe(false)
    expect(countersOmitted).toEqual([])
  })

  it('D1: validados pela Bia, submissões retidas para revisão e distribuições por UF, renda e tempo de emprego', async () => {
    const day = at('2026-05-10T15:00:00Z')
    const a = await insertLead(h, { createdAt: day, verifiedAt: day, uf: 'PE', incomeRange: 'nao_informar', jobTenure: 'mais_3_anos' })
    const b = await insertLead(h, { createdAt: day, verifiedAt: null, uf: 'PE', incomeRange: 'ate_2000', jobTenure: 'menos_3_meses' })
    await insertLead(h, { createdAt: day, verifiedAt: null, uf: 'BA', incomeRange: 'ate_2000', jobTenure: 'menos_3_meses' })
    await h.ctx.db.query(
      `INSERT INTO lead_events (id, lead_id, event_type, source, actor_type, actor_id, created_at) VALUES ($1, $2, 'contact_verified', 'bia', 'agent', 'conv', $3)`,
      [randomUUID(), a.id, day],
    )
    await h.ctx.db.query(
      `INSERT INTO lead_submissions (id, lead_id, channel, source, reason, payload_ciphertext, status, created_at)
       VALUES ($1, $2, 'site', 'avise-me', 'existing_phone', 'cifrado', 'pending', $3)`,
      [randomUUID(), b.id, day],
    )
    // Cadastro anterior à D1: sem UF nem faixas.
    const legacy = await insertLead(h, { createdAt: day, verifiedAt: null })
    await h.ctx.db.query('UPDATE leads SET uf = NULL, income_range = NULL, job_tenure = NULL WHERE id = $1', [legacy.id])

    const res = await call(marketing, 'get', '/metrics?from=2026-05-01&to=2026-05-31')
    expect(res.status).toBe(200)
    expect(res.body.leads).toMatchObject({
      created: 4,
      verified: 1,
      verifiedByBia: 1,
      pendingReview: 1,
      byUf: { PE: 2, BA: 1, sem_registro: 1 },
      byIncomeRange: { nao_informar: 1, ate_2000: 2, sem_registro: 1 },
      byJobTenure: { mais_3_anos: 1, menos_3_meses: 2, sem_registro: 1 },
    })
  })

  it('período inválido é recusado', async () => {
    expect((await call(marketing, 'get', '/metrics?from=2026-03-31&to=2026-03-01')).status).toBe(400)
    expect((await call(marketing, 'get', '/metrics?from=2024-01-01&to=2026-03-01')).status).toBe(400)
    expect((await call(marketing, 'get', '/metrics?from=2026-02-30')).status).toBe(400)
  })
})
