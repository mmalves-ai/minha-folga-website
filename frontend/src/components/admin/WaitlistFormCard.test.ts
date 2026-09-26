// @vitest-environment jsdom
/**
 * Riscos concretos do interruptor do formulário de cadastro do site (collection:manage): aparecer ou consultar a
 * API para quem não tem a permissão, pausar ou reabrir sem justificativa, oferecer "Reabrir" quando o servidor
 * fechou o formulário (WAITLIST_FORM_ENABLED=false, o painel não reabre) e a mudança não ser anunciada.
 */
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminPermission, WaitlistFormSwitch } from './types'
import { ANNOUNCER_ID } from '@/composables/useAnnouncer'
import { __resetAdminSessionForTests, refreshSession } from '@/composables/useAdminSession'
import WaitlistFormCard from './WaitlistFormCard.vue'

const calls: { key: string; init: RequestInit }[] = []
const handlers = new Map<string, ((init: RequestInit) => Response)[]>()

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function on(key: string, ...queue: ((init: RequestInit) => Response)[]) {
  handlers.set(key, queue)
}

const OPEN: WaitlistFormSwitch = { open: true, paused: false, lockedByEnvironment: false, reasons: [], changedAt: null, changedBy: null }
const PAUSED: WaitlistFormSwitch = {
  open: false,
  paused: true,
  lockedByEnvironment: false,
  reasons: [],
  changedAt: '2026-09-26T13:00:00Z',
  changedBy: 'Marina (admin)',
}

const GET = 'GET /api/admin/collection'
const PUT = 'PUT /api/admin/collection/waitlist-form'

async function signIn(permissions: AdminPermission[]) {
  on('GET /api/admin/auth/me', () =>
    json(200, {
      status: 'authenticated',
      user: { id: 'u1', email: 'a@b.c', displayName: 'Marina', role: 'admin', mfaEnabled: true, mustChangePassword: false, disabled: false, lastLoginAt: null, createdAt: '2026-09-01T00:00:00Z' },
      permissions,
      csrfToken: 'csrf-1',
    }),
  )
  await refreshSession()
}

let wrapper: VueWrapper | null = null
async function mountCard() {
  wrapper = mount(WaitlistFormCard, { attachTo: document.body })
  await flushPromises()
  return wrapper
}

const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(text)) as HTMLButtonElement | undefined
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function justify(value: string) {
  const textarea = document.querySelector('textarea')!
  textarea.value = value
  textarea.dispatchEvent(new Event('input'))
  await flushPromises()
  document.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
  await flushPromises()
}

beforeEach(() => {
  __resetAdminSessionForTests()
  calls.length = 0
  handlers.clear()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const key = `${init.method ?? 'GET'} ${url}`
      calls.push({ key, init })
      const queue = handlers.get(key)
      if (!queue?.length) throw new Error(`sem resposta simulada para ${key}`)
      return (queue.length > 1 ? queue.shift()! : queue[0]!)(init)
    }),
  )
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('formulário de cadastro do site (painel)', () => {
  it('sem collection:manage: nada aparece e a API não é consultada', async () => {
    await signIn(['metrics:read', 'leads:read', 'privacy:manage'])
    await mountCard()
    expect(document.querySelector('.wf-card')).toBeNull()
    expect(calls.some((c) => c.key === GET)).toBe(false)
  })

  it('aberto: "Pausar formulário" exige justificativa e confirmação, envia PUT paused=true e anuncia o novo estado', async () => {
    await signIn(['metrics:read', 'collection:manage'])
    on(GET, () => json(200, { waitlistForm: OPEN }))
    on(PUT, () => json(200, { waitlistForm: { ...PAUSED, changedBy: 'Marina' } }))
    await mountCard()

    expect(document.querySelector('.admin-status')?.textContent).toContain('Aberto')
    expect(document.body.textContent).toContain('Nenhuma mudança registrada pelo painel.')
    expect(document.body.textContent).toContain('Use em caso de ataque de robôs ou volume anormal.')
    expect(button('Reabrir formulário')).toBeUndefined()

    button('Pausar formulário')!.click()
    await flushPromises()
    expect(document.activeElement?.tagName).toBe('TEXTAREA')
    // Sem justificativa suficiente, nada é enviado.
    await justify('abc')
    expect(document.querySelector('.field__error')?.textContent).toContain('pelo menos 5 caracteres')
    expect(calls.some((c) => c.key === PUT)).toBe(false)

    await justify('Pico de cadastros de robôs')
    const put = calls.find((c) => c.key === PUT)!
    expect(JSON.parse(String(put.init.body))).toEqual({ paused: true, reason: 'Pico de cadastros de robôs' })
    expect((put.init.headers as Record<string, string>)['X-CSRF-Token']).toBe('csrf-1')

    expect(document.querySelector('.admin-status')?.textContent).toContain('Pausado pelo painel')
    expect(document.body.textContent).toContain('por Marina')
    expect(document.querySelector('textarea')).toBeNull()
    expect(button('Reabrir formulário')).toBeDefined()
    expect(document.activeElement?.id).toBe('formulario-site-titulo')
    const message = 'Formulário de cadastro pausado. O site passa a mostrar a mensagem de cadastro indisponível em até 30 segundos.'
    expect(document.querySelector('.wf-card__feedback')?.textContent).toContain(message)
    await wait(200)
    expect(document.getElementById(ANNOUNCER_ID)?.textContent).toBe(message)
  })

  it('pausado pelo painel: "Reabrir formulário" envia paused=false; cancelar devolve o foco ao botão', async () => {
    await signIn(['collection:manage'])
    on(GET, () => json(200, { waitlistForm: PAUSED }))
    on(PUT, () => json(200, { waitlistForm: { ...OPEN, changedAt: '2026-09-26T14:00:00Z', changedBy: 'Marina' } }))
    await mountCard()

    expect(document.body.textContent).toContain('por Marina (admin)')
    button('Reabrir formulário')!.click()
    await flushPromises()
    button('Cancelar')!.click()
    await flushPromises()
    expect(document.querySelector('textarea')).toBeNull()
    expect(document.activeElement).toBe(button('Reabrir formulário'))

    button('Reabrir formulário')!.click()
    await flushPromises()
    await justify('Ataque contido pela equipe')
    expect(JSON.parse(String(calls.find((c) => c.key === PUT)!.init.body))).toEqual({ paused: false, reason: 'Ataque contido pela equipe' })
    expect(document.querySelector('.admin-status')?.textContent).toContain('Aberto')
    expect(button('Pausar formulário')).toBeDefined()
  })

  it('fechado pelo servidor (lockedByEnvironment): explica o motivo e não oferece "Reabrir"', async () => {
    await signIn(['collection:manage'])
    on(GET, () => json(200, { waitlistForm: { ...PAUSED, lockedByEnvironment: true } }), () => json(200, { waitlistForm: { ...OPEN, open: false, lockedByEnvironment: true } }))
    await mountCard()

    expect(document.querySelector('.admin-status')?.textContent).toContain('Fechado pela configuração do servidor')
    expect(document.body.textContent).toContain('WAITLIST_FORM_ENABLED=false')
    expect(document.body.textContent).toContain('o painel não consegue reabri-lo')
    expect(button('Reabrir formulário')).toBeUndefined()
    expect(document.body.textContent).toContain('Reabrir não é possível pelo painel')

    // Sem pausa do painel, continua sem "Reabrir" (pausar ainda é possível, para valer quando o servidor reabrir).
    wrapper!.unmount()
    wrapper = null
    await mountCard()
    expect(document.querySelector('.admin-status')?.textContent).toContain('Fechado pela configuração do servidor')
    expect(button('Reabrir formulário')).toBeUndefined()
  })

  it('motivos de configuração (identity_incomplete) aparecem por extenso', async () => {
    await signIn(['collection:manage'])
    on(GET, () => json(200, { waitlistForm: { ...OPEN, open: false, reasons: ['identity_incomplete', 'motivo_novo'] } }))
    await mountCard()
    const reasons = [...document.querySelectorAll('.wf-card__reasons li')].map((li) => li.textContent?.trim())
    expect(reasons).toEqual(['Dados da empresa incompletos na configuração do servidor (exigidos pelo Aviso de Privacidade).', 'motivo_novo'])
  })
})
