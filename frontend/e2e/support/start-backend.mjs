/**
 * Sobe uma API Minha Folga isolada para o e2e: banco PGlite novo no diretório do e2e, migração aplicada,
 * pessoas usuárias do painel criadas pela CLI e integração de entrada da Hal-AI ligada com chave aleatória
 * (decisão D1: este sistema não envia WhatsApp). Encerrada pelo Playwright ao final.
 */
import { spawn, spawnSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BACKEND_ENV_FILE, backendEnv, E2E_DIR } from './env.mjs'

const backend = fileURLToPath(new URL('../../../backend', import.meta.url))
rmSync(join(E2E_DIR, 'pgdata'), { recursive: true, force: true })
// Resto de execuções anteriores à D1 (mensagens gravadas em arquivo): não existe mais.
rmSync(join(E2E_DIR, 'messages.jsonl'), { force: true })
// readEnvSource prioriza .env; vazio explícito força o ambiente isolado do teste.
const env = { ...process.env, ...backendEnv(), MF_ENV_FILE: '' }
writeFileSync(BACKEND_ENV_FILE, JSON.stringify(env, null, 2), { mode: 0o600 })

const tsx = join(backend, 'node_modules/.bin/tsx')
const migrate = spawnSync(tsx, ['src/cli/migrate.ts'], { cwd: backend, env, stdio: 'inherit' })
if (migrate.status !== 0) process.exit(migrate.status ?? 1)

// Pessoas usuárias do painel criadas pela CLI (como na implantação real) ANTES da API subir:
// o PGlite em diretório aceita um único processo por vez.
const E2E_ADMINS = [
  { key: 'admin', email: 'admin.e2e@minhafolga.test', name: 'Admin E2E', role: 'admin' },
  { key: 'support', email: 'atendimento.e2e@minhafolga.test', name: 'Atendimento E2E', role: 'support' },
  { key: 'marketing', email: 'marketing.e2e@minhafolga.test', name: 'Marketing E2E', role: 'marketing' },
]
const admins = {}
for (const a of E2E_ADMINS) {
  const r = spawnSync(tsx, ['src/cli/admin-create.ts', '--email', a.email, '--name', a.name, '--role', a.role], { cwd: backend, env, encoding: 'utf8' })
  const password = /Senha temporária:\s*(\S+)/.exec(r.stdout ?? '')?.[1]
  if (r.status !== 0 || !password) {
    console.error(`admin-create falhou para ${a.email}: ${r.stderr}`)
    process.exit(1)
  }
  admins[a.key] = { email: a.email, password, role: a.role }
}
writeFileSync(join(E2E_DIR, 'admins.json'), JSON.stringify(admins, null, 2), { mode: 0o600 })

const server = spawn(tsx, ['src/server.ts'], { cwd: backend, env, stdio: 'inherit' })
const stop = () => server.kill('SIGTERM')
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
server.on('exit', (code) => process.exit(code ?? 0))
