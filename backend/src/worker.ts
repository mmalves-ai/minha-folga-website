import { bootstrap, exitOnConfigError } from './bootstrap.js'
import { startOutboxWorker } from './jobs/outbox-worker.js'

// Processo opcional `minhafolga-worker` (WORKER_MODE=separate na API).
const ctx = await bootstrap('minhafolga-worker').catch(exitOnConfigError)
const worker = startOutboxWorker(ctx)
ctx.logger.info('worker de comunicação iniciado')
process.send?.('ready')

let closing = false
async function shutdown() {
  if (closing) return
  closing = true
  await worker.stop()
  await ctx.db.close()
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown())
process.on('SIGINT', () => void shutdown())
