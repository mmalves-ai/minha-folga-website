import { normalizeSiteUrl } from './sitemap.ts'

/** Uma única decisão de indexação para o HTML e o robots.txt. */
export function seoBuildConfig(env: Record<string, string>, config: { siteUrl: string; environment: string }) {
  const siteUrl = normalizeSiteUrl(env.VITE_SITE_URL || config.siteUrl)
  const indexable = env.MF_INDEXABLE === '1'
  if (indexable && config.environment !== 'production') {
    throw new Error('[SEO] MF_INDEXABLE=1 exige configuração pública de produção.')
  }
  if (indexable && siteUrl !== normalizeSiteUrl(config.siteUrl)) {
    throw new Error('[SEO] VITE_SITE_URL deve ser igual ao PUBLIC_SITE_URL em produção.')
  }
  return { siteUrl, indexable }
}

export function renderRobots(siteUrl: string, indexable: boolean): string {
  // Páginas privadas precisam ser rastreáveis para o Google ler o noindex no HTML.
  // Autenticação e autorização continuam sendo responsabilidade da API.
  return indexable
    ? `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${siteUrl}/sitemap.xml\n`
    : 'User-agent: *\nDisallow: /\n'
}
