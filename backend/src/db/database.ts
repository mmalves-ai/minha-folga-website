/**
 * Acesso ao banco relacional exclusivo da Minha Folga.
 *
 * Produção/homologação: PostgreSQL (`postgres://…`) com pool limitado.
 * Desenvolvimento/testes: PGlite (`pglite://memory` ou `pglite:///caminho/da/pasta`), um PostgreSQL
 * em WebAssembly no próprio processo — recusado em homologação/produção pela validação de configuração.
 *
 * Regras: sempre queries parametrizadas ($1, $2…); contagens com `::int`; ids gerados na aplicação.
 */
export interface QueryResult<T> {
  rows: T[]
  rowCount: number
}

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>
}

export interface Database extends Queryable {
  readonly kind: 'postgres' | 'pglite'
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>
  /** Execução de script SQL com vários comandos (migrações). */
  exec(sql: string): Promise<void>
  close(): Promise<void>
}

export async function createDatabase(url: string, options: { poolMax?: number } = {}): Promise<Database> {
  if (url.startsWith('pglite://')) {
    const { createPgliteDatabase } = await import('./pglite.js')
    return createPgliteDatabase(url)
  }
  if (/^postgres(ql)?:\/\//.test(url)) {
    const { createPgDatabase } = await import('./pg.js')
    return createPgDatabase(url, options.poolMax ?? 5)
  }
  throw new Error('DATABASE_URL não suportada (use postgres:// ou pglite:// em desenvolvimento)')
}
