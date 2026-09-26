#!/usr/bin/env bash
# Website Minha Folga servido LOCALMENTE em HTTPS (revisão no navegador). Não é implantação.
#
#   scripts/local-https.sh start [--port 8000] [--api-port 3170]   sobe API + site HTTPS em segundo plano
#   scripts/local-https.sh stop                                    encerra só os processos iniciados por este script
#   scripts/local-https.sh status                                  mostra processos, portas e endereços
#
# Regra do projeto (CLAUDE.md): TUDO fica dentro deste diretório — certificado autoassinado, banco PGlite,
# logs, PIDs e temporários em .tmp/local-https/; Node do runtime privado (.runtime/, scripts/node-runtime.sh).
# Nada é instalado no sistema, no navegador ou no perfil do usuário. O site NÃO envia HSTS (em localhost ele valeria
# para todas as portas do navegador). Nenhum processo alheio é encerrado: porta ocupada = o script para.
set -euo pipefail

PROJECT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
RUN="$PROJECT/scripts/node-runtime.sh"
BASE="$PROJECT/.tmp/local-https"
TLS="$BASE/tls"
LOGS="$BASE/logs"
PIDS="$BASE/pids"
ENV_FILE="$BASE/backend.env"
PORT=8000
API_PORT=3170

die() { echo "local-https: $*" >&2; exit 1; }
port_busy() { ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]$1\$"; }

# Grupo de processos registrado (o líder, criado pelo setsid), vivo e com a linha de comando apontando para este
# projeto — nunca sinaliza processo alheio.
our_pid() {
  local f="$PIDS/$1.pid" pid
  [[ -f "$f" ]] || return 1
  pid="$(cat "$f")"
  [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null || return 1
  [[ "$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')" == "$pid" ]] || return 1
  tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null | grep -qF "$PROJECT" || return 1
  echo "$pid"
}

# Líder do grupo do processo que escuta na porta (só se a linha de comando for deste projeto).
record_listener() {
  local name="$1" port="$2" pid pgid
  pid="$(ss -ltnpH "sport = :$port" 2>/dev/null | grep -o 'pid=[0-9]*' | head -n1 | cut -d= -f2)"
  [[ -n "$pid" ]] || return 1
  pgid="$(ps -o pgid= -p "$pid" | tr -d ' ')"
  tr '\0' ' ' <"/proc/$pgid/cmdline" 2>/dev/null | grep -qF "$PROJECT" || return 1
  echo "$pgid" >"$PIDS/$name.pid"
}

cmd_status() {
  local name pid
  for name in api site; do
    if pid="$(our_pid "$name")"; then echo "$name: rodando (PID $pid)"; else echo "$name: parado"; fi
  done
  [[ -f "$BASE/portas" ]] && cat "$BASE/portas"
}

cmd_stop() {
  local name pid i
  for name in site api; do
    if pid="$(our_pid "$name")"; then
      # Encerra o grupo de processos criado pelo setsid do próprio script (wrapper + node).
      kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
      for i in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.25; done
      echo "$name: encerrado (PID $pid)"
    fi
    rm -f -- "$PIDS/$name.pid"
  done
}

cmd_start() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --port) PORT="$2"; shift 2 ;;
      --api-port) API_PORT="$2"; shift 2 ;;
      *) die "opção desconhecida: $1" ;;
    esac
  done
  [[ "$PORT" =~ ^[0-9]+$ && "$API_PORT" =~ ^[0-9]+$ ]] || die "portas inválidas"
  "$RUN" path >/dev/null 2>&1 || die "runtime privado ausente: rode  scripts/node-runtime.sh install"
  [[ -f "$PROJECT/frontend/dist/index.html" ]] || die "build ausente: rode  scripts/node-runtime.sh exec npm --prefix frontend run build"
  if our_pid site >/dev/null || our_pid api >/dev/null; then die "já está rodando (use: $0 status / $0 stop)"; fi
  port_busy "$PORT" && die "porta $PORT ocupada por outro processo; nada foi alterado"
  port_busy "$API_PORT" && die "porta $API_PORT ocupada por outro processo; nada foi alterado"

  mkdir -p "$TLS" "$LOGS" "$PIDS"
  chmod 700 "$BASE"

  # 1) Certificado autoassinado para localhost/127.0.0.1 (30 dias), só dentro do projeto.
  if [[ ! -f "$TLS/cert.pem" || ! -f "$TLS/key.pem" ]]; then
    RANDFILE="$TLS/.rnd" openssl req -x509 -newkey rsa:2048 -nodes -days 30 -sha256 \
      -subj "/CN=localhost/O=Minha Folga (revisao local)" \
      -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1" \
      -keyout "$TLS/key.pem" -out "$TLS/cert.pem" >/dev/null 2>&1 || die "falha ao gerar o certificado"
    chmod 600 "$TLS/key.pem"
  fi

  # 2) Ambiente da API de revisão (segredos gerados uma vez e mantidos: os dados cifrados dependem deles).
  if [[ ! -f "$ENV_FILE" ]]; then
    local gen='const c=require("crypto");const b=(n)=>c.randomBytes(n).toString("base64");const u=(n)=>c.randomBytes(n).toString("base64url");console.log([b(32),b(32),b(32),u(24),u(32)].join(" "))'
    local secrets enc dedup sess ready inbound
    secrets="$("$RUN" exec node -e "$gen")"
    read -r enc dedup sess ready inbound <<<"$secrets"
    umask 077
    cat >"$ENV_FILE" <<EOF
# Gerado por scripts/local-https.sh — somente revisão local (NODE_ENV=development). Não versionar.
NODE_ENV=development
HOST=127.0.0.1
PORT=$API_PORT
LOG_LEVEL=info
PUBLIC_SITE_URL=https://localhost:$PORT
ALLOWED_ORIGINS=https://localhost:$PORT,https://127.0.0.1:$PORT
DATABASE_URL=pglite://$BASE/pgdata
COOKIE_SECURE=true
# Ferramentas da Bia (/api/agent/*) para testar à mão com  X-API-Key: <HALAI_INBOUND_API_KEY>. Nada sai daqui:
# o envio de template da Hal-AI é placeholder e fica desligado.
HALAI_ENABLED=true
HALAI_INBOUND_API_KEY=$inbound
WORKER_MODE=inline
CONTACT_ENCRYPTION_KEY=$enc
CONTACT_DEDUP_HMAC_KEY=$dedup
SESSION_SECRET=$sess
READINESS_TOKEN=$ready
EOF
    umask 022
  fi

  # 3) Migrações e pessoa usuária do painel (antes da API: o PGlite aceita um processo por vez).
  (cd "$PROJECT/backend" && MF_ENV_FILE="$ENV_FILE" "$RUN" exec node_modules/.bin/tsx src/cli/migrate.ts) >>"$LOGS/api.log" 2>&1 \
    || die "migração falhou (veja $LOGS/api.log)"
  if [[ ! -f "$BASE/admin.txt" ]]; then
    local out
    out="$(cd "$PROJECT/backend" && MF_ENV_FILE="$ENV_FILE" "$RUN" exec node_modules/.bin/tsx src/cli/admin-create.ts \
      --email admin@minhafolga.local --name "Admin (revisão local)" --role admin 2>&1)" || die "admin-create falhou: $out"
    umask 077
    printf 'E-mail: admin@minhafolga.local\n%s\n' "$(grep -E '^Senha temporária:' <<<"$out")" >"$BASE/admin.txt"
    umask 022
  fi

  # 4) API e site HTTPS em segundo plano, em grupo de processos próprio (setsid), com logs e PIDs no projeto.
  (cd "$PROJECT/backend" && MF_ENV_FILE="$ENV_FILE" setsid nohup "$RUN" exec node_modules/.bin/tsx src/server.ts \
    >>"$LOGS/api.log" 2>&1 </dev/null &)
  local i
  for i in $(seq 1 60); do curl -sf "http://127.0.0.1:$API_PORT/api/health" >/dev/null 2>&1 && break; sleep 0.5; done
  curl -sf "http://127.0.0.1:$API_PORT/api/health" >/dev/null 2>&1 || die "a API não respondeu (veja $LOGS/api.log)"
  record_listener api "$API_PORT" || die "não foi possível identificar o processo da API na porta $API_PORT" 

  (cd "$PROJECT/frontend" && setsid nohup "$RUN" exec node scripts/static-server.mjs --port "$PORT" \
    --api "http://127.0.0.1:$API_PORT" --tls-cert "$TLS/cert.pem" --tls-key "$TLS/key.pem" \
    >>"$LOGS/site.log" 2>&1 </dev/null &)
  for i in $(seq 1 40); do curl -skf "https://127.0.0.1:$PORT/" -o /dev/null && break; sleep 0.25; done
  curl -skf "https://127.0.0.1:$PORT/" -o /dev/null || { cmd_stop; die "o site não respondeu (veja $LOGS/site.log)"; }
  record_listener site "$PORT" || { cmd_stop; die "não foi possível identificar o processo do site na porta $PORT"; }

  printf 'site: https://localhost:%s (API interna em 127.0.0.1:%s)\n' "$PORT" "$API_PORT" >"$BASE/portas"
  cat <<EOF
Website no ar em  https://localhost:$PORT   (também https://127.0.0.1:$PORT)
- Certificado autoassinado (só deste projeto): o navegador mostra um aviso; confirme a exceção para localhost.
- Ferramentas da Bia: POST https://localhost:$PORT/api/agent/tools/<ferramenta> com X-API-Key de $ENV_FILE
- Painel: https://localhost:$PORT/admin — acesso em $BASE/admin.txt (troca de senha e MFA no primeiro acesso)
- Logs: $LOGS/   ·   parar:  scripts/local-https.sh stop
EOF
}

case "${1:-}" in
  start) shift; cmd_start "$@" ;;
  stop) cmd_stop ;;
  status) cmd_status ;;
  *) sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//' ;;
esac
