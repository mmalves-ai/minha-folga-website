#!/usr/bin/env bash
# ==============================================================================
# Minha Folga - Fix HTTP to HTTPS Redirect
# ==============================================================================
# Este script corrige a configuração do Apache no servidor para garantir 
# que o tráfego HTTP porta 80 não caia no site padrão.
# ==============================================================================
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Erro: Este script precisa ser executado como root." >&2
  exit 1
fi

VHOST_FILE="/etc/apache2/sites-available/minhafolga.conf"
APP_DIR="/var/www/html/minhafolga"

if [[ ! -f "$VHOST_FILE" ]]; then
  echo "Erro: Arquivo $VHOST_FILE não encontrado."
  exit 1
fi

echo "Fazendo backup do vhost..."
cp "$VHOST_FILE" "${VHOST_FILE}.bak_redirect"

echo "Aplicando nova configuração ao bloco *:80..."

# Removemos o bloco *:80 antigo inteiro e substituímos
sed -i '/<VirtualHost \*:80>/,/<\/VirtualHost>/c\
<VirtualHost *:80>\n\
    ServerName minhafolga.com.br\n\
    ServerAlias www.minhafolga.com.br\n\
\n\
    # Adiciona DocumentRoot explícito para evitar cair no site default (/var/www/html)\n\
    DocumentRoot "/var/www/html/minhafolga/frontend/dist"\n\
\n\
    ErrorLog  /var/log/apache2/minhafolga/error.log\n\
    CustomLog /var/log/apache2/minhafolga/access.log combined\n\
    ServerSignature Off\n\
\n\
    RewriteEngine On\n\
    # Ignora o Lets Encrypt\n\
    RewriteCond %{REQUEST_URI} !^/\\.well-known/acme-challenge/\n\
    # Redireciona tudo para HTTPS www\n\
    RewriteRule ^(.*)$ https://www.minhafolga.com.br$1 [R=301,L]\n\
</VirtualHost>' "$VHOST_FILE"

echo "Verificando módulos necessários..."
a2enmod rewrite >/dev/null 2>&1 || true

echo "Testando a sintaxe do Apache..."
if apachectl configtest; then
    echo "Recarregando Apache..."
    systemctl reload apache2
    echo "✅ Redirecionamento HTTP -> HTTPS corrigido com sucesso!"
else
    echo "❌ Erro de sintaxe no Apache. Restaurando backup..."
    mv "${VHOST_FILE}.bak_redirect" "$VHOST_FILE"
    systemctl reload apache2 || true
    exit 1
fi
