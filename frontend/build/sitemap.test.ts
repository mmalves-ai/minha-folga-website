/**
 * Risco concreto (seções 6.13 e 12): o sitemap anunciar aos buscadores que todas as páginas mudaram na data
 * do build. `<lastmod>` só pode vir de data real de revisão, aprovação ou publicação registrada no conteúdo.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { lastmodFor, renderSitemap } from './sitemap'

const dir = mkdtempSync(join(tmpdir(), 'mf-sitemap-'))
mkdirSync(join(dir, 'articles'))
mkdirSync(join(dir, 'pages'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const article = (name: string, front: string) => writeFileSync(join(dir, 'articles', `${name}.md`), `---\n${front}\n---\n\nTexto.\n`)
const yaml = (file: string, body: string) => writeFileSync(join(dir, file), body)
const rev = (status: string, approvedAt: string | null, approvedBy: string | null) =>
  `revision:\n  version: 1\n  status: ${status}\n  draftedAt: 2026-09-25\n  approvedAt: ${approvedAt ?? 'null'}\n  approvedBy: ${approvedBy ?? 'null'}\n`

article('rascunho', 'slug: rascunho\npublishedAt: null\nreview:\n  status: pending\n  reviewedAt: null\n  reviewer: null')
article('revisado', 'slug: revisado\npublishedAt: 2026-10-01\nreview:\n  status: approved\n  reviewedAt: 2026-10-20\n  reviewer: Equipe financeira')
article('sem-revisor', 'slug: sem-revisor\npublishedAt: null\nreview:\n  status: approved\n  reviewedAt: 2026-10-20\n  reviewer: null')
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
    expect(lastmodFor('/conteudos', src)).toBe('2026-10-20')
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
