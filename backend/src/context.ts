import type { AppConfig } from './config/index.js'
import type { Database } from './db/database.js'
import type { HalaiOutbound } from './integrations/halai/client.js'
import type { Logger } from './lib/logger.js'
import type { PushTransport } from './integrations/push/client.js'

/**
 * Dependências da aplicação, criadas uma vez no processo e injetadas nas rotas/serviços.
 * Nos testes, `now` pode ser substituído para simular expiração e `halai` por um dublê em memória.
 * Decisão D1: não há provedor de mensagens (WhatsApp é todo da Hal-AI); a única saída externa, além do webhook
 * interno de atendimento, é o cliente Hal-AI do placeholder de template do cadastro.
 */
export interface AppContext {
  config: AppConfig
  db: Database
  logger: Logger
  now: () => Date
  halai: HalaiOutbound
  /** Transporte injetável: testes não abrem rede. */
  push?: PushTransport
}
