#!/usr/bin/env bash
# ==============================================================================
# Script Padrão de Atualização
# ==============================================================================
# Uso: ./scripts/update.sh
# 
# Faz o download das alterações mais recentes do repositório (Git)
# e reinicia os serviços do Backend e Frontend de forma limpa.
# ==============================================================================
set -euo pipefail

APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
ENV_FILE="$APP_DIR/backend/.env"

echo "================================================================="
echo "   Atualizando o projeto em: $APP_DIR"
echo "================================================================="

cd "$APP_DIR"

echo ">>> [1/5] Baixando alterações do repositório (git)..."
# Reseta modificações locais indesejadas e puxa a versão principal
git fetch origin
git reset --hard origin/main

echo ">>> [2/5] Atualizando dependências e compilando o Backend..."
(
  cd backend
  ../scripts/node-runtime.sh exec npm install
  ../scripts/node-runtime.sh exec npm run build
)

echo ">>> [3/5] Atualizando dependências e compilando o Frontend..."
(
  cd frontend
  ../scripts/node-runtime.sh exec npm install
  ../scripts/node-runtime.sh exec npm run build
)

echo ">>> [4/5] Aplicando Migrações do Banco de Dados (se houver)..."
if [[ -f "$ENV_FILE" ]]; then
  (
    cd backend
    MF_ENV_FILE="$ENV_FILE" ../scripts/node-runtime.sh exec npm run migrate
  )
else
  echo "Aviso: Arquivo .env não encontrado. Pulando migrações."
fi

echo ">>> [5/5] Reiniciando serviço (PM2)..."
if command -v pm2 >/dev/null 2>&1; then
  MF_ENV_FILE="$ENV_FILE" pm2 restart minhafolga-api --update-env
else
  echo "Aviso: pm2 não está instalado neste ambiente."
fi

echo "================================================================="
echo " ✅ Atualização concluída com sucesso!"
echo "================================================================="
