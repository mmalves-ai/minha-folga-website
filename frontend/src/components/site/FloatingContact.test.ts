// @vitest-environment jsdom
/**
 * Riscos concretos do botão flutuante (decisão D1): carregar o widget da Hal-AI antes do clique e do aviso
 * de tratamento, aparecer sem nenhum canal configurado, montar um link de WhatsApp com dado pessoal, e o
 * painel prender ou perder o foco. A medida em tela (360/390/1440 px, contraste e cobertura de CTAs) é
 * conferida com capturas do build de verificação.
 */
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { RouterView, createMemoryHistory, createRouter } from 'vue-router'
import { openContactPanel, resolveWebchat, WHATSAPP_CONTACT_TEXT, type WebchatConfig } from './channels'
import FloatingContact from './FloatingContact.vue'
import { resetWebchatLoader, WEBCHAT_SCRIPT_ID } from './webchat-loader'

const WIDGET: WebchatConfig = resolveWebchat({
  enabled: true,
  scriptUrl: 'https://webchat.exemplo-halai.test/widget.js',
  widgetId: 'mf-site',
})!
const WA = `https://wa.me/5511999999999?text=${encodeURIComponent(WHATSAPP_CONTACT_TEXT)}`

const Stub = defineComponent({ render: () => h('div') })

async function mountWith(props: Record<string, unknown>) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: Stub },
      { path: '/bia', component: Stub },
      { path: '/privacidade', component: Stub },
      { path: '/atendimento', component: Stub },
      { path: '/avise-me', component: Stub },
    ],
  })
  await router.push('/bia')
  await router.isReady()
  const app = document.createElement('div')
  app.id = 'app'
  document.body.appendChild(app)
  const wrapper = mount(FloatingContact, { props, attachTo: app, global: { plugins: [router] } })
  await flushPromises()
  return { wrapper, router }
}

const scripts = () => [...document.querySelectorAll('script')].filter((s) => s.src.includes('exemplo-halai'))

let wrapper: VueWrapper | null = null
beforeEach(() => resetWebchatLoader())
afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  resetWebchatLoader()
  document.body.innerHTML = ''
  document.documentElement.className = ''
})

describe('configuração do widget', () => {
  it('só aceita https absoluto, sem credenciais, com identificador simples', () => {
    expect(resolveWebchat({ enabled: false, scriptUrl: 'https://a.test/w.js', widgetId: 'x' })).toBeNull()
    expect(resolveWebchat({ enabled: true, scriptUrl: 'http://a.test/w.js', widgetId: 'x' })).toBeNull()
    expect(resolveWebchat({ enabled: true, scriptUrl: '//a.test/w.js', widgetId: 'x' })).toBeNull()
    expect(resolveWebchat({ enabled: true, scriptUrl: 'https://u:p@a.test/w.js', widgetId: 'x' })).toBeNull()
    expect(resolveWebchat({ enabled: true, scriptUrl: 'https://a.test/w.js', widgetId: '"><script>' })).toBeNull()
    expect(resolveWebchat({ enabled: true, scriptUrl: 'https://a.test/w.js', widgetId: null })).toBeNull()
    expect(resolveWebchat(undefined)).toBeNull()
    expect(resolveWebchat({ enabled: true, scriptUrl: 'https://a.test/w.js', widgetId: 'mf_site-1' })).toEqual({
      scriptUrl: 'https://a.test/w.js',
      widgetId: 'mf_site-1',
      origin: 'https://a.test',
    })
  })
})

describe('botão flutuante', () => {
  it('sem nenhum canal configurado, não renderiza nada', async () => {
    ;({ wrapper } = await mountWith({ webchatConfig: null, whatsappUrl: null }))
    expect(wrapper.find('.floating-contact').exists()).toBe(false)
    expect(document.documentElement.classList.contains('mf-floating-contact')).toBe(false)
  })

  it('tem nome acessível, estado de expansão e abre o painel com o chat primeiro e o WhatsApp por último', async () => {
    ;({ wrapper } = await mountWith({ webchatConfig: WIDGET, whatsappUrl: WA, whatsappIsBia: true }))
    const toggle = wrapper.get('.floating-contact__toggle')
    expect(toggle.attributes('aria-label')).toMatch(/^Conversar/)
    expect(toggle.attributes('aria-expanded')).toBe('false')
    await toggle.trigger('click')
    await nextTick()
    expect(toggle.attributes('aria-expanded')).toBe('true')
    const options = wrapper.findAll('.fc-option')
    expect(options.map((o) => o.find('.fc-option__label').text())).toEqual(['Conversar com a Bia no site', 'WhatsApp'])
    expect(document.activeElement?.id).toBe('contato-flutuante-titulo')
  })

  it('o WhatsApp é um link wa.me com texto genérico, em nova aba', async () => {
    ;({ wrapper } = await mountWith({ webchatConfig: null, whatsappUrl: WA }))
    await wrapper.get('.floating-contact__toggle').trigger('click')
    const link = wrapper.get('a.fc-option')
    expect(link.attributes('href')).toBe(WA)
    expect(decodeURIComponent(link.attributes('href')!.split('text=')[1]!)).toBe(WHATSAPP_CONTACT_TEXT)
    expect(link.attributes('target')).toBe('_blank')
    expect(link.attributes('rel')).toContain('noopener')
    expect(wrapper.find('button.fc-option').exists()).toBe(false)
  })

  it('o script do widget só é inserido depois do clique E da confirmação do aviso de tratamento', async () => {
    ;({ wrapper } = await mountWith({ webchatConfig: WIDGET, whatsappUrl: null }))
    expect(scripts()).toHaveLength(0)
    await wrapper.get('.floating-contact__toggle').trigger('click')
    await wrapper.get('button.fc-option').trigger('click')
    await nextTick()
    // Aviso de tratamento: quem opera e link para o Aviso de Privacidade; ainda sem script.
    expect(wrapper.text()).toContain('Hal-AI')
    expect(wrapper.find('a[href="/privacidade"]').exists()).toBe(true)
    expect(scripts()).toHaveLength(0)
    await wrapper.get('.floating-contact__actions .btn--primary').trigger('click')
    await flushPromises()
    const inserted = scripts()
    expect(inserted).toHaveLength(1)
    expect(inserted[0]!.id).toBe(WEBCHAT_SCRIPT_ID)
    expect(inserted[0]!.dataset.widgetId).toBe('mf-site')
    expect(inserted[0]!.async).toBe(true)
  })

  it('falha no carregamento mostra o texto da seção 7 e caminhos sem chat; nova tentativa insere um único script', async () => {
    ;({ wrapper } = await mountWith({ webchatConfig: WIDGET, whatsappUrl: WA, waitlistOpen: true }))
    await wrapper.get('.floating-contact__toggle').trigger('click')
    await wrapper.get('button.fc-option').trigger('click')
    await wrapper.get('.floating-contact__actions .btn--primary').trigger('click')
    await flushPromises()
    scripts()[0]!.dispatchEvent(new Event('error'))
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe('Não consegui conectar agora. Você pode deixar seu contato ou usar o atendimento.')
    expect(wrapper.find('.floating-contact__fallback a[href="/avise-me"]').exists()).toBe(true)
    expect(wrapper.find('.floating-contact__fallback a[href="/atendimento"]').exists()).toBe(true)
    expect(scripts()).toHaveLength(0)
    await wrapper.get('.webchat-loader__retry').trigger('click')
    await flushPromises()
    expect(scripts()).toHaveLength(1)
  })

  it('Esc fecha o painel e devolve o foco ao botão', async () => {
    ;({ wrapper } = await mountWith({ webchatConfig: WIDGET, whatsappUrl: WA }))
    const toggle = wrapper.get('.floating-contact__toggle')
    await toggle.trigger('click')
    await nextTick()
    await wrapper.get('.floating-contact').trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(toggle.element)
  })

  it('openContactPanel("webchat") abre direto no aviso de tratamento, sem carregar o widget', async () => {
    ;({ wrapper } = await mountWith({ webchatConfig: WIDGET, whatsappUrl: null }))
    openContactPanel('webchat')
    await flushPromises()
    expect(wrapper.get('.floating-contact__title').text()).toBe('Antes de abrir o chat')
    expect(scripts()).toHaveLength(0)
  })
})

/** IntersectionObserver simulado: o teste diz quando cada bloco entra ou sai da área visível. */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = []
  readonly targets = new Set<Element>()
  constructor(private readonly callback: IntersectionObserverCallback) {
    FakeIntersectionObserver.instances.push(this)
  }
  observe(el: Element) {
    this.targets.add(el)
  }
  unobserve(el: Element) {
    this.targets.delete(el)
  }
  disconnect() {
    this.targets.clear()
  }
  takeRecords() {
    return []
  }
  show(el: Element, visible: boolean) {
    this.callback([{ target: el, isIntersecting: visible } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
  }
}

describe('botão flutuante com os canais já na página', () => {
  const Plain = defineComponent({ render: () => h('div', [h('button', { id: 'fora' }, 'Outro botão')]) })
  // Como o cartão "Seu telefone ainda não está validado" (BiaChannelActions marca o próprio contêiner).
  const WithChannels = defineComponent({
    render: () => h('section', [h('div', { 'data-inline-contact': '', id: 'canais' }, [h('a', { href: WA }, 'Conversar no WhatsApp')])]),
  })

  async function mountPage(start = '/') {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: Plain },
        { path: '/cadastro-confirmado', component: WithChannels },
        { path: '/atendimento', component: Stub },
        { path: '/privacidade', component: Stub },
        { path: '/avise-me', component: Stub },
      ],
    })
    await router.push(start)
    await router.isReady()
    const app = document.createElement('div')
    app.id = 'app'
    document.body.appendChild(app)
    const Host = defineComponent({ render: () => [h(RouterView), h(FloatingContact, { webchatConfig: null, whatsappUrl: WA })] })
    const mounted = mount(Host, { attachTo: app, global: { plugins: [router] } })
    await flushPromises()
    return { wrapper: mounted, router }
  }

  const root = () => document.querySelector('.floating-contact') as HTMLElement
  const collapsed = () => root().classList.contains('is-collapsed')
  const io = () => FakeIntersectionObserver.instances.at(-1)!

  beforeEach(() => {
    FakeIntersectionObserver.instances = []
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('recolhe enquanto o bloco está na área visível, volta quando ele sai, e reobserva a cada navegação', async () => {
    const page = await mountPage('/')
    wrapper = page.wrapper
    const { router } = page
    expect(io().targets.size).toBe(0)
    expect(collapsed()).toBe(false)

    await router.push('/cadastro-confirmado')
    await flushPromises()
    const block = document.getElementById('canais')!
    expect([...io().targets]).toEqual([block])
    expect(collapsed()).toBe(false)

    io().show(block, true)
    await nextTick()
    expect(collapsed()).toBe(true)
    // O espaço reservado no fim do rodapé continua (o botão pode voltar a qualquer momento).
    expect(document.documentElement.classList.contains('mf-floating-contact')).toBe(true)

    io().show(block, false)
    await nextTick()
    expect(collapsed()).toBe(false)

    io().show(block, true)
    await nextTick()
    expect(collapsed()).toBe(true)
    // Página sem os canais: o bloco antigo deixa de ser observado e o botão volta.
    await router.push('/')
    await flushPromises()
    expect(io().targets.size).toBe(0)
    expect(collapsed()).toBe(false)
  })

  it('bloco que a página mostra depois de montar (ex.: resposta da API) também é observado', async () => {
    ;({ wrapper } = await mountPage('/'))
    const late = document.createElement('div')
    late.setAttribute('data-inline-contact', '')
    document.getElementById('app')!.appendChild(late)
    await flushPromises()
    expect(io().targets.has(late)).toBe(true)
    io().show(late, true)
    await nextTick()
    expect(collapsed()).toBe(true)
    late.remove()
    await flushPromises()
    expect(io().targets.has(late)).toBe(false)
    expect(collapsed()).toBe(false)
  })

  it('com o painel aberto não some de repente; recolhe só depois que o painel fecha e o foco sai do botão', async () => {
    ;({ wrapper } = await mountPage('/cadastro-confirmado'))
    const block = document.getElementById('canais')!
    expect(io().targets.has(block)).toBe(true)
    const toggle = document.querySelector('.floating-contact__toggle') as HTMLButtonElement
    toggle.focus()
    toggle.click()
    await flushPromises()
    expect(toggle.getAttribute('aria-expanded')).toBe('true')

    // O bloco entra na tela com o painel aberto: nada some.
    io().show(block, true)
    await nextTick()
    expect(collapsed()).toBe(false)

    // Esc fecha e devolve o foco ao botão: continua visível enquanto estiver com o foco.
    root().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(toggle)
    expect(collapsed()).toBe(false)

    // O foco vai para o conteúdo da página: agora recolhe.
    block.querySelector('a')!.focus()
    await nextTick()
    expect(collapsed()).toBe(true)
  })

  it('sem IntersectionObserver (pré-renderização, navegador antigo), o botão fica sempre visível', async () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    ;({ wrapper } = await mountPage('/cadastro-confirmado'))
    expect(root()).not.toBeNull()
    expect(collapsed()).toBe(false)
    expect(FakeIntersectionObserver.instances).toHaveLength(0)
  })
})
