import { join } from 'node:path'
import { defineConfig, devices } from '@playwright/test'

/**
 * Testes de aceitação ponta a ponta sobre o build pré-renderizado: servidor estático com as mesmas regras do
 * virtual host + API real isolada (PGlite em diretório próprio, integração de entrada da Hal-AI com chave
 * aleatória; decisão D1 — sem WhatsApp neste sistema). Gere o build antes (`npm run build`, ou um build de
 * verificação com MF_OUT_DIR e MF_E2E_DIST apontando para ele).
 *
 * Variáveis (todas opcionais; os padrões são os do ambiente de teste único):
 * - MF_E2E_API_PORT / MF_E2E_SITE_PORT — portas da API e do site (padrão 3190 e 5190);
 * - MF_E2E_DIR — diretório de trabalho (banco, usuários de teste); com ele, resultados e relatório também
 *   ficam lá, para suítes em paralelo não apagarem os artefatos umas das outras (padrão frontend/.e2e);
 * - MF_E2E_DIST — build a servir (padrão frontend/dist).
 * Os mesmos nomes são lidos por e2e/support/env.mjs, que sobe a API.
 */
const API_PORT = process.env.MF_E2E_API_PORT || '3190'
const SITE_PORT = process.env.MF_E2E_SITE_PORT || '5190'
const E2E_DIR = process.env.MF_E2E_DIR
const DIST = process.env.MF_E2E_DIST
const SITE = `http://127.0.0.1:${SITE_PORT}`

const quote = (value: string) => `"${value.replace(/(["\\$`])/g, '\\$1')}"`

export default defineConfig({
  testDir: './e2e',
  outputDir: E2E_DIR ? join(E2E_DIR, 'test-results') : 'test-results',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: E2E_DIR ? join(E2E_DIR, 'playwright-report') : 'playwright-report' }]],
  use: {
    baseURL: SITE,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
  },
  projects: [
    { name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
  ],
  webServer: [
    {
      command: 'node e2e/support/start-backend.mjs',
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: `node scripts/static-server.mjs --port ${SITE_PORT} --api http://127.0.0.1:${API_PORT}${DIST ? ` --dist ${quote(DIST)}` : ''}`,
      url: `${SITE}/`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
})
