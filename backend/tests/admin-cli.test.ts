import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDatabase } from '../src/db/database.js'
import { migrate } from '../src/db/migrate.js'
import { verifyPassword } from '../src/lib/password.js'
import { TEST_ENV } from './helpers.js'

/**
 * A CLI admin-create de verdade (processo separado, config por MF_ENV_FILE). Scripts de implantação e
 * testes e2e leem a linha "Senha temporária: <senha>"; este teste protege esse formato.
 */
const run = promisify(execFile)
const BACKEND = fileURLToPath(new URL('..', import.meta.url))
const CLI = join(BACKEND, 'src/cli/admin-create.ts')

let dir: string
let envFile: string
let dbUrl: string

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mf-admin-cli-'))
  dbUrl = `pglite://${join(dir, 'db')}`
  envFile = join(dir, 'test.env')
  const env = { ...TEST_ENV, NODE_ENV: 'development', DATABASE_URL: dbUrl }
  await writeFile(envFile, Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n'))
  // O PGlite em pasta aceita um processo por vez: migra e fecha antes de chamar a CLI.
  const db = await createDatabase(dbUrl)
  await migrate(db)
  await db.close()
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

function cli(...args: string[]) {
  return run(process.execPath, ['--import', 'tsx', CLI, ...args], {
    cwd: BACKEND,
    env: { ...process.env, MF_ENV_FILE: envFile },
    timeout: 60_000,
  })
}

describe('CLI admin-create', () => {
  it('cria a primeira pessoa com senha temporária em linha própria, troca obrigatória e sem MFA', async () => {
    const { stdout } = await cli('--email', 'Primeira.Pessoa@Exemplo-MF.com.br', '--name', 'Primeira Pessoa', '--role', 'admin')
    const match = /^Senha temporária: (\S+)$/m.exec(stdout)
    expect(match, stdout).not.toBeNull()
    const password = match![1]!
    expect(password.length).toBeGreaterThanOrEqual(12)

    const db = await createDatabase(dbUrl)
    try {
      const r = await db.query<{ email: string; role: string; password_hash: string; must_change_password: boolean; mfa_enabled_at: Date | null }>(
        'SELECT email, role, password_hash, must_change_password, mfa_enabled_at FROM admin_users',
      )
      expect(r.rows).toHaveLength(1)
      const user = r.rows[0]!
      expect(user).toMatchObject({ email: 'primeira.pessoa@exemplo-mf.com.br', role: 'admin', must_change_password: true, mfa_enabled_at: null })
      expect(user.password_hash).not.toContain(password)
      expect(await verifyPassword(user.password_hash, password)).toBe(true)
    } finally {
      await db.close()
    }

    // E-mail repetido não cria outra pessoa nem imprime senha.
    const dup = await cli('--email', 'primeira.pessoa@exemplo-mf.com.br', '--name', 'Outra', '--role', 'support').then(
      () => null,
      (err: { code: number; stdout: string; stderr: string }) => err,
    )
    expect(dup?.code).toBe(1)
    expect(dup?.stdout).not.toMatch(/Senha temporária/)
    expect(dup?.stderr).toMatch(/Já existe/)
  })
})
