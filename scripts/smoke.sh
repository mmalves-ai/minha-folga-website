#!/usr/bin/env bash
# Smoke test público da Minha Folga (somente leitura: apenas requisições GET ao site informado).
# Confere o que a seção 13 exige do servidor web + API: páginas por acesso direto, 404 real, API sempre
# em JSON, bloqueio financeiro no servidor, fallback só nas rotas administrativas conhecidas, cabeçalhos,
# robots/sitemap, cookies e, no domínio www, raiz → www, HTTP → HTTPS e o vhost não virar o padrão de outros.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib.sh
source "$SCRIPT_DIR/lib.sh"

usage() {
  cat <<'EOF'
Uso: scripts/smoke.sh <url-base> [opções]

Exemplos:
  scripts/smoke.sh https://www.minhafolga.com.br
  scripts/smoke.sh https://www.minhafolga.com.br --resolve www.minhafolga.com.br:443:203.0.113.10
  scripts/smoke.sh https://homolog.minhafolga.com.br --auth-file ~/.minhafolga-homolog.auth --expect noindex

Opções:
  --resolve <host:porta:ip>  repassado ao curl (testar o vhost antes da troca de DNS); pode repetir. Com
                             o host www informado, o mesmo IP vale para o domínio raiz e para a porta HTTP
  --insecure                 aceita certificado não confiável (somente homologação)
  --auth-file <arquivo>      credencial "usuário:senha" do basic auth da homologação (arquivo 0600;
                             a senha não passa pela linha de comando)
  --phase <fase>             fase esperada: PRE_LAUNCH (padrão) exige 403 credit_phase_locked;
                             PILOT/LIVE exigem apenas negação em JSON sem autenticação
  --expect <modo>            indexable (produção) | noindex (homologação/revisão) | auto (padrão:
                             indexable quando a URL é https://www.minhafolga.com.br, senão só informa)
  --site-url <url>           URL canônica esperada no sitemap e nos canonicals (padrão: a URL-base se
                             for https, senão https://www.minhafolga.com.br)
  --require-hsts             falha sem Strict-Transport-Security no www, no domínio raiz e na API
                             (use depois de validar o domínio)
  --http-port <n>            porta HTTP dos testes de redirecionamento (padrão 80; útil em testes)
  --timeout <s>              tempo máximo por requisição (padrão 15)
  --allow-root               permite execução como root (não recomendado)
  -h, --help                 mostra esta ajuda

Código de saída: 0 sem falhas; 1 com qualquer falha (os avisos não reprovam).

Temporários: <raiz>/var/tmp quando MINHAFOLGA_APP_ROOT aponta para uma raiz inicializada; senão, TMPDIR.
EOF
}

BASE=""
RESOLVES=()
HTTP_PORT=80
INSECURE=0
AUTH_FILE=""
PHASE="PRE_LAUNCH"
EXPECT="auto"
SITE_URL=""
REQUIRE_HSTS=0
TIMEOUT=15
ALLOW_ROOT=0
while (($#)); do
  case "$1" in
    --resolve) RESOLVES+=("${2:-}"); shift 2 ;;
    --http-port) HTTP_PORT="${2:-}"; shift 2 ;;
    --insecure) INSECURE=1; shift ;;
    --auth-file) AUTH_FILE="${2:-}"; shift 2 ;;
    --phase) PHASE="${2:-}"; shift 2 ;;
    --expect) EXPECT="${2:-}"; shift 2 ;;
    --site-url) SITE_URL="${2:-}"; shift 2 ;;
    --require-hsts) REQUIRE_HSTS=1; shift ;;
    --timeout) TIMEOUT="${2:-}"; shift 2 ;;
    --allow-root) ALLOW_ROOT=1; shift ;;
    -h | --help) usage; exit 0 ;;
    -*) mf_die "opção desconhecida: $1 (use --help)" ;;
    *)
      [[ -z "$BASE" ]] || mf_die "informe apenas uma URL-base."
      BASE="$1"; shift
      ;;
  esac
done

mf_require_not_root "$ALLOW_ROOT"
[[ -n "$BASE" ]] || { usage; exit 1; }
[[ "$BASE" =~ ^https?://[A-Za-z0-9.-]+(:[0-9]+)?/?$ ]] || mf_die "URL-base inválida: $BASE (use só esquema, host e porta, ex.: https://www.minhafolga.com.br)."
BASE="${BASE%/}"
case "$PHASE" in PRE_LAUNCH | PILOT | LIVE) ;; *) mf_die "--phase inválida: $PHASE" ;; esac
case "$EXPECT" in indexable | noindex | auto) ;; *) mf_die "--expect inválido: $EXPECT" ;; esac
[[ "$TIMEOUT" =~ ^[0-9]+$ ]] || mf_die "--timeout precisa ser número de segundos."
[[ "$HTTP_PORT" =~ ^[0-9]+$ ]] || mf_die "--http-port precisa ser número."
RESOLVE_RE='^[A-Za-z0-9.-]+:[0-9]+:[][0-9A-Fa-f.:]+$'
for r in "${RESOLVES[@]+"${RESOLVES[@]}"}"; do
  [[ "$r" =~ $RESOLVE_RE ]] || mf_die "--resolve inválido: $r (use host:porta:ip)."
done
BASE_SCHEME="${BASE%%://*}"
BASE_HOSTPORT="${BASE#*://}"
BASE_HOST="${BASE_HOSTPORT%%:*}"
BASE_PORT="${BASE_HOSTPORT#"$BASE_HOST"}"
BASE_PORT="${BASE_PORT#:}"
[[ -n "$BASE_PORT" ]] || { [[ "$BASE_SCHEME" == https ]] && BASE_PORT=443 || BASE_PORT=80; }
# Domínio raiz e porta HTTP resolvidos para o mesmo IP informado para o www (testes antes da troca de DNS).
if [[ "$BASE_HOST" == www.* ]]; then
  APEX_HOST="${BASE_HOST#www.}"
  for r in "${RESOLVES[@]+"${RESOLVES[@]}"}"; do
    if [[ "$r" == "$BASE_HOST:$BASE_PORT:"* ]]; then
      ip="${r#"$BASE_HOST:$BASE_PORT:"}"
      for extra in "$APEX_HOST:$BASE_PORT:$ip" "$BASE_HOST:$HTTP_PORT:$ip" "$APEX_HOST:$HTTP_PORT:$ip"; do
        known=0
        for q in "${RESOLVES[@]}"; do [[ "${q%:*}" == "${extra%:*}" ]] && known=1; done
        ((known == 1)) || RESOLVES+=("$extra")
      done
      break
    fi
  done
fi
# Temporários na raiz da aplicação quando ela está inicializada (o /tmp é compartilhado).
if [[ -n "${MINHAFOLGA_APP_ROOT:-}" ]] && (mf_resolve_root initialized >/dev/null 2>&1); then
  mf_resolve_root initialized >/dev/null
fi
command -v curl >/dev/null 2>&1 || mf_die "curl é necessário."
if [[ -z "$SITE_URL" ]]; then
  if [[ "$BASE" == https://* ]]; then SITE_URL="$BASE"; else SITE_URL="https://www.minhafolga.com.br"; fi
fi
SITE_URL="${SITE_URL%/}"
if [[ "$EXPECT" == auto && "$BASE" == https://www.minhafolga.com.br ]]; then EXPECT=indexable; fi

# Sem TMPDIR da raiz da aplicação, o temporário fica no próprio checkout (nunca no /tmp compartilhado).
if [[ -z "${TMPDIR:-}" ]]; then mkdir -p "$(dirname -- "${BASH_SOURCE[0]}")/../.tmp"; TMPDIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.tmp" && pwd)"; fi
WORK="$(mktemp -d "$TMPDIR/minhafolga-smoke.XXXXXX")"
cleanup() {
  # Remove só os arquivos que este script criou no diretório temporário próprio.
  find "$WORK" -mindepth 1 -maxdepth 1 -type f -delete 2>/dev/null || true
  rmdir -- "$WORK" 2>/dev/null || true
}
trap cleanup EXIT

CURL=(curl -sS --max-time "$TIMEOUT" --proto '=http,https' -H 'User-Agent: minhafolga-smoke/1')
for r in "${RESOLVES[@]+"${RESOLVES[@]}"}"; do CURL+=(--resolve "$r"); done
[[ $INSECURE == 1 ]] && CURL+=(--insecure)
# Sem credencial: usado nos pedidos com Host de OUTRO domínio (a senha da homologação nunca vai para outro vhost).
CURL_NOAUTH=("${CURL[@]}")
if [[ -n "$AUTH_FILE" ]]; then
  [[ -f "$AUTH_FILE" ]] || mf_die "arquivo de credencial inexistente: $AUTH_FILE"
  mode="$(stat -c %a "$AUTH_FILE")"
  (((8#$mode & 8#077) == 0)) || mf_die "$AUTH_FILE precisa de permissão 600."
  # Credencial vai para um arquivo de configuração do curl (0600), nunca para a linha de comando.
  umask 077
  cred="$(head -n 1 -- "$AUTH_FILE")"
  [[ "$cred" == *:* ]] || mf_die "$AUTH_FILE deve conter uma linha usuário:senha."
  cred="${cred//\\/\\\\}"
  printf 'user = "%s"\n' "${cred//\"/\\\"}" >"$WORK/curlrc"
  unset cred
  CURL+=(-K "$WORK/curlrc")
fi

PASS=0 FAIL=0 WARN=0
ok() { PASS=$((PASS + 1)); printf '  OK     %s\n' "$*"; }
fail() { FAIL=$((FAIL + 1)); printf '  FALHA  %s\n' "$*"; }
warn() { WARN=$((WARN + 1)); printf '  AVISO  %s\n' "$*"; }
group() { printf '\n[%s]\n' "$*"; }

# GET sem seguir redirecionamentos. Define CODE, CTYPE e deixa corpo/cabeçalhos em $WORK.
COOKIE_LOG="$WORK/cookies"
: >"$COOKIE_LOG"
fetch() { fetch_url "$BASE$1" "$1"; }
# $1 URL completa; $2 rótulo (caminho) para o registro de cookies; demais: opções extras do curl.
# MF_SMOKE_LOG_COOKIES=0 no chamador: não registra cookies (respostas que não são da Minha Folga, ex.: o servidor
# padrão de outro dono na sonda de "outro domínio").
fetch_url() {
  local url="$1" label="${2:-$1}"
  shift 2 || shift $#
  : >"$WORK/body"
  : >"$WORK/headers"
  CODE="$("${CURL[@]}" "$@" -o "$WORK/body" -D "$WORK/headers" -w '%{http_code}' -- "$url" 2>"$WORK/err")" || CODE="000"
  CTYPE="$(header content-type)"
  local c
  [[ "${MF_SMOKE_LOG_COOKIES:-1}" == 0 ]] && return 0
  while IFS= read -r c; do
    [[ -n "$c" ]] && printf '%s\t%s\n' "$label" "$c" >>"$COOKIE_LOG"
  done < <(grep -i '^set-cookie:' "$WORK/headers" | cut -d: -f2- | sed 's/^ *//; s/\r$//' || true)
}
header() { grep -i "^$1:" "$WORK/headers" | tail -n 1 | cut -d: -f2- | sed 's/^ *//; s/\r$//' || true; }
header_count() { grep -ci "^$1:" "$WORK/headers" || true; }
body_has() { grep -qE -- "$1" "$WORK/body"; }
title_of_body() { grep -oE '<title>[^<]*</title>' "$WORK/body" | head -n 1 | sed -E 's#</?title>##g' || true; }
curl_error() { sed -n '1p' "$WORK/err"; }

# Rotas pré-renderizadas: lidas do manifesto do código quando disponível (mesma fonte do build).
MANIFEST="$SCRIPT_DIR/../frontend/src/router/manifest.ts"
PUBLIC_PAGES=() PRIVATE_PAGES=()
if [[ -f "$MANIFEST" ]]; then
  while IFS=' ' read -r p idx; do
    [[ "$p" == /404 || "$p" == /admin ]] && continue
    if [[ "$idx" == true ]]; then PUBLIC_PAGES+=("$p"); else PRIVATE_PAGES+=("$p"); fi
  done < <(sed -nE "s/.*\{ path: '([^']+)', indexable: (true|false), prerender: true \}.*/\1 \2/p" "$MANIFEST")
fi
if ((${#PUBLIC_PAGES[@]} == 0)); then
  PUBLIC_PAGES=(/ /sobre /solucoes /consignado-privado /como-funciona /bia /conteudos /ajuda /atendimento /seguranca
    /avise-me /lancamento /privacidade /termos /cookies)
  PRIVATE_PAGES=(/cadastro-confirmado /preferencias /atendimento/acompanhar)
fi

echo "Smoke test Minha Folga: $BASE (fase esperada: $PHASE; indexação: $EXPECT)"

# ------------------------------------------------------------------ 404 real (referência para as demais)
group "URL inexistente"
NF_TITLE=""
fetch "/mf-smoke-inexistente-$$"
if [[ "$CODE" == 000 ]]; then
  fail "sem resposta de $BASE ($(curl_error))"
  printf '\nResultado: site inacessível; nada mais foi verificado.\n'
  exit 1
fi
if [[ "$CODE" == 404 && "$CTYPE" == text/html* ]] && body_has '<h1[ >]'; then
  NF_TITLE="$(title_of_body)"
  ok "404 com a página de erro em HTML (título: ${NF_TITLE:-sem título})"
else
  fail "URL inexistente respondeu $CODE ($CTYPE); esperado 404 com 404.html"
fi
cp -- "$WORK/body" "$WORK/notfound.html"
# Mesma página 404 do site (título e CSP) também para *.html direto, /404 e o alias /index.
for probe in /conteudos/mf-smoke-inexistente /404 /404.html /index.html /sobre.html /index; do
  fetch "$probe"
  if [[ "$CODE" != 404 ]]; then
    fail "$probe respondeu $CODE; esperado 404 (URL canônica é sem .html; /index não é alias da home)"
  elif [[ -n "$NF_TITLE" && "$(title_of_body)" != "$NF_TITLE" ]]; then
    fail "$probe → 404 sem a página de erro do site (título: $(title_of_body || true); Content-Type: $CTYPE)"
  elif [[ -z "$(header content-security-policy)" ]]; then
    fail "$probe → 404 sem Content-Security-Policy (página de erro padrão do servidor?)"
  else
    ok "$probe → 404 com a página do site"
  fi
done
fetch "/sobre/"
if [[ "$CODE" == 301 || "$CODE" == 308 ]]; then
  loc="$(header location)"
  if [[ "$loc" =~ ^(https?://[^/]+)?/sobre$ ]]; then ok "/sobre/ → $CODE para /sobre"; else fail "/sobre/ redireciona para destino inesperado: $loc"; fi
elif [[ "$CODE" == 404 ]]; then
  warn "/sobre/ → 404 (aceitável; o padrão documentado é 301 para /sobre)"
else
  fail "/sobre/ respondeu $CODE (conteúdo duplicado ou erro); esperado 301 para /sobre ou 404"
fi

# ------------------------------------------------------------------ páginas públicas por acesso direto
group "Páginas por acesso direto (200, HTML próprio com H1)"
HOME_TITLE=""
check_page() {
  local p="$1" private="$2" title canonical cpath
  fetch "$p"
  if [[ "$CODE" != 200 ]]; then fail "$p respondeu $CODE"; return; fi
  [[ "$CTYPE" == text/html* ]] || { fail "$p com Content-Type inesperado: $CTYPE"; return; }
  if ! body_has '<h1[ >]'; then fail "$p sem <h1> no HTML (conteúdo não pré-renderizado?)"; return; fi
  title="$(title_of_body)"
  if [[ -z "$title" ]]; then fail "$p sem <title>"; return; fi
  if [[ -n "$NF_TITLE" && "$title" == "$NF_TITLE" ]]; then fail "$p serviu a página 404 com status 200"; return; fi
  canonical="$(grep -oE '<link rel="canonical" href="[^"]+"' "$WORK/body" | head -n 1 | sed -E 's/.*href="([^"]+)"/\1/' || true)"
  if [[ -n "$canonical" ]]; then
    cpath="$(sed -E 's#^https?://[^/]+##' <<<"$canonical")"
    [[ -n "$cpath" ]] || cpath=/
    if [[ "$cpath" != "$p" ]]; then fail "$p entregou o HTML de outra rota (canonical $canonical)"; return; fi
    if [[ "$canonical" != "$SITE_URL"* ]]; then warn "$p com canonical fora de $SITE_URL: $canonical"; fi
  elif [[ "$private" == 0 ]]; then
    warn "$p sem canonical"
  fi
  if [[ "$private" == 1 ]] && ! body_has '<meta name="robots" content="noindex'; then
    fail "$p (rota privada) sem noindex"
    return
  fi
  [[ "$p" == / ]] && HOME_TITLE="$title"
  ok "$p — $title"
}
for p in "${PUBLIC_PAGES[@]}"; do check_page "$p" 0; done
for p in "${PRIVATE_PAGES[@]}"; do check_page "$p" 1; done

# ------------------------------------------------------------------ cabeçalhos do site
group "Cabeçalhos de segurança do site"
fetch "/"
csp="$(header content-security-policy)"
if [[ -z "$csp" ]]; then
  fail "Content-Security-Policy ausente"
else
  (($(header_count content-security-policy) == 1)) || warn "mais de um Content-Security-Policy na resposta (todos se aplicam)"
  missing=""
  for d in "default-src 'self'" "script-src 'self'" "frame-ancestors 'none'" "base-uri 'self'" "form-action 'self'" "object-src 'none'"; do
    [[ "$csp" == *"$d"* ]] || missing+=" [$d]"
  done
  if [[ -n "$missing" ]]; then fail "CSP sem as diretivas:$missing"; else ok "CSP com as diretivas essenciais"; fi
  script_src="$(tr ';' '\n' <<<"$csp" | grep -E "^ *script-src " || true)"
  if [[ "$script_src" == *unsafe-inline* || "$script_src" == *unsafe-eval* ]]; then fail "script-src permite unsafe-inline/unsafe-eval"; else ok "script-src sem unsafe-inline/unsafe-eval"; fi
fi
[[ "$(header x-content-type-options)" == nosniff ]] && ok "X-Content-Type-Options: nosniff" || fail "X-Content-Type-Options ausente"
[[ -n "$(header referrer-policy)" ]] && ok "Referrer-Policy: $(header referrer-policy)" || fail "Referrer-Policy ausente"
[[ -n "$(header permissions-policy)" ]] && ok "Permissions-Policy presente" || fail "Permissions-Policy ausente"
cache="$(header cache-control)"
[[ "$cache" == *no-cache* || "$cache" == *max-age=0* || "$cache" == *no-store* ]] && ok "HTML sem cache longo (Cache-Control: $cache)" || fail "HTML com Cache-Control inadequado: ${cache:-ausente}"
server_h="$(header server)"
[[ "$server_h" =~ [0-9]+\.[0-9]+ ]] && warn "cabeçalho Server revela versão ($server_h); use server_tokens off / ServerTokens Prod"
if [[ "$BASE" == https://* ]]; then
  hsts="$(header strict-transport-security)"
  if [[ -n "$hsts" ]]; then
    ok "HSTS: $hsts"
  elif [[ $REQUIRE_HSTS == 1 ]]; then
    fail "Strict-Transport-Security ausente (--require-hsts)"
  else
    warn "HSTS ainda não habilitado (ative após validar o domínio; docs/DEPLOY_SHARED_SERVER.md)"
  fi
fi
fetch "/mf-smoke-inexistente-$$"
[[ -n "$(header content-security-policy)" ]] && ok "página 404 também com CSP" || fail "página 404 sem Content-Security-Policy"

# ------------------------------------------------------------------ domínio: raiz → www, HTTP → HTTPS, vhost padrão
group "Domínio (redirecionamentos e vhost padrão)"
HP_SUFFIX=""
[[ "$HTTP_PORT" == 80 ]] || HP_SUFFIX=":$HTTP_PORT"
P_SUFFIX=""
[[ "$BASE_PORT" == 443 ]] || P_SUFFIX=":$BASE_PORT"
if [[ "$BASE_SCHEME" == https && "$BASE_HOST" == www.* ]]; then
  probe_path="/mf-smoke/dominio?origem=smoke&x=1"
  want="https://$BASE_HOST$probe_path"
  for u in "http://$BASE_HOST$HP_SUFFIX$probe_path" "http://$APEX_HOST$HP_SUFFIX$probe_path" "https://$APEX_HOST$P_SUFFIX$probe_path"; do
    fetch_url "$u" "$u"
    loc="$(header location)"
    if [[ "$CODE" =~ ^(301|308)$ && "$loc" == "$want" ]]; then
      ok "$u → $CODE $loc"
    else
      fail "$u respondeu $CODE (Location: ${loc:-ausente}); esperado 301 para $want (caminho e query preservados)"
    fi
    if [[ "$u" == https://* ]]; then
      hsts="$(header strict-transport-security)"
      if [[ -n "$hsts" ]]; then ok "domínio raiz em HTTPS com HSTS: $hsts"
      elif [[ $REQUIRE_HSTS == 1 ]]; then fail "domínio raiz em HTTPS sem Strict-Transport-Security (--require-hsts)"
      else warn "domínio raiz em HTTPS sem HSTS (habilite junto com o www, após validar)"; fi
    fi
  done
  # Redirecionamento aberto: o destino continua no próprio domínio.
  for u in "http://$APEX_HOST$HP_SUFFIX//mf-smoke.invalid/x" "https://$APEX_HOST$P_SUFFIX//mf-smoke.invalid/x" "$BASE//mf-smoke.invalid/"; do
    fetch_url "$u" "$u"
    loc="$(header location)"
    # Destino aceito: sem Location, caminho relativo que não começa por "//" ou URL absoluta no próprio host www.
    loc_host="$(sed -nE 's#^[A-Za-z]+://([^/:?#]+).*#\1#p' <<<"$loc")"
    if [[ -z "$loc" || "$loc_host" == "$BASE_HOST" ]] || [[ -z "$loc_host" && "$loc" =~ ^/[^/\\] ]]; then
      ok "sem redirecionamento aberto: $u → $CODE ${loc:-(sem Location)}"
    else
      fail "redirecionamento aberto: $u → $loc"
    fi
  done
else
  echo "  (não se aplica a $BASE: os testes de raiz → www valem para a URL https://www.<domínio>)"
fi
# O vhost da Minha Folga não pode virar o servidor padrão do endereço:porta (pedidos de OUTROS domínios).
if [[ ! "$BASE_HOST" =~ ^[0-9.]+$ && "$BASE_HOST" != localhost && "$BASE_HOST" == *.* ]]; then
  other="mf-smoke-outro-site.invalid"
  schemes=("$BASE_SCHEME:$BASE_PORT")
  [[ "$BASE_SCHEME" == https ]] && schemes+=("http:$HTTP_PORT")
  for sp in "${schemes[@]}"; do
    sch="${sp%%:*}" pt="${sp##*:}"
    # Conecta no mesmo servidor do site, mas com Host/SNI de outro domínio, sem credencial; -k: o certificado
    # não é o foco.
    CURL_SAVED=("${CURL[@]}")
    CURL=("${CURL_NOAUTH[@]}")
    # A resposta é do servidor padrão da hospedagem (outro dono): cookies dele não entram na checagem de cookies.
    MF_SMOKE_LOG_COOKIES=0 fetch_url "$sch://$other:$pt/" "$sch://$other/" --connect-to "$other:$pt:$BASE_HOST:$pt" -k
    CURL=("${CURL_SAVED[@]}")
    loc="$(header location)"
    auth="$(header www-authenticate)"
    if [[ "$CODE" == 000 ]]; then
      ok "$sch://$other (mesmo servidor) → sem resposta do vhost da Minha Folga ($(curl_error))"
    elif [[ "$loc" == *minhafolga* || "$auth" == *"Minha Folga"* ]] || body_has '<title>[^<]*Minha Folga'; then
      fail "$sch porta $pt: pedido para outro domínio foi atendido pelo vhost da Minha Folga (Location: ${loc:-—}); ele virou o servidor padrão — o administrador precisa carregá-lo depois do padrão existente (docs/DEPLOY_SHARED_SERVER.md, 5.6)"
    else
      ok "$sch porta $pt: outro domínio não cai no vhost da Minha Folga ($CODE)"
    fi
  done
fi

group "Assets e arquivos auxiliares"
asset="$(grep -oE '/assets/[A-Za-z0-9._-]+\.js' "$WORK/notfound.html" | head -n 1 || true)"
if [[ -n "$asset" ]]; then
  fetch "$asset"
  cache="$(header cache-control)"
  if [[ "$CODE" == 200 && "$cache" == *immutable* && "$cache" == *max-age=* ]]; then ok "$asset com cache longo imutável"; else fail "$asset: status $CODE, Cache-Control: ${cache:-ausente}"; fi
  [[ "$(header x-content-type-options)" == nosniff ]] && ok "assets com nosniff" || fail "assets sem X-Content-Type-Options: nosniff"
  [[ "$CTYPE" == *javascript* ]] && ok "JavaScript com Content-Type $CTYPE" || fail "JavaScript servido como ${CTYPE:-sem tipo}"
else
  warn "nenhum asset com hash encontrado no HTML para conferir o cache"
fi
for f in /favicon.svg /favicon-32.png /apple-touch-icon.png /brand/og-minha-folga.png; do
  fetch "$f"
  [[ "$CODE" == 200 ]] && ok "$f" || fail "$f respondeu $CODE"
done

group "Arquivos que nunca podem ser públicos"
for f in /.env /.minhafolga-release /.vite/ssr-manifest.json /.git/config /backend/package.json /config/.env.production \
  /frontend/dist/index.html /current/backend/dist/server.js /node_modules/vue/package.json; do
  fetch "$f"
  if [[ "$CODE" == 200 ]]; then fail "$f está exposto (200) — document root precisa ser current/frontend/dist"; else ok "$f → $CODE"; fi
done

# ------------------------------------------------------------------ fallback somente da área interativa
group "Área administrativa"
fetch "/admin"
admin_ok=0
if [[ "$CODE" == 200 ]] && body_has '<meta name="robots" content="noindex'; then
  cp -- "$WORK/body" "$WORK/admin.html"
  admin_ok=1
  ok "/admin → 200 com noindex"
else
  fail "/admin respondeu $CODE ou sem noindex"
fi
# Rotas administrativas conhecidas (lidas do roteador, mesma fonte do build): fallback admin.html com 200.
ROUTES_TS="$SCRIPT_DIR/../frontend/src/router/routes.ts"
ADMIN_ROUTES=()
if [[ -f "$ROUTES_TS" ]]; then
  while IFS= read -r r; do
    [[ -n "$r" ]] && ADMIN_ROUTES+=("/admin/${r//:id/00000000-0000-4000-8000-000000000000}")
  done < <(awk "/path: '\/admin',/ { inside = 1; next } inside && /^[[:space:]]*\],/ { inside = 0 } inside" "$ROUTES_TS" |
    sed -nE "s/.*\{ path: '([^']+)'.*/\1/p")
fi
if ((${#ADMIN_ROUTES[@]} == 0)); then
  ADMIN_ROUTES=(/admin/painel /admin/leads /admin/leads/00000000-0000-4000-8000-000000000000 /admin/atendimentos
    /admin/atendimentos/00000000-0000-4000-8000-000000000000 /admin/privacidade /admin/auditoria /admin/notificacoes /admin/usuarios /admin/conta)
fi
admin_bad=""
for r in "${ADMIN_ROUTES[@]}"; do
  fetch "$r"
  if [[ "$CODE" != 200 || $admin_ok != 1 ]] || ! cmp -s "$WORK/body" "$WORK/admin.html"; then admin_bad+=" $r($CODE)"; fi
done
if [[ -z "$admin_bad" ]]; then
  ok "${#ADMIN_ROUTES[@]} rotas administrativas conhecidas → admin.html"
else
  fail "rotas administrativas sem o admin.html:$admin_bad (o vhost precisa listar as rotas de frontend/src/router/routes.ts)"
fi
for r in /admin/mf-smoke/qualquer /admin/leads/mf-smoke/extra /mf-smoke/admin/qualquer; do
  fetch "$r"
  [[ "$CODE" == 404 ]] && ok "$r → 404 (fallback só nas rotas conhecidas)" || fail "$r respondeu $CODE; esperado 404 (soft-404)"
done

# ------------------------------------------------------------------ API
group "API"
fetch "/api/health"
if [[ "$CODE" == 200 && "$CTYPE" == application/json* ]] && body_has '"status":"ok"'; then
  ok "/api/health → 200 JSON {\"status\":\"ok\"}"
  [[ "$(header cache-control)" == *no-store* ]] && ok "/api/health com Cache-Control: no-store" || warn "/api/health sem no-store"
  [[ "$(header x-content-type-options)" == nosniff ]] && ok "API com nosniff" || fail "API sem X-Content-Type-Options: nosniff"
  (($(header_count x-content-type-options) <= 1)) || warn "X-Content-Type-Options duplicado na API (proxy e API definindo o mesmo cabeçalho)"
  if [[ "$BASE" == https://* ]]; then
    if [[ -n "$(header strict-transport-security)" ]]; then ok "API com HSTS"
    elif [[ $REQUIRE_HSTS == 1 ]]; then fail "API sem Strict-Transport-Security (--require-hsts)"
    else warn "API sem HSTS (habilite junto com o site, após validar o domínio)"; fi
  fi
else
  fail "/api/health respondeu $CODE ($CTYPE): $(head -c 120 "$WORK/body")"
fi
for p in /api/mf-smoke-rota-inexistente /api/conteudos/mf-smoke /api; do
  fetch "$p"
  if [[ "$CODE" == 404 && "$CTYPE" == application/json* ]] && ! body_has '<html|<!DOCTYPE|<!doctype'; then
    ok "$p → 404 JSON"
  else
    fail "$p respondeu $CODE ($CTYPE); esperado 404 em JSON, nunca HTML"
  fi
done
fetch "/api/admin/leads"
if [[ "$CODE" =~ ^(401|403)$ && "$CTYPE" == application/json* ]]; then
  ok "/api/admin/leads sem sessão → $CODE JSON"
else
  fail "/api/admin/leads sem sessão respondeu $CODE ($CTYPE); esperado 401/403 em JSON"
fi
fetch "/api/credit/proposals"
if [[ "$PHASE" == PRE_LAUNCH ]]; then
  if [[ "$CODE" == 403 && "$CTYPE" == application/json* ]] && body_has '"code":"credit_phase_locked"'; then
    ok "/api/credit/proposals → 403 credit_phase_locked"
  else
    fail "/api/credit/proposals respondeu $CODE: $(head -c 160 "$WORK/body")"
  fi
else
  if [[ "$CODE" =~ ^(401|403|503)$ && "$CTYPE" == application/json* ]]; then
    ok "/api/credit/proposals sem autorização → $CODE JSON"
  else
    fail "/api/credit/proposals sem autorização respondeu $CODE ($CTYPE)"
  fi
fi
fetch "/api/public-config"
if [[ "$CODE" == 200 && "$CTYPE" == application/json* ]]; then
  if body_has 'SECRET|API_KEY|INBOUND|hal_[a-z]+_[A-Za-z0-9]+_|DATABASE_URL|postgres(ql)?://|CONTACT_ENCRYPTION|READINESS'; then
    fail "/api/public-config contém nome ou valor de segredo"
  else
    ok "/api/public-config sem segredos"
  fi
  phase_seen="$(grep -oE '"phase": ?"[A-Z_]+"' "$WORK/body" | head -n 1 | grep -oE '[A-Z_]+"$' | tr -d '"' || true)"
  [[ -z "$phase_seen" || "$phase_seen" == "$PHASE" ]] || fail "API em fase $phase_seen; esperado $PHASE"
else
  fail "/api/public-config respondeu $CODE ($CTYPE)"
fi
fetch "/api/internal/ready"
[[ "$CODE" == 404 && "$CTYPE" == application/json* ]] && ok "prontidão interna oculta sem token (404 JSON)" || fail "/api/internal/ready sem token respondeu $CODE"

# ------------------------------------------------------------------ robots e sitemap
group "robots.txt e sitemap.xml"
fetch "/robots.txt"
if [[ "$CODE" == 200 && "$CTYPE" == text/plain* ]]; then
  mode="indexable"
  grep -qxE 'Disallow: /[[:space:]]*' "$WORK/body" && mode="noindex"
  ok "robots.txt ($mode)"
  if [[ "$EXPECT" != auto && "$mode" != "$EXPECT" ]]; then fail "robots.txt em modo $mode; esperado $EXPECT"; fi
  if [[ "$mode" == indexable ]]; then
    grep -q "^Sitemap: $SITE_URL/sitemap.xml" "$WORK/body" && ok "robots.txt aponta o sitemap" || fail "robots.txt sem 'Sitemap: $SITE_URL/sitemap.xml'"
    for p in /admin /preferencias /cadastro-confirmado; do
      grep -qx "Disallow: $p" "$WORK/body" || fail "robots.txt sem Disallow: $p"
    done
  elif [[ "$EXPECT" == auto ]]; then
    warn "build sem indexação (esperado em homologação; produção usa build.sh --release)"
  fi
else
  fail "/robots.txt respondeu $CODE ($CTYPE)"
fi
fetch "/sitemap.xml"
SITEMAP_PATHS=()
if [[ "$CODE" == 200 && "$CTYPE" == *xml* ]] && body_has '<urlset'; then
  while IFS= read -r loc; do
    [[ "$loc" == "$SITE_URL"/* || "$loc" == "$SITE_URL" ]] || fail "sitemap com URL fora de $SITE_URL: $loc"
    path="$(sed -E 's#^https?://[^/]+##' <<<"$loc")"
    SITEMAP_PATHS+=("${path:-/}")
  done < <(grep -oE '<loc>[^<]+</loc>' "$WORK/body" | sed -E 's#</?loc>##g')
  ok "sitemap.xml com ${#SITEMAP_PATHS[@]} URLs"
  for p in "${SITEMAP_PATHS[@]}"; do
    case "$p" in /admin* | /preferencias* | /cadastro-confirmado* | /atendimento/acompanhar*) fail "sitemap inclui rota privada $p" ;; esac
  done
else
  fail "/sitemap.xml respondeu $CODE ($CTYPE)"
fi
extra=0
for p in "${SITEMAP_PATHS[@]+"${SITEMAP_PATHS[@]}"}"; do
  known=0
  for q in "${PUBLIC_PAGES[@]}"; do [[ "$q" == "$p" ]] && known=1 && break; done
  if [[ $known == 0 ]]; then
    ((extra == 0)) && group "URLs adicionais do sitemap (artigos)"
    extra=$((extra + 1))
    check_page "$p" 0
  fi
done

# ------------------------------------------------------------------ cookies
group "Cookies"
if [[ ! -s "$COOKIE_LOG" ]]; then
  ok "nenhuma resposta verificada definiu cookie (páginas públicas e API anônima)"
else
  while IFS=$'\t' read -r path cookie; do
    name="${cookie%%=*}"
    if [[ "$path" != /api/* ]]; then
      fail "$path (arquivo estático) define cookie $name"
      continue
    fi
    lc="${cookie,,}"
    flags=""
    [[ "$lc" == *httponly* ]] || flags+=" HttpOnly"
    [[ "$lc" == *samesite=* ]] || flags+=" SameSite"
    [[ "$BASE" != https://* || "$lc" == *secure* ]] || flags+=" Secure"
    if [[ -n "$flags" ]]; then fail "$path define cookie $name sem:$flags"; else warn "$path define cookie $name em requisição anônima (HttpOnly/SameSite presentes)"; fi
  done <"$COOKIE_LOG"
fi

printf '\nResultado: %d OK, %d aviso(s), %d falha(s).\n' "$PASS" "$WARN" "$FAIL"
((FAIL == 0))
