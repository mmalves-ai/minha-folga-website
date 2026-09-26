import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MIGRATIONS_DIR } from '../config/paths.js'
import type { Database } from './database.js'

export interface MigrationResult {
  applied: string[]
  alreadyApplied: string[]
}

/**
 * Aplica migrações SQL versionadas (`migrations/NNN_nome.sql`) em ordem, cada uma em transação.
 * Atua somente no banco configurado para a Minha Folga. Migrações já aplicadas têm checksum
 * conferido: alterar um arquivo antigo interrompe o processo (crie uma nova migração).
 * Regra de compatibilidade: migrações devem ser aditivas/retrocompatíveis com a release anterior.
 */
export async function migrate(db: Database, dir = MIGRATIONS_DIR): Promise<MigrationResult> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`)

  const files = readdirSync(dir)
    .filter((f) => /^\d{3,}_[a-z0-9_]+\.sql$/.test(f))
    .sort()

  const lockKey = 7_107_310 // chave de advisory lock exclusiva da Minha Folga
  if (db.kind === 'postgres') await db.query('SELECT pg_advisory_lock($1)', [lockKey])
  try {
    const { rows } = await db.query<{ version: string; checksum: string }>(
      'SELECT version, checksum FROM schema_migrations',
    )
    const known = new Map(rows.map((r) => [r.version, r.checksum]))
    const result: MigrationResult = { applied: [], alreadyApplied: [] }

    for (const file of files) {
      const sql = readFileSync(join(dir, file), 'utf8')
      const checksum = createHash('sha256').update(sql).digest('hex')
      const version = file.replace(/\.sql$/, '')
      const previous = known.get(version)
      if (previous) {
        if (previous !== checksum) {
          throw new Error(`Migração ${file} foi alterada após aplicada. Crie uma nova migração.`)
        }
        result.alreadyApplied.push(version)
        continue
      }
      await db.transaction(async (tx) => {
        // Comandos separados por ";" no fim da linha; os arquivos não usam funções com corpo $$.
        for (const statement of splitStatements(sql)) await tx.query(statement)
        await tx.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [version, checksum])
      })
      result.applied.push(version)
    }
    return result
  } finally {
    if (db.kind === 'postgres') await db.query('SELECT pg_advisory_unlock($1)', [lockKey])
  }
}

export function splitStatements(sql: string): string[] {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Migrações presentes na release e ainda não aplicadas. A API não inicia com pendências. */
export async function pendingMigrations(db: Database, dir = MIGRATIONS_DIR): Promise<string[]> {
  const files = readdirSync(dir)
    .filter((f) => /^\d{3,}_[a-z0-9_]+\.sql$/.test(f))
    .map((f) => f.replace(/\.sql$/, ''))
    .sort()
  let applied = new Set<string>()
  try {
    const { rows } = await db.query<{ version: string }>('SELECT version FROM schema_migrations')
    applied = new Set(rows.map((r) => r.version))
  } catch {
    return files
  }
  return files.filter((v) => !applied.has(v))
}
