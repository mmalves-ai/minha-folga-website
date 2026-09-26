import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { decryptLeadField } from '../src/repositories/leads.repo.js'
import { auditRows, call, seedUser, signIn, type AdminClient } from './admin-fixtures.js'
import { createTestHarness, HALAI_ENV, SITE, type TestHarness } from './helpers.js'
import { cpfKeyFor, dedupFor, leadIdByPhone, newPerson, registerByBia, registerSite, submitSite, type Person } from './lead-flow.js'

/**
 * Painel: interruptor do formulário de cadastro do site (collection:manage) e revisão das submissões guardadas
 * (privacy:manage) — aplicar ao cadastro ou descartar, com justificativa e auditoria.
 */
let h: TestHarness
let admin: AdminClient
let privacy: AdminClient
let support: AdminClient

beforeAll(async () => {
  h = await createTestHarness(HALAI_ENV)
  admin = await signIn(h, await seedUser(h, { role: 'admin' }))
  privacy = await signIn(h, await seedUser(h, { role: 'privacy' }))
  support = await signIn(h, await seedUser(h, { role: 'support' }))
})
afterAll(async () => {
  await h.close()
})

const publicCollection = async () => (await h.api.get('/api/public-config').set(SITE)).body.collection as { waitlistEnabled: boolean }

describe('interruptor do formulário do site', () => {
  it('só o papel admin vê e muda; justificativa obrigatória', async () => {
    const view = await call(admin, 'get', '/collection')
    expect(view.status).toBe(200)
    expect(view.body).toEqual({
      waitlistForm: { open: true, paused: false, lockedByEnvironment: false, reasons: [], changedAt: null, changedBy: null },
    })
    for (const c of [privacy, support]) {
      expect((await call(c, 'get', '/collection')).status).toBe(403)
      expect((await call(c, 'put', '/collection/waitlist-form', { paused: true, reason: 'ataque de robôs' })).status).toBe(403)
    }
    const short = await call(admin, 'put', '/collection/waitlist-form', { paused: true, reason: 'x' })
    expect(short.status).toBe(400)
    expect(short.body.error.fields.reason).toBeTruthy()
  })

  it('pausado: o site recusa (503) e a configuração pública avisa; a Bia continua; reabrir volta ao normal', async () => {
    const paused = await call(admin, 'put', '/collection/waitlist-form', { paused: true, reason: 'pico de cadastros suspeitos' })
    expect(paused.status).toBe(200)
    const name = (await h.ctx.db.query<{ display_name: string }>('SELECT display_name FROM admin_users WHERE id = $1', [admin.user.id])).rows[0]!.display_name
    expect(paused.body.waitlistForm).toMatchObject({ open: false, paused: true, changedBy: name })
    expect(paused.body.waitlistForm.changedAt).toBe(h.clock.current.toISOString())
    const audit = (await auditRows(h, 'admin.waitlist_form_paused')).at(-1)!
    expect(audit).toMatchObject({ actor_id: admin.user.id, resource_id: 'waitlist_form_paused', metadata: { reason: 'pico de cadastros suspeitos' } })

    expect((await publicCollection()).waitlistEnabled).toBe(false)
    const person = newPerson()
    const refused = await submitSite(h, person)
    expect(refused.status).toBe(503)
    expect(refused.body.error.code).toBe('collection_unavailable')
    expect(await leadIdByPhone(h, person.phone.e164)).toBeUndefined()
    // A Bia (telefone atestado) não depende do formulário do site.
    expect(await registerByBia(h)).toBeTruthy()

    const reopened = await call(admin, 'put', '/collection/waitlist-form', { paused: false, reason: 'ataque contido' })
    expect(reopened.body.waitlistForm).toMatchObject({ open: true, paused: false })
    expect(await auditRows(h, 'admin.waitlist_form_resumed')).toHaveLength(1)
    expect((await publicCollection()).waitlistEnabled).toBe(true)
    expect((await submitSite(h, person)).status).toBe(201)
  })

  it('WAITLIST_FORM_ENABLED=false fecha o formulário e o painel não reabre', async () => {
    const locked = await createTestHarness({ ...HALAI_ENV, WAITLIST_FORM_ENABLED: 'false' })
    try {
      const boss = await signIn(locked, await seedUser(locked, { role: 'admin' }))
      expect((await locked.api.get('/api/public-config').set(SITE)).body.collection.waitlistEnabled).toBe(false)
      const res = await submitSite(locked, newPerson())
      expect(res.status).toBe(503)
      const view = await call(boss, 'put', '/collection/waitlist-form', { paused: false, reason: 'tentando reabrir' })
      expect(view.body.waitlistForm).toMatchObject({ open: false, paused: false, lockedByEnvironment: true })
      expect((await submitSite(locked, newPerson())).status).toBe(503)
      expect(await registerByBia(locked)).toBeTruthy()
    } finally {
      await locked.close()
    }
  })
})

describe('revisão das submissões guardadas', () => {
  const leadRow = async (id: string) =>
    (await h.ctx.db.query<Record<string, any>>('SELECT * FROM leads WHERE id = $1', [id])).rows[0]!
  const submissionRow = async (id: string) =>
    (await h.ctx.db.query<Record<string, any>>('SELECT * FROM lead_submissions WHERE id = $1', [id])).rows[0]!

  async function pendingOf(leadId: string) {
    const detail = await call(privacy, 'get', `/leads/${leadId}`)
    expect(detail.status).toBe(200)
    return detail.body.pendingSubmissions as Array<{ id: string; reason: string; applicable: boolean }>
  }

  async function held(person: Person, overrides: Record<string, unknown> = {}) {
    expect((await submitSite(h, person, undefined, overrides)).status).toBe(201)
  }

  it('aplicar: atualiza só os dados cadastrais (sem telefone e sem preferências), audita e apaga o conteúdo guardado', async () => {
    const person = newPerson()
    const leadId = await registerSite(h, person)
    await held(person, {
      fullName: 'Ana Paula Souza Lima',
      employerName: 'Supermercado Novo',
      incomeRange: '4000_a_7000',
      consents: { launch_notice: true, marketing: true },
    })
    const [submission] = await pendingOf(leadId)
    expect(submission).toMatchObject({ reason: 'existing_phone_and_cpf', applicable: true })

    // Atendimento não revisa; justificativa é obrigatória.
    expect((await call(support, 'post', `/leads/${leadId}/submissions/${submission!.id}/apply`, { reason: 'pedido da titular' })).status).toBe(403)
    expect((await call(privacy, 'post', `/leads/${leadId}/submissions/${submission!.id}/apply`, { reason: 'ok' })).status).toBe(400)

    const res = await call(privacy, 'post', `/leads/${leadId}/submissions/${submission!.id}/apply`, { reason: 'titular confirmou pela Bia' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'applied', changed: ['fullName', 'employerName', 'incomeRange'] })

    const lead = await leadRow(leadId)
    expect(lead).toMatchObject({ full_name: 'Ana Paula Souza Lima', income_range: '4000_a_7000', dedup_key: dedupFor(h, person.phone.e164) })
    expect(decryptLeadField(lead as never, 'employer', h.ctx.config.secrets.encryption)).toBe('Supermercado Novo')
    // Preferências continuam como estavam (novidades recusadas no primeiro cadastro).
    const marketing = await h.ctx.db.query<{ granted: boolean }>(`SELECT granted FROM lead_preferences WHERE lead_id = $1 AND purpose = 'marketing'`, [leadId])
    expect(marketing.rows[0]!.granted).toBe(false)

    expect(await submissionRow(submission!.id)).toMatchObject({ status: 'applied', payload_ciphertext: '' })
    expect(await pendingOf(leadId)).toEqual([])
    const trail = await h.ctx.db.query<{ event_type: string; actor_type: string }>(
      `SELECT event_type, actor_type FROM lead_events WHERE lead_id = $1 AND event_type = 'profile_updated'`,
      [leadId],
    )
    expect(trail.rows).toEqual([{ event_type: 'profile_updated', actor_type: 'admin' }])
    const audit = (await auditRows(h, 'admin.lead_submission_applied')).at(-1)!
    expect(audit).toMatchObject({
      actor_id: privacy.user.id,
      resource_id: leadId,
      metadata: { submissionId: submission!.id, submissionReason: 'existing_phone_and_cpf', reason: 'titular confirmou pela Bia', fieldsChanged: ['fullName', 'employerName', 'incomeRange'] },
    })
    expect(JSON.stringify(audit.metadata)).not.toMatch(/Ana Paula|Supermercado/)

    const again = await call(privacy, 'post', `/leads/${leadId}/submissions/${submission!.id}/apply`, { reason: 'segunda tentativa' })
    expect(again.status).toBe(409)
    expect(again.body.error.code).toBe('submission_already_reviewed')
  })

  it('mesmo telefone com CPF novo: aplicar troca o CPF; CPF que passou a ser de outro cadastro → 409 cpf_in_use', async () => {
    const person = newPerson()
    const leadId = await registerSite(h, person)
    const corrected = newPerson().cpf
    await held({ phone: person.phone, cpf: corrected })
    const [fix] = await pendingOf(leadId)
    expect(fix).toMatchObject({ reason: 'existing_phone', applicable: true })
    const res = await call(privacy, 'post', `/leads/${leadId}/submissions/${fix!.id}/apply`, { reason: 'CPF digitado errado no primeiro envio' })
    expect(res.body.changed).toContain('cpf')
    expect((await leadRow(leadId)).cpf_key).toBe(cpfKeyFor(h, corrected.digits))

    const taken = newPerson().cpf
    await held({ phone: person.phone, cpf: taken })
    await registerSite(h, { phone: newPerson().phone, cpf: taken })
    const [late] = await pendingOf(leadId)
    const conflict = await call(privacy, 'post', `/leads/${leadId}/submissions/${late!.id}/apply`, { reason: 'tentativa de correção' })
    expect(conflict.status).toBe(409)
    expect(conflict.body.error.code).toBe('cpf_in_use')
    expect((await submissionRow(late!.id)).status).toBe('pending')
    expect((await leadRow(leadId)).cpf_key).toBe(cpfKeyFor(h, corrected.digits))
  })

  it('mesmo CPF com outro telefone: aplicar não troca o telefone do cadastro', async () => {
    const owner = newPerson()
    const leadId = await registerSite(h, owner)
    await held({ phone: newPerson().phone, cpf: owner.cpf }, { city: 'Campinas' })
    const [sub] = await pendingOf(leadId)
    expect(sub).toMatchObject({ reason: 'existing_cpf', applicable: true })
    const res = await call(privacy, 'post', `/leads/${leadId}/submissions/${sub!.id}/apply`, { reason: 'titular confirmou a mudança de cidade' })
    expect(res.body).toEqual({ status: 'applied', changed: ['city'] })
    expect(await leadRow(leadId)).toMatchObject({ city: 'Campinas', dedup_key: dedupFor(h, owner.phone.e164) })
  })

  it('CPF de outro cadastro (cpf_conflict): não se aplica, só se descarta (auditado, conteúdo apagado)', async () => {
    const a = newPerson()
    const b = newPerson()
    const leadA = await registerSite(h, a)
    await registerSite(h, b)
    await held({ phone: a.phone, cpf: b.cpf })
    const [sub] = await pendingOf(leadA)
    expect(sub).toMatchObject({ reason: 'cpf_conflict', applicable: false })
    const refused = await call(privacy, 'post', `/leads/${leadA}/submissions/${sub!.id}/apply`, { reason: 'tentativa de aplicar' })
    expect(refused.status).toBe(409)
    expect(refused.body.error.code).toBe('submission_not_applicable')

    const discarded = await call(privacy, 'post', `/leads/${leadA}/submissions/${sub!.id}/discard`, { reason: 'CPF de outra pessoa' })
    expect(discarded.status).toBe(200)
    expect(discarded.body).toEqual({ status: 'discarded', changed: [] })
    expect(await submissionRow(sub!.id)).toMatchObject({ status: 'discarded', payload_ciphertext: '' })
    expect((await auditRows(h, 'admin.lead_submission_discarded')).at(-1)).toMatchObject({
      actor_id: privacy.user.id,
      metadata: { submissionReason: 'cpf_conflict', reason: 'CPF de outra pessoa', fieldsChanged: [] },
    })
  })

  it('submissão de outro cadastro ou identificador inválido → 404', async () => {
    const a = newPerson()
    const leadA = await registerSite(h, a)
    await held(a, { city: 'Santos' })
    const [sub] = await pendingOf(leadA)
    const other = await registerSite(h)
    expect((await call(privacy, 'post', `/leads/${other}/submissions/${sub!.id}/discard`, { reason: 'cadastro errado' })).status).toBe(404)
    expect((await call(privacy, 'post', `/leads/${leadA}/submissions/nao-e-uuid/discard`, { reason: 'identificador ruim' })).status).toBe(404)
  })
})
