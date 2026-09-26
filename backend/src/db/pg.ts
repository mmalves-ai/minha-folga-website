import pg from 'pg'
import type { Database, Queryable, QueryResult } from './database.js'

// int8 (bigint) como number, para o mesmo comportamento do PGlite. Contagens do projeto cabem em number.
pg.types.setTypeParser(20, (v) => Number(v))

export function createPgDatabase(url: string, poolMax: number): Database {
  const pool = new pg.Pool({
    connectionString: url,
    max: poolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 15_000,
    application_name: 'minhafolga-api',
  })

  const wrap = (client: pg.Pool | pg.PoolClient): Queryable => ({
    async query<T>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
      const r = await client.query(sql, params as unknown[])
      return { rows: r.rows as T[], rowCount: r.rowCount ?? r.rows.length }
    },
  })

  return {
    kind: 'postgres',
    ...wrap(pool),
    async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const result = await fn(wrap(client))
        await client.query('COMMIT')
        return result
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw err
      } finally {
        client.release()
      }
    },
    async exec(sql: string) {
      await pool.query(sql)
    },
    async close() {
      await pool.end()
    },
  }
}
