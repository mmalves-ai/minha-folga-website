#!/usr/bin/env bash
# Frontend público para deploy-server.sh/update.sh: configuração real, SEO indexável e revisão estrita.
# Pré-requisitos: backend compilado, dependências frontend instaladas e backend/.env de produção.
# O build ocorre fora de dist; falhas de configuração, conteúdo ou compilação preservam o site atual.
set -euo pipefail

APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
ENV_FILE="$APP_DIR/backend/.env"
RUNTIME="$APP_DIR/scripts/node-runtime.sh"
EXPORT_CLI="$APP_DIR/backend/dist/cli/export-public-config.js"
DIST="$APP_DIR/frontend/dist"

[[ -f "$ENV_FILE" ]] || { echo "Erro: backend/.env de produção não encontrado." >&2; exit 1; }
[[ -f "$EXPORT_CLI" ]] || { echo "Erro: compile o backend antes do frontend público." >&2; exit 1; }
[[ ! -L "$DIST" ]] || { echo "Erro: dist é um link; use o fluxo de releases de scripts/deploy.sh." >&2; exit 1; }

mkdir -p "$APP_DIR/frontend/.generated"
WORK_DIR="$(mktemp -d "$APP_DIR/frontend/.generated/public-build.XXXXXX")"
PUBLIC_CONFIG="$WORK_DIR/public-config.json"
NEXT_DIST="$WORK_DIR/dist"
PREVIOUS_DIST="$WORK_DIR/previous-dist"
cleanup() {
  local code=$?
  if [[ -d "$PREVIOUS_DIST" && ! -e "$DIST" ]]; then
    if ! mv -- "$PREVIOUS_DIST" "$DIST"; then
      echo "Erro: restaure o build anterior preservado em $PREVIOUS_DIST." >&2
      return 1
    fi
  fi
  rm -rf -- "$WORK_DIR"
  return "$code"
}
trap cleanup EXIT

cd "$APP_DIR/backend"
"$RUNTIME" exec node "$EXPORT_CLI" --env-file "$ENV_FILE" --out "$PUBLIC_CONFIG"
SITE_URL="$("$RUNTIME" exec node --input-type=module - "$PUBLIC_CONFIG" <<'NODE'
import { readFileSync } from 'node:fs'
const config = JSON.parse(readFileSync(process.argv[2], 'utf8'))
if (config.schemaVersion !== 1 || config.environment !== 'production' || !config.identity?.complete) {
  console.error('Erro: o frontend público exige configuração de produção e identidade empresarial completa.')
  process.exit(1)
}
if (config.siteUrl !== 'https://www.minhafolga.com.br') {
  console.error('Erro: PUBLIC_SITE_URL deve ser https://www.minhafolga.com.br, igual ao domínio canônico do Apache.')
  process.exit(1)
}
process.stdout.write(config.siteUrl)
NODE
)"

cd "$APP_DIR/frontend"
"$RUNTIME" exec env \
  VITE_SITE_URL="$SITE_URL" \
  VITE_API_BASE_URL=/api \
  MF_PUBLIC_CONFIG_FILE="$PUBLIC_CONFIG" \
  MF_STRICT_RELEASE=1 \
  MF_INDEXABLE=1 \
  MF_OUT_DIR="$NEXT_DIST" \
  npm run build

for file in index.html 404.html admin.html robots.txt sitemap.xml; do
  [[ -f "$NEXT_DIST/$file" ]] || { echo "Erro: build público incompleto; falta $file." >&2; exit 1; }
done
if grep -Eq '^Disallow:[[:space:]]*/[[:space:]]*$' "$NEXT_DIST/robots.txt"; then
  echo "Erro: robots.txt ainda bloqueia o site inteiro; build não publicado." >&2
  exit 1
fi
grep -Fxq "Sitemap: $SITE_URL/sitemap.xml" "$NEXT_DIST/robots.txt" || {
  echo "Erro: robots.txt sem o sitemap canônico; build não publicado." >&2
  exit 1
}

[[ ! -d "$DIST" ]] || mv -- "$DIST" "$PREVIOUS_DIST"
mv -- "$NEXT_DIST" "$DIST"
echo "Frontend público validado em frontend/dist (indexação habilitada)."
