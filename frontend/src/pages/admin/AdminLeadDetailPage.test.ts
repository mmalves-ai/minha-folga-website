// @vitest-environment jsdom
/**
 * Riscos concretos da revisão de submissões no detalhe do cadastro (privacy:manage): aplicar ou descartar sem
 * justificativa, o erro do servidor (ex.: 409 cpf_in_use) sumir ou fechar a ação, a confirmação não ser
 * anunciada nem dizer o que mudou, o foco se perder quando o item sai da lista, e perfis sem a permissão verem
 * os botões. As chamadas vão para um servidor simulado no `fetch`.
 */
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createHead } from '@unhead/vue/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import type { AdminLeadDetail, AdminLeadSubmission, AdminPermission } from '@/components/admin/types'
import { ANNOUNCER_ID } from '@/composables/useAnnouncer'
import { __resetAdminSessionForTests, refreshSession } from '@/composables/useAdminSession'
import AdminLeadDetailPage from './AdminLeadDetailPage.vue'

type Handler = (init: RequestInit) => Response | Promise<Response>

const calls: { key: string; init: RequestInit }[] = []
const handlers = new Map<string, Handler[]>()

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** Respostas em fila para "MÉTODO /caminho" (a última se repete). */
function on(key: string, ...queue: Handler[]) {
  handlers.set(key, queue)
}

const DATA = {
  fullName: 'Ana Souza Lima',
  phoneHint: '(11) *****-9876',
  cpfHint: '***.456.789-**',
  emailHint: 'a***@exemplo.com',
  employerName: 'Loja Central',
  employmentType: 'clt',
  jobTenure: '1_a_3_anos',
  incomeRange: '2000_a_4000',
  city: 'Campinas',
  uf: 'SP',
  interestTopic: null,
}

const SUB_CPF: AdminLeadSubmission = {
  id: 'sub-cpf',
  channel: 'site',
  source: 'avise-me',
  reason: 'existing_cpf',
  createdAt: '2026-09-24T10:00:00Z',
  applicable: true,
  data: DATA,
}

const SUB_CONFLICT: AdminLeadSubmission = {
  id: 'sub-conflito',
  channel: 'site',
  source: 'avise-me',
  reason: 'cpf_conflict',
  createdAt: '2026-09-23T10:00:00Z',
  applicable: false,
  data: { ...DATA, cpfHint: '***.111.222-**' },
}

function lead(pendingSubmissions: AdminLeadSubmission[]): AdminLeadDetail {
  return {
    id: 'lead-1',
    fullName: 'Ana Souza',
    phoneHint: '(11) *****-1234',
    cpfHint: '***.456.789-**',
    emailHint: null,
    employerName: 'Loja A',
    employmentType: 'clt',
    jobTenure: '1_a_3_anos',
    incomeRange: '2000_a_4000',
    city: 'São Paulo',
    uf: 'SP',
    interestTopic: null,
    state: 'received',
    source: 'avise-me',
    utmSource: null,
    utmCampaign: null,
    contactVerifiedAt: null,
    createdAt: '2026-09-20T12:00:00Z',
    purposes: { launch_notice: true, marketing: false },
    anonymized: false,
    pendingSubmissions,
    events: [],
  }
}

const LEAD_PATH = 'GET /api/admin/leads/lead-1'
const APPLY_PATH = 'POST /api/admin/leads/lead-1/submissions/sub-cpf/apply'
const DISCARD_PATH = 'POST /api/admin/leads/lead-1/submissions/sub-conflito/discard'

async function signIn(permissions: AdminPermission[]) {
  on('GET /api/admin/auth/me', () =>
    json(200, {
      status: 'authenticated',
      user: { id: 'u1', email: 'p@b.c', displayName: 'Paula', role: 'privacy', mfaEnabled: true, mustChangePassword: false, disabled: false, lastLoginAt: null, createdAt: '2026-09-01T00:00:00Z' },
      permissions,
      csrfToken: 'csrf-1',
    }),
  )
  await refreshSession()
}

let wrapper: VueWrapper | null = null

async function mountPage() {
  const Stub = defineComponent({ render: () => h('div') })
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/admin/leads', name: 'admin-leads', component: Stub },
      { path: '/admin/leads/:id', name: 'admin-lead', component: AdminLeadDetailPage },
      { path: '/admin/privacidade', name: 'admin-privacidade', component: Stub },
    ],
  })
  await router.push('/admin/leads/lead-1')
  await router.isReady()
  wrapper = mount(AdminLeadDetailPage, { attachTo: document.body, global: { plugins: [router, createHead()] } })
  await flushPromises()
  return wrapper
}

const items = () => [...document.querySelectorAll<HTMLElement>('.lead-detail__subs > li')]
const itemOf = (text: string) => items().find((li) => li.textContent?.includes(text))!
const buttonIn = (el: ParentNode, text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(text)) as HTMLButtonElement | undefined
const bodyOf = (key: string) => JSON.parse(String(calls.find((c) => c.key === key)?.init.body ?? 'null'))
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function type(textarea: HTMLTextAreaElement, value: string) {
  textarea.value = value
  textarea.dispatchEvent(new Event('input'))
  await flushPromises()
}

async function submitForm(el: ParentNode) {
  el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
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
      const handler = queue.length > 1 ? queue.shift()! : queue[0]!
      return handler(init)
    }),
  )
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('submissões em revisão: aplicar e descartar', () => {
  it('aplicar exige justificativa, envia o POST, anuncia os campos alterados, recarrega e leva o foco ao título', async () => {
    await signIn(['leads:read', 'privacy:manage'])
    on(LEAD_PATH, () => json(200, lead([SUB_CPF, SUB_CONFLICT])), () => json(200, lead([SUB_CONFLICT])))
    let release: (r: Response) => void = () => undefined
    on(APPLY_PATH, () => new Promise<Response>((resolve) => (release = resolve)))
    await mountPage()

    const item = itemOf('CPF já cadastrado')
    // Mesmo CPF com outro telefone: alerta antes de aplicar.
    expect(item.textContent).toContain('O telefone desta submissão é diferente do cadastrado e não é validado; confirme com a pessoa antes de aplicar.')
    expect(document.body.textContent).toContain('O telefone e as preferências de comunicação nunca mudam por aqui')

    buttonIn(item, 'Aplicar ao cadastro')!.click()
    await flushPromises()
    const textarea = item.querySelector('textarea')!
    expect(document.activeElement).toBe(textarea)
    expect(item.querySelector('label')?.textContent).toBe('Justificativa')

    // Sem justificativa: erro no campo e nada é enviado.
    await submitForm(item)
    expect(item.querySelector('.field__error')?.textContent).toContain('pelo menos 5 caracteres')
    expect(calls.some((c) => c.key === APPLY_PATH)).toBe(false)

    await type(textarea, 'Pessoa confirmou os dados por e-mail')
    await submitForm(item)
    expect(bodyOf(APPLY_PATH)).toEqual({ reason: 'Pessoa confirmou os dados por e-mail' })
    expect((calls.find((c) => c.key === APPLY_PATH)!.init.headers as Record<string, string>)['X-CSRF-Token']).toBe('csrf-1')
    // Durante o envio os botões ficam indisponíveis (aria-disabled: o foco não cai no <body>).
    const confirm = buttonIn(item, 'Aplicando')!
    expect(confirm.getAttribute('aria-disabled')).toBe('true')
    expect(buttonIn(item, 'Cancelar')!.getAttribute('aria-disabled')).toBe('true')
    expect(buttonIn(itemOf('CPF de outro cadastro'), 'Descartar')!.getAttribute('aria-disabled')).toBe('true')

    confirm.focus()
    release(json(200, { status: 'applied', changed: ['fullName', 'cpf'] }))
    await flushPromises()
    expect(calls.filter((c) => c.key === LEAD_PATH)).toHaveLength(2)
    expect(items()).toHaveLength(1)
    expect(document.body.textContent).not.toContain('CPF já cadastrado')
    const message = 'Submissão aplicada ao cadastro. Campos alterados: Nome completo e CPF.'
    expect(document.querySelector('.lead-detail__review-feedback')?.textContent).toContain(message)
    expect(document.activeElement?.id).toBe('submissoes-titulo')
    await wait(200)
    expect(document.getElementById(ANNOUNCER_ID)?.textContent).toBe(message)
  })

  it('submissão não aplicável só tem "Descartar"; cancelar devolve o foco ao botão; descartar envia a justificativa', async () => {
    await signIn(['leads:read', 'privacy:manage'])
    on(LEAD_PATH, () => json(200, lead([SUB_CONFLICT])), () => json(200, lead([])))
    on(DISCARD_PATH, () => json(200, { status: 'discarded' }))
    await mountPage()

    const item = itemOf('CPF de outro cadastro')
    expect(buttonIn(item, 'Aplicar ao cadastro')).toBeUndefined()
    expect(item.textContent).toContain('O CPF enviado pertence a outro cadastro')

    buttonIn(item, 'Descartar')!.click()
    await flushPromises()
    expect(document.activeElement?.tagName).toBe('TEXTAREA')
    buttonIn(item, 'Cancelar')!.click()
    await flushPromises()
    expect(item.querySelector('textarea')).toBeNull()
    expect(document.activeElement).toBe(buttonIn(item, 'Descartar'))

    buttonIn(item, 'Descartar')!.click()
    await flushPromises()
    await type(item.querySelector('textarea')!, 'Envio duplicado de teste interno')
    await submitForm(item)
    expect(bodyOf(DISCARD_PATH)).toEqual({ reason: 'Envio duplicado de teste interno' })
    expect(items()).toHaveLength(0)
    expect(document.querySelector('.lead-detail__review-feedback')?.textContent).toContain('Submissão descartada. O cadastro não mudou.')
    expect(document.activeElement?.id).toBe('submissoes-titulo')
  })

  it('409 cpf_in_use: a mensagem do servidor aparece junto da ação e o formulário continua aberto', async () => {
    await signIn(['leads:read', 'privacy:manage'])
    on(LEAD_PATH, () => json(200, lead([SUB_CPF])))
    on(
      APPLY_PATH,
      () => json(400, { error: { code: 'validation_error', message: 'Confira os campos.', fields: { reason: 'Descreva o motivo em 5 a 200 caracteres.' } } }),
      () => json(409, { error: { code: 'cpf_in_use', message: 'Este CPF já pertence a outro cadastro.' } }),
    )
    await mountPage()

    const item = itemOf('CPF já cadastrado')
    buttonIn(item, 'Aplicar ao cadastro')!.click()
    await flushPromises()
    const textarea = item.querySelector('textarea')!
    await type(textarea, 'Motivo ok')

    // Erro de validação do servidor para a justificativa: no campo, que recebe o foco.
    await submitForm(item)
    expect(item.querySelector('.field__error')?.textContent).toContain('Descreva o motivo em 5 a 200 caracteres.')
    expect(textarea.getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(textarea)

    await submitForm(item)
    const alert = item.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('Este CPF já pertence a outro cadastro.')
    expect(item.querySelector('textarea')).not.toBeNull()
    expect(buttonIn(item, 'Confirmar aplicação')!.getAttribute('aria-disabled')).toBeNull()
    // Nada foi aplicado: o detalhe não é recarregado e a submissão continua na lista.
    expect(calls.filter((c) => c.key === LEAD_PATH)).toHaveLength(1)
    expect(items()).toHaveLength(1)
  })

  it('409 submission_already_reviewed: avisa na seção e recarrega a lista', async () => {
    await signIn(['leads:read', 'privacy:manage'])
    on(LEAD_PATH, () => json(200, lead([SUB_CPF])), () => json(200, lead([])))
    on(APPLY_PATH, () => json(409, { error: { code: 'submission_already_reviewed', message: 'Esta submissão já foi revisada.' } }))
    await mountPage()

    const item = itemOf('CPF já cadastrado')
    buttonIn(item, 'Aplicar ao cadastro')!.click()
    await flushPromises()
    await type(item.querySelector('textarea')!, 'Pessoa confirmou os dados')
    await submitForm(item)
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Esta submissão já foi revisada.')
    expect(items()).toHaveLength(0)
    expect(document.activeElement?.id).toBe('submissoes-titulo')
  })

  it('sem privacy:manage: a lista continua visível, só para leitura, sem botões de aplicar ou descartar', async () => {
    await signIn(['leads:read'])
    on(LEAD_PATH, () => json(200, lead([SUB_CPF, SUB_CONFLICT])))
    await mountPage()

    expect(items()).toHaveLength(2)
    expect(document.body.textContent).toContain('CPF já cadastrado')
    for (const text of ['Aplicar ao cadastro', 'Descartar']) expect(buttonIn(document.body, text)).toBeUndefined()
    expect(document.querySelector('.lead-detail__subs textarea, .lead-detail__subs form')).toBeNull()
    expect(document.body.textContent).toContain('Seu perfil só consulta as submissões.')
  })
})
