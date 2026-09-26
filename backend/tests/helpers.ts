import supertest from 'supertest'
import { createApp } from '../src/app.js'
import { loadConfig } from '../src/config/index.js'
import { createDatabase } from '../src/db/database.js'
import { migrate } from '../src/db/migrate.js'
import type { HalaiOutbound, HalaiTemplateMessage } from '../src/integrations/halai/client.js'
import { ProviderError } from '../src/integrations/provider-error.js'
import { createLogger } from '../src/lib/logger.js'
import type { AppContext } from '../src/context.js'

/** Ambiente mínimo de teste. Segredos abaixo são exclusivos de teste e não valem em nenhum ambiente real. */
export const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  PORT: '0',
  LOG_LEVEL: 'silent',
  PUBLIC_SITE_URL: 'https://www.minhafolga.com.br',
  DATABASE_URL: 'pglite://memory',
  COOKIE_SECURE: 'false',
  CONTACT_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  CONTACT_DEDUP_HMAC_KEY: 'test-only-dedup-hmac-key-0123456789abcdef',
  SESSION_SECRET: 'test-only-session-secret-0123456789abcdef',
  READINESS_TOKEN: 'test-only-readiness-token-0123456789',
}

/** Chave de entrada da Bia usada nos testes (X-API-Key). */
export const TEST_INBOUND_KEY = 'test-only-halai-inbound-api-key-0123456789abcdef'

/** Integração da Bia ligada (entrada por X-API-Key, sem assinatura). */
export const HALAI_ENV: Record<string, string> = {
  HALAI_ENABLED: 'true',
  HALAI_INBOUND_API_KEY: TEST_INBOUND_KEY,
  WHATSAPP_BUSINESS_NUMBER: '+5511900000002',
}

/** Dublê da API da Hal-AI: guarda os templates "enviados" e simula falhas. */
export interface MemoryHalai extends HalaiOutbound {
  sent: HalaiTemplateMessage[]
  /** Próximas N chamadas falham (retentável). */
  failNext: number
  /** Falha definitiva na próxima chamada. */
  failDefinitive: boolean
}

export function memoryHalai(configured = true): MemoryHalai {
  const client: MemoryHalai = {
    configured,
    sent: [],
    failNext: 0,
    failDefinitive: false,
    async sendTemplate(message) {
      if (client.failDefinitive) {
        client.failDefinitive = false
        throw new ProviderError('http_400:invalid_request', false)
      }
      if (client.failNext > 0) {
        client.failNext--
        throw new ProviderError('falha simulada', true)
      }
      client.sent.push(message)
      return { providerMessageId: `hal-${client.sent.length}` }
    },
  }
  return client
}

export interface TestClock {
  current: Date
  advance(ms: number): void
}

export interface TestHarness {
  ctx: AppContext
  app: ReturnType<typeof createApp>
  api: ReturnType<typeof supertest.agent>
  clock: TestClock
  halai: MemoryHalai
  close(): Promise<void>
}

export async function createTestHarness(overrides: Record<string, string> = {}): Promise<TestHarness> {
  const config = loadConfig({ source: { ...TEST_ENV, ...overrides } })
  const db = await createDatabase('pglite://memory')
  await migrate(db)
  const clock: TestClock = {
    current: new Date(),
    advance(ms) {
      this.current = new Date(this.current.getTime() + ms)
    },
  }
  const halai = memoryHalai()
  const ctx: AppContext = {
    config,
    db,
    logger: createLogger('silent'),
    now: () => clock.current,
    halai,
  }
  const app = createApp(ctx)
  const api = supertest.agent(app)
  return { ctx, app, api, clock, halai, close: () => db.close() }
}

/** Cabeçalhos de uma chamada do navegador vinda do próprio site. */
export const SITE = { Origin: 'https://www.minhafolga.com.br' }
