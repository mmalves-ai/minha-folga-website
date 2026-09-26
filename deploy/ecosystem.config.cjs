/**
 * Configuração PM2 EXCLUSIVA da Minha Folga (usada quando a hospedagem já adota PM2).
 *
 * Uso — sempre por nome, nunca em lote (scripts/deploy.sh faz isso por você):
 *   MINHAFOLGA_APP_ROOT=/srv/minhafolga MINHAFOLGA_NODE=/srv/minhafolga/.runtime/node-v24.21.0-linux-x64/bin/node \
 *     pm2 startOrReload /srv/minhafolga/current/deploy/ecosystem.config.cjs --only minhafolga-api --update-env
 *
 * Nomes por instância (linha "instance=" do marcador .minhafolga-root, gravada por "deploy.sh init --instance"):
 *   prod (padrão) → minhafolga-api / minhafolga-worker; homolog → minhafolga-homolog-api / minhafolga-homolog-worker.
 * Assim homologação e produção no mesmo usuário/daemon PM2 nunca compartilham nome de processo.
 *
 * Proibido com este arquivo: `pm2 start` sem --only, `pm2 save`, `pm2 restart all`, `pm2 delete all`,
 * `pm2 kill`, `pm2 update` e `pm2 startup` — afetam os processos e a persistência dos outros sites.
 *
 * O backend lê a configuração somente de MF_ENV_FILE (variáveis herdadas do shell são ignoradas).
 * `cwd` e `script` passam por `current`, então cada reinício usa a release promovida por deploy.sh.
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')

function fail(message) {
  throw new Error(`[minhafolga] ecosystem.config.cjs: ${message}`)
}

const root = process.env.MINHAFOLGA_APP_ROOT || ''
if (!path.isAbsolute(root) || root === '/' || !/^\/[A-Za-z0-9._/-]+$/.test(root)) {
  fail('defina MINHAFOLGA_APP_ROOT com o caminho absoluto da raiz exclusiva (ex.: /srv/minhafolga).')
}
const markerFile = path.join(root, '.minhafolga-root')
if (!fs.existsSync(markerFile)) {
  fail(`marcador .minhafolga-root ausente em ${root}; a raiz precisa ser criada por scripts/deploy.sh init.`)
}
// Mesma regra de scripts/lib.sh (mf_set_instance).
const instanceLines = fs.readFileSync(markerFile, 'utf8').match(/^instance=.*$/gm) || []
const instance = instanceLines.length ? instanceLines[instanceLines.length - 1].slice('instance='.length) : 'prod'
if (!/^[a-z][a-z0-9]{0,15}$/.test(instance)) {
  fail(`instância inválida no marcador (${instance}).`)
}
const base = instance === 'prod' ? 'minhafolga' : `minhafolga-${instance}`
const apiName = `${base}-api`
const workerName = `${base}-worker`
const node = process.env.MINHAFOLGA_NODE || ''
if (!path.isAbsolute(node) || !fs.existsSync(node)) {
  fail('defina MINHAFOLGA_NODE com o caminho absoluto do executável Node 24 escolhido.')
}

const current = path.join(root, 'current')
const backend = path.join(current, 'backend')
const logFile = (name) => path.join(root, 'var', 'log', name)
const pidFile = (name) => path.join(root, 'var', 'run', `${name}.pid`)

// Uma instância por processo, em fork, sem watch; limites modestos para conviver com outros sites.
const common = {
  cwd: backend,
  interpreter: node,
  exec_mode: 'fork',
  instances: 1,
  watch: false,
  autorestart: true,
  min_uptime: '20s',
  max_restarts: 10,
  exp_backoff_restart_delay: 500,
  max_memory_restart: process.env.MINHAFOLGA_MAX_MEMORY || '384M',
  // A API encerra graciosamente em até 10 s após SIGTERM; o PM2 só força depois de 12 s.
  kill_signal: 'SIGTERM',
  kill_timeout: 12000,
  wait_ready: true,
  listen_timeout: 20000,
  time: true,
  merge_logs: true,
  // Sem coleta de metadados git, sem injeção de monitoramento do PM2.
  vizion: false,
  pmx: false,
  automation: false,
  source_map_support: false,
  env: {
    NODE_ENV: 'production',
    MF_ENV_FILE: path.join(root, 'config', '.env.production'),
    // Não herdar opções de Node do shell de quem publicou.
    NODE_OPTIONS: '',
  },
}

module.exports = {
  apps: [
    {
      ...common,
      name: apiName,
      script: path.join(backend, 'dist', 'server.js'),
      out_file: logFile('api.out.log'),
      error_file: logFile('api.err.log'),
      pid_file: pidFile(apiName),
    },
    {
      // Somente com WORKER_MODE=separate no config/.env.production (padrão: inline, dentro da API).
      ...common,
      name: workerName,
      script: path.join(backend, 'dist', 'worker.js'),
      max_memory_restart: process.env.MINHAFOLGA_WORKER_MAX_MEMORY || '256M',
      out_file: logFile('worker.out.log'),
      error_file: logFile('worker.err.log'),
      pid_file: pidFile(workerName),
    },
  ],
}
