import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  head: vi.fn(),
  route: { path: '/consignado-privado', meta: {} as Record<string, unknown> },
  config: { environment: 'production', identity: { complete: false, legalName: null } },
}))
vi.mock('@unhead/vue', () => ({ useHead: state.head }))
vi.mock('vue-router', () => ({ useRoute: () => state.route }))
vi.mock('@/services/site', () => ({ publicConfig: state.config, SITE_URL: 'https://www.minhafolga.com.br' }))
import { useSeo, websiteJsonLd } from './useSeo'

const options = { title: 'Consignado privado', description: 'Entenda o consignado privado e acompanhe a abertura.' }
const head = () => state.head.mock.calls.at(-1)![0]
const meta = (key: string) => head().meta.find((entry: Record<string, string>) => entry.name === key || entry.property === key)?.content

beforeEach(() => {
  vi.stubEnv('VITE_SITE_INDEXABLE', '1')
  state.config.environment = 'production'
  state.route.meta = {}
  state.head.mockClear()
})
afterEach(() => vi.unstubAllEnvs())

describe('metadados de busca', () => {
  it('produção recebe canonical e imagem consistentes com Open Graph e Twitter', () => {
    useSeo(options)
    expect(head().title).toBe('Consignado privado | Minha Folga')
    expect(head().link).toEqual([{ rel: 'canonical', href: 'https://www.minhafolga.com.br/consignado-privado' }])
    expect(meta('og:url')).toBe(head().link[0].href)
    expect(meta('twitter:image')).toBe(meta('og:image'))
    expect(meta('robots')).toBe('index, follow, max-image-preview:large')
  })
  it('build de revisão com configuração de produção continua noindex', () => {
    vi.stubEnv('VITE_SITE_INDEXABLE', '0')
    useSeo(options)
    expect(meta('robots')).toContain('noindex')
  })
  it.each(['staging', 'development'])('%s permanece noindex', (environment) => {
    state.config.environment = environment
    useSeo(options)
    expect(meta('robots')).toContain('noindex')
  })
  it('rotas privadas e páginas inexistentes continuam noindex em produção', () => {
    state.route.meta.noindex = true
    useSeo(options)
    expect(meta('robots')).toContain('noindex')
    state.route.meta = {}
    useSeo({ ...options, noindex: true })
    expect(meta('robots')).toContain('noindex')
  })
  it('artigos usam a própria imagem em todas as prévias sociais', () => {
    useSeo({ ...options, type: 'article', image: { path: '/images/editorial/planning-1200.jpg', alt: 'Organização financeira', width: 1200, height: 800, type: 'image/jpeg' } })
    expect(meta('og:image')).toBe('https://www.minhafolga.com.br/images/editorial/planning-1200.jpg')
    expect(meta('og:image:height')).toBe('800')
    expect(meta('twitter:image:alt')).toBe('Organização financeira')
  })
  it('identifica o site sem inventar identidade empresarial', () => {
    expect(websiteJsonLd()).toMatchObject({ '@type': 'WebSite', name: 'Minha Folga', url: 'https://www.minhafolga.com.br/' })
    expect(websiteJsonLd()).not.toHaveProperty('publisher')
  })
})
