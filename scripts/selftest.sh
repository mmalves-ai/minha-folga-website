#!/usr/bin/env bash
# Autoteste dos scripts de implantação da Minha Folga — sem rede, sem build, sem Docker.
#
# Cria raízes descartáveis num diretório de teste próprio, releases sintéticas (API mínima em Node com
# /api/health e prontidão interna) e exercita init, migrate, publish, restart, stop, rollback, cleanup,
# preflight e as travas de segurança (modo do build, origem suja, porta de outro serviço, nomes de processo
# por instância, Node da release, assets no rollback, promoção do arquivo de ambiente).
#
# Não toca em processos, portas ou arquivos fora do diretório de teste. PM2 só com --with-pm2, num PM2_HOME
# próprio dentro do diretório de teste, encerrado ao final (nunca o daemon do usuário).
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd -- "$SCRIPT_DIR/.." && pwd)"

usage() {
  cat <<'EOF'
Uso: MINHAFOLGA_NODE=<node 24> scripts/selftest.sh [opções]

Opções:
  --workdir <dir>     diretório de teste (padrão: novo diretório em <projeto>/.tmp); precisa não existir
                      ou estar vazio
  --port-base <n>     primeira de 4 portas locais livres usadas pelas APIs de teste (padrão 18910)
  --with-pm2          também testa o modo PM2 (MINHAFOLGA_PM2 ou pm2 no PATH), num PM2_HOME do teste
  --keep              mantém o diretório de teste ao final (para análise)
  -h, --help          mostra esta ajuda

Código de saída: 0 sem falhas; 1 com qualquer falha.
EOF
}

WORK=""
PORT_BASE=18910
WITH_PM2=0
KEEP=0
while (($#)); do
  case "$1" in
    --workdir) WORK="${2:-}"; shift 2 ;;
    --port-base) PORT_BASE="${2:-}"; shift 2 ;;
    --with-pm2) WITH_PM2=1; shift ;;
    --keep) KEEP=1; shift ;;
    -h | --help) usage; exit 0 ;;
    *) echo "opção desconhecida: $1" >&2; exit 1 ;;
  esac
done
[[ "$(id -u)" -ne 0 ]] || { echo "não execute como root." >&2; exit 1; }
[[ -n "${MINHAFOLGA_NODE:-}" && -x "${MINHAFOLGA_NODE}" ]] || { echo "defina MINHAFOLGA_NODE (Node 24.15+)." >&2; exit 1; }
[[ "$PORT_BASE" =~ ^[0-9]+$ ]] || { echo "--port-base inválido." >&2; exit 1; }
NODE="$MINHAFOLGA_NODE"
NODE_DIR="$(dirname -- "$NODE")"

if [[ -z "$WORK" ]]; then
  # Regra do projeto: nada fora do diretório do projeto (ver CLAUDE.md).
  mkdir -p "$REPO/.tmp"
  WORK="$(mktemp -d "$REPO/.tmp/minhafolga-selftest.XXXXXX")"
else
  [[ ! -e "$WORK" || -z "$(find "$WORK" -mindepth 1 -maxdepth 1 -print -quit)" ]] || { echo "--workdir precisa estar vazio." >&2; exit 1; }
  mkdir -p -- "$WORK"
fi
WORK="$(realpath -e -- "$WORK")"
[[ "$WORK" =~ ^/[A-Za-z0-9._/-]+$ ]] || { echo "o diretório de teste não pode ter espaços: $WORK — os scripts recusam raízes com espaço; rode o autoteste a partir de um checkout do projeto num caminho sem espaços (o diretório de teste fica sempre dentro do projeto)." >&2; exit 1; }

P_A=$PORT_BASE P_B=$((PORT_BASE + 1)) P_FOREIGN=$((PORT_BASE + 2)) P_FIXED=$((PORT_BASE + 3))
for p in $P_A $P_B $P_FOREIGN $P_FIXED; do
  [[ -z "$(ss -ltnH "sport = :$p" 2>/dev/null)" ]] || { echo "porta $p ocupada; use --port-base." >&2; exit 1; }
done

PM2_BIN=""
if [[ $WITH_PM2 == 1 ]]; then
  PM2_BIN="${MINHAFOLGA_PM2:-$(command -v pm2 || true)}"
  [[ -n "$PM2_BIN" && -x "$PM2_BIN" ]] || { echo "--with-pm2: pm2 não encontrado (MINHAFOLGA_PM2)." >&2; exit 1; }
fi
# Nunca o ~/.pm2 do usuário. O socket do PM2 (PM2_HOME/rpc.sock) precisa caber no limite de ~107 bytes
# dos sockets Unix: com diretório de teste longo, usa um PM2_HOME curto próprio, removido ao final.
PM2_HOME_OWN=""
PM2_HOME="$WORK/pm2home"
if [[ -n "$PM2_BIN" ]] && ((${#PM2_HOME} > 90)); then
  # Dentro do projeto; o caminho do socket do PM2 precisa caber em 108 caracteres.
  PM2_HOME_OWN="$(mktemp -d "$REPO/.tmp/mfpm2.XXXXXX")"
  (( ${#PM2_HOME_OWN} < 90 )) || { echo "caminho do projeto longo demais para o socket do PM2: $PM2_HOME_OWN" >&2; rm -rf -- "$PM2_HOME_OWN"; exit 2; }
  PM2_HOME="$PM2_HOME_OWN"
fi
export PM2_HOME

PIDS=()
cleanup() {
  local pid
  for pid in "${PIDS[@]+"${PIDS[@]}"}"; do kill -TERM "$pid" 2>/dev/null || true; done
  if [[ -n "$PM2_BIN" && -f "$PM2_HOME/pm2.pid" ]]; then
    env PM2_HOME="$PM2_HOME" "$PM2_BIN" kill >/dev/null 2>&1 || true
    pid="$(cat "$PM2_HOME/pm2.pid" 2>/dev/null || true)"
    [[ "$pid" =~ ^[0-9]+$ ]] && kill -TERM "$pid" 2>/dev/null || true
  fi
  [[ -n "$PM2_HOME_OWN" && "$PM2_HOME_OWN" == "$REPO/.tmp/mfpm2."* ]] && rm -rf -- "$PM2_HOME_OWN"
  if [[ $KEEP == 0 ]]; then rm -rf -- "$WORK"; else echo "diretório de teste mantido: $WORK"; fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

PASS=0 FAIL=0
ok() { PASS=$((PASS + 1)); printf '  OK     %s\n' "$*"; }
bad() { FAIL=$((FAIL + 1)); printf '  FALHA  %s\n' "$*"; }
group() { printf '\n[%s]\n' "$*"; }
OUT="$WORK/out.txt"

# run <raiz> <script> args... → código em RC, saída (stdout+stderr) em $OUT
run() {
  local root="$1" script="$2"
  shift 2
  RC=0
  env MINHAFOLGA_APP_ROOT="$root" MINHAFOLGA_NODE="${SESSION_NODE:-$NODE}" MINHAFOLGA_PM2="$PM2_BIN" \
    bash "$SCRIPT_DIR/$script" "$@" >"$OUT" 2>&1 || RC=$?
}
expect_rc() { # <descrição> <código esperado: 0 | nz> [padrão que precisa aparecer na saída]
  local desc="$1" want="$2" pat="${3:-}"
  if [[ "$want" == 0 && $RC != 0 ]] || [[ "$want" == nz && $RC == 0 ]]; then
    bad "$desc (código $RC)"; sed 's/^/           /' "$OUT" | tail -n 8; return
  fi
  if [[ -n "$pat" ]] && ! grep -qE -- "$pat" "$OUT"; then
    bad "$desc (saída sem /$pat/)"; sed 's/^/           /' "$OUT" | tail -n 8; return
  fi
  ok "$desc"
}
check() { # <descrição> <comando...>
  local desc="$1"
  shift
  if "$@"; then ok "$desc"; else bad "$desc"; fi
}
current_of() { readlink -- "$1/current" 2>/dev/null || echo nenhum; }
wait_port() { # porta estado(livre|escuta) segundos
  local i
  for ((i = 0; i < ${3:-10} * 10; i++)); do
    if [[ -n "$(ss -ltnH "sport = :$1" 2>/dev/null)" ]]; then [[ "$2" == escuta ]] && return 0; else [[ "$2" == livre ]] && return 0; fi
    sleep 0.1
  done
  return 1
}

# Runtimes "diferentes" (links para o mesmo Node) para conferir que cada release usa o dela.
for rt in rtA rtB; do
  mkdir -p "$WORK/$rt/bin"
  ln -s "$NODE" "$WORK/$rt/bin/node"
  ln -s "$NODE_DIR/npm" "$WORK/$rt/bin/npm"
done
RT_A="$WORK/rtA/bin/node" RT_B="$WORK/rtB/bin/node"

# API mínima: lê só MF_ENV_FILE, responde /api/health e a prontidão interna, encerra com SIGTERM.
FAKE_SERVER='const http = require("node:http"), fs = require("node:fs"), path = require("node:path");
const { parseEnv } = require("node:util");
const env = parseEnv(fs.readFileSync(process.env.MF_ENV_FILE, "utf8"));
const release = path.basename(path.resolve(__dirname, "../.."));
const srv = http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/api/health") return res.end(JSON.stringify({ status: "ok" }));
  if (req.url === "/api/internal/ready" && req.headers["x-readiness-token"] === env.READINESS_TOKEN)
    return res.end(JSON.stringify({ status: "ready", release, phase: env.CREDIT_PHASE }));
  res.statusCode = 404; res.end("{\"error\":{\"code\":\"not_found\"}}");
});
srv.listen(Number(env.PORT), env.HOST || "127.0.0.1", () => { if (process.send) process.send("ready"); });
process.on("SIGTERM", () => srv.close(() => process.exit(0)));'

make_release() { # <raiz> <id> <modo do build> <node_path>
  local root="$1" id="$2" mode="$3" node="$4" d
  d="$root/releases/$id"
  mkdir -p "$d/backend/dist/cli" "$d/backend/migrations" "$d/frontend/dist/assets" "$d/deploy"
  cp -- "$REPO/deploy/ecosystem.config.cjs" "$d/deploy/"
  printf '%s\n' "$FAKE_SERVER" >"$d/backend/dist/server.js"
  cp -- "$d/backend/dist/server.js" "$d/backend/dist/worker.js"
  echo 'console.log(JSON.stringify({ applied: [] }))' >"$d/backend/dist/cli/migrate.js"
  echo '-- sem alterações' >"$d/backend/migrations/001_initial.sql"
  for f in index 404 admin; do echo "<!doctype html><title>$f $id</title>" >"$d/frontend/dist/$f.html"; done
  echo "/* $id */" >"$d/frontend/dist/assets/app-$id.js"
  (cd -- "$d/frontend/dist/assets" && find . -maxdepth 1 -type f -printf '%f\n' | sort) >"$d/.assets-built.txt"
  echo "mode=$mode" >"$d/.minhafolga-build"
  printf 'format=1\nid=%s\nstate=ready\nbuild_mode=%s\nnode_path=%s\nnode_version=%s\nprepared_at=%s\n' \
    "$id" "$mode" "$node" "$("$node" -v)" "$(date -Iseconds)" >"$d/.minhafolga-release"
  ln -s -- "$node" "$d/.minhafolga-node"
  chmod -R go-rwx -- "$d"
}

write_env() { # <arquivo> <porta> <NODE_ENV> [fase]
  umask 077
  cat >"$1" <<EOF
NODE_ENV=$3
HOST=127.0.0.1
PORT=$2
CREDIT_PHASE=${4:-PRE_LAUNCH}
PUBLIC_SITE_URL=http://127.0.0.1:1
WORKER_MODE=inline
READINESS_TOKEN=selftest-$(od -An -N12 -tx1 /dev/urandom | tr -d ' \n')
EOF
  chmod 600 "$1"
}

start_manual() { # <raiz> → inicia a API de current como o modo manual instruiria; PID em LAST_PID
  local root="$1"
  # cd antes e comando simples em segundo plano: $! é o PID do próprio node (env -i faz exec).
  (cd -- "$root/current/backend" || exit 1
  env -i PATH="$PATH" NODE_ENV=production MF_ENV_FILE="$root/config/.env.production" \
    "$(readlink -- "$root/current/.minhafolga-node")" dist/server.js </dev/null >>"$root/var/log/api.out.log" 2>&1 &
  echo $! >"$root/var/run/selftest-manual.pid")
  LAST_PID="$(cat "$root/var/run/selftest-manual.pid")"
  PIDS+=("$LAST_PID")
}

echo "Autoteste dos scripts de implantação — diretório $WORK, Node $("$NODE" -v), portas $P_A-$P_FIXED"

# ------------------------------------------------------------------------------------------------ raiz
group "Validação da raiz"
for bad_root in "" relativo / "$HOME" /tmp /srv "$WORK/com espaco" "$WORK/a/../b" "$WORK/public_html/mf" "/var/www/html/mf"; do
  run "$bad_root" deploy.sh init
  if [[ $RC != 0 ]]; then ok "recusada: '${bad_root:-vazia}'"; else bad "aceita: '$bad_root'"; fi
done
mkdir -p "$WORK/alheia" && touch "$WORK/alheia/arquivo"
run "$WORK/alheia" deploy.sh init
expect_rc "pasta não vazia sem marcador recusada" nz "não está vazia"

ROOT_A="$WORK/raizA" ROOT_B="$WORK/raizB" ROOT_C="$WORK/raizC"
run "$ROOT_A" deploy.sh init
expect_rc "init da raiz de produção (instância prod)" 0 "instância prod"
run "$ROOT_B" deploy.sh init --instance homolog
expect_rc "init da raiz de homologação (--instance homolog)" 0 "minhafolga-homolog-api"
run "$ROOT_B" deploy.sh init --instance outra
expect_rc "instância não muda depois do init" nz "não muda"
run "$ROOT_C" deploy.sh init --instance Prod!
expect_rc "nome de instância inválido recusado" nz "instância inválida"
run "$ROOT_C" deploy.sh init
expect_rc "init de uma segunda raiz de produção (mesmos nomes da raiz A)" 0
check "marcador 600 e árvore 700/711" test "$(stat -c %a "$ROOT_A/.minhafolga-root") $(stat -c %a "$ROOT_A/config") $(stat -c %a "$ROOT_A")" = "600 700 711"

write_env "$ROOT_A/config/.env.production" "$P_A" production
write_env "$ROOT_B/config/.env.production" "$P_B" staging
write_env "$ROOT_C/config/.env.production" "$P_A" production
chmod 640 "$ROOT_A/config/.env.production"
run "$ROOT_A" deploy.sh backup-db
expect_rc "arquivo de ambiente 640 recusado (grupo)" nz "grupo/outros"
chmod 600 "$ROOT_A/config/.env.production"

# ------------------------------------------------------------------------------------------------ prepare
group "prepare: modo explícito e origem"
run "$ROOT_A" deploy.sh prepare r0 --from-dir "$REPO"
expect_rc "prepare sem --release/--staging/--review recusado" nz "informe o modo do build"
mkdir -p "$WORK/src-git" && git -C "$WORK/src-git" init -q && echo x >"$WORK/src-git/novo.txt"
run "$ROOT_A" deploy.sh prepare r0 --from-dir "$WORK/src-git" --release
expect_rc "--release de checkout com alterações não registradas recusado" nz "alterações não registradas"
mkdir -p "$WORK/src-plain"
run "$ROOT_A" deploy.sh prepare r0 --from-dir "$WORK/src-plain" --release
expect_rc "--release de pasta sem git recusado" nz "não é um checkout git"
check "nenhuma release criada pelas tentativas recusadas" test ! -e "$ROOT_A/releases/r0"

# ------------------------------------------------------------------------------------------------ publish
group "publish: modo do build × ambiente, Node da release, registro antes da troca"
make_release "$ROOT_A" r1 release "$RT_A"
make_release "$ROOT_A" r2 release "$RT_B"
make_release "$ROOT_A" rrev review "$RT_A"
run "$ROOT_A" deploy.sh migrate r1 --skip-backup
expect_rc "migrate r1" 0 "aplicadas agora"
run "$ROOT_A" deploy.sh publish rrev --mode manual --skip-migrate-check
expect_rc "build de revisão recusado com NODE_ENV=production" nz "só publica build --release"
run "$ROOT_A" deploy.sh publish rrev --mode manual --skip-migrate-check --allow-review-build
expect_rc "--allow-review-build recusado em produção" nz "não é aceito com NODE_ENV=production"
check "current continua ausente" test "$(current_of "$ROOT_A")" = nenhum

SESSION_NODE="$RT_B" run "$ROOT_A" deploy.sh publish r1 --mode manual
expect_rc "publish r1 (manual) usa o Node da release, não o da sessão" 0 "nohup $RT_A dist/server.js"
check "current → releases/r1" test "$(current_of "$ROOT_A")" = releases/r1
check "publish-start registrado antes do publish" grep -qE "event=publish-start user=[^ ]+ release=r1 previous=nenhuma" "$ROOT_A/var/releases.log"
start_manual "$ROOT_A"
wait_port "$P_A" escuta 10 || bad "a API manual de r1 não subiu"
API_A="$LAST_PID"

run "$ROOT_A" deploy.sh restart --mode manual
expect_rc "restart manual sugere encerrar só o PID da própria API" 0 "kill -TERM $API_A +# release r1"

# Porta tomada por outro serviço (mesmo usuário, fora da raiz): nada é alterado, nenhum PID alheio sugerido.
(cd "$WORK" || exit 1
  "$NODE" -e "require('node:http').createServer((q, s) => s.end('outro')).listen($P_FOREIGN, '127.0.0.1')" </dev/null >/dev/null 2>&1 &
  echo $! >"$WORK/foreign.pid")
FOREIGN="$(cat "$WORK/foreign.pid")"
PIDS+=("$FOREIGN")
wait_port "$P_FOREIGN" escuta 10 || bad "processo alheio não subiu"
write_env "$ROOT_C/config/.env.production" "$P_FOREIGN" production
make_release "$ROOT_C" c1 release "$RT_A"
run "$ROOT_C" deploy.sh publish c1 --mode manual --skip-migrate-check
expect_rc "publish recusado com a porta ocupada por outro serviço" nz "ocupada por outro serviço"
check "raiz C sem current depois da recusa" test "$(current_of "$ROOT_C")" = nenhum
ln -s releases/c1 "$ROOT_C/current"
run "$ROOT_C" deploy.sh restart --mode manual
if [[ $RC != 0 ]] && ! grep -q "kill -TERM $FOREIGN" "$OUT"; then ok "restart manual não sugere encerrar o PID alheio ($FOREIGN)"; else bad "restart manual sugeriu o PID alheio"; sed 's/^/           /' "$OUT" | tail -n 5; fi
rm -f "$ROOT_C/current"
write_env "$ROOT_C/config/.env.production" "$P_A" production

# Pré-condição do gerenciador falha ANTES da troca (PM2 sem daemon e sem --pm2-allow-start).
run "$ROOT_A" deploy.sh migrate r2 --skip-backup
if [[ -z "$PM2_BIN" ]]; then
  mkdir -p "$WORK/fakebin" && printf '#!/bin/sh\nexit 0\n' >"$WORK/fakebin/pm2" && chmod 700 "$WORK/fakebin/pm2"
  PM2_BIN_SAVE="" PM2_BIN="$WORK/fakebin/pm2"
else
  PM2_BIN_SAVE="$PM2_BIN"
fi
run "$ROOT_A" deploy.sh publish r2 --mode pm2
expect_rc "publish --mode pm2 sem daemon para antes de trocar current" nz "Nada foi alterado"
check "current continua em r1" test "$(current_of "$ROOT_A")" = releases/r1
check "nenhum publish-start de r2 registrado" bash -c "! grep -qE 'event=publish-start user=[^ ]+ release=r2' '$ROOT_A/var/releases.log'"
PM2_BIN="$PM2_BIN_SAVE"

# Publicação r2 (manual) e rollback: assets da release que sai, Node da release de destino.
run "$ROOT_A" deploy.sh publish r2 --mode manual
expect_rc "publish r2 (manual) com o Node de r2" 0 "nohup $RT_B dist/server.js"
check "assets de r1 copiados para r2" test -f "$ROOT_A/releases/r2/frontend/dist/assets/app-r1.js"
kill -TERM "$API_A" 2>/dev/null || true
wait_port "$P_A" livre 15 || bad "a API de r1 não encerrou"
start_manual "$ROOT_A"
API_A="$LAST_PID"
wait_port "$P_A" escuta 10 || bad "a API manual de r2 não subiu"

group "rollback"
run "$ROOT_A" rollback.sh --dry-run
expect_rc "rollback --dry-run aponta r1 e o Node dela" 0 "r2 → r1.*|Node da release de destino: $RT_A"
SESSION_NODE="$RT_B" run "$ROOT_A" rollback.sh --mode manual
expect_rc "rollback (manual) para r1 com o Node de r1" 0 "nohup $RT_A dist/server.js"
check "current → releases/r1" test "$(current_of "$ROOT_A")" = releases/r1
check "assets de r2 mantidos em r1 (abas abertas)" test -f "$ROOT_A/releases/r1/frontend/dist/assets/app-r2.js"
check "evento rollback com carried_assets" grep -qE "event=rollback user=[^ ]+ release=r1 previous=r2 .*carried_assets=[1-9]" "$ROOT_A/var/releases.log"
kill -TERM "$API_A" 2>/dev/null || true
wait_port "$P_A" livre 15 || true

# Publicação interrompida depois do publish-start: o rollback ainda encontra a anterior.
make_release "$ROOT_A" r3 release "$RT_A"
printf '%s event=publish-start user=%s release=r3 previous=r1 mode=manual\n' "$(date -Iseconds)" "$(id -un)" >>"$ROOT_A/var/releases.log"
ln -sfn releases/r3 "$ROOT_A/current"
run "$ROOT_A" rollback.sh --dry-run
expect_rc "publicação interrompida: rollback encontra r1 pelo publish-start" 0 "r3 → r1"
ln -sfn releases/r1 "$ROOT_A/current"

group "mudança de fase coordenada (--env-file / --promote-env)"
cp -p "$ROOT_A/config/.env.production" "$ROOT_A/config/.env.next"
sed -i 's/^CREDIT_PHASE=.*/CREDIT_PHASE=PILOT/' "$ROOT_A/config/.env.next"
make_release "$ROOT_A" r4 release "$RT_A"
{
  echo "env_file=$ROOT_A/config/.env.next"
  echo "env_sha256=$(sha256sum "$ROOT_A/config/.env.next" | cut -c1-64)"
} >>"$ROOT_A/releases/r4/.minhafolga-release"
run "$ROOT_A" deploy.sh publish r4 --mode manual --skip-migrate-check --promote-env
expect_rc "publish --promote-env troca o ambiente junto com a release" 0 "substituído pelo arquivo do prepare"
check "config/.env.production agora em PILOT" grep -qx "CREDIT_PHASE=PILOT" "$ROOT_A/config/.env.production"
check "cópia do anterior guardada (0600)" test "$(stat -c %a "$ROOT_A/config/.env.production.antes-r4" 2>/dev/null)" = 600
run "$ROOT_A" rollback.sh --mode manual
expect_rc "rollback restaura o ambiente anterior à promoção" 0 "restaurado de config/.env.production.antes-r4"
check "config/.env.production de volta a PRE_LAUNCH" grep -qx "CREDIT_PHASE=PRE_LAUNCH" "$ROOT_A/config/.env.production"
check "current → releases/r1" test "$(current_of "$ROOT_A")" = releases/r1

group "cleanup"
for i in 5 6 7; do make_release "$ROOT_A" "r$i" release "$RT_A"; done
mkdir -p "$ROOT_A/releases/nao-gerenciada"
run "$ROOT_A" deploy.sh cleanup --keep 2
expect_rc "cleanup --keep 2" 0
check "atual (r1) mantida" test -d "$ROOT_A/releases/r1"
check "anterior da atual mantida" test -d "$ROOT_A/releases/$(env MF_LIB_LOADED= bash -c "source '$SCRIPT_DIR/lib.sh'; MF_ROOT='$ROOT_A'; mf_previous_of r1" | sed 's/^nenhuma$/r1/')"
check "pasta não gerenciada mantida" test -d "$ROOT_A/releases/nao-gerenciada"
check "releases antigas removidas" test ! -d "$ROOT_A/releases/rrev"

group "systemd-unit e instâncias"
run "$ROOT_B" deploy.sh systemd-unit
expect_rc "unidades da homologação com nomes próprios e Node da release" 0 "minhafolga-homolog-api.service"
check "ExecStart pelo link da release" grep -q "ExecStart=$ROOT_B/current/.minhafolga-node $ROOT_B/current/backend/dist/server.js" "$OUT"
names="$(env MINHAFOLGA_APP_ROOT="$ROOT_B" MINHAFOLGA_NODE="$NODE" "$NODE" -e 'console.log(require(process.argv[1]).apps.map((a) => a.name).join(","))' "$REPO/deploy/ecosystem.config.cjs")"
check "ecosystem da homologação: $names" test "$names" = "minhafolga-homolog-api,minhafolga-homolog-worker"

group "preflight"
run "$ROOT_A" preflight.sh --no-save --port "$P_FOREIGN"
expect_rc "porta de outro serviço → BLOQUEIO (código 2)" nz "BLOQUEIO: porta $P_FOREIGN ocupada por outro serviço"
mkdir -p "$WORK/noss" && printf '#!/bin/sh\nexit 1\n' >"$WORK/noss/ss" && chmod 700 "$WORK/noss/ss"
RC=0
env PATH="$WORK/noss:$PATH" MINHAFOLGA_APP_ROOT="$ROOT_A" MINHAFOLGA_NODE="$NODE" bash "$SCRIPT_DIR/preflight.sh" --no-save >"$OUT" 2>&1 || RC=$?
expect_rc "porta não verificável → BLOQUEIO, nunca 'livre'" nz "BLOQUEIO: não foi possível verificar se a porta"
chmod 640 "$ROOT_A/config/.env.production"
run "$ROOT_A" preflight.sh --no-save
expect_rc "ambiente 640 → BLOQUEIO" nz "permissão para grupo/outros"
chmod 600 "$ROOT_A/config/.env.production"
check "temporário do preflight na raiz (var/tmp)" bash -c "env MINHAFOLGA_APP_ROOT='$ROOT_A' bash -c 'source \"$SCRIPT_DIR/lib.sh\"; mf_resolve_root; echo \$TMPDIR' | grep -qx '$ROOT_A/var/tmp'"

# Document root de outro site e servidor padrão por porta (vhosts de uma pasta da hospedagem simulada).
mkdir -p "$WORK/vhosts" "$WORK/docroot-outro"
printf 'server {\n    listen 443 ssl;\n    server_name outro.example;\n    root %s;\n}\n' "$WORK/docroot-outro" >"$WORK/vhosts/outro-site.conf"
RC=0
env MINHAFOLGA_APP_ROOT="$WORK/docroot-outro/minhafolga" MINHAFOLGA_NODE="$NODE" bash "$SCRIPT_DIR/preflight.sh" --no-save \
  --vhost-dir "$WORK/vhosts" --port "$P_B" >"$OUT" 2>&1 || RC=$?
expect_rc "raiz dentro do document root de outro site → BLOQUEIO" nz "BLOQUEIO: a raiz .* fica dentro do document root"
check "sem default_server explícito em 443 → ATENCAO" grep -q "ATENCAO: Nginx sem default_server explícito em 443" "$OUT"
check "nenhum outro vhost em [::]:443 → ATENCAO (remover listen IPv6)" grep -qF "ATENCAO: nenhum outro vhost do Nginx escuta em [::]:443" "$OUT"
printf 'server {\n    listen 443 ssl default_server;\n    listen [::]:443 ssl default_server;\n    server_name _;\n}\n' >"$WORK/vhosts/00-padrao.conf"
RC=0
env MINHAFOLGA_APP_ROOT="$ROOT_A" MINHAFOLGA_NODE="$NODE" bash "$SCRIPT_DIR/preflight.sh" --no-save --vhost-dir "$WORK/vhosts" --port "$P_B" >"$OUT" 2>&1 || RC=$?
if ! grep -qE "ATENCAO: (Nginx sem default_server explícito em (443|\[::\]:443)|nenhum outro vhost do Nginx escuta em \[::\]:443)" "$OUT" &&
  grep -q "default_server=\[$WORK/vhosts/00-padrao.conf\]" "$OUT"; then
  ok "com servidor padrão explícito da hospedagem em 443 e [::]:443: sem aviso"
else
  bad "servidor padrão explícito não reconhecido"; grep -E "nginx listen|ATENCAO" "$OUT" | sed 's/^/           /'
fi

# Reinício de processo de outro site entre dois inventários (mesmo usuário, porta fixa).
start_fixed() {
  (cd "$WORK" || exit 1
  "$NODE" -e "require('node:http').createServer((q, s) => s.end('fixo')).listen($P_FIXED, '127.0.0.1')" </dev/null >/dev/null 2>&1 &
  echo $! >"$WORK/fixed.pid")
  FIXED="$(cat "$WORK/fixed.pid")"
  PIDS+=("$FIXED")
  wait_port "$P_FIXED" escuta 10
}
start_fixed
run "$ROOT_A" preflight.sh --port "$P_A"
sleep 1
run "$ROOT_A" preflight.sh --port "$P_A"
mapfile -t INV < <(ls -1 "$ROOT_A"/var/inventory/*.txt | sort)
run "$ROOT_A" preflight.sh --compare "${INV[0]}" "${INV[1]}"
if [[ $RC == 0 ]] && grep -q "Nenhuma diferença estável" "$OUT"; then
  ok "dois inventários seguidos sem diferença estável"
elif [[ $RC == 3 ]] && ! grep -qE "^[-+] .*:$P_FIXED " "$OUT"; then
  # Máquina compartilhada: outro processo do usuário (fora do teste) mudou no intervalo e foi apontado.
  ok "dois inventários seguidos: só diferença de processo alheio ao teste, apontada pelo --compare: $(grep -E '^  [-+] ' "$OUT" | head -n 1 | sed 's/^ *//')"
else
  bad "dois inventários seguidos com diferença inesperada (código $RC)"; sed 's/^/           /' "$OUT" | tail -n 8
fi
kill -TERM "$FIXED"; wait_port "$P_FIXED" livre 10
sleep 1
start_fixed
sleep 1
run "$ROOT_A" preflight.sh --port "$P_A"
mapfile -t INV < <(ls -1 "$ROOT_A"/var/inventory/*.txt | sort)
run "$ROOT_A" preflight.sh --compare "${INV[1]}" "${INV[2]}"
if [[ $RC == 3 ]] && grep -qE "ATENÇÃO: processos que não são da Minha Folga" "$OUT" && grep -qE "127.0.0.1:$P_FIXED .*pid=$FIXED" "$OUT"; then
  ok "reinício de processo alheio detectado no --compare (código 3)"
else
  bad "reinício de processo alheio não detectado (código $RC)"; sed 's/^/           /' "$OUT" | tail -n 12
fi
kill -TERM "$FIXED" 2>/dev/null || true
wait_port "$P_FIXED" livre 10 || true

# ------------------------------------------------------------------------------------------------ revisão local
if [[ -f "$REPO/frontend/scripts/static-server.mjs" ]]; then
  group "servidor de revisão (frontend/scripts/static-server.mjs) × regras do vhost"
  SD="$WORK/dist-revisao"
  mkdir -p "$SD/.vite" "$SD/assets" "$SD/conteudos"
  for f in index 404 admin sobre conteudos/o-que-e-cet; do echo "<!doctype html><title>$f</title>" >"$SD/$f.html"; done
  echo '{}' >"$SD/.vite/ssr-manifest.json"
  echo '/* a */' >"$SD/assets/a.js"
  (cd "$WORK" || exit 1
  "$NODE" "$REPO/frontend/scripts/static-server.mjs" --port "$P_FIXED" --api "http://127.0.0.1:$P_FOREIGN" --dist "$SD" </dev/null >/dev/null 2>&1 &
  echo $! >"$WORK/static.pid")
  STATIC="$(cat "$WORK/static.pid")"
  PIDS+=("$STATIC")
  wait_port "$P_FIXED" escuta 10 || bad "servidor de revisão não subiu"
  bad_codes=""
  for pair in /:200 /sobre:200 /conteudos/o-que-e-cet:200 /assets/a.js:200 /admin:200 /admin/leads:200 \
    /admin/leads/00000000-0000-4000-8000-000000000000:200 /admin/atendimentos/abc:200 /admin/conta:200 \
    /.vite/ssr-manifest.json:404 /.env:404 /assets/.x:404 /index:404 /index.html:404 /sobre.html:404 /404:404 \
    /admin/qualquer:404 /admin/leads/a/b:404 /nao-existe:404 /sobre/:301 /%E0:400; do
    code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$P_FIXED${pair%:*}")"
    [[ "$code" == "${pair##*:}" ]] || bad_codes+=" ${pair%:*}=$code(esperado ${pair##*:})"
  done
  if [[ -z "$bad_codes" ]]; then ok "21 URLs com o mesmo resultado do vhost (dotfiles, *.html, /index, rotas admin, 404, 301, 400)"; else bad "servidor de revisão diverge:$bad_codes"; fi
  kill -TERM "$STATIC" 2>/dev/null || true
  wait_port "$P_FIXED" livre 10 || true
fi

# ------------------------------------------------------------------------------------------------ PM2
if [[ -n "$PM2_BIN" ]]; then
  group "PM2 (daemon isolado em $PM2_HOME)"
  make_release "$ROOT_A" p1 release "$RT_A"
  make_release "$ROOT_A" p2 release "$RT_B"
  run "$ROOT_A" deploy.sh publish p1 --mode pm2 --skip-migrate-check
  expect_rc "sem daemon e sem --pm2-allow-start: nada muda" nz "Nada foi alterado"
  run "$ROOT_A" deploy.sh publish p1 --mode pm2 --pm2-allow-start --skip-migrate-check
  expect_rc "publish p1 --mode pm2 (processo minhafolga-api)" 0 "release p1 publicada"
  run "$ROOT_A" deploy.sh publish p2 --mode pm2 --skip-migrate-check
  expect_rc "publish p2 --mode pm2 (recarga por nome)" 0 "release p2 publicada"
  check "health=ok com a porta atendida pela release p2" grep -qE "event=publish user=[^ ]+ release=p2 .*health=ok" "$ROOT_A/var/releases.log"
  make_release "$ROOT_B" h1 staging "$RT_A"
  run "$ROOT_B" deploy.sh publish h1 --mode pm2 --skip-migrate-check
  expect_rc "homologação no mesmo daemon: minhafolga-homolog-api" 0 "release h1 publicada"
  jl="$(env PM2_HOME="$PM2_HOME" "$PM2_BIN" jlist 2>/dev/null | "$NODE" -e 'let r="";process.stdin.on("data",c=>r+=c).on("end",()=>{console.log(JSON.parse(r.slice(r.search(/\[\s*[{\]]/))).map(p=>p.name+"@"+p.pm2_env.pm_exec_path).sort().join(" "))})')"
  if [[ "$jl" == *"minhafolga-api@$ROOT_A/"* && "$jl" == *"minhafolga-homolog-api@$ROOT_B/"* ]]; then
    ok "dois processos distintos, cada um na sua raiz"
  else
    bad "processos PM2 inesperados: $jl"
  fi
  kill -TERM "$FOREIGN" 2>/dev/null || true
  wait_port "$P_FOREIGN" livre 10 || true
  make_release "$ROOT_C" c2 release "$RT_A"
  write_env "$ROOT_C/config/.env.production" "$P_FOREIGN" production
  run "$ROOT_C" deploy.sh publish c2 --mode pm2 --skip-migrate-check
  expect_rc "outra raiz com os mesmos nomes é recusada (não toca no processo da raiz A)" nz "pertencente a outra raiz"
  check "raiz C sem current" test "$(current_of "$ROOT_C")" = nenhum
  ln -s releases/c2 "$ROOT_C/current"
  run "$ROOT_C" deploy.sh stop --mode pm2
  expect_rc "stop da raiz C não alcança o minhafolga-api homônimo da raiz A" nz "pertencente a outra raiz"
  if curl -fsS "http://127.0.0.1:$P_A/api/health" >/dev/null 2>&1; then ok "API da raiz A continua no ar"; else bad "API da raiz A caiu"; fi
  rm -f "$ROOT_C/current"
  run "$ROOT_C" preflight.sh --no-save --port "$P_FOREIGN"
  expect_rc "preflight da raiz C aponta o conflito de nomes" nz "BLOQUEIO: o PM2 já tem processo com o nome desta instância"
  run "$ROOT_A" preflight.sh --no-save --port "$P_A"
  if grep -qE "minhafolga-api.*status=online.*reinicios=[0-9]+.*inicio=.*\[minhafolga\]" "$OUT"; then ok "inventário PM2 com reinícios e início"; else bad "inventário PM2 sem reinícios/início"; fi
  run "$ROOT_A" rollback.sh --mode pm2
  expect_rc "rollback --mode pm2 para p1 (saúde e release da porta conferidas)" 0 "rollback concluído"
  check "evento rollback p2 → p1 com health=ok" grep -qE "event=rollback user=[^ ]+ release=p1 previous=p2 .*health=ok" "$ROOT_A/var/releases.log"
  run "$ROOT_A" deploy.sh verify --url http://127.0.0.1:9
  if grep -q "OK   porta $P_A atendida pela release atual (p1" "$OUT" && grep -q "OK   prontidão interna" "$OUT"; then
    ok "verify confere a release que atende a porta e a prontidão interna"
  else
    bad "verify sem as conferências locais"; sed 's/^/           /' "$OUT" | head -n 12
  fi
  run "$ROOT_A" deploy.sh restart --mode pm2
  expect_rc "restart --mode pm2 com o Node da release atual" 0 "API da release p1 respondendo"
  run "$ROOT_A" deploy.sh stop --mode pm2
  expect_rc "stop --mode pm2" 0
  if wait_port "$P_A" livre 15; then ok "porta liberada depois do stop"; else bad "porta ainda em uso depois do stop"; fi
  run "$ROOT_B" deploy.sh stop --mode pm2
fi

printf '\nResultado do autoteste: %d OK, %d falha(s).\n' "$PASS" "$FAIL"
((FAIL == 0))
