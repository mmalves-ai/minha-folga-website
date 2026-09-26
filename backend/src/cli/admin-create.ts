import { parseArgs } from 'node:util'
import { z } from 'zod'
import { loadConfig } from '../config/index.js'
import { createDatabase } from '../db/database.js'
import { pendingMigrations } from '../db/migrate.js'
import { exitOnConfigError } from '../bootstrap.js'
import { ADMIN_ROLES } from '../services/admin-permissions.js'
import { countActiveAdmins, createAdminUser } from '../services/admin-users.service.js'

/**
 * Cria uma pessoa usuária do painel (inclusive a primeira: o banco novo não tem nenhuma).
 * Uso: npm run admin:create -- --email pessoa@empresa --name "Nome" --role admin
 * A configuração vem de MF_ENV_FILE (como cli/migrate.ts). A senha temporária é impressa uma única
 * vez; no primeiro acesso a pessoa cadastra o MFA e troca a senha.
 */
const USAGE = 'Uso: admin-create --email <e-mail> --name "<nome>" --role <admin|support|privacy|marketing>'

const ArgsSchema = z.strictObject({
  email: z.email().max(200),
  name: z.string().trim().min(2).max(80),
  role: z.enum(ADMIN_ROLES),
})

let args: z.infer<typeof ArgsSchema>
try {
  const { values } = parseArgs({
    options: { email: { type: 'string' }, name: { type: 'string' }, role: { type: 'string' } },
    strict: true,
    allowPositionals: false,
  })
  const parsed = ArgsSchema.safeParse(values)
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => `--${String(i.path[0] ?? '?')}`))]
    console.error(`Argumentos inválidos: ${fields.join(', ')}.\n${USAGE}`)
    process.exit(2)
  }
  args = parsed.data
} catch (err) {
  console.error(`${(err as Error).message}\n${USAGE}`)
  process.exit(2)
}

let config
try {
  config = loadConfig()
} catch (err) {
  exitOnConfigError(err)
}

const db = await createDatabase(config.database.url, { poolMax: 1 })
try {
  const pending = await pendingMigrations(db)
  if (pending.length) {
    console.error(`Há migrações pendentes (${pending.join(', ')}). Rode "npm run migrate" antes.`)
    process.exitCode = 1
  } else {
    const adminsBefore = await countActiveAdmins(db)
    const { user, temporaryPassword } = await createAdminUser(
      db,
      new Date(),
      { email: args.email, displayName: args.name, role: args.role },
      { type: 'system', id: null, via: 'cli' },
    )
    console.log(`Pessoa usuária criada: ${user.email} (papel: ${user.role}).`)
    // Linha em formato fixo ("Senha temporária: <senha>"): scripts de implantação e testes e2e a leem.
    console.log(`Senha temporária: ${temporaryPassword}`)
    console.log('Ela é exibida só agora; entregue por canal seguro.')
    console.log('No primeiro acesso ao painel serão exigidos o cadastro do MFA (aplicativo autenticador) e a troca da senha.')
    if (adminsBefore === 0 && user.role !== 'admin') {
      console.warn('Atenção: ainda não há pessoa ativa com papel "admin"; sem ela ninguém gerencia usuários pelo painel.')
    }
  }
} catch (err) {
  const code = (err as { code?: string }).code
  console.error(code === 'email_in_use' ? 'Já existe uma pessoa usuária com este e-mail.' : `Falha ao criar: ${(err as Error).message}`)
  process.exitCode = 1
} finally {
  await db.close()
}
