#!/usr/bin/env bash
# Implantação isolada da Minha Folga em servidor compartilhado.
# Subcomandos distintos para preparar, migrar, publicar e verificar; tudo restrito a MINHAFOLGA_APP_ROOT
# e aos processos da instância desta raiz (minhafolga-api/minhafolga-worker em produção).
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib.sh
source "$SCRIPT_DIR/lib.sh"

usage() {
  cat <<'EOF'
Uso: scripts/deploy.sh <subcomando> [argumentos] [opções]

Subcomandos:
  init [--instance <nome>]     cria a raiz exclusiva (marcador .minhafolga-root e árvore privada);
                               a instância (padrão prod) define os nomes de processo: prod →
                               minhafolga-api; homolog → minhafolga-homolog-api
  prepare <release-id>         cria releases/<id> e executa o build fora da pasta pública ativa
      --from-dir <dir>         cópia de um checkout (respeita .gitignore quando for git)
      --from-tarball <arq>     pacote .tar/.tar.gz gerado em CI
      --from-git <repo> [--ref <ref>]  git archive de um repositório local (padrão: HEAD)
      --release | --staging | --review   modo do build, obrigatório (produção indexável |
                               homologação sem indexação | revisão com pendências visíveis)
      --allow-dirty            aceita origem --from-dir com alterações não registradas em --release
                               (registrado na release)
      --with-tests             roda os testes no build
      --skip-typecheck         somente em --review; ver build.sh --help
      --site-url <url>         VITE_SITE_URL (padrão: PUBLIC_SITE_URL exportado)
      --public-config <json>   configuração pública já exportada (em vez de config/.env.production)
      --env-file <arquivo>     outro arquivo de ambiente de config/ para o build (ex.: config/.env.next
                               numa mudança de fase; promova-o no publish com --promote-env)
      --prebuilt               o pacote já traz backend/dist e frontend/dist (build em CI);
                               instala somente dependências de produção do backend
      --keep-frontend-deps     mantém frontend/node_modules na release (padrão: remove após o build)
  migrate <release-id>         backup do banco dedicado (pg_dump) + migrações da release
      --skip-backup            prossegue sem backup (somente com backup externo confirmado)
  publish <release-id>         troca atômica de current + recarga só dos processos da instância
      --mode pm2|systemd-user|manual   (padrão: MINHAFOLGA_PROCESS_MODE ou manual)
      --pm2-allow-start        permite iniciar o daemon PM2 do usuário se estiver parado
      --skip-migrate-check     publica sem registro de 'migrate' desta release
      --allow-review-build     aceita build --review com NODE_ENV=staging (nunca em produção)
      --promote-env            troca config/.env.production pelo arquivo usado no prepare (--env-file)
      --use-session-node       usa MINHAFOLGA_NODE em vez do Node registrado na release
      --health-timeout <s>     espera pelo /api/health local (padrão 40)
  restart | stop               recarrega/para somente os processos da instância (--mode)
  verify [--url <url>] [-- <opções do smoke.sh>]
                               saúde local, prontidão interna e smoke.sh contra a URL pública
  status                       release atual, releases, eventos recentes, porta e processos
  backup-db [rótulo]           backup avulso do banco dedicado em backups/
  cleanup [--keep <n>] [--keep-backups <n>] [--dry-run]
                               remove releases antigas identificadas (nunca a atual nem a anterior)
  systemd-unit                 imprime unidades systemd --user de exemplo (não instala nada)

Variáveis: MINHAFOLGA_APP_ROOT (obrigatória), MINHAFOLGA_NODE (obrigatória exceto em init; os processos
usam o Node registrado na release),
MINHAFOLGA_PROCESS_MODE, MINHAFOLGA_PM2, MINHAFOLGA_PG_DUMP, MINHAFOLGA_PG_RESTORE,
MINHAFOLGA_WEB_ACCESS (other | group:<grupo> | acl:<usuário> | none), MINHAFOLGA_NICE.
Opção global: --allow-root (não recomendado). Documentação: docs/DEPLOY_SHARED_SERVER.md
EOF
}

ALLOW_ROOT=0
ARGS=()
for arg in "$@"; do
  if [[ "$arg" == --allow-root ]]; then ALLOW_ROOT=1; else ARGS+=("$arg"); fi
done
set -- "${ARGS[@]+"${ARGS[@]}"}"
CMD="${1:-}"
[[ -n "$CMD" ]] || { usage; exit 1; }
shift
case "$CMD" in -h | --help | help) usage; exit 0 ;; esac
mf_require_not_root "$ALLOW_ROOT"
umask 027

# Limpeza ao sair: arquivos temporários registrados (somente em var/tmp da raiz) e estado do prepare.
MF_CLEANUP_FILES=()
on_exit() {
  local code=$? f
  prepare_on_exit "$code"
  for f in "${MF_CLEANUP_FILES[@]+"${MF_CLEANUP_FILES[@]}"}"; do
    if [[ -n "${MF_ROOT:-}" && "$f" == "$MF_ROOT/var/tmp/"* ]]; then rm -f -- "$f"; fi
  done
}
trap on_exit EXIT

# ------------------------------------------------------------------ permissões do conteúdo público
# O servidor web (outro usuário) só precisa atravessar a raiz até current/frontend/dist e ler o dist.
WEB_ACCESS="${MINHAFOLGA_WEB_ACCESS:-other}"
case "$WEB_ACCESS" in
  other | none) ;;
  group:?*)
    WEB_GROUP="${WEB_ACCESS#group:}"
    id -nG | tr ' ' '\n' | grep -qx -- "$WEB_GROUP" ||
      mf_die "MINHAFOLGA_WEB_ACCESS=group:$WEB_GROUP exige que $(id -un) pertença ao grupo $WEB_GROUP."
    ;;
  acl:?*)
    WEB_USER="${WEB_ACCESS#acl:}"
    command -v setfacl >/dev/null 2>&1 || mf_die "MINHAFOLGA_WEB_ACCESS=acl exige setfacl."
    ;;
  *) mf_die "MINHAFOLGA_WEB_ACCESS inválido: $WEB_ACCESS" ;;
esac

# Diretórios atravessados pelo servidor web (sem listagem).
web_traverse() {
  case "$WEB_ACCESS" in
    other) chmod 711 -- "$@" ;;
    none) chmod 700 -- "$@" ;;
    group:*) chgrp -- "$WEB_GROUP" "$@" && chmod 710 -- "$@" ;;
    acl:*) chmod 700 -- "$@" && setfacl -m "u:$WEB_USER:x" -- "$@" ;;
  esac
}

# Árvore pública (frontend/dist): leitura para o servidor web, nada além disso.
web_public_tree() {
  local dist="$1"
  case "$WEB_ACCESS" in
    other)
      find "$dist" -type d -exec chmod 755 {} +
      find "$dist" -type f -exec chmod 644 {} +
      ;;
    none)
      find "$dist" -type d -exec chmod 700 {} +
      find "$dist" -type f -exec chmod 600 {} +
      ;;
    group:*)
      chgrp -R -- "$WEB_GROUP" "$dist"
      find "$dist" -type d -exec chmod 750 {} +
      find "$dist" -type f -exec chmod 640 {} +
      ;;
    acl:*)
      find "$dist" -type d -exec chmod 700 {} +
      find "$dist" -type f -exec chmod 600 {} +
      setfacl -R -m "u:$WEB_USER:rX" -- "$dist"
      ;;
  esac
}

# ------------------------------------------------------------------------------------ init
cmd_init() {
  local instance=""
  while (($#)); do
    case "$1" in
      --instance) instance="${2:-}"; shift 2 ;;
      *) mf_die "opção desconhecida para init: $1" ;;
    esac
  done
  if [[ -n "$instance" ]]; then mf_set_instance "$instance"; fi
  mf_resolve_root any
  if [[ -d "$MF_ROOT" ]]; then
    if [[ -f "$MF_ROOT/$MF_MARKER_NAME" ]]; then
      mf_require_marker
      if [[ -n "$instance" && "$instance" != "$MF_INSTANCE" ]]; then
        mf_die "a raiz $MF_ROOT já é da instância '$MF_INSTANCE'; a instância não muda depois do init (use outra raiz)."
      fi
      mf_info "raiz já inicializada: $MF_ROOT (conferindo a árvore)."
    elif [[ -n "$(find "$MF_ROOT" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
      mf_die "$MF_ROOT existe, não está vazia e não tem o marcador $MF_MARKER_NAME. Por segurança, escolha uma pasta nova e exclusiva."
    fi
  else
    local parent
    parent="$(dirname -- "$MF_ROOT")"
    [[ -d "$parent" ]] || mf_die "a pasta-pai $parent não existe; crie-a (ou peça ao administrador) antes do init."
    [[ -w "$parent" ]] || mf_die "sem permissão de escrita em $parent."
    mkdir -m 700 -- "$MF_ROOT"
  fi
  [[ "$(stat -c %u "$MF_ROOT")" == "$(id -u)" ]] || mf_die "$MF_ROOT pertence a outro usuário."
  if [[ ! -f "$MF_ROOT/$MF_MARKER_NAME" ]]; then
    {
      echo "$MF_MARKER_HEADER"
      echo "created_at=$(date -Iseconds)"
      echo "created_by=$(id -un)"
      echo "instance=$MF_INSTANCE"
      echo "# Raiz exclusiva da Minha Folga. Os scripts de implantação só atuam onde este arquivo existe."
    } >"$MF_ROOT/$MF_MARKER_NAME"
    chmod 600 "$MF_ROOT/$MF_MARKER_NAME"
  fi
  local d
  for d in .runtime .cache .cache/npm config var var/log var/tmp var/private var/inventory var/run backups; do
    mkdir -p -- "$MF_ROOT/$d"
    chmod 700 -- "$MF_ROOT/$d"
  done
  mkdir -p -- "$MF_ROOT/releases"
  touch "$MF_ROOT/var/releases.log"
  chmod 600 "$MF_ROOT/var/releases.log"
  web_traverse "$MF_ROOT" "$MF_ROOT/releases"
  mf_log_event init root="$MF_ROOT" instance="$MF_INSTANCE" web_access="$WEB_ACCESS"
  mf_info "raiz pronta: $MF_ROOT (instância $MF_INSTANCE: processos $MF_PROCESS_API e $MF_PROCESS_WORKER)"
  cat <<EOF

Próximos passos (docs/DEPLOY_SHARED_SERVER.md):
  1. Node privado em $MF_ROOT/.runtime/ (ou executável compatível existente) e export MINHAFOLGA_NODE=<caminho>
  2. Ambiente privado: $MF_ROOT/config/.env.production (chmod 600), a partir de backend/.env.example
  3. scripts/preflight.sh                              # inventário antes de publicar
  4. scripts/deploy.sh prepare <id> --from-tarball <pacote> --prebuilt   (ou --from-git ... --release)
EOF
}

# ------------------------------------------------------------------------------------ prepare
PREPARE_ID=""
PREPARE_DONE=0
prepare_on_exit() {
  local code="${1:-1}"
  if [[ -n "$PREPARE_ID" && $PREPARE_DONE == 0 ]]; then
    local dir
    dir="$(mf_release_dir "$PREPARE_ID")"
    if [[ -f "$dir/$MF_RELEASE_META" ]]; then
      mf_meta_set "$dir" state failed
      mf_log_event prepare release="$PREPARE_ID" result=fail
      mf_warn "preparação da release $PREPARE_ID falhou (código $code). A pasta foi mantida para análise; remova com: scripts/deploy.sh cleanup"
    fi
  fi
}

copy_from_dir() {
  local src="$1" dest="$2"
  [[ -d "$src" ]] || mf_die "diretório de origem inexistente: $src"
  src="$(realpath -e -- "$src")"
  [[ "$src" != "$MF_ROOT" && "$src" != "$MF_ROOT"/* ]] || mf_die "a origem não pode estar dentro da raiz da aplicação."
  if git -C "$src" rev-parse --is-inside-work-tree >/dev/null 2>&1 &&
    [[ "$(git -C "$src" rev-parse --show-toplevel)" == "$src" ]]; then
    # Arquivo-fonte ignorado por engano (ex.: padrão "build/" pegando frontend/build/) geraria release incompleta.
    local ignored
    ignored="$(git -C "$src" ls-files -o -i --exclude-standard --directory |
      grep -vE '(^|/)(node_modules|dist|\.dev|\.generated|\.vite-ssg-temp|test-results|playwright-report|var)/$|(^|/)\.env(\..*)?$|\.log$|(^|/)connection\.txt$|(^|/)\.minhafolga-build$' || true)"
    if [[ -n "$ignored" ]]; then
      mf_warn "o .gitignore exclui caminhos que não parecem artefatos de build:"
      printf '  %s\n' $ignored >&2
      mf_die "corrija o .gitignore da origem (esses arquivos também ficariam fora do commit) ou gere um pacote com --from-tarball."
    fi
    # Somente o que o git considera fonte: rastreados + novos não ignorados (.env, dist, node_modules ficam fora).
    (cd -- "$src" && git ls-files -z -co --exclude-standard |
      while IFS= read -r -d '' f; do
        if [[ -e "$f" || -L "$f" ]]; then printf '%s\0' "$f"; fi
      done |
      tar --no-recursion --null -T - -cf -) | tar -C "$dest" -xf - --no-same-owner
    SOURCE_DESC="dir:$src"
    SOURCE_COMMIT="$(git -C "$src" rev-parse --short=12 HEAD 2>/dev/null || echo sem-commit)"
    if [[ -n "$(git -C "$src" status --porcelain --untracked-files=normal 2>/dev/null)" ]]; then SOURCE_COMMIT+="+alteracoes"; fi
  else
    tar -C "$src" -cf - \
      --exclude='./.git' --exclude='node_modules' --exclude='./frontend/dist' --exclude='./backend/dist' \
      --exclude='.env' --exclude='.env.*' --exclude='.dev' --exclude='./var' --exclude='connection.txt' \
      --exclude='./frontend/.vite-ssg-temp' --exclude='./frontend/.generated' \
      --exclude='test-results' --exclude='playwright-report' --exclude='*.log' . |
      tar -C "$dest" -xf - --no-same-owner
    # .env.example precisa acompanhar a release como referência.
    [[ -f "$src/backend/.env.example" ]] && cp -- "$src/backend/.env.example" "$dest/backend/.env.example"
    [[ -f "$src/frontend/.env.example" ]] && cp -- "$src/frontend/.env.example" "$dest/frontend/.env.example"
    SOURCE_DESC="dir:$src"
    SOURCE_COMMIT="sem-git"
  fi
}

copy_from_tarball() {
  local file="$1" dest="$2" listing strip=0
  [[ -f "$file" ]] || mf_die "pacote inexistente: $file"
  listing="$(tar -tvf "$file")" || mf_die "não foi possível ler o pacote $file"
  # Recusa caminhos absolutos, '..', links e dispositivos: o pacote só pode conter arquivos e pastas.
  if grep -qE '^[^-d]' <<<"$listing"; then mf_die "o pacote contém links ou arquivos especiais; gere-o apenas com arquivos e pastas."; fi
  local names
  names="$(tar -tf "$file")"
  if grep -qE '(^/|(^|/)\.\.(/|$))' <<<"$names"; then mf_die "o pacote contém caminhos absolutos ou '..'."; fi
  if ! grep -qE '^(\./)?backend/package\.json$' <<<"$names"; then
    local top
    top="$(sed -E 's#^\./##' <<<"$names" | cut -d/ -f1 | sort -u)"
    if [[ "$(wc -l <<<"$top")" == 1 ]] && grep -qE "^(\./)?$top/backend/package\.json$" <<<"$names"; then
      strip=1
    else
      mf_die "o pacote não contém backend/package.json na raiz (nem numa única pasta de topo)."
    fi
  fi
  tar -xf "$file" -C "$dest" --no-same-owner --no-same-permissions --strip-components="$strip"
  SOURCE_DESC="tarball:$(realpath -e -- "$file")"
  SOURCE_COMMIT="$(sha256sum -- "$file" | cut -c1-12)"
}

copy_from_git() {
  local repo="$1" ref="$2" dest="$3" sha
  git -C "$repo" rev-parse --git-dir >/dev/null 2>&1 || mf_die "repositório git inválido: $repo"
  sha="$(git -C "$repo" rev-parse --verify "$ref^{commit}" 2>/dev/null)" || mf_die "referência git inexistente: $ref"
  git -C "$repo" archive --format=tar "$sha" | tar -C "$dest" -xf - --no-same-owner
  SOURCE_DESC="git:$(realpath -e -- "$repo")@$ref"
  SOURCE_COMMIT="${sha:0:12}"
}

# Recusa releases com segredos versionados por engano (lista apenas nomes de arquivo).
secret_scan() {
  local dest="$1" found
  found="$(find "$dest" -name node_modules -prune -o -type f \( -name '.env' -o \( -name '.env.*' ! -name '.env.example' \) \
    -o -name '*.pem' -o -name '*.key' -o -name '*.p12' -o -name 'id_rsa*' -o -name 'id_ed25519*' -o -name 'connection.txt' \) -print)"
  found+=$'\n'"$(grep -rIlE --exclude-dir=node_modules \
    'github_pat_[A-Za-z0-9_]{20,}|ghp_[A-Za-z0-9]{30,}|-----BEGIN ([A-Z]+ )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}' "$dest" 2>/dev/null || true)"
  found="$(sed '/^$/d' <<<"$found")"
  if [[ -n "$found" ]]; then
    mf_warn "arquivos com possível segredo encontrados na release:"
    printf '  %s\n' $found >&2
    mf_die "release recusada. Remova os segredos da origem (eles pertencem a config/.env.production)."
  fi
}

cmd_prepare() {
  local id="${1:-}"
  [[ -n "$id" && "$id" != --* ]] || mf_die "uso: deploy.sh prepare <release-id> --from-dir|--from-tarball|--from-git ..."
  shift
  local from_dir="" from_tarball="" from_git="" ref="HEAD" prebuilt=0 keep_frontend=0 mode="" allow_dirty=0
  local env_file_arg="" public_config=0
  local build_args=()
  while (($#)); do
    case "$1" in
      --from-dir) from_dir="${2:-}"; shift 2 ;;
      --from-tarball) from_tarball="${2:-}"; shift 2 ;;
      --from-git) from_git="${2:-}"; shift 2 ;;
      --ref) ref="${2:-}"; shift 2 ;;
      --release | --staging | --review)
        [[ -z "$mode" || "$mode" == "${1#--}" ]] || mf_die "informe só um modo de build (--release, --staging ou --review)."
        mode="${1#--}"; shift
        ;;
      --allow-dirty) allow_dirty=1; build_args+=("$1"); shift ;;
      --with-tests | --skip-typecheck) build_args+=("$1"); shift ;;
      --site-url) build_args+=("$1" "${2:-}"); shift 2 ;;
      --public-config) public_config=1; build_args+=("$1" "${2:-}"); shift 2 ;;
      --env-file) env_file_arg="${2:-}"; shift 2 ;;
      --prebuilt) prebuilt=1; shift ;;
      --keep-frontend-deps) keep_frontend=1; shift ;;
      *) mf_die "opção desconhecida para prepare: $1" ;;
    esac
  done
  local n=0
  [[ -n "$from_dir" ]] && n=$((n + 1))
  [[ -n "$from_tarball" ]] && n=$((n + 1))
  [[ -n "$from_git" ]] && n=$((n + 1))
  ((n == 1)) || mf_die "informe exatamente uma origem: --from-dir, --from-tarball ou --from-git."
  # Sem padrão implícito: esquecer o modo não pode gerar, calado, um build de revisão para produção.
  if [[ $prebuilt == 0 && -z "$mode" ]]; then
    mf_die "informe o modo do build: --release (produção), --staging (homologação) ou --review (revisão)."
  fi
  [[ -z "$env_file_arg" || $public_config == 0 ]] || mf_die "use --env-file ou --public-config, não os dois."
  [[ -z "$env_file_arg" || $prebuilt == 0 ]] || mf_die "--env-file não se aplica a --prebuilt (a configuração pública já foi usada no build da CI)."

  mf_resolve_root
  mf_select_node
  mf_lock
  mf_validate_release_id "$id"
  local dir
  dir="$(mf_release_dir "$id")"
  [[ ! -e "$dir" && ! -L "$dir" ]] || mf_die "a release '$id' já existe; releases são imutáveis, use outro id."
  [[ "$id" != "$(mf_current_release)" ]] || mf_die "id em uso pela release atual."
  local env_used="" env_sha=""
  if [[ -n "$env_file_arg" ]]; then
    env_used="$(MINHAFOLGA_ENV_FILE="$env_file_arg" mf_env_file)"
    mf_check_env_file "$env_used"
    env_sha="$(sha256sum -- "$env_used" | cut -c1-64)"
    build_args+=(--env-file "$env_used")
  fi
  # Release pública vem de um commit (a mesma regra do build.sh, que não enxerga o .git a partir da release).
  if [[ -n "$from_dir" && "$mode" == release && $allow_dirty == 0 ]]; then
    if git -C "$from_dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
      [[ -z "$(git -C "$from_dir" status --porcelain --untracked-files=normal 2>/dev/null)" ]] ||
        mf_die "a origem $from_dir tem alterações não registradas; um release público deve vir de um commit (--from-git <repo> --ref <commit>, ou --allow-dirty, que fica registrado)."
    else
      mf_die "a origem $from_dir não é um checkout git; para --release use --from-git, --from-tarball ou --allow-dirty (registrado)."
    fi
  fi

  mkdir -m 700 -- "$dir"
  PREPARE_ID="$id"
  mf_meta_set "$dir" format 1
  mf_meta_set "$dir" id "$id"
  mf_meta_set "$dir" state preparing
  mf_meta_set "$dir" created_at "$(date -Iseconds)"

  mf_step "copiando a origem para releases/$id"
  SOURCE_DESC="" SOURCE_COMMIT=""
  if [[ -n "$from_dir" ]]; then
    copy_from_dir "$from_dir" "$dir"
  elif [[ -n "$from_tarball" ]]; then
    copy_from_tarball "$from_tarball" "$dir"
  else
    copy_from_git "$from_git" "$ref" "$dir"
  fi
  mf_meta_set "$dir" source "$SOURCE_DESC"
  mf_meta_set "$dir" commit "$SOURCE_COMMIT"
  [[ $allow_dirty == 1 ]] && mf_meta_set "$dir" allow_dirty 1
  for f in backend/package.json backend/package-lock.json frontend/package.json frontend/package-lock.json contracts/openapi.yaml deploy/ecosystem.config.cjs; do
    [[ -f "$dir/$f" ]] || mf_die "origem incompleta: falta $f"
  done
  mf_step "procurando segredos versionados por engano"
  secret_scan "$dir"
  if [[ -f "$dir/.node-version" ]]; then
    local wanted
    wanted="$(tr -d '[:space:]v' <"$dir/.node-version")"
    [[ "v$wanted" == "$MF_NODE_VERSION" ]] ||
      mf_warn ".node-version pede $wanted e o Node escolhido é $MF_NODE_VERSION (mesma linha 24; confira as notas de versão)."
  fi

  if [[ $prebuilt == 1 ]]; then
    mf_step "pacote pré-construído: conferindo artefatos e instalando dependências de produção do backend"
    [[ -f "$dir/backend/dist/server.js" && -f "$dir/frontend/dist/index.html" && -f "$dir/frontend/dist/404.html" ]] ||
      mf_die "--prebuilt exige backend/dist/server.js e frontend/dist/{index,404}.html no pacote."
    # Modo do build da CI: vem do .minhafolga-build do pacote (sem ele, "prebuilt", que produção recusa).
    [[ -f "$dir/.minhafolga-build" ]] || echo "mode=prebuilt" >"$dir/.minhafolga-build"
    local pkg_mode
    pkg_mode="$(sed -n 's/^mode=//p' "$dir/.minhafolga-build" | tail -n 1)"
    if [[ -n "$mode" && "$pkg_mode" != "$mode" ]]; then
      mf_die "o pacote foi construído em modo '${pkg_mode:-desconhecido}' e foi pedido --$mode."
    fi
    (cd -- "$dir/backend" && mf_npm ci --omit=dev --ignore-scripts)
  else
    mf_step "build da release (fora da pasta pública ativa)"
    bash "$SCRIPT_DIR/build.sh" --source "$dir" "--$mode" "${build_args[@]+"${build_args[@]}"}"
  fi

  if [[ $keep_frontend == 0 ]]; then
    mf_remove_inside_release "$id" frontend/node_modules
  fi
  # Lista dos assets desta build, usada para manter os da release anterior durante a transição.
  (cd -- "$dir/frontend/dist/assets" && find . -maxdepth 1 -type f -printf '%f\n' | sort) >"$dir/.assets-built.txt"

  mf_step "permissões: privadas na release, leitura pública só em frontend/dist"
  chmod -R u+rwX,go-rwx -- "$dir"
  web_traverse "$dir" "$dir/frontend"
  web_public_tree "$dir/frontend/dist"
  # Corpos JSON dos erros gerados pelo próprio Apache em /api (deploy/apache.minhafolga.conf.example).
  if [[ -d "$dir/deploy/http-errors" ]]; then
    web_traverse "$dir/deploy"
    web_public_tree "$dir/deploy/http-errors"
  fi

  # Node desta release: registrado e ligado por link (a unidade systemd --user executa por ele).
  ln -s -- "$MF_NODE" "$dir/$MF_RELEASE_NODE_LINK"

  local build_mode
  build_mode="$(sed -n 's/^mode=//p' "$dir/.minhafolga-build" 2>/dev/null | tail -n 1)"
  mf_meta_set "$dir" build_mode "${build_mode:-desconhecido}"
  mf_meta_set "$dir" node_version "$MF_NODE_VERSION"
  mf_meta_set "$dir" node_path "$MF_NODE"
  mf_meta_set "$dir" npm_version "$MF_NPM_VERSION"
  if [[ -n "$env_used" ]]; then
    mf_meta_set "$dir" env_file "$env_used"
    mf_meta_set "$dir" env_sha256 "$env_sha"
  fi
  mf_meta_set "$dir" prepared_at "$(date -Iseconds)"
  mf_meta_set "$dir" state ready
  PREPARE_DONE=1
  mf_log_event prepare release="$id" result=ok source="$SOURCE_DESC" commit="$SOURCE_COMMIT" mode="${build_mode:-?}" \
    node="$MF_NODE_VERSION" node_path="$MF_NODE" npm="$MF_NPM_VERSION" env_file="$(basename -- "${env_used:-padrao}")" \
    allow_dirty="$allow_dirty"
  mf_info "release $id pronta em $dir ($(du -sh -- "$dir" | cut -f1))."
  mf_info "próximo passo: scripts/deploy.sh migrate $id"
}

# ------------------------------------------------------------------------------------ banco
# Backup do banco dedicado com pg_dump (formato custom). Senha via PGPASSFILE temporário 0600.
# Imprime o caminho do arquivo; retorna 3 se pg_dump não estiver disponível.
db_backup() {
  local label="$1" env_file pgdump pgrestore tmpdir pass status host port db user sslmode out
  env_file="$(mf_env_file)"
  mf_check_env_file "$env_file"
  pgdump="${MINHAFOLGA_PG_DUMP:-$(command -v pg_dump || true)}"
  [[ -n "$pgdump" && -x "$pgdump" ]] || return 3
  tmpdir="$MF_ROOT/var/tmp"
  pass="$tmpdir/pgpass.$$"
  MF_CLEANUP_FILES+=("$pass")
  local info
  info="$("$MF_NODE" -e '
    const fs = require("node:fs");
    const { parseEnv } = require("node:util");
    const env = parseEnv(fs.readFileSync(process.argv[1], "utf8"));
    let u; try { u = new URL(env.DATABASE_URL || ""); } catch { console.log("invalid"); process.exit(0); }
    if (!/^postgres(ql)?:$/.test(u.protocol)) { console.log("skip " + u.protocol.replace(":", "")); process.exit(0); }
    const esc = (s) => s.replace(/\\/g, "\\\\").replace(/:/g, "\\:");
    const host = u.hostname || "127.0.0.1", port = u.port || "5432";
    const db = decodeURIComponent(u.pathname.slice(1)), user = decodeURIComponent(u.username);
    fs.writeFileSync(process.argv[2], [host, port, db, user, decodeURIComponent(u.password)].map(esc).join(":") + "\n", { mode: 0o600 });
    console.log(["ok", host, port, db, user, u.searchParams.get("sslmode") || ""].join(" "));
  ' "$env_file" "$pass")"
  read -r status host port db user sslmode <<<"$info"
  case "$status" in
    ok) ;;
    skip) mf_warn "DATABASE_URL não é PostgreSQL ($host); backup com pg_dump não se aplica."; return 3 ;;
    *) mf_die "DATABASE_URL ausente ou inválida em $env_file." ;;
  esac
  out="$MF_ROOT/backups/db-$(date +%Y%m%d-%H%M%S)-$(mf_sanitize_value "$label").dump"
  mf_info "backup do banco $db ($user@$host:$port) → $out"
  local rc=0
  PGPASSFILE="$pass" PGCONNECT_TIMEOUT=10 PGSSLMODE="${sslmode:-prefer}" \
    "$pgdump" --format=custom --no-password -h "$host" -p "$port" -U "$user" -d "$db" >"$out.partial" || rc=$?
  rm -f -- "$pass"
  if ((rc != 0)); then
    rm -f -- "$out.partial"
    mf_die "pg_dump falhou (código $rc); nada foi migrado."
  fi
  mv -f -- "$out.partial" "$out"
  chmod 600 "$out"
  pgrestore="${MINHAFOLGA_PG_RESTORE:-$(command -v pg_restore || true)}"
  if [[ -n "$pgrestore" && -x "$pgrestore" ]]; then
    "$pgrestore" --list "$out" >/dev/null || mf_die "o arquivo de backup não pôde ser lido por pg_restore: $out"
    mf_info "backup conferido com pg_restore --list ($(du -h -- "$out" | cut -f1))."
  else
    mf_warn "pg_restore ausente: o backup não foi conferido automaticamente."
  fi
  BACKUP_FILE="$out"
}

cmd_backup_db() {
  mf_resolve_root
  mf_select_node
  mf_lock
  BACKUP_FILE=""
  local rc=0
  db_backup "${1:-avulso}" || rc=$?
  ((rc == 0)) || mf_die "pg_dump indisponível (instale o cliente PostgreSQL compatível ou informe MINHAFOLGA_PG_DUMP)."
  mf_log_event backup file="$(basename -- "$BACKUP_FILE")" result=ok
}

cmd_migrate() {
  local id="${1:-}"
  [[ -n "$id" && "$id" != --* ]] || mf_die "uso: deploy.sh migrate <release-id> [--skip-backup]"
  shift
  local skip_backup=0
  while (($#)); do
    case "$1" in
      --skip-backup) skip_backup=1; shift ;;
      *) mf_die "opção desconhecida para migrate: $1" ;;
    esac
  done
  mf_resolve_root
  mf_select_node
  mf_lock
  mf_require_release_ready "$id"
  local dir env_file current
  dir="$(mf_release_dir "$id")"
  env_file="$(mf_env_file)"
  mf_check_env_file "$env_file"
  current="$(mf_current_release)"

  mf_step "migrações da release $id"
  local mine theirs new_list
  mine="$(find "$dir/backend/migrations" -maxdepth 1 -name '*.sql' -printf '%f\n' | sort)"
  if [[ -n "$current" ]]; then
    theirs="$(find "$(mf_release_dir "$current")/backend/migrations" -maxdepth 1 -name '*.sql' -printf '%f\n' 2>/dev/null | sort)"
    new_list="$(comm -23 <(printf '%s\n' "$mine") <(printf '%s\n' "$theirs") | tr '\n' ' ')"
    mf_info "novas em relação à release atual ($current): ${new_list:-nenhuma}"
    [[ -z "$(comm -13 <(printf '%s\n' "$mine") <(printf '%s\n' "$theirs"))" ]] ||
      mf_warn "a release atual tem migrações que a nova não tem; confira a ordem das releases."
    [[ -n "$new_list" ]] && mf_warn "confirme que as novas migrações são aditivas/retrocompatíveis com a release $current (rollback não desfaz migração)."
  fi

  BACKUP_FILE=""
  if [[ $skip_backup == 1 ]]; then
    mf_warn "--skip-backup: migrando sem backup automático (registre onde está o backup externo)."
  else
    local rc=0
    db_backup "antes-$id" || rc=$?
    if ((rc == 3)); then
      mf_die "pg_dump indisponível ou banco não PostgreSQL. Faça o backup pelo procedimento da hospedagem e repita com --skip-backup."
    fi
  fi

  local result
  result="$(MF_ENV_FILE="$env_file" "$MF_NODE" "$dir/backend/dist/cli/migrate.js")" || {
    mf_log_event migrate release="$id" result=fail backup="$(basename -- "${BACKUP_FILE:-nenhum}")"
    mf_die "migração falhou; a release atual continua publicada. Restauração, se necessária: docs/OPERATIONS.md."
  }
  local applied
  applied="$("$MF_NODE" -e 'const r = JSON.parse(process.argv[1]); console.log((r.applied || []).join(",") || "nenhuma")' "$result")"
  mf_info "aplicadas agora: $applied"
  mf_meta_set "$dir" migrated_at "$(date -Iseconds)"
  mf_log_event migrate release="$id" result=ok applied="$applied" backup="$(basename -- "${BACKUP_FILE:-nenhum}")"
  mf_info "próximo passo: scripts/deploy.sh publish $id --mode <pm2|systemd-user|manual>"
}

# ------------------------------------------------------------------------------------ publish
# Troca config/.env.production pelo arquivo usado no build da release (mudança de fase coordenada).
# Guarda o anterior em config/.env.production.antes-<id> (0600). Imprime o nome da cópia.
promote_env() {
  local id="$1" dir="$2" target="$3" next sha backup tmp
  next="$(mf_meta_get "$dir" env_file)"
  [[ -n "$next" ]] || mf_die "--promote-env: a release $id não foi preparada com --env-file."
  next="$(MINHAFOLGA_ENV_FILE="$next" mf_env_file)"
  [[ "$next" != "$target" ]] || mf_die "--promote-env: a release $id já usa $target; nada a promover."
  mf_check_env_file "$next"
  sha="$(sha256sum -- "$next" | cut -c1-64)"
  [[ "$sha" == "$(mf_meta_get "$dir" env_sha256)" ]] ||
    mf_die "--promote-env: $next mudou depois do prepare de $id; prepare outra release com o arquivo atual."
  backup="$target.antes-$id"
  [[ ! -e "$backup" ]] || mf_die "--promote-env: a cópia $backup já existe; confira e remova antes de publicar."
  cp -p -- "$target" "$backup"
  chmod 600 "$backup"
  tmp="$target.tmp.$$"
  cp -p -- "$next" "$tmp"
  chmod 600 "$tmp"
  mv -f -T -- "$tmp" "$target"
  printf '%s\n' "$(basename -- "$backup")"
}

cmd_publish() {
  local id="${1:-}"
  [[ -n "$id" && "$id" != --* ]] || mf_die "uso: deploy.sh publish <release-id> [--mode pm2|systemd-user|manual]"
  shift
  local mode_arg="" skip_migrate=0 timeout=40 allow_review=0 promote=0
  while (($#)); do
    case "$1" in
      --mode) mode_arg="${2:-}"; shift 2 ;;
      --pm2-allow-start) export MF_PM2_ALLOW_START=1; shift ;;
      --skip-migrate-check) skip_migrate=1; shift ;;
      --allow-review-build) allow_review=1; shift ;;
      --promote-env) promote=1; shift ;;
      --use-session-node) export MF_USE_SESSION_NODE=1; shift ;;
      --health-timeout) timeout="${2:-40}"; shift 2 ;;
      *) mf_die "opção desconhecida para publish: $1" ;;
    esac
  done
  [[ "$timeout" =~ ^[0-9]+$ ]] || mf_die "--health-timeout precisa ser número de segundos."
  local mode
  mode="$(mf_process_mode "$mode_arg")"
  mf_resolve_root
  mf_select_node
  mf_lock
  mf_require_release_ready "$id"
  local dir env_file previous port worker node_env build_mode
  dir="$(mf_release_dir "$id")"
  env_file="$(mf_env_file)"
  mf_check_env_file "$env_file"
  previous="$(mf_current_release)"
  [[ "$id" != "$previous" ]] || mf_die "a release $id já é a atual (para reiniciar os processos: deploy.sh restart)."
  if [[ $skip_migrate == 0 ]] && ! grep -qE "event=migrate .*release=$id .*result=ok" "$MF_ROOT/var/releases.log"; then
    mf_die "sem registro de 'deploy.sh migrate $id' bem-sucedido. Rode a migração (idempotente) antes de publicar."
  fi

  # O build precisa corresponder ao ambiente: produção só com --release; homologação com --staging
  # (ou --review com --allow-review-build, registrado). Um build de revisão tem pendências visíveis e noindex.
  node_env="$(mf_env_get "$env_file" NODE_ENV)"
  build_mode="$(mf_meta_get "$dir" build_mode)"
  case "$node_env" in
    production)
      [[ $allow_review == 0 ]] || mf_die "--allow-review-build não é aceito com NODE_ENV=production."
      [[ "$build_mode" == release ]] ||
        mf_die "a release $id foi construída em modo '${build_mode:-desconhecido}'; produção (NODE_ENV=production) só publica build --release. Prepare outra release com --release."
      ;;
    staging)
      if [[ "$build_mode" != staging ]]; then
        [[ "$build_mode" == review && $allow_review == 1 ]] ||
          mf_die "a release $id foi construída em modo '${build_mode:-desconhecido}'; homologação (NODE_ENV=staging) publica build --staging (ou --review com --allow-review-build)."
        mf_warn "publicando build de revisão em homologação (--allow-review-build): pendências visíveis e noindex."
      fi
      ;;
    *) mf_warn "NODE_ENV=${node_env:-ausente} em $env_file: modo do build ($build_mode) não conferido." ;;
  esac

  port="$(mf_env_get "$env_file" PORT)"
  worker="$(mf_env_get "$env_file" WORKER_MODE)"
  worker="${worker:-inline}"
  [[ "$port" =~ ^[0-9]+$ ]] || mf_die "PORT ausente ou inválida em $env_file."
  if [[ $promote == 1 ]]; then
    # A release nova pode mudar PORT/WORKER_MODE: vale o arquivo que será promovido.
    local next
    next="$(MINHAFOLGA_ENV_FILE="$(mf_meta_get "$dir" env_file)" mf_env_file)"
    port="$(mf_env_get "$next" PORT)"
    worker="$(mf_env_get "$next" WORKER_MODE)"
    worker="${worker:-inline}"
    [[ "$port" =~ ^[0-9]+$ ]] || mf_die "PORT ausente ou inválida em $next."
  fi

  # Pré-condições ANTES de qualquer troca: Node da release, gerenciador, unidade/ecosystem, porta, nomes.
  mf_use_release_node "$dir"
  mf_processes_check "$mode" "$worker" "$port" "$dir"

  # Intenção registrada antes da troca: se algo interromper daqui em diante, o rollback acha a anterior.
  mf_log_event publish-start release="$id" previous="${previous:-nenhuma}" mode="$mode" node_path="$MF_NODE"

  local carried=0
  if [[ -n "$previous" && -d "$(mf_release_dir "$previous")" ]]; then
    carried="$(mf_carry_assets "$(mf_release_dir "$previous")" "$dir")"
    mf_info "assets da release anterior mantidos para a transição: $carried"
  fi

  local env_backup=""
  if [[ $promote == 1 ]]; then
    env_backup="$(promote_env "$id" "$dir" "$env_file")"
    mf_info "config/.env.production substituído pelo arquivo do prepare (anterior guardado em config/$env_backup)."
  fi

  mf_step "promovendo current → releases/$id (troca atômica)"
  mf_switch_current "$id"
  mf_info "arquivos públicos já servidos da nova release; recarregando somente os processos da instância $MF_INSTANCE ($mode)."

  if ! (mf_processes reload "$mode" "$worker" "$port"); then
    # Falha do gerenciador: volta current (e o ambiente) para a release anterior e tenta recarregá-la.
    local reverted="nenhuma"
    if [[ -n "$env_backup" ]]; then
      cp -p -- "$MF_ROOT/config/$env_backup" "$env_file.tmp.$$" && mv -f -T -- "$env_file.tmp.$$" "$env_file"
      mf_warn "config/.env.production restaurado a partir de config/$env_backup."
    fi
    if [[ -n "$previous" ]]; then
      mf_switch_current "$previous"
      reverted="$previous"
      mf_warn "current voltou para releases/$previous."
      if [[ "$mode" != manual ]]; then
        local prev_port
        prev_port="$(mf_env_get "$env_file" PORT)"
        (mf_use_release_node "$(mf_release_dir "$previous")" >/dev/null && mf_processes reload "$mode" "$worker" "$prev_port") ||
          mf_warn "a recarga da release $previous também falhou; confira os processos ($MF_PROCESS_API) e var/log/."
      fi
    fi
    mf_log_event publish release="$id" previous="${previous:-nenhuma}" mode="$mode" result=fail reverted="$reverted"
    mf_die "o gerenciador de processos não recarregou a release $id; publicação revertida (current: ${reverted})."
  fi

  local health="nao_verificada" health_detail=""
  if [[ "$mode" != manual ]]; then
    local rc=0
    mf_wait_release "$port" "$id" "$timeout" || rc=$?
    case "$rc" in
      0) health=ok ;;
      2) health=falha health_detail="$MF_WAIT_DETAIL" ;;
      *) health=falha health_detail="sem resposta em 127.0.0.1:$port/api/health em ${timeout}s" ;;
    esac
  fi
  local migrations
  migrations="$(find "$dir/backend/migrations" -maxdepth 1 -name '*.sql' -printf '%f\n' | sed 's/\.sql$//' | sort | tr '\n' ',' | sed 's/,$//')"
  mf_meta_set "$dir" published_at "$(date -Iseconds)"
  mf_log_event publish release="$id" previous="${previous:-nenhuma}" mode="$mode" instance="$MF_INSTANCE" \
    node="$MF_NODE_VERSION" node_path="$MF_NODE" npm="$MF_NPM_VERSION" port="$port" worker="$worker" \
    build_mode="$build_mode" migrations="$migrations" carried_assets="$carried" env_backup="${env_backup:-nenhum}" \
    health="$health"
  if [[ "$health" == falha ]]; then
    mf_warn "$health_detail (logs: $MF_ROOT/var/log/)."
    [[ -n "$previous" ]] && mf_warn "para voltar: scripts/rollback.sh --mode $mode"
    exit 1
  fi
  mf_info "release $id publicada. Verifique: scripts/deploy.sh verify"
}

cmd_restart_stop() {
  local action="$1"
  shift
  local mode_arg=""
  while (($#)); do
    case "$1" in
      --mode) mode_arg="${2:-}"; shift 2 ;;
      --pm2-allow-start) export MF_PM2_ALLOW_START=1; shift ;;
      --use-session-node) export MF_USE_SESSION_NODE=1; shift ;;
      *) mf_die "opção desconhecida: $1" ;;
    esac
  done
  local mode
  mode="$(mf_process_mode "$mode_arg")"
  mf_resolve_root
  mf_select_node
  mf_lock
  local current
  current="$(mf_current_release)"
  [[ -n "$current" ]] || mf_die "nenhuma release publicada."
  local env_file port worker
  env_file="$(mf_env_file)"
  mf_check_env_file "$env_file"
  port="$(mf_env_get "$env_file" PORT)"
  worker="$(mf_env_get "$env_file" WORKER_MODE)"
  worker="${worker:-inline}"
  # Reinício com o Node registrado na release atual (não com o da sessão).
  mf_use_release_node "$(mf_release_dir "$current")"
  # Também no stop: "pm2 stop <nome>" não pode alcançar processo homônimo de outra raiz.
  mf_processes_check "$mode" "$worker" "$port" "$(mf_release_dir "$current")"
  mf_processes "$action" "$mode" "$worker" "$port" || mf_die "o gerenciador de processos não concluiu '$action'."
  mf_log_event "$([[ $action == reload ]] && echo restart || echo stop)" release="$current" mode="$mode" node_path="$MF_NODE"
  if [[ "$action" == reload && "$mode" != manual ]]; then
    local rc=0
    mf_wait_release "$port" "$current" 40 || rc=$?
    case "$rc" in
      0) mf_info "API da release $current respondendo em 127.0.0.1:$port." ;;
      2) mf_die "$MF_WAIT_DETAIL." ;;
      *) mf_die "API sem resposta em 127.0.0.1:$port." ;;
    esac
  fi
}

# ------------------------------------------------------------------------------------ verify
cmd_verify() {
  local url="" smoke_args=()
  while (($#)); do
    case "$1" in
      --url) url="${2:-}"; shift 2 ;;
      --) shift; smoke_args=("$@"); break ;;
      *) mf_die "opção desconhecida para verify: $1 (opções do smoke.sh vão depois de --)" ;;
    esac
  done
  mf_resolve_root
  mf_select_node
  local current env_file port ok=1
  current="$(mf_current_release)"
  [[ -n "$current" ]] || mf_die "nenhuma release publicada."
  env_file="$(mf_env_file)"
  mf_check_env_file "$env_file"
  port="$(mf_env_get "$env_file" PORT)"
  url="${url:-$(mf_env_get "$env_file" PUBLIC_SITE_URL)}"

  mf_step "API local (127.0.0.1:$port)"
  local local_health=falha readiness=nao_configurada listener=nao_identificado
  if mf_wait_health "$port" 5; then local_health=ok; mf_info "OK   /api/health local"; else ok=0; mf_warn "FALHA /api/health local"; fi
  # A porta precisa ser atendida por processo da release atual (cwd em releases/<atual>/).
  mf_port_owner "$port"
  case "$MF_PORT_STATE" in
    minhafolga)
      if [[ "$MF_PORT_RELEASES" == "$current" ]]; then
        listener=ok
        mf_info "OK   porta $port atendida pela release atual ($current, PID $MF_PORT_PIDS)"
      else
        listener=falha ok=0
        mf_warn "FALHA porta $port atendida pela release $MF_PORT_RELEASES, não pela atual ($current): os processos não foram recarregados?"
      fi
      ;;
    outro) listener=falha ok=0; mf_warn "FALHA porta $port atendida por outro processo ($MF_PORT_DETAIL)" ;;
    livre) listener=falha ok=0; mf_warn "FALHA nenhum processo escuta a porta $port" ;;
    *) mf_warn "processo da porta $port não identificado ($MF_PORT_DETAIL)" ;;
  esac
  # Prontidão interna: token lido do arquivo privado e entregue ao curl por arquivo 0600 (fora da linha de comando).
  local header="$MF_ROOT/var/tmp/readiness.$$"
  MF_CLEANUP_FILES+=("$header")
  if "$MF_NODE" -e '
      const { parseEnv } = require("node:util"); const fs = require("node:fs");
      const t = parseEnv(fs.readFileSync(process.argv[1], "utf8")).READINESS_TOKEN;
      if (!t) process.exit(3);
      fs.writeFileSync(process.argv[2], `X-Readiness-Token: ${t}\n`, { mode: 0o600 });
    ' "$env_file" "$header" 2>/dev/null; then
    local body
    body="$(curl -sS --max-time 5 -H @"$header" "http://127.0.0.1:$port/api/internal/ready" 2>/dev/null || true)"
    rm -f -- "$header"
    if [[ "$body" == *'"status":"ready"'* ]]; then readiness=ok; mf_info "OK   prontidão interna: $body"; else readiness=falha; ok=0; mf_warn "FALHA prontidão interna: ${body:-sem resposta}"; fi
  else
    rm -f -- "$header"
    mf_warn "READINESS_TOKEN não configurado: prontidão interna não verificada."
  fi

  mf_step "smoke test público: $url"
  local smoke=ok
  bash "$SCRIPT_DIR/smoke.sh" "$url" "${smoke_args[@]+"${smoke_args[@]}"}" || { smoke=falha; ok=0; }
  mf_log_event verify release="$current" url="$url" local_health="$local_health" listener="$listener" readiness="$readiness" smoke="$smoke" \
    result="$([[ $ok == 1 ]] && echo ok || echo fail)"
  ((ok == 1)) || mf_die "verificação com falhas (registrada em var/releases.log)."
  mf_info "verificação concluída sem falhas."
}

# ------------------------------------------------------------------------------------ status
cmd_status() {
  mf_resolve_root
  mf_select_node
  local current
  current="$(mf_current_release)"
  echo "raiz:            $MF_ROOT"
  echo "instância:       $MF_INSTANCE (processos $MF_PROCESS_API, $MF_PROCESS_WORKER)"
  echo "release atual:   ${current:-nenhuma}"
  echo "Node escolhido:  $MF_NODE ($MF_NODE_VERSION) · npm $MF_NPM_VERSION"
  echo
  echo "releases:"
  local d id
  for d in "$MF_ROOT"/releases/*/; do
    [[ -d "$d" ]] || continue
    id="$(basename -- "$d")"
    [[ -f "$d/$MF_RELEASE_META" ]] || { echo "  $id (sem metadados: não gerenciada)"; continue; }
    printf '  %-28s estado=%-9s build=%-8s commit=%-20s criada=%s%s\n' "$id" "$(mf_meta_get "$d" state)" \
      "$(mf_meta_get "$d" build_mode)" "$(mf_meta_get "$d" commit)" "$(mf_meta_get "$d" created_at)" \
      "$([[ "$id" == "$current" ]] && echo '  ← atual')"
  done
  echo
  echo "eventos recentes (var/releases.log):"
  tail -n 10 "$MF_ROOT/var/releases.log" 2>/dev/null | sed 's/^/  /' || true
  local env_file port
  env_file="$(mf_env_file)"
  if [[ -f "$env_file" ]]; then
    port="$(mf_env_get "$env_file" PORT)"
    echo
    mf_port_owner "$port"
    case "$MF_PORT_STATE" in
      minhafolga) echo "porta $port: em escuta pela API da Minha Folga (release $MF_PORT_RELEASES, PID $MF_PORT_PIDS)" ;;
      outro) echo "porta $port: ocupada por OUTRO processo ($MF_PORT_DETAIL)" ;;
      livre) echo "porta $port: livre (API parada?)" ;;
      *) echo "porta $port: não verificada ($MF_PORT_DETAIL)" ;;
    esac
    if mf_wait_health "$port" 1; then echo "/api/health local: ok"; else echo "/api/health local: sem resposta"; fi
  fi
  echo
  echo "processos da instância $MF_INSTANCE:"
  if bin="$(mf_pm2_bin 2>/dev/null)" && mf_pm2_daemon_running; then
    env PATH="$MF_ORIGINAL_PATH" "$bin" jlist 2>/dev/null |
      mf_pm2_jlist_report proprios "$MF_PROCESS_API,$MF_PROCESS_WORKER" "$MF_ROOT" |
      awk -F'\t' '{ printf "  pm2 %s: %s (%s%s)\n", $1, $4, $3, ($2 == "raiz=outra" ? " — OUTRA RAIZ" : "") }' || true
  else
    echo "  pm2: sem daemon em execução (não consultado)"
  fi
  if systemctl --user show-environment >/dev/null 2>&1; then
    for app in "$MF_PROCESS_API" "$MF_PROCESS_WORKER"; do
      systemctl --user cat "$app.service" >/dev/null 2>&1 && echo "  systemd --user $app: $(systemctl --user is-active "$app.service" || true)"
    done
  fi
  return 0
}

# ------------------------------------------------------------------------------------ cleanup
cmd_cleanup() {
  local keep=5 keep_backups=10 dry=0
  while (($#)); do
    case "$1" in
      --keep) keep="${2:-}"; shift 2 ;;
      --keep-backups) keep_backups="${2:-}"; shift 2 ;;
      --dry-run) dry=1; shift ;;
      *) mf_die "opção desconhecida para cleanup: $1" ;;
    esac
  done
  [[ "$keep" =~ ^[0-9]+$ ]] && ((keep >= 2)) || mf_die "--keep precisa ser um número >= 2."
  [[ "$keep_backups" =~ ^[0-9]+$ ]] && ((keep_backups >= 1)) || mf_die "--keep-backups precisa ser >= 1."
  mf_resolve_root
  mf_lock
  local current previous
  current="$(mf_current_release)"
  # A anterior (alvo de rollback) é a release publicada antes da atual.
  previous="$(mf_previous_of "$current")"
  local ready=() failed=() d id state
  while IFS= read -r d; do
    id="$(basename -- "$d")"
    [[ "$id" =~ $MF_RELEASE_ID_RE && -f "$d/$MF_RELEASE_META" ]] || continue
    state="$(mf_meta_get "$d" state)"
    if [[ "$state" == ready ]]; then ready+=("$id"); else failed+=("$id"); fi
  done < <(find "$MF_ROOT/releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -rn | cut -d' ' -f2-)
  local remove=() i=0
  for id in "${ready[@]+"${ready[@]}"}"; do
    i=$((i + 1))
    [[ "$id" == "$current" || "$id" == "$previous" ]] && continue
    ((i > keep)) && remove+=("$id")
  done
  for id in "${failed[@]+"${failed[@]}"}"; do [[ "$id" != "$current" ]] && remove+=("$id"); done
  if ((${#remove[@]} == 0)); then
    mf_info "nenhuma release a remover (atual: ${current:-nenhuma}; anterior: ${previous:-nenhuma})."
  fi
  for id in "${remove[@]+"${remove[@]}"}"; do
    if [[ $dry == 1 ]]; then echo "removeria releases/$id"; else mf_remove_release_dir "$id" && mf_info "removida releases/$id"; fi
  done
  local backups=() b
  while IFS= read -r b; do backups+=("$b"); done < <(find "$MF_ROOT/backups" -maxdepth 1 -type f -regextype posix-extended \
    -regex '.*/db-[0-9]{8}-[0-9]{6}-[A-Za-z0-9._:/@+,=-]+\.dump' -printf '%f\n' | sort -r)
  i=0
  for b in "${backups[@]+"${backups[@]}"}"; do
    i=$((i + 1))
    ((i > keep_backups)) || continue
    if [[ $dry == 1 ]]; then echo "removeria backups/$b"; else rm -f -- "$MF_ROOT/backups/$b" && mf_info "removido backups/$b"; fi
  done
  [[ $dry == 1 ]] || mf_log_event cleanup removed="$(IFS=,; echo "${remove[*]:-nenhuma}")"
}

# ------------------------------------------------------------------------------------ systemd-unit
cmd_systemd_unit() {
  mf_resolve_root
  mf_select_node
  local app script log
  for app in "$MF_PROCESS_API" "$MF_PROCESS_WORKER"; do
    if [[ "$app" == "$MF_PROCESS_API" ]]; then script=server.js log=api; else script=worker.js log=worker; fi
    cat <<EOF
# ~/.config/systemd/user/$app.service — EXEMPLO; instale só se o administrador adotar systemd --user.
# Depois: systemctl --user daemon-reload && systemctl --user enable --now $app.service
# Persistência após logout exige "loginctl enable-linger $(id -un)" (decisão do administrador).
$([[ "$app" == "$MF_PROCESS_WORKER" ]] && echo "# Somente com WORKER_MODE=separate.")
[Unit]
Description=Minha Folga ($MF_INSTANCE) — $app
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$MF_ROOT/current/backend
Environment=NODE_ENV=production
Environment=MF_ENV_FILE=$MF_ROOT/config/.env.production
Environment=NODE_OPTIONS=
# O Node vem da release publicada (link criado no prepare): trocar de release troca também o runtime.
ExecStart=$MF_ROOT/current/$MF_RELEASE_NODE_LINK $MF_ROOT/current/backend/dist/$script
Restart=on-failure
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=15
UMask=0027
NoNewPrivileges=yes
MemoryMax=$([[ "$app" == "$MF_PROCESS_API" ]] && echo 384M || echo 256M)
CPUQuota=100%
TasksMax=64
StandardOutput=append:$MF_ROOT/var/log/$log.out.log
StandardError=append:$MF_ROOT/var/log/$log.err.log

[Install]
WantedBy=default.target

EOF
  done
}

case "$CMD" in
  init) cmd_init "$@" ;;
  prepare) cmd_prepare "$@" ;;
  migrate) cmd_migrate "$@" ;;
  publish) cmd_publish "$@" ;;
  restart) cmd_restart_stop reload "$@" ;;
  stop) cmd_restart_stop stop "$@" ;;
  verify) cmd_verify "$@" ;;
  status) cmd_status "$@" ;;
  backup-db) cmd_backup_db "$@" ;;
  cleanup) cmd_cleanup "$@" ;;
  systemd-unit) cmd_systemd_unit "$@" ;;
  *) mf_die "subcomando desconhecido: $CMD (use --help)" ;;
esac
