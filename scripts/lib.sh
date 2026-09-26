#!/usr/bin/env bash
# Funções compartilhadas pelos scripts de implantação da Minha Folga. Carregue com `source`.
#
# Regras que todas as funções respeitam:
# - nada global: nenhum PATH/perfil/crontab/serviço compartilhado é alterado;
# - toda escrita e remoção acontece dentro de MINHAFOLGA_APP_ROOT, em caminhos validados;
# - processos acionados são somente os da instância desta raiz (minhafolga-api/minhafolga-worker em
#   produção; minhafolga-<instância>-api/-worker nas demais, ex.: minhafolga-homolog-api);
# - nenhum valor de segredo é impresso ou gravado em log.

if [[ -n "${MF_LIB_LOADED:-}" ]]; then return 0; fi
MF_LIB_LOADED=1

readonly MF_MARKER_NAME=".minhafolga-root"
readonly MF_MARKER_HEADER="minhafolga-app-root v1"
readonly MF_RELEASE_META=".minhafolga-release"
readonly MF_RELEASE_ID_RE='^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
# Instância da raiz (gravada no marcador por "deploy.sh init --instance"): define os nomes de processo.
readonly MF_INSTANCE_RE='^[a-z][a-z0-9]{0,15}$'
readonly MF_NODE_MAJOR=24
readonly MF_NODE_MIN_MINOR=15
readonly MF_DEFAULT_PORT=3107
# Link, em cada release, para o Node usado no prepare (a unidade systemd --user executa por ele).
readonly MF_RELEASE_NODE_LINK=".minhafolga-node"
MF_INSTANCE="prod"
MF_PROCESS_API="minhafolga-api"
MF_PROCESS_WORKER="minhafolga-worker"
# PATH original: usado apenas para localizar ferramentas do administrador (pm2), nunca alterado.
MF_ORIGINAL_PATH="${MF_ORIGINAL_PATH:-$PATH}"

# Saída em português; mensagens de erro vão para stderr.
mf_info() { printf '[minhafolga] %s\n' "$*"; }
mf_warn() { printf '[minhafolga] AVISO: %s\n' "$*" >&2; }
mf_die() {
  printf '[minhafolga] ERRO: %s\n' "$*" >&2
  exit 1
}
mf_step() { printf '\n==> %s\n' "$*"; }

# Recusa execução como root, salvo pedido explícito (--allow-root ou MINHAFOLGA_ALLOW_ROOT=1).
mf_require_not_root() {
  local allow="${1:-0}"
  if [[ "$(id -u)" -eq 0 && "$allow" != 1 && "${MINHAFOLGA_ALLOW_ROOT:-0}" != 1 ]]; then
    mf_die "não execute como root. Use o usuário da hospedagem dedicado à Minha Folga. Se a hospedagem exigir root, repita com --allow-root sabendo que os arquivos criados pertencerão ao root."
  fi
}

# Valida MINHAFOLGA_APP_ROOT e define MF_ROOT (caminho canônico).
# $1 = "initialized" (padrão: exige marcador) ou "any" (preflight/init: aceita raiz ainda inexistente).
mf_resolve_root() {
  local mode="${1:-initialized}"
  local raw="${MINHAFOLGA_APP_ROOT:-}"
  [[ -n "$raw" ]] || mf_die "defina MINHAFOLGA_APP_ROOT com o caminho absoluto da raiz exclusiva da Minha Folga (ex.: /srv/minhafolga)."
  [[ "$raw" == /* ]] || mf_die "MINHAFOLGA_APP_ROOT precisa ser um caminho absoluto (recebido: $raw)."
  [[ "$raw" =~ ^/+$ ]] && mf_die "MINHAFOLGA_APP_ROOT não pode ser /."
  [[ "$raw" =~ ^/[A-Za-z0-9._/-]+$ ]] ||
    mf_die "MINHAFOLGA_APP_ROOT deve conter apenas letras, números, '.', '_', '-' e '/' (sem espaços), para que as configurações de servidor web e processo não precisem de escape."
  case "/$raw/" in
    */../* | */./*) mf_die "MINHAFOLGA_APP_ROOT não pode conter '.' ou '..' como componente." ;;
  esac
  while [[ "$raw" == */ && "$raw" != / ]]; do raw="${raw%/}"; done

  local canonical
  if [[ -e "$raw" ]]; then
    [[ -d "$raw" ]] || mf_die "MINHAFOLGA_APP_ROOT existe e não é diretório: $raw"
    canonical="$(realpath -e -- "$raw")"
  else
    canonical="$(realpath -m -- "$raw")"
  fi
  [[ "$canonical" != "/" ]] || mf_die "MINHAFOLGA_APP_ROOT não pode ser /."
  local home_c=""
  [[ -n "${HOME:-}" && -d "$HOME" ]] && home_c="$(realpath -e -- "$HOME")"
  if [[ -n "$home_c" ]]; then
    [[ "$canonical" != "$home_c" ]] || mf_die "MINHAFOLGA_APP_ROOT não pode ser o diretório pessoal (\$HOME). Use uma subpasta exclusiva, ex.: $home_c/minhafolga."
    [[ "$home_c" != "$canonical"/* ]] || mf_die "MINHAFOLGA_APP_ROOT não pode conter o diretório pessoal (\$HOME)."
  fi
  case "$canonical" in
    /bin | /boot | /dev | /etc | /home | /lib | /lib32 | /lib64 | /media | /mnt | /opt | /proc | /root | /run | /sbin | /snap | /srv | /sys | /tmp | /usr | /var | /var/www | /var/lib | /var/log | /usr/local)
      mf_die "MINHAFOLGA_APP_ROOT não pode ser um diretório do sistema ou compartilhado ($canonical). Use uma subpasta exclusiva, ex.: /srv/minhafolga."
      ;;
  esac
  # Dentro do document root de outro site, config/, backups/ e var/ ficariam servíveis pelo vhost dele
  # (dependendo só de permissões). Recusa os nomes usuais de document root; o preflight confere também
  # os root/DocumentRoot declarados nos vhosts existentes.
  case "$canonical/" in
    */public_html/* | */htdocs/* | */httpdocs/* | */wwwroot/* | /var/www/html/*)
      mf_die "MINHAFOLGA_APP_ROOT está dentro de um document root de site ($canonical). Use uma pasta que nenhum servidor web publique, ex.: /srv/minhafolga ou ~/apps/minhafolga."
      ;;
  esac
  local depth
  depth="$(tr -cd '/' <<<"$canonical" | wc -c)"
  ((depth >= 2)) || mf_die "MINHAFOLGA_APP_ROOT precisa ter ao menos dois níveis (ex.: /srv/minhafolga)."
  [[ "$canonical" != "$raw" ]] && mf_info "raiz canônica: $canonical (informada: $raw)"
  MF_ROOT="$canonical"

  if [[ "$mode" == initialized ]]; then
    mf_require_marker
  fi
}

# Exige a raiz inicializada: marcador válido e pertencente ao usuário atual.
mf_require_marker() {
  local marker="$MF_ROOT/$MF_MARKER_NAME"
  [[ -d "$MF_ROOT" ]] || mf_die "a raiz $MF_ROOT não existe. Rode primeiro: scripts/deploy.sh init"
  [[ -f "$marker" && ! -L "$marker" ]] ||
    mf_die "marcador $MF_MARKER_NAME ausente em $MF_ROOT. Por segurança os scripts só atuam numa raiz criada por 'scripts/deploy.sh init'."
  [[ "$(head -n 1 "$marker")" == "$MF_MARKER_HEADER" ]] || mf_die "marcador $marker com conteúdo inesperado."
  [[ "$(stat -c %u "$marker")" == "$(id -u)" ]] ||
    mf_die "a raiz $MF_ROOT pertence a outro usuário. Rode os scripts com o usuário dono da instalação."
  local instance
  instance="$(sed -n 's/^instance=//p' "$marker" | tail -n 1)"
  mf_set_instance "${instance:-prod}"
  # Temporários da aplicação (npm, vite, preflight, smoke) ficam na própria raiz, não no /tmp compartilhado.
  if [[ -d "$MF_ROOT/var/tmp" && ! -L "$MF_ROOT/var/tmp" ]]; then
    export TMPDIR="$MF_ROOT/var/tmp"
  fi
}

# Nomes de processo/unidade derivados da instância: prod → minhafolga-api; homolog → minhafolga-homolog-api.
mf_set_instance() {
  local instance="$1"
  [[ "$instance" =~ $MF_INSTANCE_RE ]] ||
    mf_die "instância inválida: '$instance' (use letras minúsculas e números, até 16 caracteres, começando por letra)."
  MF_INSTANCE="$instance"
  if [[ "$instance" == prod ]]; then
    MF_PROCESS_API="minhafolga-api"
    MF_PROCESS_WORKER="minhafolga-worker"
  else
    MF_PROCESS_API="minhafolga-$instance-api"
    MF_PROCESS_WORKER="minhafolga-$instance-worker"
  fi
}

# Garante que um caminho (existente ou não) fica dentro da raiz; imprime o caminho canônico.
mf_inside_root() {
  local p
  p="$(realpath -m -- "$1")"
  [[ "$p" == "$MF_ROOT"/* ]] || mf_die "caminho fora da raiz da Minha Folga recusado: $1"
  printf '%s\n' "$p"
}

mf_validate_release_id() {
  local id="${1:-}"
  [[ -n "$id" ]] || mf_die "informe o identificador da release (ex.: $(date +%Y%m%d-%H%M%S))."
  [[ "$id" =~ $MF_RELEASE_ID_RE ]] ||
    mf_die "identificador de release inválido: '$id' (use letras, números, '.', '_' e '-', até 64 caracteres, começando por letra ou número)."
}

mf_release_dir() { printf '%s/releases/%s\n' "$MF_ROOT" "$1"; }

# Release existente, criada pelos scripts (possui metadados) e não é link simbólico.
mf_require_release() {
  mf_validate_release_id "$1"
  local dir
  dir="$(mf_release_dir "$1")"
  [[ -d "$dir" && ! -L "$dir" ]] || mf_die "release '$1' não encontrada em $MF_ROOT/releases/."
  [[ -f "$dir/$MF_RELEASE_META" ]] || mf_die "release '$1' sem metadados ($MF_RELEASE_META); não foi criada por deploy.sh prepare."
  [[ "$(realpath -e -- "$dir")" == "$MF_ROOT/releases/$1" ]] || mf_die "caminho inesperado para a release '$1'."
}

mf_require_release_ready() {
  mf_require_release "$1"
  local state
  state="$(mf_meta_get "$(mf_release_dir "$1")" state)"
  [[ "$state" == ready ]] || mf_die "release '$1' não está pronta (estado: ${state:-desconhecido}). Rode 'deploy.sh prepare' novamente com outro id."
}

# Metadados da release: arquivo chave=valor, reescrito de forma atômica.
mf_meta_get() {
  local file="$1/$MF_RELEASE_META"
  [[ -f "$file" ]] || return 0
  sed -n "s/^$2=//p" "$file" | tail -n 1
}

mf_meta_set() {
  local dir="$1" key="$2" value="$3" file tmp
  file="$dir/$MF_RELEASE_META"
  tmp="$file.tmp.$$"
  value="${value//$'\n'/ }"
  { [[ -f "$file" ]] && grep -v "^$key=" "$file" || true; } >"$tmp"
  printf '%s=%s\n' "$key" "$value" >>"$tmp"
  chmod 600 -- "$tmp"
  mv -f -- "$tmp" "$file"
}

# Release apontada por current (vazio se não houver).
mf_current_release() {
  local link="$MF_ROOT/current" target
  [[ -L "$link" ]] || return 0
  target="$(readlink -- "$link")"
  [[ "$target" =~ ^releases/([A-Za-z0-9][A-Za-z0-9._-]{0,63})$ ]] || mf_die "current aponta para destino inesperado: $target"
  printf '%s\n' "${BASH_REMATCH[1]}"
}

# Release que estava no ar quando $1 foi publicada: campo previous do último publish (ou publish-start,
# gravado antes da troca de current) de $1 em var/releases.log. Vazio ou "nenhuma" se não houver.
mf_previous_of() {
  [[ -f "$MF_ROOT/var/releases.log" ]] || return 0
  awk -v cur="$1" '
    / event=publish(-start)? / {
      r = ""; p = ""
      for (i = 1; i <= NF; i++) {
        if ($i ~ /^release=/) r = substr($i, 9)
        if ($i ~ /^previous=/) p = substr($i, 10)
      }
      if (r == cur && p != "") last = p
    }
    END { print last }' "$MF_ROOT/var/releases.log"
}

# Troca atômica de current: link temporário + rename(2) (mv -T).
mf_switch_current() {
  local id="$1" link="$MF_ROOT/current" tmp="$MF_ROOT/.current.tmp.$$"
  if [[ -e "$link" && ! -L "$link" ]]; then
    mf_die "$link existe e não é link simbólico; ajuste manualmente antes de publicar."
  fi
  [[ ! -e "$tmp" && ! -L "$tmp" ]] || mf_die "arquivo temporário inesperado: $tmp"
  ln -s "releases/$id" "$tmp"
  if ! mv -T -f -- "$tmp" "$link"; then
    rm -f -- "$tmp"
    mf_die "não foi possível promover current para $id."
  fi
}

# Remoção de uma release inteira: somente diretório validado, com metadados e fora de uso.
mf_remove_release_dir() {
  local id="$1" dir current
  mf_require_release "$id"
  dir="$(mf_release_dir "$id")"
  current="$(mf_current_release)"
  [[ "$id" != "$current" ]] || mf_die "a release '$id' é a atual e não pode ser removida."
  rm -rf -- "$dir"
}

# Remoção de um subcaminho de uma release em preparação (ex.: frontend/node_modules).
mf_remove_inside_release() {
  local id="$1" rel="$2" dir target
  dir="$(mf_release_dir "$id")"
  target="$(realpath -m -- "$dir/$rel")"
  [[ "$target" == "$dir"/* ]] || mf_die "remoção fora da release recusada: $rel"
  [[ ! -L "$dir/$rel" ]] || mf_die "remoção de link simbólico recusada: $dir/$rel"
  [[ -e "$target" ]] || return 0
  rm -rf -- "$target"
}

# Seleciona o Node explicitamente (MINHAFOLGA_NODE) e ajusta o PATH apenas deste processo.
mf_select_node() {
  local node="${MINHAFOLGA_NODE:-}"
  if [[ -z "$node" ]]; then
    local hint=""
    if [[ -n "${MF_ROOT:-}" ]]; then
      hint="$(find "$MF_ROOT/.runtime" -maxdepth 3 -path '*/bin/node' -type f 2>/dev/null | sort | tail -n 1 || true)"
    fi
    mf_die "defina MINHAFOLGA_NODE=<caminho absoluto do executável node ${MF_NODE_MAJOR}.x>${hint:+ (encontrado: $hint)}."
  fi
  [[ "$node" == /* ]] || mf_die "MINHAFOLGA_NODE precisa ser caminho absoluto (recebido: $node)."
  [[ -f "$node" && -x "$node" ]] || mf_die "MINHAFOLGA_NODE não é um executável: $node"
  local version major minor
  version="$("$node" -p 'process.versions.node' 2>/dev/null)" || mf_die "não foi possível executar $node"
  major="${version%%.*}"
  minor="${version#*.}"
  minor="${minor%%.*}"
  if [[ "$major" != "$MF_NODE_MAJOR" ]] || ((minor < MF_NODE_MIN_MINOR)); then
    mf_die "Node v$version fora da faixa suportada (>= ${MF_NODE_MAJOR}.${MF_NODE_MIN_MINOR} e < $((MF_NODE_MAJOR + 1)))."
  fi
  MF_NODE="$node"
  MF_NODE_REAL="$(realpath -e -- "$node")"
  MF_NODE_VERSION="v$version"
  MF_NODE_BIN_DIR="$(dirname -- "$node")"
  MF_NPM="${MINHAFOLGA_NPM:-$MF_NODE_BIN_DIR/npm}"
  [[ -x "$MF_NPM" ]] || mf_die "npm não encontrado junto ao Node escolhido ($MF_NPM). Informe MINHAFOLGA_NPM=<caminho absoluto>."
  # PATH ajustado somente para este processo e seus filhos.
  export PATH="$MF_NODE_BIN_DIR:$PATH"
  MF_NPM_VERSION="$("$MF_NPM" --version 2>/dev/null)" || mf_die "não foi possível executar $MF_NPM"
  export MF_NODE MF_NODE_VERSION MF_NPM MF_NPM_VERSION
}

# Prioridade reduzida para tarefas pesadas (build), para não disputar CPU com os outros sites.
# Recebe um comando externo (não uma função do shell).
mf_nice() {
  local level="${MINHAFOLGA_NICE:-10}"
  if [[ "$level" == 0 ]]; then
    "$@"
  elif command -v ionice >/dev/null 2>&1; then
    nice -n "$level" ionice -c 3 "$@"
  else
    nice -n "$level" "$@"
  fi
}

# npm com cache exclusivo da raiz, prioridade reduzida, sem auditoria/fundos/aviso de atualização.
mf_npm() {
  [[ -n "${MF_ROOT:-}" ]] || mf_die "mf_npm exige a raiz validada."
  mf_nice env npm_config_update_notifier=false "$MF_NPM" --cache "$MF_ROOT/.cache/npm" --no-audit --no-fund "$@"
}

# Arquivo de ambiente privado: dentro de config/, do usuário atual, sem acesso de outros.
mf_env_file() {
  local file="${MINHAFOLGA_ENV_FILE:-$MF_ROOT/config/.env.production}"
  file="$(mf_inside_root "$file")"
  [[ "$file" == "$MF_ROOT/config/"* ]] || mf_die "o arquivo de ambiente precisa ficar em $MF_ROOT/config/."
  printf '%s\n' "$file"
}

mf_check_env_file() {
  local file="$1" mode
  [[ -f "$file" ]] || mf_die "arquivo de ambiente ausente: $file (veja docs/ENVIRONMENT.md)."
  [[ "$(stat -c %u "$file")" == "$(id -u)" ]] || mf_die "$file pertence a outro usuário."
  mode="$(stat -c %a "$file")"
  # Nenhum bit para grupo ou outros (o documentado é chmod 600).
  if (((8#$mode & 8#077) != 0)); then
    mf_die "$file tem permissões para grupo/outros ($mode). Use: chmod 600 $file"
  fi
}

# Lê do arquivo de ambiente SOMENTE chaves não secretas (lista permitida).
mf_env_get() {
  local file="$1" key="$2"
  case "$key" in
    NODE_ENV | HOST | PORT | CREDIT_PHASE | CREDIT_OPERATIONS_ENABLED | PUBLIC_SITE_URL | WORKER_MODE | LOG_LEVEL) ;;
    *) mf_die "leitura da chave $key não permitida por este script." ;;
  esac
  "$MF_NODE" -e '
    const { parseEnv } = require("node:util");
    const env = parseEnv(require("node:fs").readFileSync(process.argv[1], "utf8"));
    const v = env[process.argv[2]];
    if (v !== undefined) process.stdout.write(String(v));
  ' "$file" "$key"
}

mf_sanitize_value() {
  local v="${1//[[:space:]]/_}"
  printf '%s' "${v//[^A-Za-z0-9._:\/@+,=-]/}"
}

# Registro de eventos da implantação em var/releases.log (uma linha chave=valor por evento).
mf_log_event() {
  local event="$1" line kv
  shift
  line="$(date -Iseconds) event=$event user=$(id -un)"
  for kv in "$@"; do line+=" $(mf_sanitize_value "$kv")"; done
  printf '%s\n' "$line" >>"$MF_ROOT/var/releases.log"
  chmod 600 "$MF_ROOT/var/releases.log" 2>/dev/null || true
}

# Uma operação de implantação por vez (flock no arquivo da própria raiz).
mf_lock() {
  mkdir -p -- "$MF_ROOT/var/run"
  exec 9>"$MF_ROOT/var/run/deploy.lock"
  flock -n 9 || mf_die "outra operação de implantação da Minha Folga está em andamento (var/run/deploy.lock)."
}

# Quem escuta a porta TCP local. Não encerra nem altera nada. Define:
#   MF_PORT_STATE    livre | minhafolga (processo desta raiz) | outro (outro serviço ou usuário) | desconhecido
#   MF_PORT_PIDS     PIDs visíveis que escutam (somente processos do próprio usuário são visíveis)
#   MF_PORT_RELEASES releases desta raiz de onde os processos rodam (pelo cwd), quando minhafolga
#   MF_PORT_DETAIL   explicação curta para mensagens
# A Minha Folga é reconhecida pelo cwd do processo em <raiz>/releases/<id>/ (a API roda em current/backend).
mf_port_owner() {
  local port="$1" out="" listening=0 pids="" pid cwd rel mine="" others="" rels=""
  MF_PORT_STATE=desconhecido MF_PORT_PIDS="" MF_PORT_RELEASES="" MF_PORT_DETAIL=""
  if command -v ss >/dev/null 2>&1; then
    if ! out="$(ss -ltnpH "sport = :$port" 2>/dev/null)"; then
      MF_PORT_DETAIL="falha ao executar ss"
      return 0
    fi
    [[ -n "$out" ]] && listening=1
    pids="$(grep -o 'pid=[0-9]*' <<<"$out" | cut -d= -f2 | sort -un | tr '\n' ' ' || true)"
  elif [[ -r /proc/net/tcp ]]; then
    # Sem ss: tabela de sockets do kernel (estado 0A = LISTEN) e, para os PIDs, os descritores do próprio usuário.
    local hex inodes ino
    hex="$(printf '%04X' "$port")"
    inodes="$(awk -v h="$hex" 'FNR > 1 && $4 == "0A" { n = split($2, a, ":"); if (a[n] == h) print $10 }' \
      /proc/net/tcp /proc/net/tcp6 2>/dev/null | sort -u || true)"
    [[ -n "$inodes" ]] && listening=1
    for ino in $inodes; do
      pids+="$(find /proc/[0-9]*/fd -maxdepth 1 -lname "socket:\[$ino\]" 2>/dev/null | cut -d/ -f3 | sort -un | tr '\n' ' ' || true)"
    done
  else
    MF_PORT_DETAIL="sem ss nem /proc/net/tcp para verificar a porta"
    return 0
  fi
  if ((listening == 0)); then
    MF_PORT_STATE=livre
    return 0
  fi
  if [[ -z "${pids// /}" ]]; then
    MF_PORT_STATE=outro
    MF_PORT_DETAIL="processo de outro usuário (PID não visível)"
    return 0
  fi
  for pid in $pids; do
    cwd="$(readlink -- "/proc/$pid/cwd" 2>/dev/null || true)"
    if [[ -n "${MF_ROOT:-}" && "$cwd" == "$MF_ROOT/releases/"* ]]; then
      rel="${cwd#"$MF_ROOT/releases/"}"
      rel="${rel%%/*}"
      mine+="$pid "
      [[ " $rels " == *" $rel "* ]] || rels+="$rel "
    else
      others+="$pid (cwd ${cwd:-desconhecido}) "
    fi
  done
  if [[ -n "$others" ]]; then
    MF_PORT_STATE=outro
    MF_PORT_PIDS="${pids% }"
    MF_PORT_DETAIL="PID ${others% }"
  else
    MF_PORT_STATE=minhafolga
    MF_PORT_PIDS="${mine% }"
    MF_PORT_RELEASES="${rels% }"
    MF_PORT_DETAIL="API da Minha Folga, release ${MF_PORT_RELEASES}"
  fi
}

# 0 = em escuta; 1 = livre; 2 = não foi possível verificar.
mf_port_listening() {
  mf_port_owner "$1"
  case "$MF_PORT_STATE" in
    livre) return 1 ;;
    desconhecido) return 2 ;;
    *) return 0 ;;
  esac
}

# Espera /api/health responder na porta local (sem proxy). $1 porta, $2 segundos.
mf_wait_health() {
  local port="$1" timeout="${2:-40}" i body
  for ((i = 0; i < timeout; i++)); do
    body="$(curl -fsS --max-time 2 "http://127.0.0.1:$port/api/health" 2>/dev/null || true)"
    if [[ "$body" == *'"status":"ok"'* ]]; then return 0; fi
    sleep 1
  done
  return 1
}

# Espera /api/health responder E a porta ser atendida por processo da release esperada (cwd).
# 0 = ok; 1 = sem resposta; 2 = responde, mas por outra release ou outro serviço (MF_WAIT_DETAIL).
mf_wait_release() {
  local port="$1" id="$2" timeout="${3:-40}" i body
  MF_WAIT_DETAIL=""
  for ((i = 0; i < timeout; i++)); do
    body="$(curl -fsS --max-time 2 "http://127.0.0.1:$port/api/health" 2>/dev/null || true)"
    if [[ "$body" == *'"status":"ok"'* ]]; then
      mf_port_owner "$port"
      case "$MF_PORT_STATE" in
        minhafolga)
          [[ "$MF_PORT_RELEASES" == "$id" ]] && return 0
          MF_WAIT_DETAIL="a porta $port ainda é atendida pela release $MF_PORT_RELEASES"
          ;;
        outro) MF_WAIT_DETAIL="a porta $port é atendida por outro processo ($MF_PORT_DETAIL)" ;;
        *)
          # Sem como identificar o processo: vale a resposta de saúde.
          return 0
          ;;
      esac
    fi
    sleep 1
  done
  [[ -n "$MF_WAIT_DETAIL" ]] && return 2
  return 1
}

# ---------------------------------------------------------------- assets entre releases
# Copia para a release de destino os assets com hash da release que sai do ar (abas abertas continuam
# carregando os chunks sob demanda). Usada na publicação e no rollback. Imprime a quantidade copiada.
mf_carry_assets() {
  local from_dir="$1" to_dir="$2" count=0 f
  [[ -f "$from_dir/.assets-built.txt" && -d "$to_dir/frontend/dist/assets" ]] || { echo 0; return 0; }
  while IFS= read -r f; do
    [[ "$f" =~ ^[A-Za-z0-9._-]+$ ]] || continue
    if [[ ! -e "$to_dir/frontend/dist/assets/$f" && -f "$from_dir/frontend/dist/assets/$f" ]]; then
      cp -p -- "$from_dir/frontend/dist/assets/$f" "$to_dir/frontend/dist/assets/$f"
      count=$((count + 1))
    fi
  done <"$from_dir/.assets-built.txt"
  echo "$count"
}

# ---------------------------------------------------------------- Node da release
# Os processos rodam com o Node registrado no prepare da release (node_path), não com o da sessão:
# publicar, reiniciar ou reverter para uma release preparada com outro runtime usa o runtime dela.
# MF_USE_SESSION_NODE=1 (--use-session-node) usa MINHAFOLGA_NODE, com aviso.
mf_use_release_node() {
  local dir="$1" recorded id
  id="$(basename -- "$dir")"
  recorded="$(mf_meta_get "$dir" node_path)"
  if [[ "${MF_USE_SESSION_NODE:-0}" == 1 ]]; then
    [[ -n "${MF_NODE:-}" ]] || mf_select_node
    mf_warn "--use-session-node: processos com $MF_NODE ($MF_NODE_VERSION); a release $id registra ${recorded:-nenhum Node}."
    return 0
  fi
  [[ -n "$recorded" ]] ||
    mf_die "a release $id não registra o Node usado no prepare (node_path). Use --use-session-node para rodar com MINHAFOLGA_NODE."
  [[ -x "$recorded" ]] ||
    mf_die "o Node registrado na release $id não existe mais: $recorded. Restaure esse runtime em .runtime/ ou use --use-session-node."
  if [[ -z "${MF_NODE:-}" || "$(realpath -e -- "$MF_NODE" 2>/dev/null)" != "$(realpath -e -- "$recorded")" ]]; then
    mf_info "processos com o Node registrado na release $id: $recorded (sessão: ${MINHAFOLGA_NODE:-não definida})."
  fi
  MINHAFOLGA_NODE="$recorded"
  export MINHAFOLGA_NODE
  mf_select_node
}

# ---------------------------------------------------------------- PM2 (somente processos da instância)
mf_pm2_bin() {
  local bin="${MINHAFOLGA_PM2:-}"
  if [[ -z "$bin" ]]; then bin="$(PATH="$MF_ORIGINAL_PATH" command -v pm2 || true)"; fi
  [[ -n "$bin" ]] || return 1
  [[ "$bin" == /* && -x "$bin" ]] || mf_die "MINHAFOLGA_PM2 precisa ser o caminho absoluto do pm2 existente."
  printf '%s\n' "$bin"
}

# Daemon PM2 já em execução? (não chamamos o pm2 sem daemon, pois isso iniciaria um novo)
mf_pm2_daemon_running() {
  local home="${PM2_HOME:-$HOME/.pm2}" pid
  [[ -f "$home/pm2.pid" ]] || return 1
  pid="$(cat -- "$home/pm2.pid" 2>/dev/null || true)"
  [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null
}

# Executa o pm2 com o PATH original do administrador (o daemon existente não é alterado).
mf_pm2() {
  local bin
  bin="$(mf_pm2_bin)" || mf_die "pm2 não encontrado (defina MINHAFOLGA_PM2 ou use --mode manual/systemd-user)."
  env PATH="$MF_ORIGINAL_PATH" MINHAFOLGA_APP_ROOT="$MF_ROOT" MINHAFOLGA_NODE="$MF_NODE" "$bin" "$@"
}

# Resumo do "pm2 jlist" (lido do stdin) sem ambiente nem segredos: só nome, estado, reinícios, início e caminho.
#   $1 = inventario  → todos os processos: "  nome status=.. reinicios=.. inicio=.." (+ [minhafolga] se desta raiz)
#   $1 = proprios    → só os nomes em $2 (separados por vírgula): "nome<TAB>raiz=esta|outra<TAB>script<TAB>estado"
#   $3 = raiz desta instalação (para reconhecer os processos dela pelo caminho do script)
mf_pm2_jlist_report() {
  "$MF_NODE" -e '
    let raw = ""; process.stdin.on("data", (c) => (raw += c)).on("end", () => {
      let list = [];
      // Início do array JSON (avisos coloridos do pm2 podem vir antes e também contêm "[").
      try { list = JSON.parse(raw.slice(raw.search(/\[\s*[{\]]/))); } catch { console.log("  (saída do pm2 não reconhecida)"); return; }
      const [mode, namesArg, root] = process.argv.slice(1);
      const names = new Set(String(namesArg || "").split(",").filter(Boolean));
      for (const p of list) {
        const e = p.pm2_env || {};
        const script = String(e.pm_exec_path || "");
        const own = Boolean(root) && script.startsWith(root + "/");
        if (mode === "proprios") {
          if (!names.has(p.name)) continue;
          console.log([p.name, own ? "raiz=esta" : "raiz=outra", script || "?", e.status || "?"].join("\t"));
        } else {
          const start = e.pm_uptime ? new Date(e.pm_uptime).toISOString() : "?";
          console.log(`  ${p.name}\tstatus=${e.status || "?"}\treinicios=${e.restart_time ?? "?"}\tinicio=${start}${own ? "\t[minhafolga]" : ""}`);
        }
      }
    });
  ' "$@"
}

# Processos com os nomes desta instância que, no daemon PM2 em uso, pertencem a OUTRA raiz (ex.: homologação e
# produção com o mesmo nome no mesmo usuário). Imprime "nome (script)" por linha; vazio = nenhum conflito.
mf_pm2_foreign_names() {
  local bin names
  bin="$(mf_pm2_bin)" || return 0
  mf_pm2_daemon_running || return 0
  names="$MF_PROCESS_API,$MF_PROCESS_WORKER"
  env PATH="$MF_ORIGINAL_PATH" "$bin" jlist 2>/dev/null | mf_pm2_jlist_report proprios "$names" "$MF_ROOT" |
    awk -F'\t' '$2 == "raiz=outra" { print $1 " (" $3 ")" }' || true
}

# ------------------------------------------------ processos da Minha Folga (pm2 | systemd-user | manual)
mf_process_mode() {
  local mode="${1:-${MINHAFOLGA_PROCESS_MODE:-manual}}"
  case "$mode" in
    pm2 | systemd-user | manual) printf '%s\n' "$mode" ;;
    *) mf_die "modo de processo desconhecido: $mode (use pm2, systemd-user ou manual)." ;;
  esac
}

mf_apps_for() {
  MF_APPS=("$MF_PROCESS_API")
  [[ "${1:-inline}" == separate ]] && MF_APPS+=("$MF_PROCESS_WORKER")
  return 0
}

# Confere, ANTES de trocar current ou tocar em processo, que o gerenciador escolhido consegue atuar somente
# nos processos desta raiz. Para com erro (nada alterado) se algo impedir.
#   $1 modo, $2 WORKER_MODE, $3 porta, $4 diretório da release que vai ficar no ar
mf_processes_check() {
  local mode="$1" worker="${2:-inline}" port="$3" dir="$4" app unit names foreign
  mf_apps_for "$worker"
  [[ "$port" =~ ^[0-9]+$ ]] || mf_die "PORT ausente ou inválida no arquivo de ambiente."
  # Porta ocupada por outro serviço: a API nova não subiria (e o ocupante nunca é encerrado).
  mf_port_owner "$port"
  if [[ "$MF_PORT_STATE" == outro ]]; then
    mf_die "a porta $port está ocupada por outro serviço ($MF_PORT_DETAIL). Nada foi alterado; confira PORT em config/.env.production."
  fi
  case "$mode" in
    pm2)
      mf_pm2_bin >/dev/null || mf_die "pm2 não encontrado (defina MINHAFOLGA_PM2 ou use --mode manual/systemd-user)."
      if ! mf_pm2_daemon_running && [[ "${MF_PM2_ALLOW_START:-0}" != 1 ]]; then
        mf_die "o daemon PM2 deste usuário não está em execução. Não iniciamos um daemon novo sem --pm2-allow-start (confirme com o administrador qual PM2 a hospedagem usa). Nada foi alterado."
      fi
      [[ -f "$dir/deploy/ecosystem.config.cjs" ]] || mf_die "ecosystem ausente na release: $dir/deploy/ecosystem.config.cjs"
      # O ecosystem da release precisa carregar e declarar os mesmos nomes que esta raiz usa.
      names="$(env MINHAFOLGA_APP_ROOT="$MF_ROOT" MINHAFOLGA_NODE="$MF_NODE" "$MF_NODE" -e '
        const c = require(process.argv[1]);
        process.stdout.write((c.apps || []).map((a) => a.name).join(","));
      ' "$dir/deploy/ecosystem.config.cjs" 2>&1)" || mf_die "o ecosystem da release não carrega: ${names##*Error: }"
      for app in "${MF_APPS[@]}"; do
        [[ ",$names," == *",$app,"* ]] ||
          mf_die "o ecosystem da release não declara o processo $app (instância $MF_INSTANCE; declarados: $names)."
      done
      foreign="$(mf_pm2_foreign_names)"
      if [[ -n "$foreign" ]]; then
        mf_die "o PM2 em uso já tem processo com o nome desta instância pertencente a outra raiz: $(tr '\n' ' ' <<<"$foreign"). Use outra instância (deploy.sh init --instance) ou outro usuário/PM2_HOME. Nada foi alterado."
      fi
      ;;
    systemd-user)
      command -v systemctl >/dev/null 2>&1 || mf_die "systemctl não encontrado."
      for app in "${MF_APPS[@]}"; do
        unit="$(systemctl --user cat "$app.service" 2>/dev/null)" ||
          mf_die "unidade de usuário $app.service não instalada (modelo: scripts/deploy.sh systemd-unit). Nada foi alterado."
        grep -qx "WorkingDirectory=$MF_ROOT/current/backend" <<<"$unit" ||
          mf_die "a unidade $app.service não aponta para $MF_ROOT/current/backend (pertence a outra raiz?). Gere de novo com scripts/deploy.sh systemd-unit."
        grep -q "^ExecStart=$MF_ROOT/current/$MF_RELEASE_NODE_LINK " <<<"$unit" ||
          mf_die "a unidade $app.service não executa pelo Node da release ($MF_ROOT/current/$MF_RELEASE_NODE_LINK). Gere de novo com scripts/deploy.sh systemd-unit e rode systemctl --user daemon-reload."
      done
      [[ -L "$dir/$MF_RELEASE_NODE_LINK" && -x "$dir/$MF_RELEASE_NODE_LINK" ]] ||
        mf_die "a release $(basename -- "$dir") não tem o link $MF_RELEASE_NODE_LINK para o Node (prepare anterior a esta versão dos scripts?)."
      ;;
    manual) ;;
  esac
}

# Aplica uma ação SOMENTE aos processos da instância (API; worker quando WORKER_MODE=separate).
# $1 ação (reload | stop), $2 modo, $3 WORKER_MODE (inline | separate), $4 porta (para instruções).
# Retorna diferente de zero se o gerenciador falhar (quem chama decide se reverte).
mf_processes() {
  local action="$1" mode="$2" worker="${3:-inline}" port="${4:-}" app
  mf_apps_for "$worker"
  local eco="$MF_ROOT/current/deploy/ecosystem.config.cjs"
  case "$mode" in
    pm2)
      if ! mf_pm2_daemon_running && [[ "${MF_PM2_ALLOW_START:-0}" != 1 ]]; then
        mf_warn "o daemon PM2 deste usuário não está em execução (sem --pm2-allow-start)."
        return 1
      fi
      [[ -f "$eco" ]] || { mf_warn "ecosystem ausente na release atual: $eco"; return 1; }
      for app in "${MF_APPS[@]}"; do
        case "$action" in
          reload) mf_pm2 startOrReload "$eco" --only "$app" --update-env || { mf_warn "o pm2 não recarregou $app."; return 1; } ;;
          stop) mf_pm2 stop "$app" || { mf_warn "o pm2 não parou $app."; return 1; } ;;
        esac
      done
      ;;
    systemd-user)
      for app in "${MF_APPS[@]}"; do
        systemctl --user cat "$app.service" >/dev/null 2>&1 ||
          { mf_warn "unidade de usuário $app.service não instalada (modelo: scripts/deploy.sh systemd-unit)."; return 1; }
        case "$action" in
          reload) systemctl --user restart "$app.service" || { mf_warn "systemctl --user restart $app.service falhou."; return 1; } ;;
          stop) systemctl --user stop "$app.service" || { mf_warn "systemctl --user stop $app.service falhou."; return 1; } ;;
        esac
      done
      ;;
    manual)
      # Só sugere encerrar PIDs que comprovadamente são desta raiz (cwd em <raiz>/releases/).
      local kill_hint="kill -TERM <pid do $MF_PROCESS_API>"
      if [[ -n "$port" ]]; then
        mf_port_owner "$port"
        case "$MF_PORT_STATE" in
          minhafolga) kill_hint="kill -TERM $MF_PORT_PIDS    # release $MF_PORT_RELEASES" ;;
          livre) kill_hint="(nenhum processo escuta a porta $port: nada a encerrar)" ;;
          outro)
            mf_warn "a porta $port é de outro serviço ($MF_PORT_DETAIL); nenhum comando de encerramento é sugerido."
            return 1
            ;;
          *) mf_warn "não foi possível identificar o processo da porta $port ($MF_PORT_DETAIL). Confira o PID antes: readlink /proc/<pid>/cwd precisa estar em $MF_ROOT/releases/." ;;
        esac
      fi
      echo
      echo "Modo manual: nenhum processo foi alterado por este script. Faça SOMENTE nos processos da Minha Folga:"
      if [[ "$action" == stop ]]; then
        echo "  1. Encerre a API com SIGTERM (desligamento gracioso em até 10 s): $kill_hint"
      else
        echo "  1. Encerre a API anterior com SIGTERM (gracioso em até 10 s): $kill_hint"
        echo "  2. Inicie a API da release atual:"
        echo "     cd $MF_ROOT/current/backend && env NODE_ENV=production MF_ENV_FILE=$MF_ROOT/config/.env.production NODE_OPTIONS= \\"
        echo "       nohup $MF_NODE dist/server.js >>$MF_ROOT/var/log/api.out.log 2>>$MF_ROOT/var/log/api.err.log &"
        if [[ "$worker" == separate ]]; then
          echo "     (WORKER_MODE=separate) repita com dist/worker.js e logs worker.*.log"
        fi
        echo "  3. Confira: scripts/deploy.sh verify"
        echo "  Em painel de hospedagem com aplicação Node, use o botão de reinício da aplicação dedicada."
      fi
      ;;
  esac
}
