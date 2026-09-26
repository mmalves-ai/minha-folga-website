import validation from '@contracts/validation.json'
import { hasMeasurementConsent } from '@/composables/useCookieChoice'
import { ARTICLE_BASE, ROUTES } from '@/router/manifest'
import { publicConfig, site } from '@/services/site'

/**
 * Medição agregada própria (seção 10 do briefing), via POST /api/events.
 *
 * Só envia quando as DUAS condições valem: ANALYTICS_ENABLED no backend (publicConfig.analyticsEnabled)
 * e consentimento de medição salvo pelo visitante. O evento tem apenas um nome do contrato e, conforme o
 * tipo de dimensão do evento (contracts/validation.json → events), um valor de uma lista conhecida: rota
 * pública, artigo publicado, tema da ajuda, página do cadastro ou exemplo da Bia. Nunca texto digitado,
 * dado pessoal, identificador, cookie ou parâmetro de URL. Falhas são silenciosas: a medição nunca
 * atrapalha a navegação.
 */
export type ProductEventName =
  | 'page_section_view'
  | 'article_read'
  | 'help_search'
  | 'help_search_empty'
  | 'waitlist_start'
  | 'waitlist_cta_click'
  | 'waitlist_error'
  | 'waitlist_confirmed'
  | 'bia_demo_tab'
  | 'bia_channel_click'
  | 'support_form_start'

/** Tipos de dimensão do contrato (contracts/validation.json → events.dimensionKinds). */
export type DimensionKind = 'route' | 'article_slug' | 'faq_category' | 'waitlist_source' | 'bia_example_id' | 'none'

/** Tipo de dimensão de cada evento, lido do contrato (fonte única com o backend). */
export const EVENT_DIMENSIONS = validation.events.names as Record<ProductEventName, DimensionKind>

/** Lista do contrato (contracts/openapi.yaml → ProductEvent.name e contracts/validation.json → events.names). */
export const PRODUCT_EVENTS: readonly ProductEventName[] = [
  'page_section_view',
  'article_read',
  'help_search',
  'help_search_empty',
  'waitlist_start',
  'waitlist_cta_click',
  'waitlist_error',
  'waitlist_confirmed',
  'bia_demo_tab',
  'bia_channel_click',
  'support_form_start',
]

/** Padrão geral de valor (o caminho de rota, que começa com "/", é conferido pela lista de rotas). */
export const DIMENSION_PATTERN = /^[a-z0-9][a-z0-9_./-]{0,63}$/
// Como no backend: sequência longa de dígitos pode ser telefone, CPF ou protocolo e nunca vira dimensão.
const LONG_DIGITS = /\d{5,}/

/** Rotas públicas indexáveis do manifesto: as únicas que contam visita. */
const PUBLIC_ROUTES = new Set(ROUTES.filter((r) => r.indexable).map((r) => r.path))
const WAITLIST_SOURCES = new Set<string>(validation.waitlist.sources)
const BIA_EXAMPLES = new Set<string>((site.biaExamples as { id: string }[]).map((e) => e.id))

/**
 * Valores conhecidos só pelas páginas que carregam o conteúdo (artigos publicados, temas da ajuda).
 * Registrados pela própria página ao carregar seu módulo, para a medição não carregar o conteúdo inteiro.
 */
const registered: Record<'article_slug' | 'faq_category', Set<string>> = {
  article_slug: new Set(),
  faq_category: new Set(),
}

export function registerDimensionValues(kind: 'article_slug' | 'faq_category', values: readonly string[]): void {
  for (const v of values) if (DIMENSION_PATTERN.test(v) && !LONG_DIGITS.test(v)) registered[kind].add(v)
}

/** Caminho de rota pública (manifesto, indexável) ou de artigo publicado; qualquer outro é recusado. */
export function isPublicRoutePath(path: string): boolean {
  if (PUBLIC_ROUTES.has(path)) return true
  const prefix = `${ARTICLE_BASE}/`
  return path.startsWith(prefix) && registered.article_slug.has(path.slice(prefix.length))
}

function validDimension(kind: DimensionKind, value: string): boolean {
  if (kind === 'route') return value.length <= 64 && isPublicRoutePath(value)
  if (!DIMENSION_PATTERN.test(value) || LONG_DIGITS.test(value)) return false
  switch (kind) {
    case 'article_slug':
    case 'faq_category':
      return registered[kind].has(value)
    case 'waitlist_source':
      return WAITLIST_SOURCES.has(value)
    case 'bia_example_id':
      return BIA_EXAMPLES.has(value)
    default:
      return false
  }
}

const ENDPOINT = `${(import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')}/events`
const sentOnce = new Set<string>()
// Somente chaves da lista fixa de origens; cliques duplos no mesmo CTA contam uma vez.
const lastCtaClick = new Map<string, number>()
const CTA_DOUBLE_CLICK_MS = 1_000

export interface ProductEvent {
  name: ProductEventName
  dimension?: string
}

/**
 * Monta o corpo do evento conforme o contrato, ou null quando ele não pode ser enviado:
 * - nome fora do contrato;
 * - evento sem dimensão (`none`): qualquer valor é descartado;
 * - tema da ajuda (`faq_category`): vazio vale "todos os temas"; valor desconhecido recusa o evento;
 * - demais tipos: o valor é obrigatório e precisa estar na lista conhecida, senão o evento não sai.
 */
export function buildEvent(name: string, dimension?: string): ProductEvent | null {
  if (!(PRODUCT_EVENTS as readonly string[]).includes(name)) return null
  const kind = EVENT_DIMENSIONS[name as ProductEventName]
  if (!kind) return null
  const event: ProductEvent = { name: name as ProductEventName }
  const value = typeof dimension === 'string' ? dimension : ''
  if (kind === 'none') return event
  if (!value) return kind === 'faq_category' ? event : null
  if (!validDimension(kind, value)) return null
  event.dimension = value
  return event
}

/** Medição permitida agora (configuração + consentimento). */
export function measurementEnabled(): boolean {
  if (import.meta.env.SSR || typeof window === 'undefined') return false
  return publicConfig.analyticsEnabled && hasMeasurementConsent()
}

/**
 * Registra um evento agregado. `dimension` deve ser um valor fixo do código (caminho de rota pública,
 * slug publicado, id de tema, origem do cadastro ou id de exemplo), jamais o que a pessoa digitou.
 */
export function track(name: ProductEventName, dimension?: string): void {
  if (!measurementEnabled()) return
  const event = buildEvent(name, dimension)
  if (!event) return
  if (event.name === 'waitlist_cta_click') {
    const key = event.dimension!
    const now = Date.now()
    const previous = lastCtaClick.get(key)
    if (previous !== undefined && now >= previous && now - previous < CTA_DOUBLE_CLICK_MS) return
    lastCtaClick.set(key, now)
  }
  try {
    void fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
      // Sem cookies: o evento não se liga a nenhuma sessão.
      credentials: 'omit',
      cache: 'no-store',
      keepalive: true,
    }).catch(() => undefined)
  } catch {
    // Falha silenciosa.
  }
}

/** Como `track`, mas no máximo uma vez por carregamento de página para o mesmo par nome/dimensão. */
export function trackOnce(name: ProductEventName, dimension?: string): void {
  if (!measurementEnabled()) return
  const key = `${name}:${dimension ?? ''}`
  if (sentOnce.has(key)) return
  sentOnce.add(key)
  track(name, dimension)
}

/**
 * Dimensão da visita a uma página: o CAMINHO da rota pública (lista fixa do manifesto, ou artigo
 * publicado), sem query string nem fragmento. Rotas privadas, 404 e caminhos desconhecidos não contam.
 */
export function pageDimension(path: unknown): string | undefined {
  if (typeof path !== 'string') return undefined
  const clean = path.split(/[?#]/)[0]!.replace(/(.)\/$/, '$1') || '/'
  return isPublicRoutePath(clean) ? clean : undefined
}
