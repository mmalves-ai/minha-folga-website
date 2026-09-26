/**
 * Gera as imagens PNG da marca a partir dos SVG oficiais (public/brand/*.svg e public/favicon.svg):
 *   public/brand/og-minha-folga.png  1200×630  (compartilhamento social)
 *   public/apple-touch-icon.png       180×180
 *   public/favicon-32.png             32×32    (ponto simplificado do favicon.svg)
 *
 * Renderiza HTML local no Chrome instalado (Playwright, channel 'chrome'); a fonte Sora vem de
 * src/assets/fonts por file://. O logo entra como SVG original, sem distorção, sombra ou gradiente.
 * Uso (revisão manual; as imagens geradas são versionadas): node scripts/generate-brand-images.mjs
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('..', import.meta.url))
const pub = join(root, 'public')
const fonts = join(root, 'src/assets/fonts')

// Tokens da marca (docs/MINHA_FOLGA_WEBSITE_MASTER.md, seção 3).
const C = { forest: '#123F35', cream: '#F8F6F0', mint: '#DDECE2', muted: '#50615A' }
const PROMISE = ['Mais clareza para escolher.', 'Mais espaço para viver.']

// SVG oficial sem o <title> (a imagem final não precisa de texto alternativo interno).
const svg = (file) =>
  readFileSync(join(pub, file), 'utf8')
    .replace(/<title[^>]*>.*?<\/title>/s, '')
    .replace(/\s(role|aria-labelledby)="[^"]*"/g, '')

const fontFace = (family, file) => `@font-face {
  font-family: '${family}';
  src: url('${pathToFileURL(join(fonts, file)).href}') format('woff2');
  font-weight: 100 800;
  font-display: block;
}`

const page = (w, h, body, extraCss = '') => `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<style>
${fontFace('Sora', 'sora-latin-wght-normal.woff2')}
${fontFace('Sora', 'sora-latin-ext-wght-normal.woff2')}
${fontFace('Inter', 'inter-latin-wght-normal.woff2')}
html, body { margin: 0; padding: 0; }
body { width: ${w}px; height: ${h}px; overflow: hidden; background: ${C.cream}; position: relative; }
svg { display: block; }
${extraCss}
</style></head><body>${body}</body></html>`

// Logo completo: 338×76 no SVG. Largura 440 px → altura ≈ 99 px; margem livre ≥ 12% da altura (12 px) de sobra.
const LOGO_W = 440
const og = page(
  1200,
  630,
  `<div class="panel" aria-hidden="true"></div>
  <div class="logo">${svg('brand/minha-folga-logo.svg')}</div>
  <p class="promise"><span>${PROMISE[0]}</span><span>${PROMISE[1]}</span></p>
  <p class="domain">www.minhafolga.com.br</p>`,
  `.panel { position: absolute; right: -160px; top: -200px; width: 560px; height: 560px; border-radius: 50%; background: ${C.mint}; }
  .logo { position: absolute; left: 88px; top: 84px; width: ${LOGO_W}px; }
  .logo svg { width: 100%; height: auto; }
  .promise { position: absolute; left: 88px; right: 88px; top: 262px; margin: 0; font-family: 'Sora', sans-serif;
    font-weight: 600; font-size: 62px; line-height: 1.16; letter-spacing: -0.02em; color: ${C.forest}; }
  .promise span { display: block; }
  .domain { position: absolute; left: 88px; bottom: 64px; margin: 0; font-family: 'Inter', sans-serif; font-weight: 500;
    font-size: 24px; color: ${C.muted}; }`,
)

// Símbolo 80×72: centralizado com área de respiro (o iOS aplica máscara arredondada).
const icon = (size, file, scale) =>
  page(
    size,
    size,
    `<div class="mark">${svg(file)}</div>`,
    `.mark { position: absolute; inset: 0; display: grid; place-items: center; }
    .mark svg { width: ${Math.round(size * scale)}px; height: auto; }`,
  )

const jobs = [
  { out: join(pub, 'brand/og-minha-folga.png'), w: 1200, h: 630, html: og, needsFonts: true },
  { out: join(pub, 'apple-touch-icon.png'), w: 180, h: 180, html: icon(180, 'brand/minha-folga-simbolo.svg', 0.64) },
  // 32 px: ponto ampliado do favicon.svg (simplificação prevista na seção 3) e símbolo quase no limite.
  { out: join(pub, 'favicon-32.png'), w: 32, h: 32, html: icon(32, 'favicon.svg', 0.9) },
]

const work = mkdtempSync(join(tmpdir(), 'mf-brand-'))
const browser = await chromium.launch({ channel: 'chrome', args: ['--allow-file-access-from-files'] })
try {
  for (const job of jobs) {
    const file = join(work, 'page.html')
    writeFileSync(file, job.html)
    const context = await browser.newContext({ viewport: { width: job.w, height: job.h }, deviceScaleFactor: 1 })
    const tab = await context.newPage()
    await tab.goto(pathToFileURL(file).href)
    await tab.evaluate(() => document.fonts.ready)
    if (job.needsFonts) {
      const ok = await tab.evaluate(() => document.fonts.check("600 62px 'Sora'") && [...document.fonts].some((f) => f.family.includes('Sora') && f.status === 'loaded'))
      if (!ok) throw new Error('a fonte Sora não carregou; confira src/assets/fonts')
    }
    await tab.screenshot({ path: job.out, type: 'png', clip: { x: 0, y: 0, width: job.w, height: job.h } })
    await context.close()
    console.log(`[brand] ${job.out.replace(root, '')} (${job.w}×${job.h})`)
  }
} finally {
  await browser.close()
  rmSync(work, { recursive: true, force: true })
}
