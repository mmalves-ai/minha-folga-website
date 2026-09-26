/**
 * Variantes editoriais locais; requer ffmpeg com libaom-av1/libwebp.
 * Executar da raiz: scripts/node-runtime.sh exec node frontend/scripts/optimize-editorial-images.mjs [hero planning bia conversation aliviar-parcelas]
 * Fontes ficam fora de public para não publicar PNGs pesados. Nenhum download ou instalação.
 */
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = fileURLToPath(new URL('..', import.meta.url))
const sourceDir = join(root, 'source-assets/editorial')
const destination = join(root, 'public/images/editorial')
const availableNames = ['hero', 'planning', 'bia', 'conversation', 'aliviar-parcelas']
const names = process.argv.slice(2).length ? process.argv.slice(2) : availableNames
mkdirSync(destination, { recursive: true })
for (const name of names) {
  if (!availableNames.includes(name)) throw new Error(`Asset desconhecido: ${name}`)
  const source = join(sourceDir, `${name}.png`)
  if (!existsSync(source)) throw new Error(`Fonte ausente: ${source}`)
  for (const width of [480, 800, 1200]) {
    for (const format of ['avif', 'webp', 'jpg']) {
      const file = join(destination, `${name}-${width}.${format}`)
      const codec = format === 'avif'
        ? ['-c:v', 'libaom-av1', '-still-picture', '1', '-crf', '34', '-cpu-used', '6', '-pix_fmt', 'yuv420p']
        : format === 'webp' ? ['-c:v', 'libwebp', '-quality', '78', '-compression_level', '6']
          : ['-c:v', 'mjpeg', '-q:v', '4', '-pix_fmt', 'yuvj420p']
      const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', source,
        '-vf', `scale=${width}:-2:flags=lanczos`, '-frames:v', '1', '-threads', '2', ...codec, file], { encoding: 'utf8' })
      if (result.status !== 0) throw new Error(result.stderr || `Falha ao gerar ${file}`)
      console.log(`${name}-${width}.${format}: ${(statSync(file).size / 1024).toFixed(1)} KB`)
    }
  }
}

const manifest = availableNames.flatMap((name) => [480, 800, 1200].flatMap((width) =>
  ['avif', 'webp', 'jpg'].flatMap((format) => {
    const file = `${name}-${width}.${format}`
    const path = join(destination, file)
    return existsSync(path) ? [{ file, width, height: Math.round(width / 1.5 / 2) * 2, bytes: statSync(path).size }] : []
  }),
))
writeFileSync(join(destination, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
