import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { callBiaTool, horizontalOverflow, SITE_ORIGIN } from './support/helpers'

const articles = readdirSync(fileURLToPath(new URL('../content/articles', import.meta.url)))
  .filter((f) => f.endsWith('.md'))
  .map((f) => `/conteudos/${f.replace(/\.md$/, '')}`)

const PUBLIC = [
  '/',
  '/sobre',
  '/solucoes',
  '/consignado-privado',
  '/como-funciona',
  '/bia',
  '/conteudos',
  ...articles,
  '/ajuda',
  '/atendimento',
  '/seguranca',
  '/avise-me',
  '/lancamento',
  '/privacidade',
  '/termos',
  '/cookies',
]
const PRIVATE = ['/cadastro-confirmado', '/preferencias', '/atendimento/acompanhar', '/admin']
const WIDTHS = [360, 390, 768, 1024, 1440]

test.describe('rotas por acesso direto', () => {
  for (const path of PUBLIC) {
    test(`${path} responde 200 com conteúdo pré-renderizado e metadados`, async ({ page, request }) => {
      // HTML bruto do servidor (sem JavaScript): conteúdo e metadados já presentes.
      const raw = await request.get(path)
      expect(raw.status()).toBe(200)
      const html = await raw.text()
      expect(html).toMatch(/<h1[\s>]/)
      expect(html).toMatch(/<link rel="canonical" href="https:\/\/www\.minhafolga\.com\.br/)
      expect(html).toMatch(/<meta name="description" content="[^"]{50,}"/)
      expect(html).not.toMatch(/lorem ipsum/i)

      await page.goto(path)
      await expect(page.locator('h1')).toHaveCount(1)
      await expect(page.locator('main#conteudo')).toBeVisible()
    })
  }

  for (const path of PRIVATE) {
    test(`${path} é acessível e não indexável`, async ({ request }) => {
      const res = await request.get(path)
      expect(res.status()).toBe(200)
      expect(await res.text()).toMatch(/<meta name="robots" content="noindex/)
    })
  }

  test('URL inexistente retorna 404 com página útil (nunca a home com 200)', async ({ page, request }) => {
    const res = await request.get('/pagina-que-nao-existe')
    expect(res.status()).toBe(404)
    await page.goto('/pagina-que-nao-existe')
    await expect(page.locator('h1')).toBeVisible()
    await expect(page.getByRole('link', { name: /início|inicial|home/i }).first()).toBeVisible()
  })

  test('artigo inexistente retorna 404', async ({ request }) => {
    expect((await request.get('/conteudos/nao-existe')).status()).toBe(404)
  })

  test('erro de API é JSON, não HTML', async ({ request }) => {
    const res = await request.get('/api/rota-inexistente')
    expect(res.status()).toBe(404)
    expect(res.headers()['content-type']).toMatch(/application\/json/)
  })

  test('crédito bloqueado no servidor em PRE_LAUNCH', async ({ request }) => {
    for (const path of ['/api/credit/eligibility', '/api/credit/margin', '/api/credit/proposals']) {
      const res = await request.post(path, { data: {}, headers: { Origin: SITE_ORIGIN } })
      expect(res.status()).toBe(403)
      expect((await res.json()).error.code).toBe('credit_phase_locked')
    }
  })

  test('decisão D1: rotas de código e de mensagens de WhatsApp não existem mais', async ({ request }) => {
    const removed: [method: 'get' | 'post', path: string][] = [
      ['post', '/api/waitlist/verify'],
      ['post', '/api/waitlist/resend'],
      ['post', '/api/preferences/access'],
      ['post', '/api/preferences/access/verify'],
      ['get', '/api/webhooks/whatsapp'],
      ['post', '/api/webhooks/whatsapp'],
    ]
    for (const [method, path] of removed) {
      const res = await request[method](path, method === 'post' ? { data: {}, headers: { Origin: SITE_ORIGIN } } : {})
      expect(res.status(), `${method.toUpperCase()} ${path}`).toBe(404)
      expect(res.headers()['content-type']).toMatch(/application\/json/)
    }
  })

  test('ferramentas da Bia: removidas pela D1 respondem 404; financeiras bloqueadas em PRE_LAUNCH', async ({ request }) => {
    const attested = { senderPhone: '+5511987654321', senderVerified: true }
    for (const tool of ['create_waitlist_interest', 'verify_contact', 'request_human_support']) {
      const res = await callBiaTool(request, tool, attested)
      expect(res.status(), tool).toBe(404)
    }
    for (const tool of ['check_eligibility', 'query_margin', 'get_proposal', 'simulate_credit']) {
      const res = await callBiaTool(request, tool, attested)
      expect(res.status(), tool).toBe(403)
      expect((await res.json()).error.code, tool).toBe('credit_phase_locked')
    }
  })

  test('área administrativa interna usa o fallback da aplicação', async ({ request }) => {
    const res = await request.get('/admin/leads')
    expect(res.status()).toBe(200)
    expect(await res.text()).toMatch(/noindex/)
  })

  test('títulos únicos entre páginas públicas', async ({ request }) => {
    const titles = new Map<string, string>()
    for (const path of PUBLIC) {
      const html = await (await request.get(path)).text()
      const title = /<title>([^<]+)<\/title>/.exec(html)?.[1] ?? ''
      expect(titles.has(title), `${path} repete o título de ${titles.get(title)}`).toBe(false)
      titles.set(title, path)
    }
  })
})

test.describe('responsividade e acessibilidade', () => {
  for (const path of [...PUBLIC, '/preferencias', '/atendimento/acompanhar', '/pagina-que-nao-existe']) {
    test(`${path}: sem rolagem horizontal nas larguras de referência e sem violações graves de acessibilidade`, async ({ page }) => {
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 })
        await page.goto(path)
        await page.waitForLoadState('networkidle')
        expect(await horizontalOverflow(page), `overflow em ${width}px`).toBeLessThanOrEqual(0)
      }
      await page.setViewportSize({ width: 1440, height: 900 })
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
      const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
      expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`)).toEqual([])
    })
  }
})
