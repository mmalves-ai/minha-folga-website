import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'yaml'
import { CONTENT_DIR } from '../config/paths.js'
import { toPublicConfig } from '../config/public.js'
import type { AppContext } from '../context.js'

/**
 * Base aprovada de perguntas frequentes (frontend/content/faq.yaml), a mesma da central /ajuda.
 * Usada pela ferramenta `get_approved_faq` da Bia: a resposta sai em texto simples, com links absolutos
 * e a versão da base. Nada é gerado aqui: sem correspondência, o resultado é vazio e explícito.
 */

export interface FaqLink {
  label: string
  url: string
}

export interface FaqEntry {
  id: string
  category: string
  categoryLabel: string
  question: string
  /** Resposta em texto simples (Markdown convertido; marcadores de identidade resolvidos). */
  answer: string
  /** Central de ajuda (absoluto). Links relacionados da pergunta ficam em `links`. */
  helpUrl: string
  links: FaqLink[]
}

export interface FaqRevision {
  version: string
  status: string
  approvedAt: string | null
}

export interface FaqBase {
  revision: FaqRevision
  categories: { id: string; label: string }[]
  items: FaqEntry[]
  /** Itens omitidos por conter marcador pendente ou dado de identidade não configurado. */
  withheld: number
}

export interface FaqSearchResult {
  found: boolean
  baseVersion: string
  baseStatus: string
  items: FaqEntry[]
}

const FAQ_FILE = resolve(CONTENT_DIR, 'faq.yaml')

// ------------------------------------------------------------------------------ Markdown → texto

/** Converte Markdown simples em texto corrido e coleta os links encontrados. HTML bruto é descartado. */
export function markdownToPlainText(md: string): { text: string; links: { label: string; href: string }[] } {
  const links: { label: string; href: string }[] = []
  let text = md.replace(/\r\n?/g, '\n')
  text = text.replace(/```[^\n]*\n([\s\S]*?)```/g, '$1')
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  text = text.replace(/\[([^\]]+)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g, (_m, label: string, href: string) => {
    links.push({ label, href })
    return label
  })
  text = text.replace(/<(https?:\/\/[^>\s]+)>/g, (_m, href: string) => {
    links.push({ label: href, href })
    return href
  })
  text = text.replace(/<\/?[a-zA-Z][^>]*>/g, '')
  text = text.replace(/`([^`]+)`/g, '$1')
  text = text.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2')
  text = text.replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?!\w)/g, '$1$2')
  text = text.replace(/(^|[^\w])_(?=\S)([^_\n]*?\S)_(?!\w)/g, '$1$2')
  text = text.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
  text = text.replace(/^[ \t]{0,3}>[ \t]?/gm, '')
  text = text.replace(/^[ \t]*[-*+][ \t]+/gm, '• ')
  text = text.replace(/^[ \t]*([-*_])\1{2,}[ \t]*$/gm, '')
  text = text.replace(/\\([\\`*_{}[\]()#+\-.!>])/g, '$1')
  text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
  return { text: text.trim(), links }
}

// ------------------------------------------------------------------------------ carga da base

const IDENTITY_MARKER = /\{\{\s*identity\.([a-zA-Z]+)\s*\}\}/g
const ANY_MARKER = /\{\{[^}]*\}\}/

/** Resolve {{identity.*}} pela configuração pública. Retorna null se sobrar marcador sem dado real. */
function resolveMarkers(text: string, identity: Record<string, unknown>): string | null {
  let missing = false
  const out = text.replace(IDENTITY_MARKER, (_m, key: string) => {
    const value = identity[key]
    if (typeof value === 'string' && value.trim()) return value
    missing = true
    return ''
  })
  if (missing || ANY_MARKER.test(out)) return null
  return out
}

function absoluteUrl(siteUrl: string, href: string): string | null {
  if (/^\/(?!\/)/.test(href)) return `${siteUrl}${href}`
  if (/^https:\/\//.test(href)) return href
  return null // âncoras, mailto e esquemas desconhecidos não saem como link
}

interface RawFaq {
  revision?: { version?: unknown; status?: unknown; approvedAt?: unknown }
  categories?: { id?: unknown; label?: unknown }[]
  items?: { id?: unknown; category?: unknown; question?: unknown; answer_md?: unknown; related?: { label?: unknown; to?: unknown }[] }[]
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const dateStr = (v: unknown): string | null => (v instanceof Date ? v.toISOString().slice(0, 10) : str(v))

export function buildFaqBase(raw: RawFaq, siteUrl: string, identity: Record<string, unknown>): FaqBase {
  const categories = (raw.categories ?? [])
    .map((c) => ({ id: str(c.id), label: str(c.label) }))
    .filter((c): c is { id: string; label: string } => Boolean(c.id && c.label))
  const labelOf = new Map(categories.map((c) => [c.id, c.label]))

  const items: FaqEntry[] = []
  let withheld = 0
  for (const item of raw.items ?? []) {
    const id = str(item.id)
    const category = str(item.category)
    const questionRaw = str(item.question)
    const answerRaw = str(item.answer_md)
    if (!id || !category || !questionRaw || !answerRaw || !labelOf.has(category)) {
      withheld++
      continue
    }
    const question = resolveMarkers(questionRaw, identity)
    const answerMd = resolveMarkers(answerRaw, identity)
    if (question === null || answerMd === null) {
      withheld++
      continue
    }
    const { text, links: inline } = markdownToPlainText(answerMd)
    const links: FaqLink[] = []
    const seen = new Set<string>()
    const push = (label: string | null, href: string | null) => {
      const url = href ? absoluteUrl(siteUrl, href) : null
      if (!label || !url || seen.has(url)) return
      seen.add(url)
      links.push({ label, url })
    }
    for (const l of inline) push(l.label, l.href)
    for (const r of item.related ?? []) push(str(r.label), str(r.to))
    items.push({
      id,
      category,
      categoryLabel: labelOf.get(category)!,
      question: markdownToPlainText(question).text,
      answer: text,
      helpUrl: `${siteUrl}/ajuda`,
      links,
    })
  }

  const rev = raw.revision ?? {}
  return {
    revision: {
      version: str(rev.version) ?? (typeof rev.version === 'number' ? String(rev.version) : 'unversioned'),
      status: str(rev.status) ?? 'draft',
      approvedAt: dateStr(rev.approvedAt),
    },
    categories,
    items,
    withheld,
  }
}

let cache: { mtimeMs: number; siteUrl: string; base: FaqBase } | undefined

/** Lê a base (com cache invalidado pela data de modificação do arquivo). */
export function loadFaqBase(ctx: AppContext, file = FAQ_FILE): FaqBase {
  const mtimeMs = statSync(file).mtimeMs
  if (cache && cache.mtimeMs === mtimeMs && cache.siteUrl === ctx.config.siteUrl && file === FAQ_FILE) return cache.base
  const raw = parse(readFileSync(file, 'utf8')) as RawFaq
  const identity = toPublicConfig(ctx.config).identity as unknown as Record<string, unknown>
  const base = buildFaqBase(raw ?? {}, ctx.config.siteUrl, identity)
  if (file === FAQ_FILE) cache = { mtimeMs, siteUrl: ctx.config.siteUrl, base }
  return base
}

/** Em produção, somente base com status "approved" responde à Bia. */
export function faqBaseUsable(ctx: AppContext, base: FaqBase): boolean {
  return ctx.config.env !== 'production' || base.revision.status === 'approved'
}

export const faqBaseVersion = (base: FaqBase) => `faq.v${base.revision.version}.${base.revision.status}`

// ------------------------------------------------------------------------------ busca

const STOPWORDS = new Set(
  (
    'a o as os um uma uns umas de da do das dos e em no na nos nas num numa para pra pro por pelo pela pelos pelas ' +
    'com sem que se eu tu ele ela nos vos eles elas voce voces vc me te lhe meu minha meus minhas seu sua seus suas ' +
    'teu tua isso isto esse essa este esta aquilo ja qual quais como quando onde porque pq quem ou ao aos ' +
    'e ser sou sao era esta estao estou tem tenho ter ha vai vou foi mais muito muita oi ola bom boa dia tarde noite ' +
    'queria quero gostaria saber sobre algum alguma favor obrigado obrigada ai la aqui entao so tambem'
  ).split(/\s+/),
)

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
}

function stem(t: string): string {
  return t.length > 4 && t.endsWith('s') ? t.slice(0, -1) : t
}

export function tokenize(s: string): string[] {
  return normalize(s)
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t))
    .map(stem)
}

/** Igualdade ou raiz comum longa (ex.: "liberando" × "liberar", "cadastro" × "cadastrar"). */
function similar(a: string, b: string): boolean {
  if (a === b) return true
  const min = Math.min(a.length, b.length)
  if (min < 4) return false
  let i = 0
  while (i < min && a[i] === b[i]) i++
  return i >= Math.max(4, Math.ceil(min * 0.75))
}

interface Scored {
  entry: FaqEntry
  score: number
}

/**
 * Busca por termos na pergunta (peso 3), resposta e categoria (peso 1).
 * Só retorna itens com correspondência relevante (termo na pergunta cobrindo ao menos um terço da consulta,
 * ou cobertura alta pela resposta); perguntas fora da base resultam em lista vazia, nunca na "mais parecida".
 */
export function searchFaq(base: FaqBase, query: string | undefined, category: string | undefined, limit: number): FaqEntry[] {
  const pool = category ? base.items.filter((i) => i.category === category) : base.items
  if (!query) return pool.slice(0, limit)
  const terms = [...new Set(tokenize(query))]
  if (!terms.length) return []

  const scored: Scored[] = []
  for (const entry of pool) {
    const q = tokenize(entry.question)
    const rest = [...tokenize(entry.answer), ...tokenize(entry.categoryLabel)]
    let inQuestion = 0
    let inRest = 0
    for (const term of terms) {
      if (q.some((t) => similar(term, t))) inQuestion++
      else if (rest.some((t) => similar(term, t))) inRest++
    }
    const matched = inQuestion + inRest
    const coverage = matched / terms.length
    // Com termo na pergunta, basta cobrir um terço da consulta; só na resposta, exige cobertura alta.
    const relevant = inQuestion >= 1 ? coverage >= 1 / 3 : inRest >= 2 && coverage >= 0.75
    if (!relevant) continue
    const score = inQuestion * 3 + inRest
    // Desempate: pergunta mais específica (maior fração dos seus termos coberta).
    const specificity = q.length ? inQuestion / q.length : 0
    scored.push({ entry, score: score + specificity })
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.entry)
}
