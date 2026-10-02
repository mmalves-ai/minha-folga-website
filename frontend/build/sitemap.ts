/**
 * sitemap.xml a partir das rotas publicadas, com `<lastmod>` vindo SOMENTE de datas reais registradas nos
 * metadados versionados (seções 6.13 e 12; docs/CONTENT_GUIDE.md: nenhuma data é preenchida pelo build):
 *
 * - artigo: a mais recente entre `publishedAt` e `review.reviewedAt` (esta só com revisão aprovada, data e revisor);
 * - Privacidade, Termos e Cookies: `revisedAt` do aviso em contracts/consents.json, só com `status: approved`;
 * - demais páginas: `revision.approvedAt` (com `status: approved`) do YAML da página e dos conteúdos que ela
 *   exibe (FAQ, aquisição, formulários, artigos), a mais recente.
 *
 * Sem data real, a tag `<lastmod>` é omitida (o protocolo a trata como opcional). A data do build nunca entra.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { parse as parseYaml } from 'yaml'

const DATE = /^\d{4}-\d{2}-\d{2}$/

export interface SitemapSources {
  /** Pasta frontend/content. */
  contentDir: string
  /** Metadados dos avisos legais (contracts/consents.json → notices). */
  notices: Record<string, { status?: string; revisedAt?: string | null }>
}

function date(v: unknown): string | null {
  if (typeof v !== 'string' || !DATE.test(v) || v.startsWith('0000-')) return null
  const parsed = new Date(`${v}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === v ? v : null
}

function latest(dates: (string | null | undefined)[]): string | null {
  const real = dates.filter((d): d is string => date(d) !== null)
  return real.length ? real.sort().at(-1)! : null
}

function readYaml(file: string): any {
  return existsSync(file) ? parseYaml(readFileSync(file, 'utf8')) : null
}

/** Data de aprovação registrada no bloco `revision` de um YAML de content/, ou null. */
export function approvedAt(data: any): string | null {
  const rev = data?.revision
  return rev?.status === 'approved' && rev?.approvedBy ? date(rev.approvedAt) : null
}

/** Data real de um artigo (frontmatter), ou null. */
export function articleDate(front: any): string | null {
  const review = front?.review
  const reviewed = review?.status === 'approved' && review?.reviewer ? date(review.reviewedAt) : null
  return latest([date(front?.publishedAt), reviewed])
}

function frontmatter(source: string): any {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source)
  return m ? parseYaml(m[1]!) : {}
}

const LEGAL: Record<string, string> = { '/privacidade': 'privacy', '/termos': 'terms', '/cookies': 'cookies' }

/** Conteúdos compartilhados que cada página exibe, além do próprio YAML. */
const SHARED: Record<string, string[]> = {
  '/': ['faq.yaml', 'pages/aquisicao.yaml', 'pages/formularios.yaml'],
  '/consignado-privado': ['faq.yaml'],
  '/ajuda': ['faq.yaml'],
  '/avise-me': ['faq.yaml', 'pages/aquisicao.yaml', 'pages/formularios.yaml'],
  '/atendimento': ['pages/formularios.yaml'],
}

export function lastmodFor(path: string, src: SitemapSources, articleBase = '/conteudos'): string | null {
  // A mesma validação protege as leituras de conteúdo de caminhos relativos ou normalizados pelo navegador.
  path = decodeURIComponent(canonicalPath(path))
  const article = (slug: string): any => {
    if (!slug || basename(slug) !== slug) return null
    const file = join(src.contentDir, 'articles', `${slug}.md`)
    return existsSync(file) ? frontmatter(readFileSync(file, 'utf8')) : null
  }
  const articles = () =>
    readdirSync(join(src.contentDir, 'articles'))
      .filter((f) => f.endsWith('.md'))
      .map((f) => ({ ...article(basename(f, '.md')), slug: basename(f, '.md') }))
      // Mesma ordem de virtual:mf-articles (content-plugin.ts), usada por HomePage.vue.
      .sort((a, b) => String(a.order ?? a.slug).localeCompare(String(b.order ?? b.slug), 'pt-BR', { numeric: true }))

  if (path.startsWith(`${articleBase}/`)) {
    return articleDate(article(path.slice(articleBase.length + 1)))
  }
  const notice = LEGAL[path]
  if (notice) {
    const meta = src.notices[notice]
    return meta?.status === 'approved' ? date(meta.revisedAt) : null
  }
  const page = path === '/' ? 'home' : path.slice(1)
  const content = readYaml(join(src.contentDir, 'pages', `${page}.yaml`))
  const dates: (string | null)[] = [approvedAt(content)]
  for (const dep of SHARED[path] ?? []) {
    dates.push(approvedAt(readYaml(join(src.contentDir, dep))))
  }
  if (path === '/') dates.push(...articles().slice(0, 3).map(articleDate))
  if (path === '/conteudos') dates.push(...articles().map(articleDate))
  if (path === '/seguranca' && typeof content?.learn?.article === 'string') dates.push(articleDate(article(content.learn.article)))
  return latest(dates)
}

/** A URL pública é uma origem HTTPS, nunca uma subpasta, URL autenticada ou URL com parâmetros. */
export function normalizeSiteUrl(siteUrl: string): string {
  const invalid = () => new Error('[sitemap] VITE_SITE_URL deve ser uma origem HTTPS sem caminho, credenciais, query ou fragmento')
  let url: URL
  try {
    url = new URL(siteUrl)
  } catch {
    throw invalid()
  }
  if (!/^https:\/\/[^/?#\\\s]+\/?$/i.test(siteUrl) || /[\s\\?#@]/.test(siteUrl) || url.protocol !== 'https:' || url.pathname !== '/' || url.username || url.password) {
    throw invalid()
  }
  return url.origin
}

/** Só caminhos de página canônicos; falhar no build evita publicar URLs ambíguas no sitemap. */
function canonicalPath(path: string): string {
  const invalid = () => new Error(`[sitemap] Caminho não canônico: ${JSON.stringify(path)}`)
  if (!path.startsWith('/') || /[?#\\\u0000-\u001f\u007f]/.test(path)) throw invalid()
  if (path === '/') return path
  const segments = path.slice(1).split('/').map((segment) => {
    let decoded: string
    try {
      decoded = decodeURIComponent(segment)
    } catch {
      throw invalid()
    }
    if (!decoded || decoded === '.' || decoded === '..' || /[/\\?#\u0000-\u001f\u007f]/.test(decoded)) throw invalid()
    return encodeURI(decoded)
  })
  return `/${segments.join('/')}`
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!)
}

export function renderSitemap(siteUrl: string, paths: string[], src: SitemapSources): string {
  const origin = normalizeSiteUrl(siteUrl)
  const urls = [...new Set(paths.map(canonicalPath))].sort()
    .map((p) => {
      const lastmod = lastmodFor(p, src)
      return `  <url><loc>${escapeXml(`${origin}${p}`)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`
    })
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
}
