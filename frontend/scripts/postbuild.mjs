/**
 * Verificações do build estático (executa após `vite-ssg build`):
 * - toda rota pré-renderizada gerou HTML com <h1>, <title> e descrição próprios;
 * - rotas indexáveis têm canonical absoluto; rotas privadas têm noindex;
 * - nenhum segredo, marcador de documentação ou texto de preenchimento chegou ao dist;
 * - na release estrita (MF_STRICT_RELEASE=1), nenhum marcador de pendência ("[pendente: …]") no HTML.
 * Falha com código 1 e lista os problemas.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const dist = process.env.MF_OUT_DIR || join(root, 'dist')
const problems = []

const manifestSrc = readFileSync(join(root, 'src/router/manifest.ts'), 'utf8')
const routes = [...manifestSrc.matchAll(/\{ path: '([^']+)', indexable: (true|false), prerender: (true|false) \}/g)].map((m) => ({
  path: m[1],
  indexable: m[2] === 'true',
  prerender: m[3] === 'true',
}))
const articles = readdirSync(join(root, 'content/articles'))
  .filter((f) => f.endsWith('.md'))
  .map((f) => ({ path: `/conteudos/${f.replace(/\.md$/, '')}`, indexable: true, prerender: true }))

const fileFor = (p) => (p === '/' ? 'index.html' : `${p.slice(1)}.html`)
const titles = new Map()

for (const route of [...routes, ...articles].filter((r) => r.prerender)) {
  const file = join(dist, fileFor(route.path))
  if (!existsSync(file)) {
    problems.push(`${route.path}: HTML não gerado (${relative(root, file)})`)
    continue
  }
  const html = readFileSync(file, 'utf8')
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1]
  if (!title) problems.push(`${route.path}: sem <title>`)
  else if (route.indexable) {
    if (titles.has(title)) problems.push(`${route.path}: título repetido de ${titles.get(title)} ("${title}")`)
    titles.set(title, route.path)
  }
  if (!/<meta name="description" content="[^"]{30,}"/.test(html)) problems.push(`${route.path}: sem meta description própria`)
  if (route.path !== '/admin' && !/<h1[\s>]/.test(html)) problems.push(`${route.path}: HTML sem <h1> (conteúdo não pré-renderizado)`)
  if (route.indexable && !/<link rel="canonical" href="https:\/\/[^"]+"/.test(html)) problems.push(`${route.path}: sem canonical absoluto`)
  if (!route.indexable && !/<meta name="robots" content="noindex/.test(html)) problems.push(`${route.path}: rota privada sem noindex`)
}

const FORBIDDEN = [
  /lorem ipsum/i,
  /SESSION_SECRET|CONTACT_ENCRYPTION_KEY|CONTACT_DEDUP_HMAC_KEY|HALAI_API_KEY|HALAI_INBOUND_API_KEY|HALAI_WEBHOOK_SECRET|SUPPORT_NOTIFY_WEBHOOK_SECRET|READINESS_TOKEN|DATABASE_URL/,
  // Chave da API pública da Hal-AI (hal_<ambiente>_<prefixo>_<segredo>).
  /\bhal_[a-z]+_[A-Za-z0-9]+_[A-Za-z0-9]{12,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /postgres(ql)?:\/\/[^\s"']+/,
  /github_pat_[A-Za-z0-9_]+/,
  /\bSTUB\b/,
]
// Release pública (MF_STRICT_RELEASE=1): nenhum marcador de pendência pode chegar ao HTML pré-renderizado,
// venha ele do conteúdo ({{pending: ...}}, já barrado no build) ou de um componente que mostra
// "[pendente: ...]" para um dado de configuração ausente. Só o HTML é conferido: o JS guarda o texto do
// marcador como ramo possível do template mesmo quando ele não é exibido.
const strict = process.env.MF_STRICT_RELEASE === '1'
const PENDING_MARKERS = [/\[pendente:/i, /class="[^"]*\bpending-data\b/]

const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]))
for (const file of walk(dist).filter((f) => /\.(html|js|css|json|txt|xml)$/.test(f))) {
  const text = readFileSync(file, 'utf8')
  for (const re of FORBIDDEN) if (re.test(text)) problems.push(`${relative(root, file)}: contém padrão proibido ${re}`)
  if (strict && file.endsWith('.html')) {
    for (const re of PENDING_MARKERS) {
      if (re.test(text)) problems.push(`${relative(root, file)}: marcador de pendência na release pública (${re}); veja docs/PENDENCIAS_PUBLICACAO.md`)
    }
  }
  // A CSP do virtual host não permite estilo inline nem script inline executável.
  if (file.endsWith('.html')) {
    if (/<[a-z][^>]*\sstyle="/i.test(text)) problems.push(`${relative(root, file)}: atributo style inline (a CSP bloqueia; use classes ou o atributo hidden)`)
    if (/<script(?![^>]*\bsrc=)(?![^>]*type="application\/ld\+json")[^>]*>/i.test(text)) problems.push(`${relative(root, file)}: <script> inline executável (a CSP bloqueia)`)
  }
}

if (problems.length) {
  console.error(`\n[postbuild] ${problems.length} problema(s) no build:\n` + problems.map((p) => `  - ${p}`).join('\n'))
  process.exit(1)
}
console.log(`[postbuild] ok: ${[...routes, ...articles].filter((r) => r.prerender).length} rotas verificadas, nenhum padrão proibido.`)
