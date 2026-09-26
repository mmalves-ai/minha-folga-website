import { createServer } from 'node:http'
import { createApp } from './app.js'
import { bootstrap, exitOnConfigError } from './bootstrap.js'
import { pendingMigrations } from './db/migrate.js'
import { startOutboxWorker, type WorkerHandle } from './jobs/outbox-worker.js'

const ctx = await bootstrap('minhafolga-api').catch(exitOnConfigError)
const { config, logger, db } = ctx

const pending = await pendingMigrations(db)
if (pending.length) {
  logger.fatal({ pending }, 'migrações pendentes: execute `npm run migrate` antes de iniciar a API')
  await db.close()
  process.exit(1)
}

const app = createApp(ctx)
const server = createServer(app)
server.requestTimeout = 20_000
server.headersTimeout = 15_000
server.keepAliveTimeout = 5_000

let worker: WorkerHandle | undefined
if (config.workerMode === 'inline') worker = startOutboxWorker(ctx)

server.listen(config.port, config.host, () => {
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : config.port
  logger.info({ host: config.host, port, phase: config.credit.phase, worker: config.workerMode }, 'API Minha Folga iniciada')
  process.send?.('ready')
})

server.on('error', (err: NodeJS.ErrnoException) => {
  // Porta ocupada: não tentamos outra nem encerramos o ocupante.
  logger.fatal({ code: err.code }, 'não foi possível abrir a porta configurada')
  process.exit(1)
})

let closing = false
async function shutdown(signal: string) {
  if (closing) return
  closing = true
  logger.info({ signal }, 'encerrando API graciosamente')
  const force = setTimeout(() => process.exit(1), 10_000)
  force.unref()
  server.close()
  server.closeIdleConnections()
  await worker?.stop()
  await db.close()
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
