import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'yaml'
import { z } from 'zod'
import { VALIDATION } from '../config/contracts.js'
import { CONTENT_DIR, FRONTEND_DIR } from '../config/paths.js'
import type { AppContext } from '../context.js'
import { parseOrThrow } from '../middleware/validate.js'
import { incrementMetric } from './metrics.service.js'

/**
 * Eventos de produto agregados (seção 10): nomes transparentes, contagem diária por dimensão,
 * sem identificador, IP, texto digitado ou dado pessoal.
 *
 * Contrato: contracts/validation.json → events (nome do evento → tipo de dimensão), fonte única com o frontend.
 * Cada tipo tem uma LISTA FECHADA, montada na inicialização a partir dos arquivos do próprio release:
 * - route: caminhos indexáveis de frontend/src/router/manifest.ts (lidos por expressão regular, como faz
 *   frontend/scripts/postbuild.mjs) e /conteudos/<slug> de cada artigo publicado;
 * - article_slug: nomes de arquivo (sem .md) de frontend/content/articles;
 * - faq_category: ids de frontend/content/faq.yaml → categories, ou vazio (busca em todas);
 * - waitlist_source: contracts/validation.json → waitlist.sources;
 * - bia_example_id: ids de frontend/content/site.yaml → biaExamples;
 * - none: sem dimensão.
 * Dimensão fora da lista do evento é recusada (400) — assim nenhum texto vindo de fora vira linha de métrica,
 * e a quantidade de linhas por evento e por dia fica limitada ao tamanho da lista.
 */

export const DIMENSION_KINDS = ['route', 'article_slug', 'faq_category', 'waitlist_source', 'bia_example_id', 'none'] as const
export type DimensionKind = (typeof DIMENSION_KINDS)[number]

export interface ProductEventCatalog {
  names: [string, ...string[]]
  kindOf: Readonly<Record<string, DimensionKind>>
  /** Valores aceitos por tipo; '' (sem dimensão) só onde o contrato permite. */
  allowed: Readonly<Record<DimensionKind, ReadonlySet<string>>>
}

export interface CatalogSources {
  /** Raiz do frontend no release (src/router/manifest.ts e content/). */
  frontendDir: string
  contentDir: string
}

const DEFAULT_SOURCES: CatalogSources = { frontendDir: FRONTEND_DIR, contentDir: CONTENT_DIR }

/** Mesmo formato lido por frontend/scripts/postbuild.mjs: `{ path: '/x', indexable: true, prerender: … }`. */
const MANIFEST_ENTRY = /\{\s*path:\s*'([^']+)'\s*,\s*indexable:\s*(true|false)\b/g
const ARTICLE_BASE = /export const ARTICLE_BASE = '([^']+)'/

class CatalogError extends Error {
  constructor(message: string) {
    super(`eventos de produto: ${message}`)
    this.name = 'CatalogError'
  }
}

function readIds(file: string, key: string): string[] {
  const doc = parse(readFileSync(file, 'utf8')) as Record<string, unknown> | null
  const list = doc?.[key]
  if (!Array.isArray(list)) throw new CatalogError(`${file} sem a lista "${key}"`)
  const ids = list.map((item) => (item as { id?: unknown } | null)?.id).filter((id): id is string => typeof id === 'string' && id !== '')
  if (!ids.length) throw new CatalogError(`${file}: lista "${key}" sem ids`)
  return ids
}

export function loadProductEventCatalog(sources: CatalogSources = DEFAULT_SOURCES): ProductEventCatalog {
  const contract = VALIDATION.events as { names?: Record<string, unknown> } | undefined
  const entries = Object.entries(contract?.names ?? {})
  if (!entries.length) throw new CatalogError('contracts/validation.json sem events.names')
  const kindOf: Record<string, DimensionKind> = {}
  for (const [name, kind] of entries) {
    if (!(DIMENSION_KINDS as readonly unknown[]).includes(kind)) throw new CatalogError(`tipo de dimensão desconhecido para ${name}`)
    kindOf[name] = kind as DimensionKind
  }

  const manifestSrc = readFileSync(resolve(sources.frontendDir, 'src/router/manifest.ts'), 'utf8')
  const routes = [...manifestSrc.matchAll(MANIFEST_ENTRY)].filter((m) => m[2] === 'true').map((m) => m[1]!)
  if (!routes.length) throw new CatalogError('nenhuma rota indexável lida de src/router/manifest.ts')
  const articleBase = ARTICLE_BASE.exec(manifestSrc)?.[1] ?? '/conteudos'

  const articles = readdirSync(resolve(sources.contentDir, 'articles'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.slice(0, -'.md'.length))
  if (!articles.length) throw new CatalogError('nenhum artigo em content/articles')

  const allowed: Record<DimensionKind, ReadonlySet<string>> = {
    route: new Set([...routes, ...articles.map((slug) => `${articleBase}/${slug}`)]),
    article_slug: new Set(articles),
    faq_category: new Set(['', ...readIds(resolve(sources.contentDir, 'faq.yaml'), 'categories')]),
    waitlist_source: new Set(VALIDATION.waitlist.sources),
    bia_example_id: new Set(readIds(resolve(sources.contentDir, 'site.yaml'), 'biaExamples')),
    none: new Set(['']),
  }
  return { names: entries.map(([name]) => name) as [string, ...string[]], kindOf, allowed }
}

let cached: ProductEventCatalog | undefined
/** Catálogo do release em execução (lido uma vez). */
export function productEventCatalog(): ProductEventCatalog {
  cached ??= loadProductEventCatalog()
  return cached
}

export const EVENT_MESSAGES = {
  name: 'Evento desconhecido.',
  dimension: 'Dimensão fora da lista permitida para este evento.',
} as const

export function productEventSchema(catalog: ProductEventCatalog = productEventCatalog()) {
  return z
    .strictObject({
      name: z.enum(catalog.names),
      // Tamanho só como proteção barata; quem decide é a lista do evento.
      dimension: z.string().max(80).optional(),
    })
    .superRefine((event, issue) => {
      const kind = catalog.kindOf[event.name]!
      if (!catalog.allowed[kind].has(event.dimension ?? '')) {
        issue.addIssue({ code: 'custom', path: ['dimension'], message: EVENT_MESSAGES.dimension })
      }
    })
}

export type ProductEventSchema = ReturnType<typeof productEventSchema>
export type ProductEventInput = z.infer<ProductEventSchema>

/** Grava o evento como contador agregado. Retorna false quando a medição está desligada. */
export async function recordProductEvent(ctx: AppContext, body: unknown, schema: ProductEventSchema): Promise<boolean> {
  if (!ctx.config.analyticsEnabled) return false
  const event = parseOrThrow(schema, body, EVENT_MESSAGES)
  await incrementMetric(ctx.db, ctx.now(), `event:${event.name}`, event.dimension ?? '')
  return true
}
