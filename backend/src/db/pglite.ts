import type { Database, Queryable, QueryResult } from './database.js'

type PGliteLike = {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[]; affectedRows?: number }>
  exec(sql: string): Promise<unknown>
  transaction<T>(fn: (tx: { query: PGliteLike['query'] }) => Promise<T>): Promise<T>
  close(): Promise<void>
}

/** Somente desenvolvimento e testes. O pacote é devDependency e não existe na instalação de produção. */
export async function createPgliteDatabase(url: string): Promise<Database> {
  const { PGlite } = (await import('@electric-sql/pglite')) as unknown as {
    PGlite: new (dataDir?: string) => PGliteLike
  }
  const location = url.slice('pglite://'.length)
  const db = location === 'memory' || location === '' ? new PGlite() : new PGlite(location)

  // PGlite tem uma única conexão: serializamos as operações para que uma transação
  // não intercale comandos de outra requisição.
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn)
    queue = run.catch(() => undefined)
    return run
  }

  const toResult = <T>(r: { rows: T[]; affectedRows?: number }): QueryResult<T> => ({
    rows: r.rows,
    rowCount: Math.max(r.affectedRows ?? 0, r.rows.length),
  })

  return {
    kind: 'pglite',
    query<T>(sql: string, params: unknown[] = []) {
      return serial(async () => toResult(await db.query<T>(sql, params)))
    },
    transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      return serial(() =>
        db.transaction(async (tx) => {
          const q: Queryable = {
            async query<R>(sql: string, params: unknown[] = []) {
              return toResult(await tx.query<R>(sql, params))
            },
          }
          return fn(q)
        }),
      )
    },
    exec(sql: string) {
      return serial(async () => {
        await db.exec(sql)
      })
    },
    close() {
      return serial(() => db.close())
    },
  }
}
