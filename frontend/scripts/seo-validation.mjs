/** Valida artefatos já renderizados, sem depender das variáveis usadas pelo processo Vite. */
import { JSDOM } from 'jsdom'

const SITEMAP_NS = 'http://www.sitemaps.org/schemas/sitemap/0.9'
const normalize = (value) => value.trim().replace(/\s+/g, ' ')
const directives = (value) => value.toLowerCase().split(',').map((part) => part.trim())

export function validateSeoArtifacts({ pages, expectedPaths, sitemap, robots, assetExists }) {
  const problems = []
  const titles = new Map()
  const descriptions = new Map()
  const facts = pages.map((page) => {
    const dom = new JSDOM(page.html)
    const document = dom.window.document
    const problem = (message) => problems.push(`${page.path}: ${message}`)
    const single = (selector, attribute, label) => {
      const elements = [...document.head.querySelectorAll(selector)]
      const value = normalize(attribute ? elements[0]?.getAttribute(attribute) ?? '' : elements[0]?.textContent ?? '')
      if (elements.length !== 1 || !value) problem(`deve ter exatamente um ${label} preenchido`)
      return value
    }
    const meta = (key, property = false) => single(`meta[${property ? 'property' : 'name'}="${key}"]`, 'content', key)
    const title = single('title', null, '<title>')
    const description = meta('description')
    const canonical = single('link[rel="canonical"]', 'href', 'canonical')
    const robots = directives(meta('robots'))
    const headings = document.querySelectorAll('h1')
    if (page.indexable && (headings.length !== 1 || !normalize(headings[0]?.textContent ?? ''))) {
      problem('página pública deve ter exatamente um <h1> preenchido')
    } else if (!page.indexable && page.path !== '/admin' && !headings.length) {
      problem('HTML sem <h1> (conteúdo não pré-renderizado)')
    }
    if (page.indexable) {
      for (const [value, seen, label] of [[title, titles, 'título'], [description, descriptions, 'descrição']]) {
        if (value && seen.has(value)) problem(`${label} repetido de ${seen.get(value)}`)
        if (value) seen.set(value, page.path)
      }
    }
    let canonicalUrl
    try {
      canonicalUrl = new URL(canonical)
      if (canonicalUrl.protocol !== 'https:' || canonicalUrl.search || canonicalUrl.hash || canonicalUrl.username || canonicalUrl.password) {
        problem('canonical deve ser HTTPS absoluto, sem credenciais, query ou fragmento')
      }
    } catch {
      problem('canonical deve ser uma URL absoluta válida')
    }
    const socialUrl = meta('og:url', true)
    const socialImage = meta('og:image', true)
    if (socialUrl !== canonical) problem('og:url difere do canonical')
    for (const [key, expected, property] of [
      ['og:title', title, true], ['og:description', description, true],
      ['twitter:title', title, false], ['twitter:description', description, false],
      ['twitter:card', 'summary_large_image', false], ['twitter:image', socialImage, false],
    ]) {
      if (meta(key, property) !== expected) problem(`${key} incoerente com os metadados da página`)
    }
    meta('og:image:alt', true)
    meta('twitter:image:alt')
    try {
      const image = new URL(socialImage)
      if (image.protocol !== 'https:' || image.origin !== canonicalUrl?.origin || image.search || image.hash) {
        problem('imagem social deve ter URL HTTPS no domínio canônico')
      } else if (!assetExists(decodeURIComponent(image.pathname))) {
        problem(`imagem social não existe no build: ${image.pathname}`)
      }
    } catch {
      problem('imagem social deve ser uma URL absoluta válida')
    }
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const value = JSON.parse(script.textContent)
        if (!value || typeof value !== 'object') problem('JSON-LD deve conter um objeto ou array')
      } catch {
        problem('JSON-LD inválido')
      }
    }
    dom.window.close()
    return { path: page.path, indexable: page.indexable, canonical, robots }
  })

  const home = facts.find((page) => page.path === '/')
  if (!home) {
    problems.push('SEO: home ausente, não foi possível conferir sitemap e robots.txt')
    return problems
  }
  if (!home.canonical.endsWith('/')) problems.push('/: canonical da home deve terminar em /')
  const siteUrl = home.canonical.replace(/\/$/, '')
  const indexable = home.robots.includes('index') && !home.robots.includes('noindex')
  for (const page of facts) {
    if (page.canonical !== `${siteUrl}${page.path}`) problems.push(`${page.path}: canonical não corresponde à URL da rota`)
    if (!page.indexable || !indexable) {
      if (!page.robots.includes('noindex') || page.robots.includes('index')) problems.push(`${page.path}: precisa de noindex coerente com a rota e o ambiente`)
    } else if (!page.robots.includes('index') || !page.robots.includes('follow') || page.robots.includes('noindex') || page.robots.includes('nofollow')) {
      problems.push(`${page.path}: página pública deve permitir indexação e seguir links neste ambiente`)
    }
  }

  if (sitemap === null) {
    problems.push('sitemap.xml: arquivo não gerado')
  } else {
    let dom
    try {
      dom = new JSDOM(sitemap, { contentType: 'application/xml' })
      const root = dom.window.document.documentElement
      if (root.localName !== 'urlset' || root.namespaceURI !== SITEMAP_NS) {
        problems.push('sitemap.xml: raiz ou namespace do protocolo inválido')
      }
      const found = new Set()
      const expected = new Set(expectedPaths.map((path) => `${siteUrl}${path}`))
      const canonicals = new Set(facts.filter((page) => page.indexable).map((page) => page.canonical))
      for (const entry of root.children) {
        const locations = [...entry.children].filter((node) => node.localName === 'loc' && node.namespaceURI === SITEMAP_NS)
        if (entry.localName !== 'url' || entry.namespaceURI !== SITEMAP_NS || locations.length !== 1) {
          problems.push('sitemap.xml: cada entrada deve ser <url> com exatamente um <loc>')
          continue
        }
        const url = locations[0].textContent.trim()
        if (found.has(url)) problems.push(`sitemap.xml: URL duplicada ${url}`)
        found.add(url)
        if (!expected.has(url)) problems.push(`sitemap.xml: URL privada, desconhecida ou fora do domínio canônico: ${url}`)
        if (!canonicals.has(url)) problems.push(`sitemap.xml: URL sem canonical público correspondente: ${url}`)
      }
      for (const url of expected) if (!found.has(url)) problems.push(`sitemap.xml: URL pública ausente ${url}`)
    } catch (error) {
      problems.push(`sitemap.xml: XML inválido (${error.message})`)
    } finally {
      dom?.window.close()
    }
  }

  if (robots === null) {
    problems.push('robots.txt: arquivo não gerado')
  } else {
    // Apenas um grupo global: páginas noindex continuam rastreáveis para o Google ler a diretiva.
    const actual = robots.split(/\r?\n/).map((line) => line.replace(/#.*$/, '').trim()).filter(Boolean)
      .map((line) => line.replace(/^([^:]+):\s*/, (_, name) => `${name.trim().toLowerCase()}: `))
    const expected = indexable
      ? ['user-agent: *', 'allow: /', 'disallow: /api/', `sitemap: ${siteUrl}/sitemap.xml`]
      : ['user-agent: *', 'disallow: /']
    if (actual[0] !== 'user-agent: *' || JSON.stringify(actual.sort()) !== JSON.stringify(expected.sort())) {
      problems.push(`robots.txt: diretivas incoerentes com os metadados ${indexable ? 'indexáveis' : 'noindex'} da home e a URL canônica`)
    }
  }
  return problems
}
