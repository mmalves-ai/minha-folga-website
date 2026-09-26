import { Router } from 'express'
import { safeEqual } from '../lib/crypto.js'
import { AppError } from '../lib/errors.js'
import { pendingMigrations } from '../db/migrate.js'
import type { AppContext } from '../context.js'

export function healthRoutes(ctx: AppContext): Router {
  const router = Router()

  // Estado mínimo do processo: sem versão, segredos, dados ou detalhes de infraestrutura.
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  // Prontidão interna: exige token próprio (cabeçalho), verifica banco e migrações. Não vaza credenciais.
  router.get('/internal/ready', async (req, res) => {
    const expected = ctx.config.secrets.readinessToken
    const given = req.get('x-readiness-token') ?? ''
    if (!expected || !safeEqual(given, expected)) throw new AppError(404, 'not_found', 'Rota da API inexistente.')
    const checks: Record<string, 'ok' | 'fail'> = {}
    try {
      await ctx.db.query('SELECT 1')
      checks.database = 'ok'
    } catch {
      checks.database = 'fail'
    }
    try {
      checks.migrations = (await pendingMigrations(ctx.db)).length === 0 ? 'ok' : 'fail'
    } catch {
      checks.migrations = 'fail'
    }
    const ready = checks.database === 'ok' && checks.migrations === 'ok'
    res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready', checks })
  })

  return router
}
