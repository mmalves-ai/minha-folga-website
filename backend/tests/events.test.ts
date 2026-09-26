import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parse } from 'yaml'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CONTRACTS_DIR } from '../src/config/paths.js'
import { VALIDATION } from '../src/config/contracts.js'
import { loadProductEventCatalog, productEventCatalog } from '../src/services/product-events.service.js'
import { createTestHarness, SITE, type TestHarness } from './helpers.js'

async function counters(h: TestHarness) {
  const r = await h.ctx.db.query<{ name: string; dimension: string; count: number }>(
    `SELECT name, dimension, count FROM metric_counters WHERE name LIKE 'event:%' ORDER BY name, dimension`,
  )
  return r.rows
}

describe('catálogo de eventos (contracts/validation.json → events)', () => {
  const catalog = productEventCatalog()

  it('nomes iguais aos do contrato OpenAPI e todos com tipo de dimensão', () => {
    const doc = parse(readFileSync(resolve(CONTRACTS_DIR, 'openapi.yaml'), 'utf8')) as {
      components: { schemas: { ProductEvent: { properties: { name: { enum: string[] } } } } }
    }
    expect([...catalog.names].sort()).toEqual([...doc.components.schemas.ProductEvent.properties.name.enum].sort())
    expect(Object.keys(catalog.kindOf).sort()).toEqual(Object.keys(VALIDATION.events.names).sort())
  })

  it('rotas vêm do manifesto (só indexáveis) e dos artigos publicados; categorias, origens e exemplos do conteúdo', () => {
    const routes = catalog.allowed.route
    for (const path of ['/', '/sobre', '/ajuda', '/avise-me', '/bia', '/conteudos', '/conteudos/o-que-e-cet']) expect(routes.has(path)).toBe(true)
    for (const path of ['/admin', '/preferencias', '/cadastro-confirmado', '/404', '/atendimento/acompanhar', 'ajuda', 'home']) {
      expect(routes.has(path)).toBe(false)
    }
    expect(catalog.allowed.article_slug.has('o-que-e-cet')).toBe(true)
    expect(catalog.allowed.faq_category.has('')).toBe(true)
    expect(catalog.allowed.faq_category.has('consignado')).toBe(true)
    expect([...catalog.allowed.waitlist_source].sort()).toEqual([...VALIDATION.waitlist.sources].sort())
    expect([...catalog.allowed.bia_example_id].sort()).toEqual(['cet', 'prazo-parcela', 'proximo-passo'])
    expect([...catalog.allowed.none]).toEqual([''])
  })

  it('release sem manifesto ou sem artigos não monta o catálogo (erro de release, não de visitante)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mf-events-'))
    mkdirSync(join(dir, 'src/router'), { recursive: true })
    mkdirSync(join(dir, 'content/articles'), { recursive: true })
    writeFileSync(join(dir, 'src/router/manifest.ts'), 'export const ROUTES = []\n')
    try {
      expect(() => loadProductEventCatalog({ frontendDir: dir, contentDir: join(dir, 'content') })).toThrow(/rota indexável/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('POST /api/events com ANALYTICS_ENABLED=false', () => {
  let h: TestHarness
  beforeAll(async () => {
    h = await createTestHarness()
  })
  afterAll(async () => {
    await h.close()
  })

  it('responde 204 e não grava nada, nem evento válido nem inválido', async () => {
    const ok = await h.api.post('/api/events').set(SITE).send({ name: 'article_read', dimension: 'o-que-e-cet' })
    expect(ok.status).toBe(204)
    const junk = await h.api.post('/api/events').set(SITE).send({ name: 'qualquer', texto: 'livre' })
    expect(junk.status).toBe(204)
    expect(await counters(h)).toEqual([])
  })
})

describe('POST /api/events com ANALYTICS_ENABLED=true', () => {
  let h: TestHarness
  beforeAll(async () => {
    h = await createTestHarness({ ANALYTICS_ENABLED: 'true' })
  })
  afterAll(async () => {
    await h.close()
  })

  const send = (body: unknown, ip = '203.0.113.10') => h.api.post('/api/events').set(SITE).set('X-Forwarded-For', ip).send(body as object)

  it('incrementa contador agregado por nome e dimensão', async () => {
    expect((await send({ name: 'article_read', dimension: 'o-que-e-cet' })).status).toBe(204)
    expect((await send({ name: 'article_read', dimension: 'o-que-e-cet' })).status).toBe(204)
    expect((await send({ name: 'help_search_empty' })).status).toBe(204)
    expect(await counters(h)).toEqual([
      { name: 'event:article_read', dimension: 'o-que-e-cet', count: 2 },
      { name: 'event:help_search_empty', dimension: '', count: 1 },
    ])
  })

  it.each([
    ['page_section_view', '/'],
    ['page_section_view', '/ajuda'],
    ['page_section_view', '/conteudos/o-que-e-cet'],
    ['article_read', 'parcela-menor-e-custo-total'],
    ['help_search', 'consignado'],
    ['help_search', ''],
    ['help_search', undefined],
    ['help_search_empty', 'dados'],
    ['waitlist_start', 'avise-me'],
    ['waitlist_cta_click', 'avise-me'],
    ['waitlist_error', 'avise-me'],
    ['waitlist_confirmed', 'avise-me'],
    ['support_form_start', undefined],
    ['bia_demo_tab', 'prazo-parcela'],
    ['bia_channel_click', '/bia'],
  ])('aceita %s com a dimensão %j da lista do evento', async (name, dimension) => {
    const body = dimension === undefined ? { name } : { name, dimension }
    expect((await send(body, '203.0.113.11')).status).toBe(204)
  })

  it.each([
    ['nome fora do contrato', { name: 'purchase' }, 'name'],
    ['CPF junto da confirmação', { name: 'waitlist_confirmed', dimension: 'home', cpf: '52998224725' }, 'cpf'],
    ['campo que errou como dimensão', { name: 'waitlist_error', dimension: 'cpf' }, 'dimension'],
    ['mensagem de erro extra', { name: 'waitlist_error', dimension: 'home', message: 'CPF inválido' }, 'message'],
    ['CTA sem origem', { name: 'waitlist_cta_click' }, 'dimension'],
    ['campo extra (identificador)', { name: 'waitlist_start', dimension: 'avise-me', phone: '11987654321' }, 'phone'],
    ['nome de pessoa como rota', { name: 'page_section_view', dimension: 'maria.silva' }, 'dimension'],
    ['nome da rota em vez do caminho', { name: 'page_section_view', dimension: 'ajuda' }, 'dimension'],
    ['rota não indexável', { name: 'page_section_view', dimension: '/preferencias' }, 'dimension'],
    ['rota administrativa', { name: 'bia_channel_click', dimension: '/admin' }, 'dimension'],
    ['rota sem dimensão', { name: 'page_section_view' }, 'dimension'],
    ['artigo inexistente', { name: 'article_read', dimension: 'artigo-que-nao-existe' }, 'dimension'],
    ['texto livre na busca', { name: 'help_search', dimension: 'como pego emprestimo' }, 'dimension'],
    ['categoria inexistente', { name: 'help_search', dimension: 'emprestimo' }, 'dimension'],
    ['telefone na dimensão', { name: 'help_search', dimension: '11987654321' }, 'dimension'],
    ['e-mail na dimensão', { name: 'waitlist_start', dimension: 'ana@exemplo.com' }, 'dimension'],
    ['origem fora da lista', { name: 'waitlist_start', dimension: 'campanha-x' }, 'dimension'],
    ['dimensão em evento sem dimensão', { name: 'support_form_start', dimension: 'ajuda' }, 'dimension'],
    ['exemplo da Bia inexistente', { name: 'bia_demo_tab', dimension: 'margem' }, 'dimension'],
    ['dimensão longa', { name: 'page_section_view', dimension: 'a'.repeat(200) }, 'dimension'],
  ])('recusa %s sem gravar', async (_label, body, field) => {
    const before = await counters(h)
    const res = await send(body, '203.0.113.12')
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('validation_error')
    expect(res.body.error.fields[field]).toBeDefined()
    expect(await counters(h)).toEqual(before)
  })

  it('eventos da aquisição geram somente totais por origem de uma lista fixa', async () => {
    for (const name of ['waitlist_cta_click', 'waitlist_error', 'waitlist_confirmed']) {
      expect((await send({ name, dimension: 'home' }, '203.0.113.15')).status).toBe(204)
    }
    expect((await counters(h)).filter((counter) => counter.dimension === 'home')).toEqual([
      { name: 'event:waitlist_confirmed', dimension: 'home', count: 1 },
      { name: 'event:waitlist_cta_click', dimension: 'home', count: 1 },
      { name: 'event:waitlist_error', dimension: 'home', count: 1 },
    ])
  })

  it('limita a frequência por IP', async () => {
    const ip = '203.0.113.99'
    let last = 0
    for (let i = 0; i < 121; i++) last = (await send({ name: 'page_section_view', dimension: '/' }, ip)).status
    expect(last).toBe(429)
  })
})
