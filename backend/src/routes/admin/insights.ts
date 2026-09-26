import { Router } from 'express'
import { can } from '../../middleware/admin-auth.js'
import { parseOrThrow } from '../../middleware/validate.js'
import { DATE_MESSAGES } from '../../services/admin-common.js'
import { AuditQuerySchema, listAudit } from '../../services/admin-audit.service.js'
import { getAdminMetrics, MetricsQuerySchema } from '../../services/admin-metrics.service.js'
import type { AppContext } from '../../context.js'

/** Métricas agregadas (metrics:read) e trilha de auditoria (audit:read). */
export function insightsRoutes(ctx: AppContext): Router {
  const router = Router()

  router.get('/metrics', can(ctx, 'metrics:read'), async (req, res) => {
    const query = parseOrThrow(MetricsQuerySchema, req.query, DATE_MESSAGES)
    res.json(await getAdminMetrics(ctx, query))
  })

  router.get('/audit', can(ctx, 'audit:read'), async (req, res) => {
    const query = parseOrThrow(AuditQuerySchema, req.query, DATE_MESSAGES)
    res.json(await listAudit(ctx, query))
  })

  return router
}
