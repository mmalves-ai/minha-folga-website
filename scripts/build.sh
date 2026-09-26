#!/usr/bin/env bash
# Build da Minha Folga a partir de checkout limpo ou de um diretório de release.
# Ordem obrigatória: instalar pelo lockfile → typecheck → (testes) → compilar backend →
# exportar configuração pública → build do frontend → só então remover devDependencies do backend.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib.sh
source "$SCRIPT_DIR/lib.sh"

usage() {
  cat <<'EOF'
Uso: scripts/build.sh [opções]

Constrói backend e frontend separadamente (npm ci em cada pasta, cache npm exclusivo em
<raiz>/.cache/npm). Não publica nada: para publicar use scripts/deploy.sh.

Variáveis obrigatórias:
  MINHAFOLGA_APP_ROOT   raiz exclusiva inicializada (cache npm e temporários)
  MINHAFOLGA_NODE       caminho absoluto do Node 24.15+ (linha 24)

Opções:
  --source <dir>          árvore a construir (padrão: o checkout que contém este script)
  --env-file <arquivo>    ambiente privado usado para exportar a configuração pública
                          (padrão: <raiz>/config/.env.production)
  --public-config <json>  usa uma configuração pública já exportada (CI sem segredos)
  --site-url <url>        VITE_SITE_URL (padrão: siteUrl da configuração pública)
  --release               produção: MF_STRICT_RELEASE=1 e MF_INDEXABLE=1
  --staging               homologação: MF_STRICT_RELEASE=1, sem indexação
  --review                revisão (padrão quando o build.sh é chamado direto; deploy.sh prepare
                          exige um dos três modos explicitamente)
  --with-tests            roda os testes do backend e do frontend (recomendado em CI;
                          MINHAFOLGA_TEST_WORKERS limita os workers, padrão 2)
  --no-prune              mantém devDependencies do backend (somente revisão local)
  --skip-typecheck        pula a verificação de tipos (somente revisão; recusado com
                          --release/--staging e registrado em .minhafolga-build)
  --allow-dirty           aceita checkout git com alterações não registradas em --release
  --allow-root            permite execução como root (não recomendado)
  -h, --help              mostra esta ajuda

Sem --release/--staging o build é de revisão: marcadores de pendência visíveis e robots.txt
com "Disallow: /". O deploy.sh publish recusa build de revisão com NODE_ENV=production.

Temporários (npm, vite) ficam em <raiz>/var/tmp. O registro do build é gravado em
<origem>/.minhafolga-build (ignorado pelo git).
EOF
}

SOURCE="$(cd -- "$SCRIPT_DIR/.." && pwd)"
ENV_FILE=""
PUBLIC_CONFIG_IN=""
SITE_URL=""
MODE="review"
WITH_TESTS=0
PRUNE=1
ALLOW_DIRTY=0
ALLOW_ROOT=0
TYPECHECK=1
while (($#)); do
  case "$1" in
    --source) SOURCE="${2:-}"; shift 2 ;;
    --env-file) ENV_FILE="${2:-}"; shift 2 ;;
    --public-config) PUBLIC_CONFIG_IN="${2:-}"; shift 2 ;;
    --site-url) SITE_URL="${2:-}"; shift 2 ;;
    --release) MODE="release"; shift ;;
    --staging) MODE="staging"; shift ;;
    --review) MODE="review"; shift ;;
    --with-tests) WITH_TESTS=1; shift ;;
    --no-prune) PRUNE=0; shift ;;
    --allow-dirty) ALLOW_DIRTY=1; shift ;;
    --skip-typecheck) TYPECHECK=0; shift ;;
    --allow-root) ALLOW_ROOT=1; shift ;;
    -h | --help) usage; exit 0 ;;
    *) mf_die "opção desconhecida: $1 (use --help)" ;;
  esac
done

mf_require_not_root "$ALLOW_ROOT"
if [[ $TYPECHECK == 0 && "$MODE" != review ]]; then
  mf_die "--skip-typecheck só é aceito em build de revisão (sem --release/--staging)."
fi
mf_resolve_root initialized
mf_select_node
umask 027

[[ -d "$SOURCE" ]] || mf_die "diretório de origem inexistente: $SOURCE"
SOURCE="$(realpath -e -- "$SOURCE")"
for f in backend/package.json backend/package-lock.json frontend/package.json frontend/package-lock.json contracts/openapi.yaml; do
  [[ -f "$SOURCE/$f" ]] || mf_die "origem incompleta: falta $f em $SOURCE"
done
# Nunca construir dentro da release pública ativa.
if [[ -L "$MF_ROOT/current" ]] && [[ "$(realpath -e -- "$MF_ROOT/current")" == "$SOURCE" ]]; then
  mf_die "a origem é a release publicada (current). Construa em outra pasta (scripts/deploy.sh prepare)."
fi
if [[ "$MODE" == release && $ALLOW_DIRTY == 0 ]] && git -C "$SOURCE" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if [[ -n "$(git -C "$SOURCE" status --porcelain --untracked-files=normal 2>/dev/null)" ]]; then
    mf_die "checkout com alterações não registradas; um release público deve vir de um commit (use --allow-dirty só em revisão)."
  fi
fi

# Testes com poucos workers: o servidor é compartilhado com outros sites.
TEST_WORKERS="${MINHAFOLGA_TEST_WORKERS:-2}"
[[ "$TEST_WORKERS" =~ ^[1-9][0-9]*$ ]] || mf_die "MINHAFOLGA_TEST_WORKERS precisa ser um número >= 1."

NPM_CI_FLAGS=(ci --ignore-scripts)
# Scripts de instalação ficam desligados por padrão (nenhuma dependência atual precisa deles).
[[ "${MINHAFOLGA_NPM_SCRIPTS:-0}" == 1 ]] && NPM_CI_FLAGS=(ci)

mf_info "origem: $SOURCE"
mf_info "Node $MF_NODE_VERSION ($MF_NODE) · npm $MF_NPM_VERSION · modo: $MODE"
[[ "$MODE" == review ]] && mf_info "build de REVISÃO: pendências visíveis e noindex; não é publicável em produção."
START=$(date +%s)

mf_step "backend: instalação pelo lockfile"
cd -- "$SOURCE/backend"
mf_npm "${NPM_CI_FLAGS[@]}"
run_typecheck() {
  mf_step "$1: verificação de tipos"
  if [[ $TYPECHECK == 1 ]]; then
    mf_npm run typecheck
  else
    mf_warn "--skip-typecheck: verificação de tipos do $1 NÃO executada (build apenas para revisão)."
  fi
}
run_typecheck backend
if [[ $WITH_TESTS == 1 ]]; then
  mf_step "backend: testes"
  mf_npm test -- --maxWorkers="$TEST_WORKERS"
fi
mf_step "backend: compilação (antes de remover devDependencies)"
mf_npm run build
[[ -f dist/server.js && -f dist/cli/export-public-config.js && -f dist/cli/migrate.js ]] ||
  mf_die "build do backend incompleto (dist/server.js ou CLIs ausentes)."

mf_step "configuração pública do build"
GENERATED="$SOURCE/frontend/.generated"
mkdir -p -- "$GENERATED"
PUBLIC_CONFIG="$GENERATED/public-config.json"
if [[ -n "$PUBLIC_CONFIG_IN" ]]; then
  [[ -f "$PUBLIC_CONFIG_IN" ]] || mf_die "arquivo de configuração pública inexistente: $PUBLIC_CONFIG_IN"
  cp -- "$PUBLIC_CONFIG_IN" "$PUBLIC_CONFIG"
  mf_info "usando configuração pública informada: $PUBLIC_CONFIG_IN"
else
  [[ -n "$ENV_FILE" ]] || ENV_FILE="$(mf_env_file)"
  mf_check_env_file "$ENV_FILE"
  # A mesma validação da API: identidade incompleta em produção impede o release.
  "$MF_NODE" dist/cli/export-public-config.js --env-file "$ENV_FILE" --out "$PUBLIC_CONFIG" ||
    mf_die "exportação da configuração pública falhou (veja as chaves acima; nenhum valor é exibido)."
  mf_info "configuração pública exportada para $PUBLIC_CONFIG"
fi
read -r CFG_ENV CFG_SITE CFG_PHASE CFG_COMPLETE < <("$MF_NODE" -e '
  const c = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
  if (c.schemaVersion !== 1) { console.error("schemaVersion inesperado"); process.exit(1); }
  console.log([c.environment, c.siteUrl, c.credit && c.credit.phase, c.identity && c.identity.complete].join(" "));
' "$PUBLIC_CONFIG") || mf_die "configuração pública inválida: $PUBLIC_CONFIG"
SITE_URL="${SITE_URL:-$CFG_SITE}"
SITE_URL="${SITE_URL%/}"
mf_info "ambiente=$CFG_ENV site=$SITE_URL fase=$CFG_PHASE identidade_completa=$CFG_COMPLETE"
case "$MODE" in
  release)
    [[ "$CFG_ENV" == production ]] || mf_die "--release exige configuração pública de produção (NODE_ENV=production); recebido: $CFG_ENV"
    [[ "$SITE_URL" == https://* ]] || mf_die "--release exige VITE_SITE_URL com https://"
    STRICT=1 INDEXABLE=1
    ;;
  staging)
    [[ "$SITE_URL" == https://* ]] || mf_die "--staging exige VITE_SITE_URL com https://"
    STRICT=1 INDEXABLE=0
    ;;
  *) STRICT=0 INDEXABLE=0 ;;
esac

mf_step "frontend: instalação pelo lockfile"
cd -- "$SOURCE/frontend"
mf_npm "${NPM_CI_FLAGS[@]}"
run_typecheck frontend
if [[ $WITH_TESTS == 1 ]]; then
  mf_step "frontend: testes"
  mf_npm test -- --maxWorkers="$TEST_WORKERS"
fi
mf_step "frontend: pré-renderização (vite-ssg) e verificações do build"
mf_nice env -u MF_OUT_DIR npm_config_update_notifier=false \
  VITE_SITE_URL="$SITE_URL" \
  VITE_API_BASE_URL=/api \
  MF_PUBLIC_CONFIG_FILE="$PUBLIC_CONFIG" \
  MF_STRICT_RELEASE="$STRICT" \
  MF_INDEXABLE="$INDEXABLE" \
  "$MF_NPM" --cache "$MF_ROOT/.cache/npm" run build
for f in index.html 404.html admin.html robots.txt sitemap.xml; do
  [[ -f "dist/$f" ]] || mf_die "build do frontend incompleto: falta dist/$f"
done

if [[ $PRUNE == 1 ]]; then
  mf_step "backend: remoção das devDependencies (depois da compilação)"
  cd -- "$SOURCE/backend"
  mf_npm prune --omit=dev --ignore-scripts
  [[ ! -d node_modules/typescript ]] || mf_die "prune não removeu as devDependencies."
else
  mf_warn "--no-prune: devDependencies mantidas (não use este build em produção)."
fi

COMMIT="desconhecido"
if git -C "$SOURCE" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  COMMIT="$(git -C "$SOURCE" rev-parse --short=12 HEAD 2>/dev/null || echo desconhecido)"
fi
{
  echo "built_at=$(date -Iseconds)"
  echo "mode=$MODE"
  echo "node_version=$MF_NODE_VERSION"
  echo "node_path=$MF_NODE"
  echo "node_real=$MF_NODE_REAL"
  echo "npm_version=$MF_NPM_VERSION"
  echo "site_url=$SITE_URL"
  echo "public_config_environment=$CFG_ENV"
  echo "credit_phase=$CFG_PHASE"
  echo "typecheck=$([[ $TYPECHECK == 1 ]] && echo ok || echo pulada)"
  echo "tests=$WITH_TESTS"
  echo "pruned=$PRUNE"
  echo "commit=$COMMIT"
} >"$SOURCE/.minhafolga-build"
mf_info "build concluído em $(($(date +%s) - START)) s (registro em $SOURCE/.minhafolga-build)."
