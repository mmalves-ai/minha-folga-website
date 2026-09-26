/**
 * Servidor estático de REVISÃO LOCAL e testes e2e. Não é servidor de produção.
 * Reproduz as regras do virtual host documentado em deploy/nginx.minhafolga.conf.example:
 *   0. dotfiles (qualquer segmento iniciado por "."), *.html direto, /404 e /index → 404;
 *   1. arquivo exato em dist/;  2. rota pré-renderizada (<rota>.html);
 *   3. fallback de aplicação somente para as rotas administrativas conhecidas (ADMIN_ROUTE, a mesma lista
 *      dos modelos Nginx/Apache); 4. demais URLs → 404.html com status 404;
 *   /api/* é encaminhado à API Node (MF_API_TARGET), preservando o prefixo /api.
 * Uso: node scripts/static-server.mjs [--port 5190] [--api http://127.0.0.1:3170] [--tls-cert <pem> --tls-key <pem>]
 *        [--webchat-origin https://<origem-do-widget-hal-ai>]  (ou MF_WEBCHAT_ORIGIN; ver a CSP abaixo)
 * Com --tls-cert/--tls-key serve em HTTPS (revisão local; ver scripts/local-https.sh). NUNCA envia HSTS: em
 * localhost ele valeria para todas as portas do navegador e afetaria outros apps da máquina.
 */
import { createReadStream, readFileSync, statSync } from 'node:fs'
import { createServer, request } from 'node:http'
import { createServer as createTlsServer } from 'node:https'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: {
    port: { type: 'string' },
    api: { type: 'string' },
    dist: { type: 'string' },
    'tls-cert': { type: 'string' },
    'tls-key': { type: 'string' },
    'webchat-origin': { type: 'string' },
  },
})
const tls = values['tls-cert'] && values['tls-key'] ? { cert: readFileSync(values['tls-cert']), key: readFileSync(values['tls-key']) } : null
const port = Number(values.port ?? process.env.MF_STATIC_PORT ?? 5190)
const api = new URL(values.api ?? process.env.MF_API_TARGET ?? 'http://127.0.0.1:3170')
const dist = values.dist ?? fileURLToPath(new URL('../dist', import.meta.url))

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.avif': 'image/avif',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.pdf': 'application/pdf',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.ico': 'image/x-icon',
}

/**
 * Chat do site (widget da Hal-AI, decisão D1 — docs/DECISOES.md). DESLIGADO por padrão: sem origem
 * informada, a CSP é idêntica à do virtual host e não libera nenhuma origem externa.
 * PLACEHOLDER: widget da Hal-AI ainda não provisionado. Para revisar localmente um build com
 * channels.webchat habilitado, informe a origem do script do widget (a mesma de channels.webchat.scriptUrl):
 * ela entra em script-src, connect-src e frame-src. Se o widget também usar outra origem de API/WebSocket
 * (wss://) ou exigir style-src/img-src/font-src, confirme com a Hal-AI e ajuste aqui e nos dois modelos de
 * servidor web (deploy/nginx.minhafolga.conf.example, deploy/apache.minhafolga.conf.example).
 * Nunca curinga (*), nunca 'unsafe-inline'/'unsafe-eval' em script-src.
 */
function webchatOrigin(value) {
  if (!value) return null
  let url
  try {
    url = new URL(value)
  } catch {
    url = null
  }
  if (!url || url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    console.error(`[static-server] --webchat-origin inválida (use só https://host[:porta]): ${value}`)
    process.exit(1)
  }
  return url.origin
}
const WEBCHAT_ORIGIN = webchatOrigin(values['webchat-origin'] ?? process.env.MF_WEBCHAT_ORIGIN)
const withWebchat = WEBCHAT_ORIGIN ? ` ${WEBCHAT_ORIGIN}` : ''

// Mesmos cabeçalhos do virtual host (deploy/nginx.minhafolga.conf.example).
const SECURITY_HEADERS = {
  'Content-Security-Policy':
    `default-src 'self'; script-src 'self'${withWebchat}; style-src 'self'; img-src 'self' data:; font-src 'self'; ` +
    `connect-src 'self'${withWebchat}; manifest-src 'self'; worker-src 'self'; frame-src ${WEBCHAT_ORIGIN ?? "'none'"}; ` +
    "object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  'Cross-Origin-Opener-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
}

// Rotas de frontend/src/router/routes.ts (filhas de /admin). Ao criar rota administrativa, acrescente-a aqui
// e nos dois modelos de vhost; scripts/smoke.sh confere todas as rotas do roteador contra o servidor.
const ADMIN_ROUTE =
  /^\/admin\/(painel|leads|leads\/[A-Za-z0-9_-]{1,64}|atendimentos|atendimentos\/[A-Za-z0-9_-]{1,64}|privacidade|auditoria|notificacoes|usuarios|conta)$/

function fileIfExists(rel) {
  const full = normalize(join(dist, rel))
  if (!full.startsWith(dist)) return null
  try { return statSync(full).isFile() ? full : null } catch { return null }
}

function send(res, status, file) {
  const ext = extname(file)
  const headers = { ...SECURITY_HEADERS, 'Content-Type': TYPES[ext] ?? 'application/octet-stream' }
  headers['Cache-Control'] = file.includes(`${join(dist, 'assets')}`) ? 'public, max-age=31536000, immutable' : 'no-cache'
  // O build local substitui dist/: uma leitura durante a troca não pode derrubar a prévia.
  const stream = createReadStream(file)
  stream.once('open', () => {
    if (res.destroyed) { stream.destroy(); return }
    res.writeHead(status, headers)
    stream.pipe(res)
  })
  stream.on('error', () => {
    if (res.headersSent) { res.destroy(); return }
    res.writeHead(503, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '2' })
    res.end('A prévia está sendo atualizada. Tente novamente em instantes.')
  })
  res.once('close', () => stream.destroy())
}

function proxy(req, res) {
  const upstream = request(
    { hostname: api.hostname, port: api.port, path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${port}`, 'x-forwarded-proto': 'https' } },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers)
      up.pipe(res)
    },
  )
  upstream.on('error', () => {
    res.writeHead(502, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: { code: 'bad_gateway', message: 'API indisponível.' } }))
  })
  req.pipe(upstream)
}

function handle(req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  let path
  try {
    path = decodeURIComponent(url.pathname)
  } catch {
    // Codificação inválida (ex.: "%E0"): 400, sem derrubar o servidor de revisão.
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
    return res.end('Requisição inválida.')
  }
  if (path === '/api' || path.startsWith('/api/')) return proxy(req, res)
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' })
    return res.end()
  }
  // Dotfiles (.vite/ssr-manifest.json, .env, .git ...) nunca são servidos, como no vhost.
  if (path.split('/').some((segment) => segment.startsWith('.'))) return send(res, 404, join(dist, '404.html'))
  if (path === '/404' || path === '/404.html' || path === '/index') return send(res, 404, join(dist, '404.html'))
  if (path.endsWith('/') && path !== '/') {
    res.writeHead(301, { Location: path.replace(/\/+$/, '') + url.search })
    return res.end()
  }
  const exact = path === '/' ? fileIfExists('index.html') : fileIfExists(path.slice(1))
  if (exact && !exact.endsWith('.html')) return send(res, 200, exact)
  const page = path === '/' ? exact : fileIfExists(`${path.slice(1)}.html`)
  if (page) return send(res, 200, page)
  if (ADMIN_ROUTE.test(path)) return send(res, 200, join(dist, 'admin.html'))
  return send(res, 404, join(dist, '404.html'))
}

const server = tls ? createTlsServer(tls, handle) : createServer(handle)
server.listen(port, '127.0.0.1', () => {
  const scheme = tls ? 'https' : 'http'
  console.log(`[static-server] revisão local em ${scheme}://127.0.0.1:${port} e ${scheme}://localhost:${port} (API → ${api.origin})`)
  if (WEBCHAT_ORIGIN) console.log(`[static-server] CSP libera a origem do chat do site: ${WEBCHAT_ORIGIN}`)
})
