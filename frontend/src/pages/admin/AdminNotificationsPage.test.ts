// @vitest-environment jsdom
/** Envio externo: autorização, revisão explícita, CSRF e idempotência. Grants e cancelamento mantêm escopo nominal. */
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createHead } from '@unhead/vue/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminPermission, AdminRole } from '@/components/admin/types'
import type { AdminNotifications, NotificationCampaign } from '@/components/admin/notifications'
import { __resetAdminSessionForTests, refreshSession } from '@/composables/useAdminSession'
import AdminNotificationsPage from './AdminNotificationsPage.vue'

type Handler = (init: RequestInit) => Response | Promise<Response>
const calls: { key: string; init: RequestInit }[] = []
const handlers = new Map<string, Handler[]>()
const GET = 'GET /api/admin/notifications'
const POST = 'POST /api/admin/notifications/campaigns'
const GRANTS = 'GET /api/admin/notifications/grants'
const USER = '00000000-0000-4000-8000-000000000001'
const OTHER = '00000000-0000-4000-8000-000000000002'
const CAMPAIGN = '00000000-0000-4000-8000-000000000010'
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const on = (key: string, ...queue: Handler[]) => handlers.set(key, queue)
const data = (overrides: Partial<AdminNotifications> = {}): AdminNotifications => ({ enabled: true, subscribers: 3, dailyCampaignCap: 3, destinations: ['/', '/lancamento'], campaigns: [], ...overrides })
const campaign = (overrides: Partial<NotificationCampaign> = {}): NotificationCampaign => ({ id: CAMPAIGN, title: 'Uma novidade', body: 'Veja os próximos passos.', url: '/lancamento', audienceCount: 3, createdBy: USER, createdAt: '2026-09-26T12:00:00Z', cancelled: false, delivery: { pending: 2, sending: 0, accepted: 1, failed: 0, expired: 0, cancelled: 0 }, ...overrides })
const grantUsers = [
  { id: USER, displayName: 'Marina', role: 'admin', disabled: false, allowed: true, grantedAt: null },
  { id: OTHER, displayName: 'Joana', role: 'marketing', disabled: false, allowed: false, grantedAt: null },
]
let wrapper: VueWrapper | null = null

async function signIn(permissions: AdminPermission[], role: AdminRole = 'marketing') {
  on('GET /api/admin/auth/me', () => json(200, { status: 'authenticated', user: { id: USER, email: 'a@b.c', displayName: 'Marina', role, mfaEnabled: true, mustChangePassword: false, disabled: false, lastLoginAt: null, createdAt: '2026-09-01T00:00:00Z' }, permissions, csrfToken: 'csrf-notifications' }))
  await refreshSession()
}
async function mountPage() {
  wrapper = mount(AdminNotificationsPage, { attachTo: document.body, global: { plugins: [createHead()] } })
  await flushPromises(); return wrapper
}
function button(text: string, root: ParentNode = document): HTMLButtonElement {
  const found = [...root.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') ?? b.textContent?.trim() ?? '').startsWith(text))
  if (!found) throw new Error(`Botão não encontrado: ${text}`)
  return found
}
const openDialog = () => document.querySelector('dialog[open]') as HTMLDialogElement
async function fill() {
  await wrapper!.get('#notification-title').setValue('Estamos chegando')
  await wrapper!.get('#notification-body').setValue('Conheça os próximos passos da Minha Folga.')
  await wrapper!.get('#notification-url').setValue('/lancamento')
}
async function review() { button('Revisar envio').click(); await flushPromises() }
async function confirm() {
  const checkbox = openDialog().querySelector('input[type="checkbox"]') as HTMLInputElement
  checkbox.checked = true; checkbox.dispatchEvent(new Event('change', { bubbles: true })); await flushPromises()
}
async function reason(value: string) {
  const dialog = openDialog(); const textarea = dialog.querySelector('textarea')!
  textarea.value = value; textarea.dispatchEvent(new Event('input', { bubbles: true }))
  await flushPromises(); dialog.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })); await flushPromises()
}

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { if (!this.hasAttribute('open')) return; this.removeAttribute('open'); this.dispatchEvent(new Event('close')) }
  Element.prototype.getClientRects = function () { return (this.isConnected ? [{}] : []) as unknown as DOMRectList }
})
beforeEach(() => {
  __resetAdminSessionForTests(); calls.length = 0; handlers.clear()
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const key = `${init.method ?? 'GET'} ${url}`; calls.push({ key, init })
    const queue = handlers.get(key); if (!queue?.length) throw new Error(`Resposta não preparada: ${key}`)
    return (queue.length > 1 ? queue.shift()! : queue[0]!)(init)
  }))
})
afterEach(() => { wrapper?.unmount(); wrapper = null; document.body.innerHTML = ''; vi.unstubAllGlobals() })

describe('notificações administrativas', () => {
  it('sem autorização não consulta público, histórico nem permissões e não oferece envio', async () => {
    await signIn(['metrics:read']); await mountPage()
    expect(document.body.textContent).toContain('Seu perfil não tem acesso')
    expect(calls.filter(call => [GET, GRANTS, POST].includes(call.key))).toHaveLength(0)
    expect(document.querySelector('#notification-title')).toBeNull()
  })

  it('sender não consulta grants; reconsulta o público e só enfileira após prévia e confirmação, com CSRF', async () => {
    await signIn(['notifications:send'])
    on(GET, () => json(200, data({ subscribers: 2 })), () => json(200, data()))
    on(POST, () => json(202, { status: 'queued', campaignId: CAMPAIGN, audienceCount: 3 }))
    await mountPage(); await review()
    expect(document.querySelector('#notification-title-error')).not.toBeNull()
    expect(calls.some(call => call.key === POST)).toBe(false)
    await fill(); await review()
    expect(openDialog().textContent).toContain('3 aparelhos')
    expect(openDialog().textContent).toContain('Estamos chegando')
    button('Confirmar envio', openDialog()).click(); await flushPromises()
    expect(calls.some(call => call.key === POST)).toBe(false)
    await confirm(); button('Confirmar envio', openDialog()).click(); await flushPromises()
    const post = calls.find(call => call.key === POST)!
    expect(JSON.parse(String(post.init.body))).toMatchObject({ title: 'Estamos chegando', body: 'Conheça os próximos passos da Minha Folga.', url: '/lancamento', confirm: true })
    expect(JSON.parse(String(post.init.body)).requestKey).toMatch(/^[0-9a-f-]{36}$/i)
    expect((post.init.headers as Record<string,string>)['X-CSRF-Token']).toBe('csrf-notifications')
    expect(document.body.textContent).toContain('Campanha colocada na fila para 3 aparelhos')
    expect(document.body.textContent).toContain('Não confirma exibição no aparelho nem leitura')
    expect(calls.some(call => call.key === GRANTS)).toBe(false)
  })

  it('falha de rede mantém a chave idempotente mesmo ao fechar e reabrir a mesma mensagem', async () => {
    await signIn(['notifications:send']); on(GET, () => json(200, data()))
    on(POST, () => { throw new TypeError('rede indisponível') }, () => json(202, { status: 'queued', campaignId: CAMPAIGN, audienceCount: 3 }))
    await mountPage(); await fill(); await review(); await confirm()
    button('Confirmar envio', openDialog()).click(); await flushPromises()
    expect(openDialog().querySelector('[role="alert"]')).not.toBeNull()
    button('Voltar à edição', openDialog()).click(); await flushPromises(); await review(); await confirm()
    button('Confirmar envio', openDialog()).click(); await flushPromises()
    const attempts = calls.filter(call => call.key === POST).map(call => JSON.parse(String(call.init.body)))
    expect(attempts).toHaveLength(2); expect(attempts[1]).toEqual(attempts[0])
  })

  it('não envia para um destino fora da lista permitida', async () => {
    await signIn(['notifications:send']); on(GET, () => json(200, data())); await mountPage(); await fill()
    const select = document.getElementById('notification-url') as HTMLSelectElement
    const option = document.createElement('option'); option.value = 'https://outro.example/'; select.append(option)
    select.value = option.value; select.dispatchEvent(new Event('change', { bubbles: true })); await flushPromises(); await review()
    expect(document.querySelector('#notification-url-error')?.textContent).toContain('páginas permitidas')
    expect(calls.some(call => call.key === POST)).toBe(false)
  })

  it('envio desativado preserva histórico e cancelamento, que exige confirmação', async () => {
    await signIn(['notifications:send']); on(GET, () => json(200, data({ enabled: false, campaigns: [campaign()] })), () => json(200, data({ enabled: false, campaigns: [campaign({ cancelled: true })] })))
    const cancel = `POST /api/admin/notifications/campaigns/${CAMPAIGN}/cancel`
    on(cancel, () => json(200, { status: 'cancelled' }))
    await mountPage(); expect(document.body.textContent).toContain('Envio desativado')
    expect((document.getElementById('notification-title') as HTMLInputElement).matches(':disabled')).toBe(true)
    button('Revisar envio').click(); await flushPromises(); expect(calls.some(call => call.key === POST)).toBe(false)
    button('Cancelar pendentes').click(); await flushPromises(); expect(calls.some(call => call.key === cancel)).toBe(false)
    button('Confirmar cancelamento', openDialog()).click(); await flushPromises()
    expect(calls.some(call => call.key === cancel)).toBe(true)
    expect(document.body.textContent).toContain('Campanha cancelada')
  })

  it('sender não recebe controle para cancelar campanha de outra pessoa', async () => {
    await signIn(['notifications:send']); on(GET, () => json(200, data({ campaigns: [campaign({ createdBy: OTHER })] })))
    await mountPage()
    expect(document.querySelector('.notifications-campaigns')?.textContent).not.toContain('Cancelar pendentes')
  })

  it('admin concede acesso nominal com justificativa; papel Administração não é revogável nessa lista', async () => {
    await signIn(['notifications:send','notifications:manage'], 'admin')
    on(GET, () => json(200, data({ enabled: false })))
    on(GRANTS, () => json(200, { users: grantUsers }), () => json(200, { users: grantUsers.map(user => user.id === OTHER ? { ...user, allowed: true } : user) }))
    const put = `PUT /api/admin/notifications/grants/${OTHER}`; on(put, () => json(200, { status: 'updated' }))
    await mountPage(); expect(document.body.textContent).toContain('Pelo papel Administração')
    expect([...document.querySelectorAll('.notifications-grants button')]).toHaveLength(1)
    button('Autorizar Joana').click(); await flushPromises(); await reason('abc')
    expect(calls.some(call => call.key === put)).toBe(false)
    await reason('Responsável pelos avisos de abertura')
    const request = calls.find(call => call.key === put)!
    expect(JSON.parse(String(request.init.body))).toEqual({ enabled: true, reason: 'Responsável pelos avisos de abertura' })
    expect((request.init.headers as Record<string,string>)['X-CSRF-Token']).toBe('csrf-notifications')
    expect(document.body.textContent).toContain('autorizado para Joana')
    expect(button('Revogar Joana')).toBeDefined()
    expect(document.activeElement?.id).toBe('notifications-permissions')
  })
})
