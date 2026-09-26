// @vitest-environment jsdom
/**
 * Riscos concretos da medição (seções 9 e 10): nada sai sem ANALYTICS_ENABLED E consentimento salvo,
 * escolha de outra versão da política não vale, o corpo enviado nunca leva nada além de nome e de uma
 * dimensão da lista do tipo do evento (contracts/validation.json → events), nunca texto digitado, falhas de
 * rede não quebram a página e a lista de eventos não diverge do contrato.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'
// Texto bruto do contrato (sufixo ?raw do Vite): sem APIs do Node, compatível com os tipos do app.
import openapiSource from '@contracts/openapi.yaml?raw'
import validation from '@contracts/validation.json'

const cfg = vi.hoisted(() => ({
  analyticsEnabled: false,
  notices: { cookies: { version: '1.0', status: 'draft', draftedAt: '2026-09-25', revisedAt: null, reviewedBy: null } },
}))
vi.mock('@/services/site', async () => ({ publicConfig: cfg, site: (await import('@content/site.yaml')).default }))

const { COOKIE_CHOICE_KEY, loadCookieChoice, parseCookieChoice, saveCookieChoice } = await import(
  '@/composables/useCookieChoice'
)
const { EVENT_DIMENSIONS, PRODUCT_EVENTS, buildEvent, pageDimension, registerDimensionValues, track } = await import('./analytics')
registerDimensionValues('article_slug', ['o-que-e-cet', 'parcela-menor-e-custo-total'])
registerDimensionValues('faq_category', ['sobre', 'dados'])

const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })))

function sent(): { url: string; init: RequestInit; body: unknown }[] {
  return fetchMock.mock.calls.map((call) => {
    const [url, init] = call as unknown as [string, RequestInit]
    return { url, init, body: JSON.parse(String(init.body)) }
  })
}

function storeChoice(value: unknown) {
  localStorage.setItem(COOKIE_CHOICE_KEY, typeof value === 'string' ? value : JSON.stringify(value))
  loadCookieChoice(true)
}

beforeEach(() => {
  cfg.analyticsEnabled = true
  localStorage.clear()
  loadCookieChoice(true)
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('condições de envio', () => {
  it('não envia sem ANALYTICS_ENABLED, mesmo com consentimento salvo antes', () => {
    storeChoice({ version: '1.0', measurement: true, savedAt: '2026-09-25' })
    cfg.analyticsEnabled = false
    loadCookieChoice(true)
    track('page_section_view', 'ajuda')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sem tecnologia opcional, nada é gravado no navegador', () => {
    cfg.analyticsEnabled = false
    expect(saveCookieChoice(true)).toBeNull()
    expect(localStorage.getItem(COOKIE_CHOICE_KEY)).toBeNull()
  })

  it('não envia enquanto a pessoa não escolheu', () => {
    track('page_section_view', 'ajuda')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('não envia depois da recusa', () => {
    saveCookieChoice(false)
    track('help_search')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('escolha de outra versão da política ou malformada vale como "sem escolha"', () => {
    storeChoice({ version: '0.9', measurement: true, savedAt: '2026-01-10' })
    track('page_section_view', 'ajuda')
    storeChoice('{"version":"1.0","measurement":"true"}')
    track('page_section_view', 'ajuda')
    storeChoice('não é json')
    track('page_section_view', 'ajuda')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(parseCookieChoice(JSON.stringify({ version: '1.0', measurement: true, savedAt: 'x' }))).toEqual({
      version: '1.0',
      measurement: true,
      savedAt: '',
    })
  })

  it('com consentimento, envia só nome e dimensão, sem cookies', () => {
    const saved = saveCookieChoice(true)
    expect(JSON.parse(localStorage.getItem(COOKIE_CHOICE_KEY) ?? 'null')).toEqual(saved)
    track('article_read', 'o-que-e-cet')
    const [call] = sent()
    expect(call?.url).toBe('/api/events')
    expect(call?.init.method).toBe('POST')
    expect(call?.init.credentials).toBe('omit')
    expect(call?.body).toEqual({ name: 'article_read', dimension: 'o-que-e-cet' })
  })
})

describe('conteúdo do evento', () => {
  it.each(['waitlist_cta_click', 'waitlist_error', 'waitlist_confirmed'] as const)(
    '%s exige configuração e consentimento, aceita só origem fixa e nunca dados do formulário',
    (name) => {
      cfg.analyticsEnabled = false
      track(name, 'avise-me')
      expect(fetchMock).not.toHaveBeenCalled()
      cfg.analyticsEnabled = true
      track(name, 'avise-me')
      expect(fetchMock).not.toHaveBeenCalled()
      saveCookieChoice(true)
      track(name, 'avise-me')
      expect(sent().map((entry) => entry.body)).toEqual([{ name, dimension: 'avise-me' }])
      for (const dimension of ['11987654321', '52998224725', 'cpf', 'ana@exemplo.com', 'Nome inválido', undefined]) {
        expect(buildEvent(name, dimension)).toBeNull()
      }
    },
  )

  it('clique duplo no CTA conta uma vez; outro clique após 1 segundo pode ser contado', () => {
    saveCookieChoice(true)
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    try {
      track('waitlist_cta_click', 'home')
      clock.mockReturnValue(now + 300)
      track('waitlist_cta_click', 'home')
      expect(fetchMock).toHaveBeenCalledTimes(1)
      clock.mockReturnValue(now + 1_100)
      track('waitlist_cta_click', 'home')
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      clock.mockRestore()
    }
  })

  it('texto digitado, maiúsculas ou números longos nunca viram dimensão: o evento não sai', () => {
    expect(buildEvent('help_search', 'Como cancelar')).toBeNull()
    expect(buildEvent('help_search', 'cancelar')).toBeNull()
    expect(buildEvent('help_search', '11912345678')).toBeNull()
    expect(buildEvent('page_section_view', 'x'.repeat(65))).toBeNull()
    expect(buildEvent('article_read', 'Maria')).toBeNull()
  })

  it('visita: só caminho de rota pública do manifesto ou de artigo publicado', () => {
    expect(buildEvent('page_section_view', '/')).toEqual({ name: 'page_section_view', dimension: '/' })
    expect(buildEvent('page_section_view', '/ajuda')).toEqual({ name: 'page_section_view', dimension: '/ajuda' })
    expect(buildEvent('page_section_view', '/conteudos/o-que-e-cet')).toEqual({
      name: 'page_section_view',
      dimension: '/conteudos/o-que-e-cet',
    })
    for (const bad of ['/conteudos/nao-existe', '/preferencias', '/admin', '/404', 'ajuda', '/ajuda?utm_source=x', undefined]) {
      expect(buildEvent('page_section_view', bad)).toBeNull()
    }
    expect(pageDimension('/ajuda?busca=cpf#tema-dados')).toBe('/ajuda')
    expect(pageDimension('/sobre/')).toBe('/sobre')
    expect(pageDimension('/cadastro-confirmado')).toBeUndefined()
  })

  it('cada evento aceita só a lista do seu tipo de dimensão', () => {
    expect(buildEvent('article_read', 'o-que-e-cet')).toEqual({ name: 'article_read', dimension: 'o-que-e-cet' })
    expect(buildEvent('article_read', 'nao-existe')).toBeNull()
    expect(buildEvent('help_search')).toEqual({ name: 'help_search' })
    expect(buildEvent('help_search_empty', 'dados')).toEqual({ name: 'help_search_empty', dimension: 'dados' })
    expect(buildEvent('waitlist_start', 'avise-me')).toEqual({ name: 'waitlist_start', dimension: 'avise-me' })
    expect(buildEvent('waitlist_start', 'instagram')).toBeNull()
    expect(buildEvent('waitlist_start')).toBeNull()
    expect(buildEvent('bia_demo_tab', 'cet')).toEqual({ name: 'bia_demo_tab', dimension: 'cet' })
    expect(buildEvent('bia_demo_tab', 'outro')).toBeNull()
    expect(buildEvent('bia_channel_click', '/bia')).toEqual({ name: 'bia_channel_click', dimension: '/bia' })
    // Sem dimensão no contrato: qualquer valor é descartado.
    expect(buildEvent('support_form_start', 'privacidade')).toEqual({ name: 'support_form_start' })
  })

  it('não envia nome fora do contrato', () => {
    saveCookieChoice(true)
    track('pageview' as never)
    expect(buildEvent('lead_created')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('falha de rede é silenciosa', async () => {
    saveCookieChoice(true)
    fetchMock.mockImplementationOnce(() => Promise.reject(new TypeError('offline')))
    expect(() => track('waitlist_start', 'home')).not.toThrow()
    await Promise.resolve()
    fetchMock.mockImplementationOnce(() => {
      throw new Error('bloqueado')
    })
    expect(() => track('waitlist_start', 'home')).not.toThrow()
  })

  it('a lista de eventos é a mesma do contrato (openapi e validation.json), cada um com tipo de dimensão conhecido', () => {
    const doc = parse(openapiSource) as {
      components: { schemas: { ProductEvent: { properties: { name: { enum: string[] }; dimension: { pattern: string } } } } }
    }
    const props = doc.components.schemas.ProductEvent.properties
    expect([...PRODUCT_EVENTS].sort()).toEqual([...props.name.enum].sort())
    expect(Object.keys(EVENT_DIMENSIONS).sort()).toEqual([...PRODUCT_EVENTS].sort())
    const kinds = Object.keys(validation.events.dimensionKinds)
    for (const kind of Object.values(EVENT_DIMENSIONS)) expect(kinds).toContain(kind)
  })
})
