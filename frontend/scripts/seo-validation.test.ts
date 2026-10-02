import { describe, expect, it } from 'vitest'
import { validateSeoArtifacts } from './seo-validation.mjs'

const siteUrl = 'https://www.minhafolga.com.br'
const page = (path: string, indexable: boolean, production = true) => {
  const title = path === '/' ? 'Minha Folga' : `Página ${path} | Minha Folga`
  const description = `Descrição própria da página ${path} com informações claras para quem busca a Minha Folga.`
  const canonical = `${siteUrl}${path}`
  const image = `${siteUrl}/brand/og-minha-folga.png`
  return {
    path,
    indexable,
    html: `<!doctype html><html lang="pt-BR"><head>
      <title>${title}</title><link href="${canonical}" rel="canonical">
      <meta content="${description}" name="description">
      <meta name="robots" content="${indexable && production ? 'index, follow, max-image-preview:large' : 'noindex, nofollow'}">
      <meta property="og:url" content="${canonical}">
      <meta property="og:title" content="${title}"><meta property="og:description" content="${description}">
      <meta property="og:image" content="${image}"><meta property="og:image:alt" content="Minha Folga">
      <meta name="twitter:card" content="summary_large_image">
      <meta name="twitter:title" content="${title}"><meta name="twitter:description" content="${description}">
      <meta name="twitter:image" content="${image}"><meta name="twitter:image:alt" content="Minha Folga">
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage"}</script>
      </head><body><h1>${title}</h1></body></html>`,
  }
}
const fixture = (production = true) => ({
  pages: [page('/', true, production), page('/sobre', true, production), page('/preferencias', false, production)],
  expectedPaths: ['/', '/sobre'],
  sitemap: `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${siteUrl}/</loc></url><url><loc>${siteUrl}/sobre</loc></url></urlset>`,
  robots: production ? `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${siteUrl}/sitemap.xml\n` : 'User-agent: *\nDisallow: /\n',
  assetExists: (path: string) => path === '/brand/og-minha-folga.png',
})
const validate = (data: ReturnType<typeof fixture>) => validateSeoArtifacts(data).join('\n')

describe('validação dos artefatos SEO publicados', () => {
  it('aceita produção com privadas noindex e metadados completos, independentemente da ordem dos atributos', () => {
    expect(validate(fixture())).toBe('')
  })

  it('aceita staging com todos os metadados noindex e robots bloqueado', () => {
    expect(validate(fixture(false))).toBe('')
  })

  it('recusa duplicação de h1 e título mesmo quando o HTML continua válido', () => {
    const data = fixture()
    data.pages[1]!.html = data.pages[1]!.html.replace('</body>', '<h1>Outro título</h1></body>')
      .replace('</title>', '</title><title>Outro título</title>')
    expect(validate(data)).toContain('exatamente um <h1>')
    expect(validate(data)).toContain('exatamente um <title>')
  })

  it('identifica títulos e descrições duplicados nas páginas públicas', () => {
    const data = fixture()
    data.pages[1]!.html = data.pages[1]!.html.replaceAll('Página /sobre | Minha Folga', 'Minha Folga')
      .replaceAll('página /sobre com', 'página / com')
    expect(validate(data)).toContain('título repetido de /')
    expect(validate(data)).toContain('descrição repetido de /')
  })

  it('recusa canonical divergente da rota, duplicado e metadados sociais conflitantes', () => {
    const data = fixture()
    data.pages[1]!.html = data.pages[1]!.html.replace('href="https://www.minhafolga.com.br/sobre"', 'href="https://www.minhafolga.com.br/errado"')
      .replace('</head>', '<link rel="canonical" href="https://www.minhafolga.com.br/sobre"></head>')
    expect(validate(data)).toContain('canonical não corresponde à URL da rota')
    expect(validate(data)).toContain('exatamente um canonical')
    expect(validate(data)).toContain('og:url difere do canonical')
  })

  it('recusa imagem social ausente do build e Twitter divergente', () => {
    const data = fixture()
    data.assetExists = () => false
    data.pages[0]!.html = data.pages[0]!.html.replace('name="twitter:image"', 'name="imagem-removida"')
    expect(validate(data)).toContain('imagem social não existe no build')
    expect(validate(data)).toContain('twitter:image incoerente')
  })

  it('detecta JSON-LD malformado sem executar scripts da página', () => {
    const data = fixture()
    data.pages[1]!.html = data.pages[1]!.html.replace('"@type":"WebPage"', '"@type":')
    expect(validate(data)).toContain('JSON-LD inválido')
  })

  it('não permite que o sitemap omita uma página pública', () => {
    const data = fixture()
    data.sitemap = data.sitemap.replace(`<url><loc>${siteUrl}/sobre</loc></url>`, '')
    expect(validate(data)).toContain(`URL pública ausente ${siteUrl}/sobre`)
  })

  it('não permite URLs duplicadas, privadas, externas ou sem canonical público no sitemap', () => {
    const data = fixture()
    data.sitemap = data.sitemap.replace('</urlset>', `<url><loc>${siteUrl}/</loc></url><url><loc>${siteUrl}/preferencias</loc></url><url><loc>https://example.com/sobre</loc></url></urlset>`)
    expect(validate(data)).toContain('URL duplicada')
    expect(validate(data)).toContain(`URL privada, desconhecida ou fora do domínio canônico: ${siteUrl}/preferencias`)
    expect(validate(data)).toContain('URL sem canonical público correspondente: https://example.com/sobre')
  })

  it('detecta XML malformado, namespace errado e entrada sem loc', () => {
    const invalid = fixture()
    invalid.sitemap = '<urlset><url>'
    expect(validate(invalid)).toContain('XML inválido')
    invalid.sitemap = '<urlset xmlns="https://example.com"><url /></urlset>'
    expect(validate(invalid)).toContain('namespace do protocolo inválido')
    expect(validate(invalid)).toContain('exatamente um <loc>')
  })

  it('mantém privadas rastreáveis e sinaliza conflito entre robots.txt e a home', () => {
    const data = fixture()
    data.robots += 'Disallow: /preferencias\n'
    expect(validate(data)).toContain('robots.txt: diretivas incoerentes')
    data.robots = fixture(false).robots
    expect(validate(data)).toContain('robots.txt: diretivas incoerentes')
  })

  it('detecta rotas públicas e privadas com diretivas de indexação incorretas', () => {
    const data = fixture()
    data.pages[1]!.html = data.pages[1]!.html.replace('index, follow, max-image-preview:large', 'noindex, nofollow')
    data.pages[2]!.html = data.pages[2]!.html.replace('noindex, nofollow', 'index, follow')
    expect(validate(data)).toContain('/sobre: página pública deve permitir indexação')
    expect(validate(data)).toContain('/preferencias: precisa de noindex')
  })
})
