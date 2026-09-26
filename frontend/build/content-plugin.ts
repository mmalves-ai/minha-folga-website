/**
 * Plugin de conteúdo da Minha Folga (executa somente no build/dev, no Node).
 *
 * - `*.yaml` em content/ → módulo JSON. Campos cujo nome termina em `_md` chegam como HTML
 *   renderizado por markdown-it com HTML bruto desabilitado (conteúdo escapado).
 * - `*.md` em content/legal → { meta, html }.
 * - `virtual:mf-articles` → artigos da central editorial com tempo de leitura calculado do texto.
 * - `virtual:mf-public-config` → lista permitida de configuração pública exportada pelo backend.
 *
 * Marcadores `{{identity.legalName}}`, `{{channels.whatsappNumber}}` etc. são substituídos pela
 * configuração pública validada. Dado ausente vira um marcador visível de pendência — permitido
 * apenas fora do modo estrito. No modo estrito (release pública) o build falha com a lista de pendências.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import MarkdownIt from 'markdown-it'
import type { Plugin } from 'vite'
import { LineCounter, isMap, parseDocument, parse as parseYaml, visit } from 'yaml'

export interface ContentPluginOptions {
  contentDir: string
  contractsDir: string
  publicConfigFile: string
  strict: boolean
  siteUrl: string
}

const VIRTUAL_ARTICLES = 'virtual:mf-articles'
const VIRTUAL_PUBLIC_CONFIG = 'virtual:mf-public-config'

type Json = null | boolean | number | string | Json[] | { [k: string]: Json }

const PLACEHOLDER_LABELS: Record<string, string> = {
  'identity.legalName': 'razão social',
  'identity.cnpj': 'CNPJ',
  'identity.address': 'endereço',
  'identity.privacyContact': 'canal de privacidade',
  'identity.privacyOfficerName': 'encarregado de dados',
  'identity.supportContact': 'canal de atendimento',
  'identity.supportPhone': 'telefone de atendimento',
  'identity.supportHours': 'horário de atendimento',
  'identity.supportResponseTime': 'prazo de resposta',
  'channels.whatsappNumber': 'número de WhatsApp',
}

function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

function formatCnpj(v: string): string {
  const d = v.replace(/\D/g, '')
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : v
}

function formatPhone(e164: string): string {
  const d = e164.replace(/\D/g, '').replace(/^55/, '')
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return e164
}

/**
 * Chaves sem valor dentro de mapas em linha (`{ ... }`). Em YAML, a vírgula separa os pares de um
 * mapa em linha: `{ label: Bia, nossa IA, to: /bia }` vira { label: 'Bia', 'nossa IA': null } e o
 * texto sai truncado sem erro. Um par sem ":" nesse contexto é sempre esse engano; o valor com
 * vírgula precisa de aspas (`label: 'Bia, nossa IA'`). Pares com valor vazio explícito (`a: `)
 * não entram na lista.
 */
export function flowMapKeysWithoutValue(source: string): { key: string; line: number }[] {
  const lineCounter = new LineCounter()
  const doc = parseDocument(source, { lineCounter })
  const found: { key: string; line: number }[] = []
  visit(doc, {
    Pair(_key, pair, path) {
      const parent = path[path.length - 1]
      if (!isMap(parent) || !parent.flow || pair.value !== null) return
      const key = pair.key as { value?: unknown; range?: [number, number, number] } | null
      const offset = key?.range?.[0] ?? 0
      found.push({ key: String(key?.value ?? ''), line: lineCounter.linePos(offset).line })
    },
  })
  return found
}

/**
 * Verifica um arquivo de conteúdo (YAML inteiro ou front matter de Markdown) e devolve a mensagem
 * de pendência, ou null. As linhas contam a partir do início do arquivo.
 */
export function flowMapIssue(file: string, source: string): string | null {
  const yamlSource = file.endsWith('.md') ? (/^---\r?\n([\s\S]*?)\r?\n---/.exec(source)?.[1] ?? '') : source
  const offset = file.endsWith('.md') && yamlSource ? 1 : 0
  const issues = flowMapKeysWithoutValue(yamlSource)
  if (!issues.length) return null
  return (
    `${file}: texto com vírgula sem aspas em mapa em linha (${issues.map((i) => `linha ${i.line + offset}, "${i.key}"`).join('; ')}). ` +
    "Ponha o valor entre aspas, por exemplo label: 'Bia, nossa IA'."
  )
}

function frontmatter(source: string): { data: Record<string, unknown>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(source)
  if (!m) return { data: {}, body: source }
  return { data: (parseYaml(m[1]!) ?? {}) as Record<string, unknown>, body: m[2]! }
}

export function mfContent(options: ContentPluginOptions): Plugin {
  const md = new MarkdownIt({ html: false, linkify: false, typographer: false, breaks: false })

  // Âncoras em h2/h3 para sumário e links diretos.
  md.core.ruler.push('heading_ids', (state) => {
    const seen = new Map<string, number>()
    state.tokens.forEach((token, i) => {
      if (token.type !== 'heading_open' || !['h2', 'h3'].includes(token.tag)) return
      const inline = state.tokens[i + 1]
      const base = slugify(inline?.content ?? '') || 'secao'
      const n = seen.get(base) ?? 0
      seen.set(base, n + 1)
      token.attrSet('id', n ? `${base}-${n}` : base)
    })
  })

  // Links externos: rel seguro. Links internos seguem como href relativo ao site.
  const defaultLinkOpen =
    md.renderer.rules.link_open ?? ((tokens, idx, opts, _env, self) => self.renderToken(tokens, idx, opts))
  md.renderer.rules.link_open = (tokens, idx, opts, env, self) => {
    const href = String(tokens[idx]!.attrGet('href') ?? '')
    if (/^https?:\/\//.test(href) && !href.startsWith(options.siteUrl)) {
      tokens[idx]!.attrSet('rel', 'noopener noreferrer')
      tokens[idx]!.attrSet('class', 'external')
    }
    return defaultLinkOpen(tokens, idx, opts, env, self)
  }

  let publicConfig: Record<string, any> | null = null
  const pending = new Set<string>()

  function loadPublicConfig(): Record<string, any> {
    if (publicConfig) return publicConfig
    if (!existsSync(options.publicConfigFile)) {
      throw new Error(
        `[mf-content] Configuração pública não encontrada em ${options.publicConfigFile}. ` +
          'Gere com `npm run export:public-config` no backend (scripts/build.sh faz isso) ou use MF_PUBLIC_CONFIG_FILE.',
      )
    }
    publicConfig = JSON.parse(readFileSync(options.publicConfigFile, 'utf8'))
    return publicConfig!
  }

  function lookup(path: string): unknown {
    return path.split('.').reduce<any>((acc, key) => (acc == null ? undefined : acc[key]), loadPublicConfig())
  }

  function interpolate(html: string, file: string, mode: 'html' | 'text' = 'html'): string {
    // {{pending: descrição}} marca conteúdo que depende de decisão/dado real ainda não fornecido.
    html = html.replace(/\{\{\s*pending:\s*([^}]+?)\s*\}\}/g, (_m, what: string) => {
      pending.add(`${what} — usado em ${file}`)
      if (options.strict) throw new Error(`[mf-content] Conteúdo pendente "${what}" em ${file} bloqueia a release pública`)
      return mode === 'text' ? `[pendente: ${what}]` : `<span class="pending-data">[pendente: ${escapeHtml(what)}]</span>`
    })
    return html.replace(/\{\{\s*([a-zA-Z.]+)\s*\}\}/g, (_m, path: string) => {
      const value = lookup(path)
      if (value === undefined && !(path in PLACEHOLDER_LABELS)) {
        throw new Error(`[mf-content] Marcador desconhecido {{${path}}} em ${file}`)
      }
      if (value == null || value === '') {
        const label = PLACEHOLDER_LABELS[path] ?? path
        pending.add(`${label} (${path}) — usado em ${file}`)
        if (mode === 'text') return `[pendente: ${label}]`
        return `<span class="pending-data">[pendente: ${escapeHtml(label)}]</span>`
      }
      let text = String(value)
      if (path === 'identity.cnpj') text = formatCnpj(text)
      if (path === 'channels.whatsappNumber' || path === 'identity.supportPhone') text = formatPhone(text)
      return mode === 'text' ? text : escapeHtml(text)
    })
  }

  function renderMarkdown(src: string, file: string, inline = false): string {
    const html = inline ? md.renderInline(src) : md.render(src)
    return interpolate(html, file)
  }

  function transformMdFields(value: Json, file: string, key = ''): Json {
    if (Array.isArray(value)) return value.map((v) => transformMdFields(v, file, key))
    if (value && typeof value === 'object') {
      const out: Record<string, Json> = {}
      for (const [k, v] of Object.entries(value)) out[k] = transformMdFields(v as Json, file, k)
      return out
    }
    if (typeof value === 'string') {
      if (key.endsWith('_md')) return renderMarkdown(value, file)
      if (key.endsWith('_mdi')) return renderMarkdown(value, file, true)
      if (value.includes('{{')) return interpolate(value, file, 'text')
    }
    return value
  }

  function wordCount(text: string): number {
    return text
      .replace(/[#>*_`\[\]()!-]/g, ' ')
      .split(/\s+/)
      .filter((w) => /[\p{L}\p{N}]/u.test(w)).length
  }

  function loadArticles() {
    const dir = join(options.contentDir, 'articles')
    const files = readdirSync(dir).filter((f) => f.endsWith('.md'))
    const articles = files.map((f) => {
      const file = join(dir, f)
      const { data, body } = frontmatter(readFileSync(file, 'utf8'))
      const slug = String(data.slug ?? basename(f, '.md'))
      if (slug !== basename(f, '.md')) throw new Error(`[mf-content] slug diferente do nome do arquivo em ${f}`)
      for (const required of ['title', 'summary', 'category', 'author', 'draftedAt', 'sources', 'related']) {
        if (data[required] == null) throw new Error(`[mf-content] campo "${required}" ausente em ${f}`)
      }
      const words = wordCount(body)
      const headings = [...body.matchAll(/^##\s+(.+)$/gm)].map((m) => ({ id: slugify(m[1]!), text: m[1]!.trim() }))
      return {
        ...data,
        slug,
        words,
        readingMinutes: Math.max(1, Math.round(words / 200)),
        headings,
        html: renderMarkdown(body, relative(options.contentDir, file)),
      }
    })
    articles.sort((a: any, b: any) => String(a.order ?? a.slug).localeCompare(String(b.order ?? b.slug), 'pt-BR', { numeric: true }))
    return articles
  }

  /** Verificações de publicação (modo estrito). Retorna a lista de pendências encontradas. */
  function releaseIssues(): string[] {
    const issues: string[] = []
    const cfg = loadPublicConfig()
    if (!cfg.identity?.complete) {
      issues.push(`Identidade empresarial incompleta: ${(cfg.identity?.missing ?? []).join(', ')}`)
    }
    if (cfg.siteUrl && cfg.siteUrl !== options.siteUrl) {
      issues.push(`VITE_SITE_URL (${options.siteUrl}) difere de PUBLIC_SITE_URL do backend (${cfg.siteUrl})`)
    }
    const notices = JSON.parse(readFileSync(join(options.contractsDir, 'consents.json'), 'utf8')).notices
    for (const [name, meta] of Object.entries<any>(notices)) {
      if (meta.status !== 'approved' || !meta.revisedAt) issues.push(`Aviso legal "${name}" sem revisão aprovada (contracts/consents.json)`)
    }
    for (const a of loadArticles() as any[]) {
      if (a.review?.status !== 'approved' || !a.review?.reviewedAt || !a.review?.reviewer) {
        issues.push(`Artigo "${a.slug}" sem revisão financeira registrada`)
      }
      if (!a.publishedAt) issues.push(`Artigo "${a.slug}" sem data de publicação`)
    }
    const walk = (dir: string, ext: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(dir, e.name), ext) : e.name.endsWith(ext) ? [join(dir, e.name)] : [],
      )
    // Textos truncados por vírgula sem aspas (YAML e front matter dos Markdown).
    for (const file of [...walk(options.contentDir, '.yaml'), ...walk(options.contentDir, '.md')]) {
      const issue = flowMapIssue(relative(options.contentDir, file), readFileSync(file, 'utf8'))
      if (issue) issues.push(issue)
    }
    for (const file of walk(options.contentDir, '.yaml')) {
      const data = parseYaml(readFileSync(file, 'utf8')) as any
      const rev = data?.revision
      if (!rev) issues.push(`${relative(options.contentDir, file)} sem bloco "revision"`)
      else if (rev.status !== 'approved' || !rev.approvedAt || !rev.approvedBy) {
        issues.push(`${relative(options.contentDir, file)} sem aprovação registrada (revision.status/approvedAt/approvedBy)`)
      }
    }
    return issues
  }

  return {
    name: 'mf-content',
    enforce: 'pre',

    buildStart() {
      publicConfig = null
      pending.clear()
      loadPublicConfig()
      if (options.strict) {
        const issues = releaseIssues()
        if (issues.length) {
          this.error(
            '\n[mf-content] Release pública bloqueada. Pendências de publicação:\n' +
              issues.map((i) => `  - ${i}`).join('\n') +
              '\nVeja docs/PENDENCIAS_PUBLICACAO.md.',
          )
        }
      }
    },

    resolveId(id) {
      if (id === VIRTUAL_ARTICLES || id === VIRTUAL_PUBLIC_CONFIG) return '\0' + id
      return null
    },

    load(id) {
      if (id === '\0' + VIRTUAL_PUBLIC_CONFIG) {
        this.addWatchFile(options.publicConfigFile)
        return `export default ${JSON.stringify(loadPublicConfig())}`
      }
      if (id === '\0' + VIRTUAL_ARTICLES) {
        const dir = join(options.contentDir, 'articles')
        for (const f of readdirSync(dir)) {
          this.addWatchFile(join(dir, f))
          const flow = f.endsWith('.md') ? flowMapIssue(`articles/${f}`, readFileSync(join(dir, f), 'utf8')) : null
          if (flow) this.error(`[mf-content] ${flow}`)
        }
        return `export default ${JSON.stringify(loadArticles())}`
      }
      return null
    },

    transform(code, id) {
      const file = id.split('?')[0]!
      if (!file.startsWith(resolve(options.contentDir))) return null
      const rel = relative(options.contentDir, file)
      if (file.endsWith('.yaml')) {
        // Texto cortado por vírgula sem aspas em mapa em linha é defeito de conteúdo em qualquer modo: o build para.
        const flow = flowMapIssue(rel, code)
        if (flow) this.error(`[mf-content] ${flow}`)
        const data = transformMdFields(parseYaml(code) as Json, rel)
        return { code: `export default ${JSON.stringify(data)}`, map: null }
      }
      if (file.endsWith('.md')) {
        const flow = flowMapIssue(rel, code)
        if (flow) this.error(`[mf-content] ${flow}`)
        const { data, body } = frontmatter(code)
        return {
          code: `export default ${JSON.stringify({ meta: transformMdFields(data as Json, rel), html: renderMarkdown(body, rel) })}`,
          map: null,
        }
      }
      return null
    },

    buildEnd() {
      if (pending.size && !options.strict) {
        this.warn(
          `[mf-content] Build NÃO publicável: ${pending.size} dado(s) empresarial(is) pendente(s) marcados na página:\n` +
            [...pending].map((p) => `  - ${p}`).join('\n'),
        )
      }
    },
  }
}
