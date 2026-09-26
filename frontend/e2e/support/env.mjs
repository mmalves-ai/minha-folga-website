import { randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Diretório de trabalho do e2e (banco PGlite, usuários de teste e ambiente da API). Fica DENTRO do projeto
 * (frontend/.e2e, ignorado pelo git) — regra do projeto: nada fora do diretório do projeto. MF_E2E_DIR permite outro
 * (ex.: .tmp/<frente>/ para rodar em paralelo com outra suíte).
 */
export const E2E_DIR = process.env.MF_E2E_DIR || fileURLToPath(new URL('../../.e2e', import.meta.url))
mkdirSync(E2E_DIR, { recursive: true })

/** Ambiente efetivo da API de teste, gravado por start-backend.mjs (inclui a chave de entrada da Hal-AI). */
export const BACKEND_ENV_FILE = join(E2E_DIR, 'backend-env.json')

/** Portas do ambiente de teste (padrão 3190/5190). Ambientes paralelos usam MF_E2E_API_PORT / MF_E2E_SITE_PORT. */
export const API_PORT = process.env.MF_E2E_API_PORT || '3190'
export const SITE_PORT = process.env.MF_E2E_SITE_PORT || '5190'

/**
 * Ambiente da API isolada. Decisão D1 (docs/DECISOES.md): nada de WhatsApp aqui — sem provedor de mensagens.
 * A integração de entrada da Hal-AI fica LIGADA com uma chave aleatória por execução, para as jornadas chamarem
 * as ferramentas da Bia (/api/agent/tools/*) com X-API-Key e telefone atestado. A saída (template de cadastro)
 * continua desligada, como no padrão.
 */
export function backendEnv() {
  return {
    NODE_ENV: 'development',
    HOST: '127.0.0.1',
    PORT: API_PORT,
    LOG_LEVEL: 'warn',
    PUBLIC_SITE_URL: `http://127.0.0.1:${SITE_PORT}`,
    ALLOWED_ORIGINS: `http://127.0.0.1:${SITE_PORT}`,
    DATABASE_URL: `pglite://${join(E2E_DIR, 'pgdata')}`,
    COOKIE_SECURE: 'false',
    WORKER_MODE: 'inline',
    HALAI_ENABLED: 'true',
    HALAI_INBOUND_API_KEY: randomBytes(32).toString('base64url'),
    HALAI_SIGNUP_TEMPLATE_ENABLED: 'false',
    CONTACT_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    CONTACT_DEDUP_HMAC_KEY: randomBytes(32).toString('base64'),
    SESSION_SECRET: randomBytes(32).toString('base64'),
    READINESS_TOKEN: randomBytes(24).toString('base64url'),
  }
}
