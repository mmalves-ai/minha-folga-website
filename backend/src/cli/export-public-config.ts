import { writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { loadConfig } from '../config/index.js'
import { toPublicConfig } from '../config/public.js'
import { exitOnConfigError } from '../bootstrap.js'

/**
 * Exporta a lista permitida de configuração pública para o build do frontend.
 * Uso: node dist/cli/export-public-config.js --env-file <arquivo> --out <arquivo.json>
 * Usa a MESMA validação da API: se a identidade empresarial estiver incompleta em
 * homologação/produção, falha e o release não é gerado.
 */
const { values } = parseArgs({
  options: { 'env-file': { type: 'string' }, out: { type: 'string' } },
})
let config
try {
  config = loadConfig({ envFile: values['env-file'] })
} catch (err) {
  exitOnConfigError(err)
}
const json = JSON.stringify(toPublicConfig(config), null, 2) + '\n'
if (values.out) writeFileSync(values.out, json, { mode: 0o644 })
else process.stdout.write(json)
