/**
 * Riscos concretos da área editorial: link interno que leva a lugar nenhum (conteúdo, ajuda, segurança,
 * lançamento, FAQ e corpo dos artigos), fonte fora dos órgãos oficiais, revisão exibida como concluída
 * sem data e responsável, marco "em andamento" ou "concluído" sem evidência e responsável, busca que falha
 * com acento/maiúscula, busca medida a cada tecla (ou com o texto digitado) e âncora de pergunta da ajuda
 * que não abre nada.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import articles from 'virtual:mf-articles'
import validation from '@contracts/validation.json'
import faq from '@content/faq.yaml'
import launch from '@content/launch.yaml'
import ajuda from '@content/pages/ajuda.yaml'
import conteudos from '@content/pages/conteudos.yaml'
import lancamento from '@content/pages/lancamento.yaml'
import seguranca from '@content/pages/seguranca.yaml'
import ReviewStatus from '@/components/editorial/ReviewStatus.vue'
import { ARTICLE_BASE, ROUTES } from '@/router/manifest'
import type { Article, FaqBase } from '@/types/content'
import { currentMilestone, parseMilestones } from './milestones'
import { buildSearchIndex, createSearchSettler, faqIdFromHash, matchesTerms, searchTerms } from './search'

const base = faq as FaqBase
const faqIds = base.items.map((i) => i.id)
const slugs = articles.map((a) => a.slug)
const routePaths = new Set(ROUTES.map((r) => r.path))
const subjects = validation.support.subjects.map((s: { value: string }) => s.value)

/** Todos os valores `to` de um objeto de conteúdo, em qualquer profundidade. */
function collectTo(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach((n) => collectTo(n, out))
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === 'to' && typeof v === 'string') out.push(v)
      else collectTo(v, out)
    }
  }
  return out
}

/** Links internos (href="/...") de um HTML gerado a partir de Markdown. */
function internalHrefs(html: string): string[] {
  return [...html.matchAll(/href="(\/[^"]*)"/g)].map((m) => m[1]!.replaceAll('&amp;', '&'))
}

/** Motivo pelo qual um link interno não leva a um destino real; null se estiver correto. */
function brokenReason(link: string): string | null {
  const url = new URL(link, 'https://site.invalid')
  const path = url.pathname.replace(/\/$/, '') || '/'
  if (path.startsWith(`${ARTICLE_BASE}/`)) {
    if (!slugs.includes(path.slice(ARTICLE_BASE.length + 1))) return 'artigo inexistente'
  } else if (!routePaths.has(path)) return 'rota inexistente'
  if (path === '/ajuda' && url.hash && !url.hash.startsWith('#tema-') && !faqIdFromHash(url.hash, faqIds)) {
    return 'pergunta inexistente'
  }
  const subject = url.searchParams.get('assunto')
  if (path === '/atendimento' && subject !== null && !subjects.includes(subject)) return 'assunto inexistente'
  return null
}

describe('links internos da área editorial', () => {
  const sources: Record<string, string[]> = {
    'pages/ajuda.yaml': collectTo(ajuda),
    'pages/conteudos.yaml': collectTo(conteudos),
    'pages/seguranca.yaml': collectTo(seguranca),
    'pages/lancamento.yaml': collectTo(lancamento),
    'faq.yaml (related e respostas)': [
      ...collectTo(base.items),
      ...base.items.flatMap((i) => internalHrefs(i.answer_md)),
    ],
    ...Object.fromEntries(articles.map((a) => [`articles/${a.slug}.md`, internalHrefs(a.html)])),
  }

  it.each(Object.entries(sources))('%s aponta só para destinos existentes', (_file, links) => {
    const broken = links.map((l) => [l, brokenReason(l)]).filter(([, reason]) => reason)
    expect(broken).toEqual([])
  })

  it('a regra de links reconhece destinos quebrados', () => {
    expect(brokenReason('/simular')).toBe('rota inexistente')
    expect(brokenReason('/conteudos/nao-existe')).toBe('artigo inexistente')
    expect(brokenReason('/ajuda#pergunta-removida')).toBe('pergunta inexistente')
    expect(brokenReason('/atendimento?assunto=cpf')).toBe('assunto inexistente')
    expect(brokenReason('/atendimento?assunto=seguranca')).toBeNull()
  })
})

describe('artigos', () => {
  const OFFICIAL = /(^|\.)(bcb\.gov\.br|gov\.br|planalto\.gov\.br|consumidor\.gov\.br)$/

  it.each(articles.map((a) => [a.slug, a] as const))('%s: fontes oficiais, com data de consulta', (_slug, a) => {
    expect(a.sources.length).toBeGreaterThan(0)
    for (const s of a.sources) {
      const url = new URL(s.url)
      expect(url.protocol).toBe('https:')
      expect(url.hostname).toMatch(OFFICIAL)
      expect(s.accessedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it.each(articles.map((a) => [a.slug, a] as const))('%s: dois relacionados existentes e CTA válido', (_slug, a) => {
    expect(a.related).toHaveLength(2)
    expect(new Set(a.related).size).toBe(2)
    for (const r of a.related) {
      expect(r).not.toBe(a.slug)
      expect(slugs).toContain(r)
    }
    expect(['bia', 'ajuda']).toContain(a.cta)
    expect(a.headings.length).toBeGreaterThan(0)
  })

  it('só publica categorias que existem na configuração do site', async () => {
    const { site } = await import('@/services/site')
    const ids = (site.contentCategories as { id: string }[]).map((c) => c.id)
    for (const a of articles) expect(ids).toContain(a.category)
  })
})

describe('situação da revisão financeira', () => {
  async function render(review: Article['review']) {
    return renderToString(createSSRApp({ render: () => h(ReviewStatus, { review }) }))
  }

  it('pendente enquanto não aprovada', async () => {
    const html = await render({ status: 'pending', reviewedAt: null, reviewer: null })
    expect(html).toContain('Revisão financeira pendente')
    expect(html).not.toContain('Revisado em')
  })

  it('"approved" sem data ou responsável continua pendente (nunca data automática)', async () => {
    for (const review of [
      { status: 'approved', reviewedAt: null, reviewer: 'Equipe financeira' },
      { status: 'approved', reviewedAt: '2026-10-01', reviewer: null },
    ] as Article['review'][]) {
      const html = await render(review)
      expect(html).toContain('Revisão financeira pendente')
      expect(html).not.toContain('Revisado em')
    }
  })

  it('aprovada mostra a data registrada e o responsável', async () => {
    const html = await render({ status: 'approved', reviewedAt: '2026-10-01', reviewer: 'Equipe financeira' })
    expect(html).toContain('Revisado em')
    expect(html).toContain('datetime="2026-10-01"')
    expect(html).toContain('Equipe financeira')
  })
})

describe('marcos da abertura financeira', () => {
  const marco = (over: Record<string, unknown>) => ({
    id: 'm',
    title: 'Marco',
    description: 'Descrição',
    status: 'pending',
    evidence: null,
    updatedAt: null,
    responsible: null,
    ...over,
  })

  it('o launch.yaml versionado é válido e tem os quatro marcos', () => {
    const list = parseMilestones(launch)
    expect(list).toHaveLength(4)
    // Nenhum marco sai de "pending" sem evidência, data e responsável registrados.
    for (const m of list.filter((x) => x.status !== 'pending')) {
      expect([m.id, m.evidence && m.updatedAt && m.responsible ? 'ok' : 'sem registro']).toEqual([m.id, 'ok'])
    }
  })

  it.each(['done', 'in_progress'])('"%s" sem evidência, data ou responsável interrompe o build', (status) => {
    const re = new RegExp(status)
    expect(() => parseMilestones({ milestones: [marco({ status, updatedAt: '2026-10-01', responsible: 'X' })] })).toThrow(re)
    expect(() => parseMilestones({ milestones: [marco({ status, evidence: 'Ata', responsible: 'X' })] })).toThrow(re)
    expect(() => parseMilestones({ milestones: [marco({ status, evidence: 'Ata', updatedAt: '2026-10-01' })] })).toThrow(re)
    expect(() => parseMilestones({ milestones: [marco({ status, evidence: 'Ata', updatedAt: '2026-10-01', responsible: 'X' })] })).not.toThrow()
  })

  it('"pending" não exige registro', () => {
    expect(() => parseMilestones({ milestones: [marco({})] })).not.toThrow()
  })

  it('rejeita status desconhecido e data fora do formato', () => {
    expect(() => parseMilestones({ milestones: [marco({ status: 'quase' })] })).toThrow(/status/)
    expect(() => parseMilestones({ milestones: [marco({ updatedAt: '25/09/2026' })] })).toThrow(/AAAA-MM-DD/)
  })

  it('marco atual: o que está em andamento; sem ele, o primeiro não concluído', () => {
    const done = { evidence: 'Ata', updatedAt: '2026-10-01', responsible: 'X', status: 'done' }
    const list = parseMilestones({
      milestones: [marco({ id: 'a', ...done }), marco({ id: 'b' }), marco({ id: 'c', ...done, status: 'in_progress' })],
    })
    expect(currentMilestone(list)?.id).toBe('c')
    expect(currentMilestone(parseMilestones({ milestones: [marco({ id: 'a', ...done }), marco({ id: 'b' })] }))?.id).toBe('b')
    expect(currentMilestone(parseMilestones({ milestones: [marco({ id: 'a', ...done })] }))).toBeNull()
  })
})

describe('busca local', () => {
  const index = buildSearchIndex(['Custo Efetivo Total', '<p>Evite <a href="/seguranca" class="x">golpes</a> &amp; fraudes</p>'])

  it('ignora acento e maiúsculas', () => {
    expect(matchesTerms(index, searchTerms('EFETIVO'))).toBe(true)
    expect(matchesTerms(buildSearchIndex(['Segurança e atenção']), searchTerms('seguranca atencao'))).toBe(true)
  })

  it('exige todos os termos, em qualquer ordem; plural encontra o singular', () => {
    expect(matchesTerms(index, searchTerms('total custo'))).toBe(true)
    expect(matchesTerms(index, searchTerms('custo aprovacao'))).toBe(false)
    expect(matchesTerms(buildSearchIndex(['sinais de golpe']), searchTerms('golpes'))).toBe(true)
  })

  it('não encontra resultados por nomes de tags, atributos ou entidades HTML', () => {
    for (const q of ['href', 'class', 'seguranca', 'amp']) expect(matchesTerms(index, searchTerms(q))).toBe(false)
  })

  it('consulta vazia ou só com espaços não filtra nada', () => {
    expect(searchTerms('   ')).toEqual([])
  })
})

describe('medição da busca da ajuda', () => {
  afterEach(() => vi.useRealTimers())

  it('conta uma vez quando a digitação para, nunca a cada tecla, e o aviso não recebe o texto', () => {
    vi.useFakeTimers()
    const onSettled = vi.fn()
    const settler = createSearchSettler(1000, onSettled)
    for (const q of ['c', 'ce', 'cet']) {
      settler.update(searchTerms(q))
      vi.advanceTimersByTime(300)
    }
    expect(onSettled).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(onSettled).toHaveBeenCalledTimes(1)
    expect(onSettled.mock.calls[0]).toEqual([])
  })

  it('a mesma busca não conta de novo; limpar e buscar de novo conta', () => {
    vi.useFakeTimers()
    const onSettled = vi.fn()
    const settler = createSearchSettler(1000, onSettled)
    settler.update(searchTerms('golpe'))
    vi.advanceTimersByTime(1000)
    settler.update(searchTerms('Golpe '))
    vi.advanceTimersByTime(1000)
    expect(onSettled).toHaveBeenCalledTimes(1)
    settler.update(searchTerms(''))
    settler.update(searchTerms('golpe'))
    vi.advanceTimersByTime(1000)
    expect(onSettled).toHaveBeenCalledTimes(2)
  })

  it('sair da página antes de a digitação parar não conta nada', () => {
    vi.useFakeTimers()
    const onSettled = vi.fn()
    const settler = createSearchSettler(1000, onSettled)
    settler.update(searchTerms('margem'))
    settler.cancel()
    vi.advanceTimersByTime(5000)
    expect(onSettled).not.toHaveBeenCalled()
  })
})

describe('central de ajuda', () => {
  it('cada tema tem perguntas publicadas', () => {
    for (const c of base.categories) expect(base.items.some((i) => i.category === c.id)).toBe(true)
    for (const i of base.items) expect(base.categories.map((c) => c.id)).toContain(i.category)
  })

  it('ids das perguntas são únicos (a âncora abre uma única resposta)', () => {
    expect(new Set(faqIds).size).toBe(faqIds.length)
  })

  it('âncora de pergunta aceita #id e #faq-id e recusa o que não existe', () => {
    expect(faqIdFromHash('#preciso-pagar', faqIds)).toBe('preciso-pagar')
    expect(faqIdFromHash('#faq-preciso-pagar', faqIds)).toBe('preciso-pagar')
    expect(faqIdFromHash('#tema-dados', faqIds)).toBeNull()
    expect(faqIdFromHash('#nao-existe', faqIds)).toBeNull()
    expect(faqIdFromHash('#%E0%A4%A', faqIds)).toBeNull()
  })
})
