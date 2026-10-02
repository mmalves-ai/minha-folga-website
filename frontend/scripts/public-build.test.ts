import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const helper = fileURLToPath(new URL('../../scripts/build-public-frontend.sh', import.meta.url))
const siteUrl = 'https://www.minhafolga.com.br'
const fixtures: string[] = []

afterEach(() => {
  for (const directory of fixtures.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function fixture() {
  // node-runtime.sh points tmpdir at the repository; no real backend configuration is read.
  const root = mkdtempSync(join(tmpdir(), 'public-build-test-'))
  fixtures.push(root)
  for (const directory of ['scripts', 'bin', 'backend/dist/cli', 'frontend/dist']) {
    mkdirSync(join(root, directory), { recursive: true })
  }
  copyFileSync(helper, join(root, 'scripts/build-public-frontend.sh'))
  writeFileSync(join(root, 'backend/.env'), '# Isolated test fixture; no credentials.\n')
  writeFileSync(join(root, 'frontend/dist/index.html'), 'previous deployment')
  writeFileSync(join(root, 'fixture-config.json'), JSON.stringify({
    schemaVersion: 1,
    environment: 'production',
    siteUrl,
    identity: { complete: true },
  }))
  writeFileSync(join(root, 'scripts/node-runtime.sh'), `#!/usr/bin/env bash
set -euo pipefail
[[ "$1" == exec ]]
shift
export PATH="$MF_TEST_ROOT/bin:$PATH"
if [[ "$1" == node ]]; then
  shift
  exec "$MF_TEST_NODE" "$@"
fi
exec "$@"
`, { mode: 0o755 })
  writeFileSync(join(root, 'backend/dist/cli/export-public-config.js'), `
const { copyFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const root = process.env.MF_TEST_ROOT
const args = process.argv.slice(2)
if (args[args.indexOf('--env-file') + 1] !== join(root, 'backend/.env')) process.exit(2)
writeFileSync(join(root, 'export-called'), 'yes')
copyFileSync(join(root, 'fixture-config.json'), args[args.indexOf('--out') + 1])
`)
  writeFileSync(join(root, 'bin/npm'), `#!/usr/bin/env bash
set -euo pipefail
exec "$MF_TEST_NODE" "$MF_TEST_ROOT/scripts/mock-build.cjs" "$@"
`, { mode: 0o755 })
  writeFileSync(join(root, 'scripts/mock-build.cjs'), `
const { mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const env = process.env
if (process.argv.slice(2).join(' ') !== 'run build') process.exit(2)
writeFileSync(join(env.MF_TEST_ROOT, 'build-env.json'), JSON.stringify({
  strict: env.MF_STRICT_RELEASE,
  indexable: env.MF_INDEXABLE,
  siteUrl: env.VITE_SITE_URL,
  apiBaseUrl: env.VITE_API_BASE_URL,
}))
mkdirSync(env.MF_OUT_DIR, { recursive: true })
writeFileSync(join(env.MF_OUT_DIR, 'index.html'), 'new deployment')
if (env.MF_TEST_BUILD_FAIL === '1') process.exit(42)
for (const name of ['404.html', 'admin.html', 'sitemap.xml']) {
  writeFileSync(join(env.MF_OUT_DIR, name), 'fixture artifact')
}
writeFileSync(join(env.MF_OUT_DIR, 'robots.txt'), 'User-agent: *\\nAllow: /\\nSitemap: ' + env.VITE_SITE_URL + '/sitemap.xml\\n')
`)
  return {
    root,
    run(overrides: Record<string, string> = {}) {
      const env = { ...process.env }
      delete env.MF_STRICT_RELEASE
      return spawnSync('bash', [join(root, 'scripts/build-public-frontend.sh')], {
        cwd: root,
        env: { ...env, MF_TEST_ROOT: root, MF_TEST_NODE: process.execPath, ...overrides },
        encoding: 'utf8',
        timeout: 10_000,
      })
    },
    buildEnvironment() {
      return JSON.parse(readFileSync(join(root, 'build-env.json'), 'utf8'))
    },
  }
}

describe('build público dos scripts de deploy', () => {
  it('habilita indexação sem exigir aprovação editorial por padrão', () => {
    const app = fixture()
    const result = app.run()

    expect(result.status, result.stderr).toBe(0)
    expect(app.buildEnvironment()).toEqual({ strict: '0', indexable: '1', siteUrl, apiBaseUrl: '/api' })
    expect(readFileSync(join(app.root, 'frontend/dist/index.html'), 'utf8')).toBe('new deployment')
    expect(readdirSync(join(app.root, 'frontend/.generated'))).toEqual([])
  })

  it('propaga a exigência explícita de revisão estrita mantendo a indexação', () => {
    const app = fixture()
    const result = app.run({ MF_STRICT_RELEASE: '1' })

    expect(result.status, result.stderr).toBe(0)
    expect(app.buildEnvironment()).toMatchObject({ strict: '1', indexable: '1' })
  })

  it('preserva o site anterior quando o build falha com revisão estrita', () => {
    const app = fixture()
    const result = app.run({ MF_STRICT_RELEASE: '1', MF_TEST_BUILD_FAIL: '1' })

    expect(result.status).toBe(42)
    expect(app.buildEnvironment()).toMatchObject({ strict: '1', indexable: '1' })
    expect(readdirSync(join(app.root, 'frontend/dist'))).toEqual(['index.html'])
    expect(readFileSync(join(app.root, 'frontend/dist/index.html'), 'utf8')).toBe('previous deployment')
    expect(readdirSync(join(app.root, 'frontend/.generated'))).toEqual([])
  })

  it('rejeita revisão estrita inválida antes de exportar configuração ou compilar', () => {
    const app = fixture()
    const result = app.run({ MF_STRICT_RELEASE: 'true' })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('MF_STRICT_RELEASE')
    expect(existsSync(join(app.root, 'export-called'))).toBe(false)
    expect(existsSync(join(app.root, 'build-env.json'))).toBe(false)
    expect(readFileSync(join(app.root, 'frontend/dist/index.html'), 'utf8')).toBe('previous deployment')
  })
})
