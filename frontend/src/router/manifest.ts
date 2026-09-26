/**
 * Manifesto de rotas (dados puros, sem Vue): usado pelo roteador, pela pré-renderização,
 * pelo sitemap e pela configuração do servidor web. Toda rota pública listada aqui é
 * pré-renderizada com HTML, conteúdo e metadados próprios.
 */
export interface RouteEntry {
  path: string
  /** Aparece no sitemap e pode ser indexada. */
  indexable: boolean
  /** Gera HTML no build. Rotas administrativas internas usam o fallback de /admin. */
  prerender: boolean
}

export const ROUTES: RouteEntry[] = [
  { path: '/', indexable: true, prerender: true },
  { path: '/sobre', indexable: true, prerender: true },
  { path: '/solucoes', indexable: true, prerender: true },
  { path: '/consignado-privado', indexable: true, prerender: true },
  { path: '/como-funciona', indexable: true, prerender: true },
  { path: '/bia', indexable: true, prerender: true },
  { path: '/conteudos', indexable: true, prerender: true },
  { path: '/ajuda', indexable: true, prerender: true },
  { path: '/atendimento', indexable: true, prerender: true },
  { path: '/seguranca', indexable: true, prerender: true },
  { path: '/avise-me', indexable: true, prerender: true },
  { path: '/lancamento', indexable: true, prerender: true },
  { path: '/privacidade', indexable: true, prerender: true },
  { path: '/termos', indexable: true, prerender: true },
  { path: '/cookies', indexable: true, prerender: true },
  // Relacionamento e operação: fora do sitemap e com noindex.
  { path: '/cadastro-confirmado', indexable: false, prerender: true },
  { path: '/preferencias', indexable: false, prerender: true },
  { path: '/atendimento/acompanhar', indexable: false, prerender: true },
  { path: '/admin', indexable: false, prerender: true },
  { path: '/404', indexable: false, prerender: true },
]

export const ARTICLE_BASE = '/conteudos'

/** Prefixos com fallback de aplicação no servidor web (rotas interativas conhecidas). */
export const APP_FALLBACK_PREFIXES = ['/admin/']
