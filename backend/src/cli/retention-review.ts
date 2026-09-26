import { parseArgs } from 'node:util'
import { exitOnConfigError } from '../bootstrap.js'
import { loadConfig } from '../config/index.js'
import { createDatabase } from '../db/database.js'
import { pendingMigrations } from '../db/migrate.js'
import { runRetention, type RetentionReport } from '../jobs/retention.js'
import { createLogger } from '../lib/logger.js'

/**
 * Revisão de retenção dos cadastros (seção 9).
 * Uso: node dist/cli/retention-review.js [--apply] [--json] [--env-file <arquivo>]
 *   (sem --apply) simulação: só conta, nada é alterado;
 *   --apply marca `expired` os cadastros sem interação há 180 dias e remove desafios, sessões, links e
 *   submissões guardadas para revisão com mais de 30 dias, além de itens vencidos do anti-robô. Exclusão/anonimização de cadastros é decisão da equipe de privacidade
 *   (painel administrativo). A saída não contém dados pessoais, apenas contagens.
 */
const { values } = parseArgs({
  options: {
    apply: { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
    'env-file': { type: 'string' },
  },
})

let config
try {
  config = loadConfig({ envFile: values['env-file'] })
} catch (err) {
  exitOnConfigError(err)
}

function printReport(r: RetentionReport) {
  const applied = r.mode === 'apply'
  const lines = [
    applied ? 'Revisão de retenção — alterações APLICADAS' : 'Revisão de retenção — simulação (nada foi alterado)',
    `Referência: ${r.now}`,
    '',
    `Cadastros sem interação desde ${r.inactivityCutoff}: ${r.staleLeads.total}`,
    ...Object.entries(r.staleLeads.byState).map(([state, n]) => `  - estado ${state}: ${n}`),
    applied ? `  marcados como expired: ${r.expiredLeads}` : '  seriam marcados como expired (use --apply)',
    '',
    `Itens técnicos vencidos antes de ${r.purgeCutoff}${applied ? ' (removidos)' : ' (seriam removidos)'}:`,
    `  - desafios de verificação (legado): ${r.challenges}`,
    `  - sessões do titular: ${r.sessions}`,
    `  - links de acesso às preferências: ${r.accessTokens}`,
    `  - mensagens finalizadas com conteúdo a apagar: ${r.outboxRedacted}`,
    `  - eventos de replay das chamadas da Bia: ${r.webhookEvents}`,
    `  - submissões guardadas para revisão: ${r.heldSubmissions}`,
    `  - anti-robô: usos de token vencidos: ${r.formTokens}; tentativas com mais de 2 dias: ${r.formAttempts}`,
    '',
    'Exclusão ou anonimização de cadastros expirados: decisão da equipe de privacidade no painel administrativo.',
  ]
  console.log(lines.join('\n'))
}

const db = await createDatabase(config.database.url, { poolMax: 1 })
try {
  const pending = await pendingMigrations(db)
  if (pending.length) {
    console.error(`Migrações pendentes (${pending.join(', ')}): execute \`npm run migrate\` antes da revisão.`)
    process.exitCode = 1
  } else {
    const logger = createLogger(values.json ? 'silent' : config.logLevel, { process: 'minhafolga-retention', env: config.env })
    const report = await runRetention({ db, logger, now: () => new Date() }, { apply: values.apply })
    if (values.json) console.log(JSON.stringify(report, null, 2))
    else printReport(report)
  }
} catch (err) {
  console.error(`Falha na revisão de retenção: ${(err as Error).message}`)
  process.exitCode = 1
} finally {
  await db.close()
}
