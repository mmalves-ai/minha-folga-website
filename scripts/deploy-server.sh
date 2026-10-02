#!/usr/bin/env bash
# ==============================================================================
# Minha Folga - Script de Implantação e Publicação no Servidor
# ==============================================================================
# Este script:
# 1. Instala o runtime Node isolado (se necessário)
# 2. Compila Backend e Frontend (gera frontend/dist e backend/dist)
# 3. Executa as migrações do PostgreSQL
# 4. Inicia/recarrega o serviço no PM2 (minhafolga-api)
# 5. Obtém o certificado SSL Let's Encrypt (Certbot)
# 6. Configura e ativa o VirtualHost no Apache2
# 7. Executa testes de saúde (smoke test)
# ==============================================================================
set -euo pipefail

APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
ENV_FILE="$APP_DIR/backend/.env"

echo "================================================================="
echo "   Minha Folga - Iniciando Implantação em: $APP_DIR"
echo "================================================================="

# ------------------------------------------------------------------------------
# 0. Verificações Iniciais
# ------------------------------------------------------------------------------
if [[ $EUID -ne 0 ]]; then
  echo "Aviso: Este script precisa de permissão de root para configurar Apache e Certbot." >&2
  echo "Execute como root ou com: sudo $0" >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Erro: Arquivo $ENV_FILE não encontrado." >&2
  echo "Crie o arquivo .env no backend antes de rodar a implantação." >&2
  exit 2
fi

PORT=$(grep -E '^[[:space:]]*PORT=' "$ENV_FILE" | cut -d= -f2 | tr -d ' "[:space:]' || true)
if [[ -z "$PORT" || "$PORT" == *"<"* ]]; then
  PORT=3107
fi

# ------------------------------------------------------------------------------
# 1. Runtime Node Isolado
# ------------------------------------------------------------------------------
echo ">>> [1/7] Verificando runtime Node isolado..."
if [[ ! -x "$APP_DIR/scripts/node-runtime.sh" ]]; then
  chmod +x "$APP_DIR/scripts/node-runtime.sh"
fi

"$APP_DIR/scripts/node-runtime.sh" install
NODE_EXEC="$("$APP_DIR/scripts/node-runtime.sh" path)"
echo "Node pronto: $NODE_EXEC ($("$NODE_EXEC" -v))"

# ------------------------------------------------------------------------------
# 2. Build do Backend e Frontend
# ------------------------------------------------------------------------------
echo ">>> [2/7] Instalando dependências e compilando o Backend..."
(
  cd "$APP_DIR/backend"
  "$APP_DIR/scripts/node-runtime.sh" exec npm ci
  "$APP_DIR/scripts/node-runtime.sh" exec npm run build
)

echo ">>> [3/7] Instalando dependências e compilando o Frontend (SSG)..."
(
  cd "$APP_DIR/frontend"
  "$APP_DIR/scripts/node-runtime.sh" exec npm ci
  "$APP_DIR/scripts/node-runtime.sh" exec npm run build
)

# ------------------------------------------------------------------------------
# 3. Migrações do Banco de Dados
# ------------------------------------------------------------------------------
echo ">>> [4/7] Executando migrações do PostgreSQL..."
(
  cd "$APP_DIR/backend"
  MF_ENV_FILE="$ENV_FILE" "$APP_DIR/scripts/node-runtime.sh" exec npm run migrate
)

# ------------------------------------------------------------------------------
# 4. Gerenciamento do Processo no PM2
# ------------------------------------------------------------------------------
echo ">>> [5/7] Configurando serviço PM2 (minhafolga-api)..."
command -v pm2 >/dev/null 2>&1 || {
  echo "Instalando PM2..."
  npm install -g pm2
}

if pm2 describe minhafolga-api >/dev/null 2>&1; then
  echo "Reiniciando serviço minhafolga-api existente..."
  MF_ENV_FILE="$ENV_FILE" pm2 restart minhafolga-api --update-env
else
  echo "Iniciando novo processo minhafolga-api no PM2..."
  (
    cd "$APP_DIR/backend"
    MF_ENV_FILE="$ENV_FILE" pm2 start dist/server.js \
      --name "minhafolga-api" \
      --interpreter "$NODE_EXEC" \
      --cwd "$APP_DIR/backend" \
      --update-env \
      --max-memory-restart 384M \
      --time
  )
fi

# Aguarda 2 segundos e testa a API internamente
sleep 2
if curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
  echo "API respondendo localmente com sucesso na porta $PORT!"
else
  echo "Aviso: API demorou para responder na porta $PORT. Verifique com 'pm2 logs minhafolga-api'."
fi

# ------------------------------------------------------------------------------
# 5. Let's Encrypt / Certbot
# ------------------------------------------------------------------------------
echo ">>> [6/7] Verificando módulos do Apache e Certificado SSL..."
a2enmod ssl rewrite headers proxy proxy_http alias dir mime deflate >/dev/null 2>&1 || true

if ! command -v certbot >/dev/null 2>&1; then
  echo "Instalando Certbot e plugin Apache..."
  apt update && apt install -y certbot python3-certbot-apache
fi

if [[ ! -d "/etc/letsencrypt/live/minhafolga.com.br" ]]; then
  echo "Emitindo certificado SSL Let's Encrypt para minhafolga.com.br e www.minhafolga.com.br..."
  certbot certonly --apache \
    -d minhafolga.com.br \
    -d www.minhafolga.com.br \
    --non-interactive \
    --agree-tos \
    --register-unsafely-without-email
else
  echo "Certificado SSL existente em /etc/letsencrypt/live/minhafolga.com.br."
fi

# ------------------------------------------------------------------------------
# 6. VirtualHost do Apache2
# ------------------------------------------------------------------------------
echo ">>> [7/7] Configurando VirtualHost do Apache..."
mkdir -p /var/log/apache2/minhafolga
chmod 750 /var/log/apache2/minhafolga

VHOST_FILE="/etc/apache2/sites-available/minhafolga.conf"

cat <<EOF > "$VHOST_FILE"
# ==============================================================================
# Minha Folga - VirtualHost Apache 2.4
# Gerado automaticamente por scripts/deploy-server.sh
# ==============================================================================

# 1. Redirecionamento HTTP -> HTTPS no www
<VirtualHost *:80>
    ServerName minhafolga.com.br
    ServerAlias www.minhafolga.com.br

    ErrorLog  /var/log/apache2/minhafolga/error.log
    CustomLog /var/log/apache2/minhafolga/access.log combined
    ServerSignature Off

    # Adiciona DocumentRoot explícito para evitar cair no site default (/var/www/html)
    DocumentRoot "${APP_DIR}/frontend/dist"

    RewriteEngine On
    # Ignora o Let's Encrypt
    RewriteCond %{REQUEST_URI} !^/\.well-known/acme-challenge/
    # Redireciona tudo para HTTPS www
    RewriteRule ^(.*)$ https://www.minhafolga.com.br$1 [R=301,L]
</VirtualHost>

# 2. Domínio raiz HTTPS -> www (301)
<VirtualHost *:443>
    ServerName minhafolga.com.br

    SSLEngine on
    SSLCertificateFile    /etc/letsencrypt/live/minhafolga.com.br/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/minhafolga.com.br/privkey.pem

    ErrorLog  /var/log/apache2/minhafolga/error.log
    CustomLog /var/log/apache2/minhafolga/access.log combined
    ServerSignature Off

    Redirect permanent / https://www.minhafolga.com.br/
</VirtualHost>

# 3. VirtualHost Principal (HTTPS no www)
<VirtualHost *:443>
    ServerName www.minhafolga.com.br

    SSLEngine on
    SSLCertificateFile    /etc/letsencrypt/live/minhafolga.com.br/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/minhafolga.com.br/privkey.pem

    <IfModule mod_http2.c>
        Protocols h2 http/1.1
    </IfModule>

    ErrorLog  /var/log/apache2/minhafolga/error.log
    CustomLog /var/log/apache2/minhafolga/access.log combined
    ServerSignature Off

    DocumentRoot "${APP_DIR}/frontend/dist"
    AddDefaultCharset utf-8
    LimitRequestBody 32768

    # Bloqueia leitura direta de arquivos privados da aplicação
    <Directory "${APP_DIR}">
        Options None
        AllowOverride None
        Require all denied
    </Directory>

    # Libera exclusivamente o diretório dist público do frontend
    <Directory "${APP_DIR}/frontend/dist">
        Options SymLinksIfOwnerMatch
        AllowOverride None
        Require all granted
        DirectoryIndex index.html
        DirectorySlash Off

        Header always set Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' https://www.googletagmanager.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://www.googletagmanager.com https://www.google-analytics.com; font-src 'self'; connect-src 'self' https://www.google-analytics.com https://analytics.google.com https://stats.g.doubleclick.net; manifest-src 'self'; worker-src 'self'; frame-src 'none'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
        Header always set X-Content-Type-Options "nosniff"
        Header always set X-Frame-Options "DENY"
        Header always set Referrer-Policy "strict-origin-when-cross-origin"
        Header always set Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()"
        Header always set Cross-Origin-Opener-Policy "same-origin"
        Header always set Cache-Control "no-cache"
    </Directory>

    <Directory "${APP_DIR}/frontend/dist/assets">
        Header always set Cache-Control "public, max-age=31536000, immutable"
        Header always set Cross-Origin-Resource-Policy "same-origin"
    </Directory>

    <IfModule mod_deflate.c>
        AddOutputFilterByType DEFLATE text/html text/css text/plain text/xml application/xml application/javascript text/javascript image/svg+xml application/manifest+json
        SetEnvIf Request_URI "^/api(/|$)" no-gzip
    </IfModule>

    ErrorDocument 404 /404.html

    RewriteEngine On
    RewriteCond expr "%{HTTP:Content-Length} -gt 32768"
    RewriteRule "^/api(/|$)" - [R=413,L]
    RewriteRule "^/(api|__minhafolga)(/|$)" - [L]
    RewriteRule "(^|/)\." - [R=404,L]

    RewriteCond %{ENV:REDIRECT_STATUS} ^$
    RewriteCond %{THE_REQUEST} "^\S+\s[^?\s]*\.html[?\s]" [NC]
    RewriteRule "\.html$" - [R=404,L]
    RewriteRule "^/404$" - [R=404,L]
    RewriteRule "^/index$" - [R=404,L]

    # Rotas administrativas (SPA fallback)
    RewriteRule "^/admin/(painel|leads|leads/[A-Za-z0-9_-]{1,64}|atendimentos|atendimentos/[A-Za-z0-9_-]{1,64}|privacidade|auditoria|notificacoes|usuarios|conta)$" /admin.html [L]
    RewriteRule "^/([^/\\].*?)/+$" /$1 [R=301,L]
    RewriteRule "^/$" /index.html [L]

    # Rotas pré-renderizadas estáticas (/sobre -> sobre.html)
    RewriteCond %{DOCUMENT_ROOT}%{REQUEST_URI} !-f
    RewriteCond %{DOCUMENT_ROOT}%{REQUEST_URI}.html -f
    RewriteRule "^/(.+)$" /$1.html [L]

    RewriteCond %{DOCUMENT_ROOT}%{REQUEST_URI} -d
    RewriteRule "^/." - [R=404,L]

    # Proxy reverso para o backend Node
    ProxyRequests Off
    ProxyPreserveHost On
    ProxyPass        "/api/" "http://127.0.0.1:${PORT}/api/" connectiontimeout=5 timeout=30 retry=0
    ProxyPassReverse "/api/" "http://127.0.0.1:${PORT}/api/"
    ProxyPassMatch   "^/api$" "http://127.0.0.1:${PORT}/api" connectiontimeout=5 timeout=30 retry=0

    <LocationMatch "^/api(/|$)">
        RequestHeader unset X-Forwarded-For
        RequestHeader set X-Forwarded-Proto "https"
        ErrorDocument 413 /__minhafolga/erros/api-413.json
        ErrorDocument 502 /__minhafolga/erros/api-503.json
        ErrorDocument 503 /__minhafolga/erros/api-503.json
        ErrorDocument 504 /__minhafolga/erros/api-503.json
    </LocationMatch>

    Alias /__minhafolga/erros/ "${APP_DIR}/deploy/http-errors/"
    <Directory "${APP_DIR}/deploy/http-errors">
        Options None
        AllowOverride None
        Require all granted
        ForceType application/json
        Header always set Cache-Control "no-store"
        Header always set X-Content-Type-Options "nosniff"
    </Directory>
</VirtualHost>
EOF

a2ensite minhafolga.conf >/dev/null 2>&1 || true

echo "Validando sintaxe do Apache..."
apachectl configtest

echo "Recarregando Apache graciosamente..."
systemctl reload apache2

echo ""
echo "================================================================="
echo "   ✅ Implantação concluída com sucesso!"
echo "================================================================="
echo "Site público: https://www.minhafolga.com.br"
echo "Saúde da API: https://www.minhafolga.com.br/api/health"
echo "Status PM2:   pm2 status minhafolga-api"
echo "Logs PM2:     pm2 logs minhafolga-api"
echo "Logs Apache:  /var/log/apache2/minhafolga/"
echo "================================================================="
