/**
 * Riscos concretos das páginas legais: selo de versão nunca afirmar revisão que não houve, inventário de
 * cookies nunca listar tecnologia que o código não usa, texto de medição descrever exatamente os eventos do
 * contrato, e âncoras internas dos documentos não quebrarem (o sumário e os links "veja a seção" dependem
 * dos ids gerados no build).
 */
import { describe, expect, it } from 'vitest'
import validation from '@contracts/validation.json'
import cookies from '@content/legal/cookies.md'
import privacy from '@content/legal/privacidade.md'
import terms from '@content/legal/termos.md'
import texts from '@content/legal/cookie-consent.yaml'
import {
  activeTechnologies,
  extractToc,
  noticeVersionLabel,
  splitLegalBlocks,
  type CookieTechnology,
  type MeasurementEventText,
} from './legal'

const DOCS = { privacy, terms, cookies }

describe('selo de versão', () => {
  it('rascunho mostra a data real de elaboração e a pendência de revisão', () => {
    const label = noticeVersionLabel({ version: '1.0', status: 'draft', draftedAt: '2026-09-25', revisedAt: null, reviewedBy: null })
    expect(label).toBe('Versão 1.0 · rascunho elaborado em 25/09/2026 · pendente de revisão jurídica')
  })

  it('"approved" sem data de revisão continua como rascunho', () => {
    const label = noticeVersionLabel({ version: '1.1', status: 'approved', draftedAt: '2026-09-25', revisedAt: null, reviewedBy: 'x' })
    expect(label).toContain('pendente de revisão jurídica')
  })

  it('revisado mostra a data da revisão', () => {
    const label = noticeVersionLabel({ version: '1.1', status: 'approved', draftedAt: '2026-09-25', revisedAt: '2026-10-02', reviewedBy: 'x' })
    expect(label).toBe('Versão 1.1 · revisada em 02/10/2026')
  })
})

describe('inventário de cookies', () => {
  const all = texts.technologies as CookieTechnology[]

  it('sem medição, lista as tecnologias necessárias às funções solicitadas pelo visitante', () => {
    expect(activeTechnologies(all, false).map((t) => t.name)).toEqual(['mf_contact', 'mf_admin', 'mf_browser_notifications'])
  })

  it('com medição, inclui o armazenamento da escolha e a categoria opcional', () => {
    const active = activeTechnologies(all, true)
    expect(active.map((t) => t.id)).toEqual(['mf_contact', 'mf_admin', 'mf_cookie_choice', 'medicao-agregada', 'mf_browser_notifications'])
    expect(active.filter((t) => t.category === 'measurement').map((t) => t.id)).toEqual(['medicao-agregada'])
  })
})

describe('texto da medição', () => {
  it('descreve todos os eventos do contrato e nenhum outro', () => {
    const events = texts.events as MeasurementEventText[]
    expect(events.map((e) => e.name).sort()).toEqual(Object.keys(validation.events.names).sort())
    for (const e of events) {
      expect(e.label.trim()).not.toBe('')
      expect(e.dimension.trim()).not.toBe('')
    }
  })

  it('eventos sem dimensão no contrato são descritos como sem valor enviado', () => {
    const names = validation.events.names as Record<string, string>
    for (const e of texts.events as MeasurementEventText[]) {
      if (names[e.name] === 'none') expect(e.dimension).toMatch(/^Nenhum/)
    }
  })
})

describe('documentos', () => {
  for (const [key, doc] of Object.entries(DOCS)) {
    it(`${key}: âncoras internas apontam para títulos existentes e ids não se repetem`, () => {
      const ids = [...doc.html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])
      expect(new Set(ids).size).toBe(ids.length)
      const anchors = [...doc.html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1])
      for (const anchor of anchors) expect(ids).toContain(anchor)
      expect(extractToc(doc.html).length).toBeGreaterThan(5)
    })
  }

  it('marcadores [[...]] viram blocos de encaixe e não sobram no texto', () => {
    const slots = (html: string) => splitLegalBlocks(html).filter((b) => b.type === 'slot').map((b) => (b as { name: string }).name)
    expect(slots(privacy.html)).toEqual(['medicao', 'webchat', 'contato'])
    expect(slots(cookies.html)).toEqual(['inventario', 'opcionais', 'webchat', 'escolhas'])
    expect(slots(terms.html)).toEqual([])
    for (const doc of Object.values(DOCS)) {
      const rest = splitLegalBlocks(doc.html).filter((b) => b.type === 'html').map((b) => (b as { html: string }).html)
      expect(rest.join('')).not.toMatch(/\[\[/)
    }
  })
})
