/**
 * sitemap.xml a partir das rotas publicadas, com `<lastmod>` vindo SOMENTE de datas reais registradas nos
 * metadados versionados (seções 6.13 e 12; docs/CONTENT_GUIDE.md: nenhuma data é preenchida pelo build):
 *
 * - artigo: a mais recente entre `publishedAt` e `review.reviewedAt` (esta só com revisão aprovada, data e revisor);
 * - Privacidade, Termos e Cookies: `revisedAt` do aviso em contracts/consents.json, só com `status: approved`;
 * - demais páginas: `revision.approvedAt` (com `status: approved`) do YAML da página e dos conteúdos que ela
 *   exibe (FAQ, marcos, artigos), a mais recente; nos marcos, também o `updatedAt` registrado à mão.
 *
 * Sem data real, a tag `<lastmod>` é omitida (o protocolo a trata como opcional). A data do build nunca entra.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'

const DATE = /^\d{4}-\d{2}-\d{2}$/

export interface SitemapSources {
  /** Pasta frontend/content. */
  contentDir: string
  /** Metadados dos avisos legais (contracts/consents.json → notices). */
  notices: Record<string, { status?: string; revisedAt?: string | null }>
}

function date(v: unknown): string | null {
  const s = v == null ? '' : String(v)
  return DATE.test(s) ? s : null
}

function latest(dates: (string | null | undefined)[]): string | null {
  const real = dates.filter((d): d is string => typeof d === 'string' && DATE.test(d))
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
const SHARED: Record<string, ('faq' | 'articles' | 'aquisicao')[]> = {
  '/': ['faq', 'articles', 'aquisicao'],
  '/consignado-privado': ['faq'],
  '/ajuda': ['faq'],
  '/avise-me': ['faq', 'aquisicao'],
  '/conteudos': ['articles'],
}

export function lastmodFor(path: string, src: SitemapSources, articleBase = '/conteudos'): string | null {
  const articles = () =>
    readdirSync(join(src.contentDir, 'articles'))
      .filter((f) => f.endsWith('.md'))
      .map((f) => articleDate(frontmatter(readFileSync(join(src.contentDir, 'articles', f), 'utf8'))))

  if (path.startsWith(`${articleBase}/`)) {
    const file = join(src.contentDir, 'articles', `${path.slice(articleBase.length + 1)}.md`)
    return existsSync(file) ? articleDate(frontmatter(readFileSync(file, 'utf8'))) : null
  }
  const notice = LEGAL[path]
  if (notice) {
    const meta = src.notices[notice]
    return meta?.status === 'approved' ? date(meta.revisedAt) : null
  }
  const page = path === '/' ? 'home' : path.slice(1)
  const dates: (string | null)[] = [approvedAt(readYaml(join(src.contentDir, 'pages', `${page}.yaml`)))]
  for (const dep of SHARED[path] ?? []) {
    if (dep === 'aquisicao') dates.push(approvedAt(readYaml(join(src.contentDir, 'pages', 'aquisicao.yaml'))))
    if (dep === 'faq') dates.push(approvedAt(readYaml(join(src.contentDir, 'faq.yaml'))))
    if (dep === 'articles') dates.push(...articles())
  }
  return latest(dates)
}

export function renderSitemap(siteUrl: string, paths: string[], src: SitemapSources): string {
  const urls = paths
    .map((p) => {
      const lastmod = lastmodFor(p, src)
      return `  <url><loc>${siteUrl}${p}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`
    })
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
}
