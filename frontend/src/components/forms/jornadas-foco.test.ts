// @vitest-environment jsdom
/**
 * Riscos concretos das jornadas de relacionamento depois da decisão D1 (docs/DECISOES.md):
 * - robôs gerarem cadastro: todo envio leva a prova de trabalho (token + nonce válidos) e o
 *   campo-armadilha; prova recusada (`form_expired`) → novo token e UM reenvio, sem perder dados;
 * - sucesso falso: só com 201 a pessoa vai para /cadastro-confirmado (sem dados na URL);
 * - CPF inválido ou erro do servidor sem foco no campo certo;
 * - pedido de saída revelar se o número existe (resposta sempre genérica);
 * - o foco cair no <body> quando o botão acionado some (sair da lista) e confirmações sem anúncio;
 * - a medição de início de cadastro/atendimento enviar algo fora do contrato ou mais de uma vez.
 * O envio real da medição depende de configuração e consentimento (services/analytics.test.ts).
 */
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import copy from '@content/pages/formularios.yaml'
import prefsPage from '@content/pages/preferencias.yaml'
import consents from '@contracts/consents.json'
import { ApiError } from '@/services/api'
import { ANNOUNCER_ID } from '@/composables/useAnnouncer'
import { verifyProof } from '@/workers/pow'
import type { Preferences } from './api-types'

const trackOnce = vi.fn()
vi.mock('@/services/analytics', () => ({ trackOnce: (...args: unknown[]) => trackOnce(...args) }))

type ApiCall = { path: string; body?: any; method?: string }
const calls: ApiCall[] = []
let respond: (call: ApiCall) => Promise<unknown> = async () => ({})
let tokens = 0
const CHALLENGE = 'q7Xw3c2ZkPpV9mT1bY0aHg'
const BITS = 6
/** Desafio do GET /api/form-token (dificuldade baixa para o teste; sem tempo mínimo). */
function formToken() {
  tokens++
  return { token: `token-${tokens}`, challenge: CHALLENGE, difficultyBits: BITS, expiresInSeconds: 7200, minFillSeconds: 0 }
}

vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api')>()
  return {
    ...actual,
    api: (path: string, options: { body?: unknown; method?: string } = {}) => {
      const call = { path, body: options.body, method: options.method }
      calls.push(call)
      if (path === '/form-token') return Promise.resolve(formToken())
      return respond(call)
    },
  }
})
// Sem rede no teste: a checagem de coleta ao carregar não muda nada.
vi.mock('@/composables/useCollectionStatus', () => ({ fetchCollectionStatus: async () => null }))

const { default: WaitlistForm } = await import('./WaitlistForm.vue')
const { default: SupportForm } = await import('./SupportForm.vue')
const { default: OptOutForm } = await import('./OptOutForm.vue')
const { default: PreferencesManager } = await import('./PreferencesManager.vue')
const { buildEvent } = await vi.importActual<typeof import('@/services/analytics')>('@/services/analytics')

function makeRouter() {
  const Stub = defineComponent({ render: () => h('div') })
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: Stub },
      { path: '/cadastro-confirmado', component: Stub },
      { path: '/bia', component: Stub },
    ],
  })
}

let wrapper: VueWrapper | null = null
let router: Router
async function mountWith(component: Parameters<typeof mount>[0], props: Record<string, unknown> = {}) {
  router = makeRouter()
  await router.push('/')
  await router.isReady()
  wrapper = mount(component, { props, attachTo: document.body, global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** Espera o envio terminar (prova na página + folga do tempo mínimo de preenchimento). */
async function settle(w: VueWrapper, ms = 3000) {
  const start = Date.now()
  while (Date.now() - start < ms) {
    await flushPromises()
    const busy = w.find('button[type="submit"]').exists() && w.find('button[type="submit"]').attributes('aria-disabled') === 'true'
    if (!busy) return
    await sleep(25)
  }
}

beforeEach(() => {
  calls.length = 0
  tokens = 0
  trackOnce.mockClear()
  respond = async () => ({})
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

const VALID_CPF = '529.982.247-25'

async function fillWaitlist(w: VueWrapper, overrides: Partial<Record<string, string>> = {}) {
  const value = (k: string, v: string) => overrides[k] ?? v
  await w.find('input[name="fullName"]').setValue(value('fullName', 'Ana Maria Souza'))
  await w.find('input[name="cpf"]').setValue(value('cpf', VALID_CPF))
  await w.find('input[name="phone"]').setValue(value('phone', '11987654321'))
  await w.find('form.waitlist__form').trigger('submit')
  await flushPromises()
  await w.find('input[name="employerName"]').setValue(value('employerName', 'Padaria Estrela Ltda'))
  await w.find('select[name="employmentType"]').setValue(value('employmentType', 'clt'))
  await w.find('select[name="jobTenure"]').setValue(value('jobTenure', '1_a_3_anos'))
  await w.find('select[name="incomeRange"]').setValue(value('incomeRange', '2000_a_4000'))
  await w.find('input[name="city"]').setValue(value('city', 'Campinas'))
  await w.find('select[name="uf"]').setValue(value('uf', 'SP'))
  await w.find('input[name="ageConfirmed"]').setValue(true)
  await w.find('input[name="launch_notice"]').setValue(true)
}

const submissions = () => calls.filter((c) => c.path === '/waitlist')

describe('cadastro de aviso (D1): corpo, anti-robô e sucesso só com 201', () => {
  it('divide o cadastro em duas etapas sem gravar antes do envio e conserva dados ao voltar', async () => {
    const w = await mountWith(WaitlistForm, { source: 'avise-me' })
    expect(w.find('input[name="fullName"]').isVisible()).toBe(true)
    expect(w.find('input[name="employerName"]').isVisible()).toBe(false)
    await w.find('form.waitlist__form').trigger('submit')
    await flushPromises()
    expect(document.activeElement).toBe(w.find('input[name="fullName"]').element)
    expect(submissions()).toHaveLength(0)
    await fillWaitlist(w)
    expect(w.find('input[name="fullName"]').isVisible()).toBe(false)
    expect(w.find('input[name="employerName"]').isVisible()).toBe(true)
    expect(submissions()).toHaveLength(0)
    const back = w.findAll('button').find((button) => button.text() === copy.waitlist.steps.back)!
    await back.trigger('click')
    expect(document.activeElement).toBe(w.find('input[name="fullName"]').element)
    expect((w.find('input[name="cpf"]').element as HTMLInputElement).value).toBe(VALID_CPF)
    await w.find('form.waitlist__form').trigger('submit')
    expect((w.find('input[name="employerName"]').element as HTMLInputElement).value).toBe('Padaria Estrela Ltda')
    expect(submissions()).toHaveLength(0)
  })

  it('mantém enviando até a confirmação do backend e bloqueia duplo envio', async () => {
    let confirm: ((result: unknown) => void) | undefined
    respond = ({ path }) => path === '/waitlist' ? new Promise((resolve) => { confirm = resolve }) : Promise.resolve({})
    const w = await mountWith(WaitlistForm, { source: 'avise-me' })
    await fillWaitlist(w)
    const push = vi.spyOn(router, 'push')
    await w.find('form.waitlist__form').trigger('submit')
    for (let attempt = 0; !confirm && attempt < 100; attempt++) await sleep(20)
    expect(confirm).toBeDefined()
    expect(w.find('button[type="submit"]').text()).toContain(copy.common.submitting)
    expect(w.find('button[type="submit"]').attributes('aria-disabled')).toBe('true')
    expect(push).not.toHaveBeenCalled()
    await w.find('form.waitlist__form').trigger('submit')
    expect(submissions()).toHaveLength(1)
    expect(trackOnce.mock.calls.some(([name]) => name === 'waitlist_confirmed')).toBe(false)
    confirm!({ status: 'received', message: 'Recebemos.' })
    await settle(w)
    expect(push).toHaveBeenCalledTimes(1)
    expect(trackOnce.mock.calls.filter(([name]) => name === 'waitlist_confirmed')).toEqual([['waitlist_confirmed', 'avise-me']])
  })

  it.each([undefined, {}, { status: 'pending' }])('resposta fora do contrato (%j) não confirma cadastro', async (result) => {
    respond = async () => result
    const w = await mountWith(WaitlistForm, { source: 'avise-me' })
    await fillWaitlist(w)
    const push = vi.spyOn(router, 'push')
    await w.find('form.waitlist__form').trigger('submit')
    await settle(w)
    expect(push).not.toHaveBeenCalled()
    expect(w.find('[role="alert"]').text()).toContain('Não foi possível concluir')
    expect(trackOnce.mock.calls.filter(([name]) => name === 'waitlist_error')).toEqual([['waitlist_error', 'avise-me']])
    expect(trackOnce.mock.calls.some(([name]) => name === 'waitlist_confirmed')).toBe(false)
  })

  it('erro de conexão conserva os campos e permite novo envio confirmado pelo backend', async () => {
    respond = async () => { throw new ApiError(0, 'network_error', 'Não foi possível concluir. Tente novamente em instantes.') }
    const w = await mountWith(WaitlistForm, { source: 'avise-me' })
    await fillWaitlist(w)
    const push = vi.spyOn(router, 'push')
    await w.find('form.waitlist__form').trigger('submit')
    await settle(w)
    expect(push).not.toHaveBeenCalled()
    expect(w.find('[role="alert"]').isVisible()).toBe(true)
    expect(trackOnce.mock.calls.filter(([name]) => name === 'waitlist_error')).toEqual([['waitlist_error', 'avise-me']])
    expect(trackOnce.mock.calls.some(([name]) => name === 'waitlist_confirmed')).toBe(false)
    expect((w.find('input[name="cpf"]').element as HTMLInputElement).value).toBe(VALID_CPF)
    expect((w.find('input[name="employerName"]').element as HTMLInputElement).value).toBe('Padaria Estrela Ltda')
    respond = async () => ({ status: 'received', message: 'Recebemos.' })
    await w.find('form.waitlist__form').trigger('submit')
    await settle(w)
    expect(push).toHaveBeenCalledTimes(1)
    expect(submissions()).toHaveLength(2)
  })

  it('envia os campos do contrato com prova de trabalho válida e vai para /cadastro-confirmado sem dados na URL', async () => {
    respond = async ({ path }) => (path === '/waitlist' ? { status: 'received', message: 'Recebemos.' } : {})
    const w = await mountWith(WaitlistForm, { source: 'avise-me' })
    await w.find('input[name="fullName"]').trigger('focusin')
    await flushPromises()
    // A prova começa no primeiro foco, antes do envio.
    expect(calls.filter((c) => c.path === '/form-token')).toHaveLength(1)
    await fillWaitlist(w)
    await w.find('input[name="email"]').setValue('ana@exemplo.com.br')
    const push = vi.spyOn(router, 'push')
    await w.find('form.waitlist__form').trigger('submit')
    await settle(w)

    expect(submissions()).toHaveLength(1)
    const body = submissions()[0]!.body
    expect(body).toMatchObject({
      fullName: 'Ana Maria Souza',
      cpf: '52998224725',
      phone: '+5511987654321',
      email: 'ana@exemplo.com.br',
      employerName: 'Padaria Estrela Ltda',
      employmentType: 'clt',
      jobTenure: '1_a_3_anos',
      incomeRange: '2000_a_4000',
      city: 'Campinas',
      uf: 'SP',
      ageConfirmed: true,
      consents: { launch_notice: true, marketing: false },
      consentVersions: { launch_notice: consents.purposes.launch_notice.version, marketing: consents.purposes.marketing.version },
      source: 'avise-me',
      website: '',
    })
    expect(body.antiBot.token).toBe('token-1')
    expect(verifyProof(CHALLENGE, body.antiBot.nonce, BITS)).toBe(true)
    // Só chaves do contrato (corpo estrito no servidor).
    expect(Object.keys(body).sort()).toEqual(
      [
        'fullName', 'cpf', 'phone', 'email', 'employerName', 'employmentType', 'jobTenure', 'incomeRange', 'city', 'uf',
        'ageConfirmed', 'consents', 'consentVersions', 'source', 'antiBot', 'website',
      ].sort(),
    )
    expect(push).toHaveBeenCalledTimes(1)
    const target = push.mock.calls[0]![0] as { path: string; query?: unknown; state?: Record<string, unknown> }
    expect(target.path).toBe('/cadastro-confirmado')
    expect(target.query).toBeUndefined()
    expect(target.state).toEqual({ mfSignupReceived: true, mfEmploymentOther: false })
    expect(JSON.stringify(target)).not.toContain('529')
  })

  it('e-mail vazio e tema não respondido ficam fora do corpo', async () => {
    respond = async ({ path }) => (path === '/waitlist' ? { status: 'received', message: 'ok' } : {})
    const w = await mountWith(WaitlistForm, { source: 'home' })
    await fillWaitlist(w)
    await w.find('form.waitlist__form').trigger('submit')
    await settle(w)
    const body = submissions()[0]!.body
    expect('email' in body).toBe(false)
    expect('interestTopic' in body).toBe(false)
  })

  it('prova recusada (form_expired): pega outro token e reenvia UMA vez com os mesmos dados', async () => {
    let n = 0
    respond = async ({ path }) => {
      if (path !== '/waitlist') return {}
      if (n++ === 0) throw new ApiError(400, 'form_expired', 'Expirou.')
      return { status: 'received', message: 'ok' }
    }
    const w = await mountWith(WaitlistForm, { source: 'avise-me' })
    await fillWaitlist(w)
    const push = vi.spyOn(router, 'push')
    await w.find('form.waitlist__form').trigger('submit')
    await settle(w, 5000)
    const sent = submissions()
    expect(sent).toHaveLength(2)
    const { antiBot: first, ...rest1 } = sent[0]!.body
    const { antiBot: second, ...rest2 } = sent[1]!.body
    expect(rest2).toEqual(rest1)
    expect(second.token).not.toBe(first.token)
    expect(verifyProof(CHALLENGE, second.nonce, BITS)).toBe(true)
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ path: '/cadastro-confirmado' }))
  })

  it('duas recusas seguidas: para no segundo envio, mostra o aviso e mantém o que foi digitado', async () => {
    respond = async ({ path }) => {
      if (path === '/waitlist') throw new ApiError(400, 'form_expired', 'Expirou.')
      return {}
    }
    const w = await mountWith(WaitlistForm, { source: 'avise-me' })
    await fillWaitlist(w)
    const push = vi.spyOn(router, 'push')
    await w.find('form.waitlist__form').trigger('submit')
    await settle(w, 5000)
    expect(submissions()).toHaveLength(2)
    expect(push).not.toHaveBeenCalled()
    const alert = w.find('[role="alert"]')
    expect(alert.text()).toContain(copy.waitlist.formExpired)
    expect(document.activeElement).toBe(alert.element)
    expect((w.find('input[name="cpf"]').element as HTMLInputElement).value).toBe(VALID_CPF)
    expect((w.find('input[name="fullName"]').element as HTMLInputElement).value).toBe('Ana Maria Souza')
  })

  it('CPF com dígito verificador errado: nada é enviado e o foco vai para o CPF', async () => {
    const w = await mountWith(WaitlistForm, { source: 'avise-me' })
    await fillWaitlist(w, { cpf: '529.982.247-24' })
    await w.find('form.waitlist__form').trigger('submit')
    await flushPromises()
    expect(submissions()).toHaveLength(0)
    const cpf = w.find('input[name="cpf"]')
    expect(cpf.attributes('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(cpf.element)
    expect(w.text()).toContain(copy.waitlist.cpf.invalid)
    // O erro fica associado ao campo, junto da dica e do texto sobre o uso do CPF.
    const described = cpf.attributes('aria-describedby')!.split(' ')
    expect(described).toHaveLength(3)
    for (const id of described) expect(document.getElementById(id), id).not.toBeNull()
  })

  it('erro de campo do servidor (validation_error): destaca e foca o campo indicado', async () => {
    respond = async ({ path }) => {
      if (path === '/waitlist') throw new ApiError(400, 'validation_error', 'Confira.', { phone: 'Confira o DDD e o número.' })
      return {}
    }
    const w = await mountWith(WaitlistForm, { source: 'avise-me' })
    await fillWaitlist(w)
    await w.find('form.waitlist__form').trigger('submit')
    await settle(w)
    expect(submissions()).toHaveLength(1)
    const phone = w.find('input[name="phone"]')
    expect(phone.attributes('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(phone.element)
  })

  it('campo-armadilha fica fora da tela, escondido de leitores e fora da tabulação', async () => {
    const w = await mountWith(WaitlistForm, { source: 'avise-me' })
    const trap = w.find('input[name="website"]')
    expect(trap.attributes('tabindex')).toBe('-1')
    expect(trap.attributes('autocomplete')).toBe('off')
    expect(trap.element.closest('[aria-hidden="true"]')).not.toBeNull()
  })

  it('sem textos de confirmação por código e sem o aviso antigo sobre CPF', async () => {
    const w = await mountWith(WaitlistForm, { source: 'avise-me' })
    const text = w.text()
    expect(text).not.toMatch(/c[óo]digo/i)
    expect(text).not.toContain('Não envie CPF')
    expect(text).toContain(copy.waitlist.cpf.purpose)
    expect(text).toContain(consents.purposes.launch_notice.text)
    expect(text).toContain(consents.purposes.marketing.text)
  })
})

describe('pedido de saída das comunicações (sem link)', () => {
  it('resposta genérica, com prova de trabalho, e foco na confirmação', async () => {
    respond = async ({ path }) => (path === '/preferences/opt-out' ? { status: 'received' } : {})
    const w = await mountWith(OptOutForm)
    await w.find('input[name="phone"]').trigger('focusin')
    await w.find('input[name="phone"]').setValue('11987654321')
    await w.find('form').trigger('submit')
    await settle(w)
    const sent = calls.filter((c) => c.path === '/preferences/opt-out')
    expect(sent).toHaveLength(1)
    expect(Object.keys(sent[0]!.body).sort()).toEqual(['antiBot', 'phone'])
    expect(sent[0]!.body.phone).toBe('+5511987654321')
    expect(verifyProof(CHALLENGE, sent[0]!.body.antiBot.nonce, BITS)).toBe(true)
    expect((document.activeElement as HTMLElement).textContent).toContain(copy.optOut.done)
  })

  it('campo-armadilha preenchido: nada vai ao servidor e a tela é a mesma', async () => {
    const w = await mountWith(OptOutForm)
    await w.find('input[name="phone"]').setValue('11987654321')
    await w.find('input[name="website"]').setValue('http://spam.example')
    await w.find('form').trigger('submit')
    await settle(w)
    expect(calls.filter((c) => c.path === '/preferences/opt-out')).toHaveLength(0)
    expect(w.text()).toContain(copy.optOut.done)
  })
})

describe('medição de início (contrato de eventos)', () => {
  it('cadastro: waitlist_start com a origem, uma única vez, no primeiro foco ou interação', async () => {
    const w = await mountWith(WaitlistForm, { source: 'avise-me' })
    expect(trackOnce).not.toHaveBeenCalled()
    await w.find('input[name="fullName"]').trigger('focusin')
    await w.find('input[name="fullName"]').setValue('Ana Souza')
    await w.find('input[name="phone"]').trigger('focusin')
    expect(trackOnce.mock.calls).toEqual([['waitlist_start', 'avise-me']])
    // Nenhum texto digitado vai no evento, e a origem é uma dimensão aceita pelo contrato.
    expect(JSON.stringify(trackOnce.mock.calls)).not.toContain('Ana')
    expect(buildEvent('waitlist_start', 'avise-me')).toEqual({ name: 'waitlist_start', dimension: 'avise-me' })
  })

  it('atendimento: support_form_start sem dimensão, uma única vez', async () => {
    const w = await mountWith(SupportForm)
    const name = w.find('input[name="name"]')
    await name.trigger('focusin')
    await name.setValue('Carla')
    await w.find('textarea[name="message"]').trigger('focusin')
    expect(trackOnce.mock.calls).toEqual([['support_form_start']])
    expect(buildEvent('support_form_start')).toEqual({ name: 'support_form_start' })
  })
})

describe('preferências: foco e anúncio das confirmações', () => {
  const basePrefs: Preferences = {
    preferredName: 'Ana',
    nameHint: 'Ana M. S.',
    contactHint: '(11) •••••-••21',
    contactVerified: false,
    cpfHint: '***.***.***-25',
    emailHint: null,
    employmentType: 'clt',
    jobTenure: '1_a_3_anos',
    incomeRange: 'nao_informar',
    city: 'Campinas',
    uf: 'SP',
    interestTopic: null,
    state: 'received',
    contactVerifiedAt: null,
    purposes: { launch_notice: { granted: true }, marketing: { granted: false } },
  }

  const Host = defineComponent({
    setup() {
      const prefs = ref<Preferences>(basePrefs)
      return () => h(PreferencesManager, { prefs: prefs.value, onUpdated: (p: Preferences) => (prefs.value = p) })
    },
  })

  it('mostra só dados mascarados e o telefone como não validado', async () => {
    const w = await mountWith(Host)
    const text = w.text()
    expect(text).toContain('Olá, Ana.')
    expect(text).toContain('***.***.***-25')
    expect(text).toContain(prefsPage.manage.phoneNotVerified)
    expect(text).not.toMatch(/c[óo]digo/i)
  })

  it('sair da lista: o botão some e o foco vai para a confirmação (não para o <body>)', async () => {
    respond = async ({ path, method }) =>
      path === '/preferences' && method === 'PATCH' ? { ...basePrefs, purposes: { launch_notice: { granted: false }, marketing: { granted: false } } } : {}
    const w = await mountWith(Host)
    const leave = w.findAll('button').find((b) => b.text() === prefsPage.manage.leave.button)!
    ;(leave.element as HTMLButtonElement).focus()
    await leave.trigger('click')
    await flushPromises()
    expect(w.findAll('button').some((b) => b.text() === prefsPage.manage.leave.button)).toBe(false)
    const active = document.activeElement as HTMLElement
    expect(active).not.toBe(document.body)
    expect(active.textContent).toBe(prefsPage.manage.leave.done)
  })

  it('salvar: o foco fica no botão e a confirmação sai pela região viva persistente', async () => {
    respond = async ({ path, method }) =>
      path === '/preferences' && method === 'PATCH' ? { ...basePrefs, purposes: { launch_notice: { granted: true }, marketing: { granted: true } } } : {}
    const w = await mountWith(Host)
    const region = document.getElementById(ANNOUNCER_ID)
    expect(region, 'região criada ao montar, antes da ação').not.toBeNull()
    expect(region!.textContent).toBe('')
    await w.find('input[name="marketing"]').setValue(true)
    const form = w.findAll('form.prefs__card')[0]!
    const save = form.find('button[type="submit"]')
    ;(save.element as HTMLButtonElement).focus()
    await form.trigger('submit')
    await flushPromises()
    expect(document.activeElement).toBe(save.element)
    // O bloco visível não é uma região nova (seria lido em dobro ou não seria lido).
    expect(w.find('.prefs__message').attributes('role')).toBeUndefined()
    await sleep(250)
    expect(region!.textContent).toBe(prefsPage.manage.saved)
  })

  it('dados gerais: envia só o que mudou e nada que identifique', async () => {
    respond = async ({ path, method, body }) => (path === '/preferences' && method === 'PATCH' ? { ...basePrefs, ...body } : {})
    const w = await mountWith(Host)
    await w.find('select[name="incomeRange"]').setValue('4000_a_7000')
    await w.find('input[name="city"]').setValue('  Sumaré  ')
    const general = w.findAll('form.prefs__card')[1]!
    await general.trigger('submit')
    await flushPromises()
    const patches = calls.filter((c) => c.path === '/preferences' && c.method === 'PATCH')
    expect(patches).toHaveLength(1)
    expect(patches[0]!.body).toEqual({ incomeRange: '4000_a_7000', city: 'Sumaré' })
  })
})
