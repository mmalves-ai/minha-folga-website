import type { Queryable } from '../db/database.js'

/**
 * Contadores diários agregados, sem identificadores pessoais.
 * `dimension` só aceita valores de baixa cardinalidade e não pessoais (ex.: origem, vínculo, seção).
 */
export async function incrementMetric(db: Queryable, now: Date, name: string, dimension = '', by = 1): Promise<void> {
  const day = now.toISOString().slice(0, 10)
  await db.query(
    `INSERT INTO metric_counters (day, name, dimension, count) VALUES ($1, $2, $3, $4)
     ON CONFLICT (day, name, dimension) DO UPDATE SET count = metric_counters.count + EXCLUDED.count`,
    [day, name, dimension.slice(0, 64), by],
  )
}
