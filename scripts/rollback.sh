#!/usr/bin/env bash
# Rollback de CÓDIGO da Minha Folga: volta current para a release anterior registrada e recarrega
# somente os processos da instância desta raiz. Não desfaz migrações e não apaga dados.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib.sh
source "$SCRIPT_DIR/lib.sh"

usage() {
  cat <<'EOF'
Uso: scripts/rollback.sh [opções]

Volta a referência current para a release publicada antes da atual (segundo var/releases.log)
e recarrega apenas os processos da Minha Folga, com o Node registrado na release de destino.
Os assets da release que sai do ar são copiados para a de destino (abas abertas continuam
funcionando). Se a publicação da atual promoveu um arquivo de ambiente (--promote-env), o
arquivo anterior volta junto (mudança de fase revertida de forma coordenada).

O que NÃO faz: desfazer migrações, restaurar banco ou apagar cadastros, protocolos e preferências.
As migrações são aditivas e retrocompatíveis por regra; se uma migração nova causou o problema,
corrija para frente (nova migração + nova release). Restauração de banco tem procedimento próprio
em docs/OPERATIONS.md, pois descartaria dados recebidos depois do backup.

Opções:
  --to <release-id>        release de destino explícita (precisa estar pronta)
  --mode <modo>            pm2 | systemd-user | manual (padrão: MINHAFOLGA_PROCESS_MODE ou manual)
  --pm2-allow-start        permite iniciar o daemon PM2 do usuário se estiver parado
  --health-timeout <s>     espera pelo /api/health local (padrão 40)
  --use-session-node       usa MINHAFOLGA_NODE em vez do Node registrado na release de destino
  --keep-env               não restaura o config/.env.production anterior à publicação da atual
  --dry-run                mostra o destino e as diferenças de migração, sem alterar nada
  --allow-root             permite execução como root (não recomendado)
  -h, --help               mostra esta ajuda
EOF
}

TARGET=""
MODE_ARG=""
TIMEOUT=40
DRY=0
ALLOW_ROOT=0
KEEP_ENV=0
while (($#)); do
  case "$1" in
    --to) TARGET="${2:-}"; shift 2 ;;
    --mode) MODE_ARG="${2:-}"; shift 2 ;;
    --pm2-allow-start) export MF_PM2_ALLOW_START=1; shift ;;
    --health-timeout) TIMEOUT="${2:-40}"; shift 2 ;;
    --use-session-node) export MF_USE_SESSION_NODE=1; shift ;;
    --keep-env) KEEP_ENV=1; shift ;;
    --dry-run) DRY=1; shift ;;
    --allow-root) ALLOW_ROOT=1; shift ;;
    -h | --help) usage; exit 0 ;;
    *) mf_die "opção desconhecida: $1 (use --help)" ;;
  esac
done

mf_require_not_root "$ALLOW_ROOT"
[[ "$TIMEOUT" =~ ^[0-9]+$ ]] || mf_die "--health-timeout precisa ser número de segundos."
umask 027
MODE="$(mf_process_mode "$MODE_ARG")"
mf_resolve_root
mf_select_node
mf_lock

CURRENT="$(mf_current_release)"
[[ -n "$CURRENT" ]] || mf_die "nenhuma release publicada; não há o que reverter."

if [[ -z "$TARGET" ]]; then
  # Destino = release que estava no ar quando a atual foi publicada (campo previous do último publish ou
  # publish-start dela; o publish-start é gravado antes da troca de current, então vale mesmo se a
  # publicação foi interrompida). Depois de um rollback, repetir o comando não "avança" para a revertida.
  TARGET="$(mf_previous_of "$CURRENT")"
  if [[ -z "$TARGET" || "$TARGET" == nenhuma ]]; then
    mf_die "não há release anterior registrada para $CURRENT. Informe --to <release-id> (veja: scripts/deploy.sh status)."
  fi
  mf_validate_release_id "$TARGET"
  dir="$(mf_release_dir "$TARGET")"
  [[ -d "$dir" && "$(mf_meta_get "$dir" state)" == ready ]] ||
    mf_die "a release anterior registrada ($TARGET) não está mais disponível. Informe --to <release-id>."
fi
mf_require_release_ready "$TARGET"
[[ "$TARGET" != "$CURRENT" ]] || mf_die "a release $TARGET já é a atual."

ENV_FILE="$(mf_env_file)"
mf_check_env_file "$ENV_FILE"
TARGET_DIR="$(mf_release_dir "$TARGET")"
CURRENT_DIR="$(mf_release_dir "$CURRENT")"

# Arquivo de ambiente anterior à publicação da atual (publish --promote-env), restaurado junto.
ENV_BACKUP=""
if [[ $KEEP_ENV == 0 ]]; then
  ENV_BACKUP="$(awk -v cur="$CURRENT" -v tgt="$TARGET" '
    / event=publish / {
      r = ""; p = ""; b = ""
      for (i = 1; i <= NF; i++) {
        if ($i ~ /^release=/) r = substr($i, 9)
        if ($i ~ /^previous=/) p = substr($i, 10)
        if ($i ~ /^env_backup=/) b = substr($i, 12)
      }
      if (r == cur) last = (p == tgt && b != "nenhum") ? b : ""
    }
    END { print last }' "$MF_ROOT/var/releases.log")"
  if [[ -n "$ENV_BACKUP" ]]; then
    [[ "$ENV_BACKUP" =~ ^\.env\.production\.antes-[A-Za-z0-9._-]+$ && -f "$MF_ROOT/config/$ENV_BACKUP" ]] ||
      mf_die "a publicação de $CURRENT trocou o ambiente, mas a cópia anterior (config/$ENV_BACKUP) não está disponível. Restaure-a ou use --keep-env."
    mf_check_env_file "$MF_ROOT/config/$ENV_BACKUP"
  fi
fi
PORT_ENV="$ENV_FILE"
[[ -n "$ENV_BACKUP" ]] && PORT_ENV="$MF_ROOT/config/$ENV_BACKUP"
PORT="$(mf_env_get "$PORT_ENV" PORT)"
WORKER="$(mf_env_get "$PORT_ENV" WORKER_MODE)"
WORKER="${WORKER:-inline}"
[[ "$PORT" =~ ^[0-9]+$ ]] || mf_die "PORT ausente ou inválida em $PORT_ENV."

list_migrations() { find "$(mf_release_dir "$1")/backend/migrations" -maxdepth 1 -name '*.sql' -printf '%f\n' 2>/dev/null | sort; }
ONLY_IN_CURRENT="$(comm -23 <(list_migrations "$CURRENT") <(list_migrations "$TARGET") | tr '\n' ' ')"

echo "Rollback de código: $CURRENT → $TARGET (modo de processo: $MODE; instância $MF_INSTANCE)"
echo "Node da release de destino: $(mf_meta_get "$TARGET_DIR" node_path) ($(mf_meta_get "$TARGET_DIR" node_version))"
[[ -n "$ENV_BACKUP" ]] && echo "Ambiente: config/.env.production volta a ser config/$ENV_BACKUP (anterior à publicação de $CURRENT)."
if [[ -n "$ONLY_IN_CURRENT" ]]; then
  echo "Migrações que CONTINUAM aplicadas no banco (não são desfeitas): $ONLY_IN_CURRENT"
  echo "A release $TARGET precisa ser compatível com elas (regra: migrações aditivas). Se não for, corrija para frente."
fi
if [[ $DRY == 1 ]]; then
  echo "(--dry-run: nada foi alterado)"
  exit 0
fi

# Pré-condições antes de qualquer troca: Node da release de destino, gerenciador, unidade/ecosystem, porta.
mf_use_release_node "$TARGET_DIR"
mf_processes_check "$MODE" "$WORKER" "$PORT" "$TARGET_DIR"

# Abas abertas na release que sai do ar continuam carregando os chunks dela.
CARRIED="$(mf_carry_assets "$CURRENT_DIR" "$TARGET_DIR")"
mf_info "assets da release $CURRENT mantidos na $TARGET: $CARRIED"

if [[ -n "$ENV_BACKUP" ]]; then
  cp -p -- "$ENV_FILE" "$ENV_FILE.rollback-$CURRENT.$$" && chmod 600 "$ENV_FILE.rollback-$CURRENT.$$"
  cp -p -- "$MF_ROOT/config/$ENV_BACKUP" "$ENV_FILE.tmp.$$" && chmod 600 "$ENV_FILE.tmp.$$"
  mv -f -T -- "$ENV_FILE.tmp.$$" "$ENV_FILE"
  mf_info "config/.env.production restaurado de config/$ENV_BACKUP (o da release $CURRENT ficou em $(basename -- "$ENV_FILE.rollback-$CURRENT.$$"))."
fi

mf_switch_current "$TARGET"
mf_info "current → releases/$TARGET; recarregando somente os processos da instância $MF_INSTANCE."
HEALTH="nao_verificada"
DETAIL=""
if ! (mf_processes reload "$MODE" "$WORKER" "$PORT"); then
  HEALTH=falha
  DETAIL="o gerenciador de processos não recarregou a release $TARGET"
elif [[ "$MODE" != manual ]]; then
  RC=0
  mf_wait_release "$PORT" "$TARGET" "$TIMEOUT" || RC=$?
  case "$RC" in
    0) HEALTH=ok ;;
    2) HEALTH=falha DETAIL="$MF_WAIT_DETAIL" ;;
    *) HEALTH=falha DETAIL="a API não respondeu em 127.0.0.1:$PORT/api/health em ${TIMEOUT}s" ;;
  esac
fi
mf_log_event rollback release="$TARGET" previous="$CURRENT" mode="$MODE" instance="$MF_INSTANCE" node="$MF_NODE_VERSION" \
  node_path="$MF_NODE" port="$PORT" migrations_kept="${ONLY_IN_CURRENT// /,}" carried_assets="$CARRIED" \
  env_restored="${ENV_BACKUP:-nenhum}" health="$HEALTH"
if [[ "$HEALTH" == falha ]]; then
  mf_die "$DETAIL após o rollback (current já aponta para $TARGET; logs em $MF_ROOT/var/log/)."
fi
mf_info "rollback concluído. Verifique: scripts/deploy.sh verify"
