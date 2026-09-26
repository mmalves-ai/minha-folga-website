import { useHead } from '@unhead/vue'
import { useRoute } from 'vue-router'
import { publicConfig, SITE_URL } from '@/services/site'

export interface SeoOptions {
  /** Título da página. Sem "Minha Folga", recebe o sufixo " | Minha Folga". */
  title: string
  description: string
  path?: string
  noindex?: boolean
  type?: 'website' | 'article'
  /** Dados estruturados verdadeiros (nunca Review, AggregateRating, preços ou licenças fictícias). */
  jsonLd?: Record<string, unknown>[]
  publishedTime?: string | null
  modifiedTime?: string | null
}

export const OG_IMAGE = '/brand/og-minha-folga.png'

export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path === '/' ? '/' : path}`
}

/** Metadados por página: título, descrição, canonical, sociais e robots. */
export function useSeo(options: SeoOptions) {
  const route = useRoute()
  const path = options.path ?? route.path
  const url = absoluteUrl(path)
  const title = /Minha Folga/.test(options.title) ? options.title : `${options.title} | Minha Folga`
  // Ambientes que não são produção nunca são indexados.
  const noindex = options.noindex || route.meta.noindex || publicConfig.environment !== 'production'

  const meta: Record<string, string>[] = [
    { name: 'description', content: options.description },
    { name: 'robots', content: noindex ? 'noindex, nofollow' : 'index, follow' },
    { property: 'og:site_name', content: 'Minha Folga' },
    { property: 'og:locale', content: 'pt_BR' },
    { property: 'og:type', content: options.type ?? 'website' },
    { property: 'og:title', content: title },
    { property: 'og:description', content: options.description },
    { property: 'og:url', content: url },
    { property: 'og:image', content: `${SITE_URL}${OG_IMAGE}` },
    { property: 'og:image:width', content: '1200' },
    { property: 'og:image:height', content: '630' },
    { property: 'og:image:alt', content: 'Minha Folga — Mais clareza para escolher. Mais espaço para viver.' },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: title },
    { name: 'twitter:description', content: options.description },
  ]
  if (options.publishedTime) meta.push({ property: 'article:published_time', content: options.publishedTime })
  if (options.modifiedTime) meta.push({ property: 'article:modified_time', content: options.modifiedTime })

  useHead({
    title,
    link: [{ rel: 'canonical', href: url }],
    meta,
    script: (options.jsonLd ?? []).map((data) => ({
      type: 'application/ld+json',
      innerHTML: JSON.stringify({ '@context': 'https://schema.org', ...data }),
    })),
  })
}

/** Organização: somente com identidade empresarial validada. */
export function organizationJsonLd(): Record<string, unknown> | null {
  const id = publicConfig.identity
  if (!id.complete || !id.legalName) return null
  return {
    '@type': 'Organization',
    name: id.tradeName,
    legalName: id.legalName,
    url: SITE_URL,
    logo: `${SITE_URL}/brand/minha-folga-logo.svg`,
    ...(id.cnpj ? { taxID: id.cnpj.replace(/\D/g, '') } : {}),
  }
}

export function breadcrumbJsonLd(items: { label: string; to: string }[]): Record<string, unknown> {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.label,
      item: absoluteUrl(item.to),
    })),
  }
}
