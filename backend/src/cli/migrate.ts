import { loadConfig } from '../config/index.js'
import { createDatabase } from '../db/database.js'
import { migrate } from '../db/migrate.js'
import { exitOnConfigError } from '../bootstrap.js'

let config
try {
  config = loadConfig()
} catch (err) {
  exitOnConfigError(err)
}
const db = await createDatabase(config.database.url, { poolMax: 1 })
try {
  const result = await migrate(db)
  console.log(JSON.stringify({ applied: result.applied, alreadyApplied: result.alreadyApplied.length }))
} catch (err) {
  console.error(`Falha na migração: ${(err as Error).message}`)
  process.exitCode = 1
} finally {
  await db.close()
}
