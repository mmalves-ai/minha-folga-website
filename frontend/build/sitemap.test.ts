/**
 * Risco concreto (seções 6.13 e 12): o sitemap anunciar aos buscadores que todas as páginas mudaram na data
 * do build. `<lastmod>` só pode vir de data real de revisão, aprovação ou publicação registrada no conteúdo.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { approvedAt, articleDate, lastmodFor, normalizeSiteUrl, renderSitemap } from './sitemap'

const dir = mkdtempSync(join(tmpdir(), 'mf-sitemap-'))
mkdirSync(join(dir, 'articles'))
mkdirSync(join(dir, 'pages'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const article = (name: string, front: string) => writeFileSync(join(dir, 'articles', `${name}.md`), `---\n${front}\n---\n\nTexto.\n`)
const yaml = (file: string, body: string) => writeFileSync(join(dir, file), body)
const rev = (status: string, approvedAt: string | null, approvedBy: string | null) =>
  `revision:\n  version: 1\n  status: ${status}\n  draftedAt: 2026-09-25\n  approvedAt: ${approvedAt ?? 'null'}\n  approvedBy: ${approvedBy ?? 'null'}\n`

article('rascunho', 'order: 1\nslug: rascunho\npublishedAt: null\nreview:\n  status: pending\n  reviewedAt: null\n  reviewer: null')
article('revisado', 'order: 2\nslug: revisado\npublishedAt: 2026-10-01\nreview:\n  status: approved\n  reviewedAt: 2026-10-20\n  reviewer: Equipe financeira')
article('sem-revisor', 'order: 3\nslug: sem-revisor\npublishedAt: null\nreview:\n  status: approved\n  reviewedAt: 2026-10-20\n  reviewer: null')
article('fora-da-home', 'order: 4\nslug: fora-da-home\npublishedAt: 2026-10-25')
yaml('pages/formularios.yaml', rev('approved', '2026-10-12', 'Diretoria'))
yaml('pages/seguranca.yaml', rev('approved', '2026-10-05', 'Diretoria') + 'learn:\n  article: revisado\n')
yaml('pages/sobre.yaml', rev('approved', '2026-10-05', 'Diretoria'))
yaml('pages/ajuda.yaml', rev('approved', '2026-10-05', 'Diretoria'))
yaml('pages/bia.yaml', rev('approved', '2026-10-05', null))
yaml('pages/conteudos.yaml', rev('draft', null, null))
yaml('faq.yaml', rev('approved', '2026-10-09', 'Diretoria'))
yaml('pages/aquisicao.yaml', rev('approved', '2026-10-15', 'Diretoria'))

const notices = {
  privacy: { status: 'approved', revisedAt: '2026-10-02' },
  terms: { status: 'draft', revisedAt: null },
  cookies: { status: 'draft', revisedAt: '2026-10-03' },
}
const src = { contentDir: dir, notices }

describe('lastmod do sitemap', () => {
  it('artigo: publicação ou revisão aprovada com revisor; sem isso, nenhuma data', () => {
    expect(lastmodFor('/conteudos/revisado', src)).toBe('2026-10-20')
    expect(lastmodFor('/conteudos/rascunho', src)).toBeNull()
    expect(lastmodFor('/conteudos/sem-revisor', src)).toBeNull()
  })

  it('páginas legais: só a revisão aprovada do aviso', () => {
    expect(lastmodFor('/privacidade', src)).toBe('2026-10-02')
    expect(lastmodFor('/termos', src)).toBeNull()
    expect(lastmodFor('/cookies', src)).toBeNull()
  })

  it('páginas: aprovação registrada do YAML e dos conteúdos exibidos, a mais recente', () => {
    expect(lastmodFor('/sobre', src)).toBe('2026-10-05')
    expect(lastmodFor('/ajuda', src)).toBe('2026-10-09')
    expect(lastmodFor('/avise-me', src)).toBe('2026-10-15')
    expect(lastmodFor('/bia', src)).toBeNull()
    expect(lastmodFor('/conteudos', src)).toBe('2026-10-25')
    expect(lastmodFor('/pagina-sem-yaml', src)).toBeNull()
  })

  it('sem data real, a tag é omitida; a data do build nunca aparece', () => {
    const xml = renderSitemap('https://www.minhafolga.com.br', ['/', '/bia', '/sobre', '/termos'], src)
    // A home exibe artigos: vale a data do artigo revisado.
    expect(xml).toContain('<url><loc>https://www.minhafolga.com.br/</loc><lastmod>2026-10-20</lastmod></url>')
    expect(xml).toContain('<url><loc>https://www.minhafolga.com.br/bia</loc></url>')
    expect(xml).toContain('<url><loc>https://www.minhafolga.com.br/sobre</loc><lastmod>2026-10-05</lastmod></url>')
    expect(xml).toContain('<url><loc>https://www.minhafolga.com.br/termos</loc></url>')
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
    if (!['2026-10-02', '2026-10-05', '2026-10-09', '2026-10-20'].includes(today)) expect(xml).not.toContain(today)
  })
})


describe('datas reais e dependências do conteúdo exibido', () => {
  it.each(['2026-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '0000-01-01', '2026-2-01', '2026-10-02T10:00:00Z'])(
    'omite a data inválida %s em todos os tipos de fonte', (invalid) => {
      expect(articleDate({ publishedAt: invalid, review: { status: 'approved', reviewer: 'Equipe', reviewedAt: invalid } })).toBeNull()
      expect(approvedAt({ revision: { status: 'approved', approvedBy: 'Equipe', approvedAt: invalid } })).toBeNull()
      expect(lastmodFor('/privacidade', { ...src, notices: { privacy: { status: 'approved', revisedAt: invalid } } })).toBeNull()
    },
  )

  it('preserva data válida de ano bissexto e ignora revisão inválida mais recente', () => {
    expect(articleDate({ publishedAt: '2024-02-29', review: { status: 'approved', reviewer: 'Equipe', reviewedAt: '2026-02-29' } })).toBe('2024-02-29')
  })

  it('home depende somente dos três artigos destacados; a central depende de todos', () => {
    expect(lastmodFor('/', src)).toBe('2026-10-20')
    expect(lastmodFor('/conteudos', src)).toBe('2026-10-25')
  })

  it('segurança depende do artigo selecionado; atendimento depende do texto dos formulários', () => {
    expect(lastmodFor('/seguranca', src)).toBe('2026-10-20')
    expect(lastmodFor('/atendimento', src)).toBe('2026-10-12')
  })
})

describe('URLs canônicas do sitemap', () => {
  it('normaliza a origem HTTPS sem gerar barra duplicada', () => {
    expect(normalizeSiteUrl('https://WWW.MINHAFOLGA.COM.BR/')).toBe('https://www.minhafolga.com.br')
    expect(renderSitemap('https://www.minhafolga.com.br/', ['/sobre'], src)).toContain('<loc>https://www.minhafolga.com.br/sobre</loc>')
  })

  it.each([
    'http://www.minhafolga.com.br', 'https://www.minhafolga.com.br/subpasta',
    'https://www.minhafolga.com.br/./', 'https://www.minhafolga.com.br/%2e%2e/',
    'https://www.minhafolga.com.br?x=1', 'https://www.minhafolga.com.br?',
    'https://www.minhafolga.com.br#topo', 'https://www.minhafolga.com.br#',
    'https://usuario:senha@www.minhafolga.com.br', 'https://@www.minhafolga.com.br',
    '//www.minhafolga.com.br', ' https://www.minhafolga.com.br', 'https:///www.minhafolga.com.br',
  ])('recusa origem inválida %s', (base) => {
    expect(() => renderSitemap(base, ['/'], src)).toThrow(/origem HTTPS/)
  })

  it.each([
    'sobre', '//outro.example/sobre', '/sobre/', '/sobre//equipe', '/sobre?origem=google',
    '/sobre#equipe', '/./sobre', '/conteudos/../sobre', '/conteudos/%2E%2E/sobre',
    '/conteudos/a%2fb', '/sobre%5Cequipe', '/sobre%00', '/sobre%0A', '/sobre%3Fparametro',
    '/sobre%23equipe', '/sobre%ZZ',
  ])('recusa caminho ambíguo %s', (path) => {
    expect(() => renderSitemap('https://www.minhafolga.com.br', [path], src)).toThrow(/Caminho não canônico/)
  })

  it('codifica Unicode, escapa XML e elimina URLs equivalentes', () => {
    const xml = renderSitemap('https://www.minhafolga.com.br', ['/sobre', '/ação & crédito', '/a%C3%A7%C3%A3o%20&%20cr%C3%A9dito', '/', '/sobre'], src)
    const locs = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1])
    expect(locs).toEqual([
      'https://www.minhafolga.com.br/',
      'https://www.minhafolga.com.br/a%C3%A7%C3%A3o%20&amp;%20cr%C3%A9dito',
      'https://www.minhafolga.com.br/sobre',
    ])
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(xml).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"')
  })
})
