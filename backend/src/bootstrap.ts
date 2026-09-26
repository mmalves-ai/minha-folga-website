import { loadConfig, type AppConfig } from './config/index.js'
import { createDatabase } from './db/database.js'
import { halaiClientFromConfig } from './integrations/halai/client.js'
import { createLogger } from './lib/logger.js'
import type { AppContext } from './context.js'
import { createPushTransport } from './integrations/push/client.js'

/** Monta o contexto a partir da configuração validada. Falha cedo, sem imprimir valores de segredos. */
export async function bootstrap(processName: string, config: AppConfig = loadConfig()): Promise<AppContext> {
  const logger = createLogger(config.logLevel, { process: processName, env: config.env })
  if (config.obsoleteKeys.length) {
    // Só os nomes: o WhatsApp saiu deste sistema (D1) e estas variáveis não têm mais efeito.
    logger.warn({ keys: config.obsoleteKeys }, 'variáveis de ambiente obsoletas ignoradas (decisão D1); remova-as do arquivo de ambiente')
  }
  const db = await createDatabase(config.database.url, { poolMax: config.database.poolMax })
  return { config, db, logger, now: () => new Date(), halai: halaiClientFromConfig(config), push: createPushTransport(config) }
}

export function exitOnConfigError(err: unknown): never {
  // Mensagem da ConfigError lista chaves e motivos, nunca valores.
  console.error((err as Error).message)
  process.exit(1)
}
