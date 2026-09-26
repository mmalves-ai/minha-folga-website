import { mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'

// scripts/node-runtime.sh exec node frontend/scripts/build-credit-guide.mjs
// No downloads or new packages: uses the project's Playwright and existing Chrome.
const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const projectRoot = resolve(frontendRoot, '..')
if (!process.execPath.startsWith(join(projectRoot, '.runtime') + '/')) {
  throw new Error('Use o runtime privado: scripts/node-runtime.sh exec node frontend/scripts/build-credit-guide.mjs')
}
const scratch = join(projectRoot, '.tmp', 'credit-guide')
const output = join(frontendRoot, 'public', 'guias', 'roteiro-consignado.pdf')
const source = join(frontendRoot, 'source-assets', 'guides', 'roteiro-consignado.html')
await Promise.all([
  mkdir(dirname(output), { recursive: true }),
  mkdir(join(projectRoot, '.tmp'), { recursive: true }),
  mkdir(join(scratch, 'config'), { recursive: true }),
  mkdir(join(scratch, 'cache'), { recursive: true }),
])
// Keep Playwright/Chrome temporary files, profiles and caches inside this project.
// Keep this path short: Chrome's Unix socket has a 108-byte path limit.
process.env.TMPDIR = join(projectRoot, '.tmp')
const browser = await chromium.launchPersistentContext(join(scratch, 'profile'), {
  channel: 'chrome',
  headless: true,
  viewport: { width: 794, height: 1123 },
  deviceScaleFactor: 2,
  env: {
    ...process.env,
    XDG_CONFIG_HOME: join(scratch, 'config'),
    XDG_CACHE_HOME: join(scratch, 'cache'),
  },
})
try {
  const page = await browser.newPage()
  await page.goto(pathToFileURL(source).href)
  await page.emulateMedia({ media: 'print' })
  await page.evaluate(() => document.fonts.ready)
  const layout = await page.evaluate(() => ({
    height: document.querySelector('.sheet').getBoundingClientRect().height,
    width: document.documentElement.scrollWidth,
    fonts: document.fonts.check('12px Sora') && document.fonts.check('12px Inter'),
    images: [...document.images].every((image) => image.complete && image.naturalWidth > 0),
  }))
  await page.screenshot({ path: join(scratch, 'roteiro-consignado-preview.png'), fullPage: true })
  if (!layout.fonts || !layout.images || layout.height > 1123 || layout.width > 795) {
    throw new Error(`O guia não cabe em uma página A4 ou tem recursos ausentes: ${JSON.stringify(layout)}`)
  }
  await page.pdf({ path: output, format: 'A4', preferCSSPageSize: true, printBackground: true, tagged: true })
  console.log(`Guia gerado: ${output}`)
  console.log(`Prévia: ${join(scratch, 'roteiro-consignado-preview.png')}`)
  console.log(`Layout validado: ${JSON.stringify(layout)}`)
} finally {
  await browser.close()
}
