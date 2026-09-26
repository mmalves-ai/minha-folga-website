import { writeFileSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import webPush from 'web-push'
import { REPO_ROOT } from '../config/paths.js'

/** Gera uma única vez, nunca imprime a chave privada e nunca sobrescreve arquivo existente. */
const outputArg = process.argv.find((v) => v.startsWith('--output='))?.slice(9) ?? 'backend/.env.web-push'
const subject = process.argv.find((v) => v.startsWith('--subject='))?.slice(10)
try {
  if (!subject || (!/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/.test(subject) && !/^https:\/\/[^\s]+$/.test(subject))) {
    throw new Error('Informe --subject=mailto:contato-real@dominio ou URL HTTPS da organização.')
  }
  const root = realpathSync(REPO_ROOT)
  const output = resolve(root, outputArg)
  const parent = realpathSync(dirname(output))
  const rel = relative(root, parent)
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('O arquivo precisa ficar dentro do projeto.')
  const keys = webPush.generateVAPIDKeys()
  writeFileSync(output, `# Segredos locais: não versionar. Ativar exige decisão explícita de configuração.\nWEB_PUSH_ENABLED=false\nWEB_PUSH_VAPID_SUBJECT=${subject}\nWEB_PUSH_VAPID_PUBLIC_KEY=${keys.publicKey}\nWEB_PUSH_VAPID_PRIVATE_KEY=${keys.privateKey}\nWEB_PUSH_DAILY_CAMPAIGN_CAP=3\n`, { flag: 'wx', mode: 0o600 })
  console.log(`Par VAPID salvo com permissão 0600 em ${relative(root, output)}. Envios permanecem desligados.`)
} catch (error) {
  const code = (error as { code?: string })?.code
  console.error(code === 'EEXIST' ? 'O arquivo já existe. Não foi alterado; não regenere chaves em uso.' : code ? 'Não foi possível criar o arquivo de configuração.' : (error as Error).message)
  process.exitCode = 1
}
