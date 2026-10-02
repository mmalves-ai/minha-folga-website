#!/usr/bin/env bash
# Inventário da hospedagem para a Minha Folga — SOMENTE LEITURA.
# Não instala, não inicia nem encerra processos, não altera arquivos fora de var/inventory/.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib.sh
source "$SCRIPT_DIR/lib.sh"

usage() {
  cat <<'EOF'
Uso: scripts/preflight.sh [opções]

Inventaria, sem alterar nada, o que a implantação da Minha Folga precisa conhecer:
caminhos e permissões, espaço, Node/npm escolhidos, PM2 e systemd de usuário (somente
leitura), porta desejada, Nginx/Apache e vhosts existentes (somente nomes e hashes),
banco dedicado, limites da hospedagem e ferramentas. Nenhum segredo é coletado.

Com a raiz inicializada, grava o resultado em <raiz>/var/inventory/<data>.txt para
comparar antes/depois da publicação. O inventário registra, para processos PM2, serviços
systemd, containers e processos do usuário em escuta, o início e o contador de reinícios:
reinício, parada ou recriação de processo de outro site aparece na comparação.

Variáveis:
  MINHAFOLGA_APP_ROOT   raiz exclusiva (obrigatória; pode ainda não existir)
  MINHAFOLGA_NODE       executável Node escolhido (opcional aqui; validado se informado)
  MINHAFOLGA_PM2        caminho do pm2 existente (opcional)

Opções:
  --port <n>            porta desejada para a API (padrão: PORT do config/.env.production ou 3107)
  --out <arquivo>       grava também neste arquivo (útil antes do init)
  --no-save             não grava em var/inventory/
  --vhost-dir <dir>     pasta adicional de vhosts a inventariar (hospedagens com caminho próprio; pode
                        repetir). Padrão: /etc/nginx/{sites-enabled,conf.d}, /etc/apache2/sites-enabled,
                        /etc/httpd/conf.d, /usr/local/etc/nginx/servers
  --compare <a> <b>     compara dois inventários ignorando valores voláteis (linhas com "~");
                        código 3 quando processo de outro site mudou (início/reinícios/estado)
  --allow-root          permite execução como root (não recomendado)
  -h, --help            mostra esta ajuda
EOF
}

PORT_ARG=""
OUT_FILE=""
EXTRA_VHOST_DIRS=()
SAVE=1
ALLOW_ROOT=0
while (($#)); do
  case "$1" in
    --port) PORT_ARG="${2:-}"; shift 2 ;;
    --out) OUT_FILE="${2:-}"; shift 2 ;;
    --no-save) SAVE=0; shift ;;
    --vhost-dir) EXTRA_VHOST_DIRS+=("${2:-}"); shift 2 ;;
    --compare)
      [[ $# -ge 3 ]] || mf_die "--compare exige dois arquivos."
      a="$2"; b="$3"
      [[ -f "$a" && -f "$b" ]] || mf_die "arquivos de inventário não encontrados."
      echo "Diferenças estáveis entre $(basename -- "$a") e $(basename -- "$b") (linhas voláteis '~' ignoradas):"
      diffout="$(diff -u --label antes --label depois <(grep -v -e '^~' -e '^# gerado' "$a") <(grep -v -e '^~' -e '^# gerado' "$b") || true)"
      if [[ -z "$diffout" ]]; then
        echo "Nenhuma diferença estável."
        exit 0
      fi
      printf '%s\n' "$diffout"
      # Linhas de processo (início, reinícios, estado) que não são da Minha Folga: exigem explicação.
      alheios="$(grep -E '^[-+] ' <<<"$diffout" | grep -E 'inicio=|reinicios=|status=' | grep -v '\[minhafolga\]' || true)"
      if [[ -n "$alheios" ]]; then
        echo
        echo "ATENÇÃO: processos que não são da Minha Folga foram reiniciados, parados ou recriados entre os"
        echo "inventários (compare as linhas '-' antes e '+' depois; cada mudança precisa de explicação):"
        printf '%s\n' "$alheios" | sed 's/^/  /'
        exit 3
      fi
      exit 0
      ;;
    --allow-root) ALLOW_ROOT=1; shift ;;
    -h | --help) usage; exit 0 ;;
    *) mf_die "opção desconhecida: $1 (use --help)" ;;
  esac
done

mf_require_not_root "$ALLOW_ROOT"
mf_resolve_root any
export LC_ALL=C

INITIALIZED=0
if [[ -f "$MF_ROOT/$MF_MARKER_NAME" ]]; then
  mf_require_marker
  INITIALIZED=1
fi

# Sem TMPDIR da raiz da aplicação, o temporário fica no próprio checkout (nunca no /tmp compartilhado).
if [[ -z "${TMPDIR:-}" ]]; then mkdir -p "$SCRIPT_DIR/../.tmp"; TMPDIR="$(cd -- "$SCRIPT_DIR/../.tmp" && pwd)"; fi
REPORT="$(mktemp "$TMPDIR/minhafolga-preflight.XXXXXX")"
trap 'rm -f -- "$REPORT"' EXIT
chmod 600 "$REPORT"

# Convenção: linhas iniciadas por "~" são voláteis (mudam sem ação nossa) e são ignoradas no --compare.
out() { printf '%s\n' "$*" >>"$REPORT"; }
vol() { printf '~ %s\n' "$*" >>"$REPORT"; }
section() { printf '\n[%s]\n' "$*" >>"$REPORT"; }
STATUS_LINES=()
verdict() { STATUS_LINES+=("$1: $2"); }
have() { command -v "$1" >/dev/null 2>&1; }

out "# Inventário Minha Folga (somente leitura)"
out "# gerado em $(date -Iseconds) por $(id -un)@$(hostname)"

section "execução"
out "usuario=$(id -un) uid=$(id -u) grupos=$(id -nG | tr ' ' ',')"
out "host=$(hostname)"
[[ -r /etc/os-release ]] && out "so=$(. /etc/os-release && printf '%s' "${PRETTY_NAME:-desconhecido}")"
out "kernel=$(uname -sr) arquitetura=$(uname -m)"
[[ "$(id -u)" -eq 0 ]] && verdict ATENCAO "executado como root"

section "raiz da aplicação"
out "raiz=$MF_ROOT"
if [[ -d "$MF_ROOT" ]]; then
  out "existe=sim inicializada=$([[ $INITIALIZED == 1 ]] && echo sim || echo nao)"
  out "dono=$(stat -c %U "$MF_ROOT") modo=$(stat -c %a "$MF_ROOT")"
  for sub in releases .runtime .cache .cache/npm config var var/log var/tmp var/private var/inventory var/run backups; do
    if [[ -e "$MF_ROOT/$sub" ]]; then
      out "  $sub modo=$(stat -c %a "$MF_ROOT/$sub") dono=$(stat -c %U "$MF_ROOT/$sub")"
    else
      out "  $sub ausente"
    fi
  done
  if [[ -L "$MF_ROOT/current" ]]; then out "current -> $(readlink -- "$MF_ROOT/current")"; else out "current ausente"; fi
  if [[ -d "$MF_ROOT/releases" ]]; then
    out "releases=$(find "$MF_ROOT/releases" -mindepth 1 -maxdepth 1 -type d | wc -l)"
  fi
  if [[ $INITIALIZED == 1 ]]; then
    out "instancia=$MF_INSTANCE processos=$MF_PROCESS_API,$MF_PROCESS_WORKER"
  fi
  if [[ -f "$MF_ROOT/config/.env.production" ]]; then
    envmode="$(stat -c %a "$MF_ROOT/config/.env.production")"
    out "config/.env.production presente modo=$envmode"
    (((8#$envmode & 8#077) == 0)) || verdict BLOQUEIO "config/.env.production com permissão para grupo/outros ($envmode); use chmod 600"
  else
    out "config/.env.production ausente"
  fi
  [[ $INITIALIZED == 1 ]] || verdict ATENCAO "raiz existe mas não foi inicializada (rode scripts/deploy.sh init)"
else
  parent="$(dirname -- "$MF_ROOT")"
  out "existe=nao pai=$parent pai_existe=$([[ -d $parent ]] && echo sim || echo nao) pai_gravavel=$([[ -w $parent ]] && echo sim || echo nao)"
  [[ -w "$parent" ]] || verdict BLOQUEIO "sem permissão de escrita em $parent para criar a raiz; peça a pasta ao administrador ou escolha outra permitida"
fi

section "espaço e limites (voláteis)"
target="$MF_ROOT"
[[ -d "$target" ]] || target="$(dirname -- "$MF_ROOT")"
if [[ -d "$target" ]]; then
  vol "disco: $(df -hP "$target" | awk 'NR==2 {print "total="$2" usado="$3" livre="$4" uso="$5" montagem="$6}')"
  vol "inodes: $(df -iP "$target" | awk 'NR==2 {print "livres="$4" uso="$5}')"
  free_kb="$(df -kP "$target" | awk 'NR==2 {print $4}')"
  ((free_kb > 3 * 1024 * 1024)) || verdict ATENCAO "menos de 3 GB livres; cada release com dependências ocupa algumas centenas de MB"
fi
out "nucleos=$(nproc 2>/dev/null || echo ?)"
if [[ -r /proc/meminfo ]]; then
  vol "memoria: $(awk '/MemTotal/ {t=$2} /MemAvailable/ {a=$2} END {printf "total=%dMB disponivel=%dMB", t/1024, a/1024}' /proc/meminfo)"
fi
out "ulimit: arquivos_abertos=$(ulimit -n) processos=$(ulimit -u) memoria_virtual=$(ulimit -v) cpu=$(ulimit -t)"
if [[ -r /proc/self/cgroup ]]; then
  cg="$(awk -F: '$1=="0" {print $3}' /proc/self/cgroup 2>/dev/null || true)"
  if [[ -n "$cg" && -r "/sys/fs/cgroup$cg/memory.max" ]]; then
    vol "cgroup=$cg memory.max=$(cat "/sys/fs/cgroup$cg/memory.max") cpu.max=$(cat "/sys/fs/cgroup$cg/cpu.max" 2>/dev/null || echo ?)"
  fi
fi

section "Node e npm"
if [[ -f "$SCRIPT_DIR/../.node-version" ]]; then out "desejado(.node-version)=$(tr -d '[:space:]' <"$SCRIPT_DIR/../.node-version")"; fi
out "node_no_PATH_padrao=$(command -v node || echo ausente) versao=$(node -v 2>/dev/null || echo -)"
if [[ -d "$MF_ROOT/.runtime" ]]; then
  while IFS= read -r candidate; do
    out "runtime_privado=$candidate versao=$("$candidate" -v 2>/dev/null || echo ?)"
  done < <(find "$MF_ROOT/.runtime" -maxdepth 3 -path '*/bin/node' -type f 2>/dev/null | sort)
fi
if [[ -n "${MINHAFOLGA_NODE:-}" ]]; then
  if (mf_select_node >/dev/null 2>&1); then
    mf_select_node
    out "MINHAFOLGA_NODE=$MF_NODE real=$MF_NODE_REAL versao=$MF_NODE_VERSION npm=$MF_NPM versao_npm=$MF_NPM_VERSION"
  else
    out "MINHAFOLGA_NODE=$MINHAFOLGA_NODE inválido ou fora da faixa 24.15–24.x"
    verdict BLOQUEIO "MINHAFOLGA_NODE inválido (veja docs/DEPLOY_SHARED_SERVER.md, runtime privado)"
  fi
else
  out "MINHAFOLGA_NODE não definido"
  verdict ATENCAO "defina MINHAFOLGA_NODE (Node 24.15+ da linha 24) antes de preparar releases"
fi

section "gerenciador de processos"
if pm2bin="$(mf_pm2_bin 2>/dev/null)"; then
  pm2pkg="$(dirname -- "$(realpath -e -- "$pm2bin")")/../package.json"
  pm2ver="$(sed -n 's/^  "version": "\(.*\)",$/\1/p' "$pm2pkg" 2>/dev/null | head -n 1)"
  out "pm2=$pm2bin versao=${pm2ver:-?} PM2_HOME=${PM2_HOME:-$HOME/.pm2}"
  if mf_pm2_daemon_running; then
    out "pm2_daemon=em_execucao"
    out "processos pm2 (nome, estado, reinícios e início; sem ambiente):"
    if [[ -n "${MF_NODE:-}" ]]; then
      env PATH="$MF_ORIGINAL_PATH" "$pm2bin" jlist 2>/dev/null | mf_pm2_jlist_report inventario "" "$MF_ROOT" >>"$REPORT" || out "  (não foi possível listar)"
      if [[ $INITIALIZED == 1 ]]; then
        foreign="$(mf_pm2_foreign_names)"
        if [[ -n "$foreign" ]]; then
          out "nomes_da_instancia_em_outra_raiz=$(tr '\n' ' ' <<<"$foreign")"
          verdict BLOQUEIO "o PM2 já tem processo com o nome desta instância ($MF_PROCESS_API/$MF_PROCESS_WORKER) de outra raiz; use deploy.sh init --instance <nome> nesta raiz, ou outro usuário/PM2_HOME"
        fi
      fi
    else
      out "  (defina MINHAFOLGA_NODE para listar os nomes sem expor ambiente)"
    fi
  else
    out "pm2_daemon=parado (não consultado: chamar o pm2 agora iniciaria um daemon)"
  fi
else
  out "pm2=ausente"
fi
if have systemctl; then
  if systemctl --user show-environment >/dev/null 2>&1; then
    out "systemd_usuario=disponivel"
    units="$(systemctl --user list-unit-files 'minhafolga-*' --no-legend 2>/dev/null | awk '{print $1" "$2}' || true)"
    out "unidades_minhafolga=${units:-nenhuma}"
    have loginctl && out "linger=$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null || echo ?)"
  else
    out "systemd_usuario=indisponivel"
  fi
  vol "servicos_sistema_ativos=$(systemctl list-units --type=service --state=running --no-legend 2>/dev/null | wc -l)"
  # PID principal e início: um reinício (inclusive acidental, durante a publicação) muda a linha.
  services_report() {
    local scope=("$@") names
    names="$(systemctl "${scope[@]}" list-units --type=service --state=running --no-legend --plain 2>/dev/null | awk '{print $1}' || true)"
    [[ -n "$names" ]] || return 0
    # shellcheck disable=SC2086
    systemctl "${scope[@]}" show -p Id -p MainPID -p ActiveEnterTimestamp -- $names 2>/dev/null | awk '
      /^Id=/ { id = substr($0, 4) }
      /^MainPID=/ { pid = substr($0, 9) }
      /^ActiveEnterTimestamp=/ { ts = substr($0, 22) }
      /^$/ { if (id != "") printf "  %s pid=%s inicio=%s%s\n", id, pid, ts, (id ~ /^minhafolga-/ ? " [minhafolga]" : ""); id = ""; pid = ""; ts = "" }
      END { if (id != "") printf "  %s pid=%s inicio=%s%s\n", id, pid, ts, (id ~ /^minhafolga-/ ? " [minhafolga]" : "") }' | sort
  }
  out "servicos do sistema em execução (nome, PID principal, início):"
  services_report --system >>"$REPORT" || true
  if systemctl --user show-environment >/dev/null 2>&1; then
    out "servicos systemd --user deste usuário em execução (nome, PID principal, início):"
    services_report --user >>"$REPORT" || true
  fi
fi
if have docker && docker info >/dev/null 2>&1; then
  out "containers (nome, imagem, estado, início, reinícios):"
  ids="$(docker ps -q 2>/dev/null || true)"
  if [[ -n "$ids" ]]; then
    # shellcheck disable=SC2086
    docker inspect --format '  {{.Name}} {{.Config.Image}} status={{.State.Status}} inicio={{.State.StartedAt}} reinicios={{.RestartCount}}' $ids 2>/dev/null |
      sed 's#^  /#  #' | sort >>"$REPORT" || true
  fi
fi
if have crontab; then
  if crontab -l >/dev/null 2>&1; then
    out "crontab_usuario linhas=$(crontab -l 2>/dev/null | grep -cv '^\s*\(#\|$\)' || true) sha256=$(crontab -l 2>/dev/null | sha256sum | cut -c1-16)"
  else
    out "crontab_usuario=vazio"
  fi
fi

section "porta da API"
port="$PORT_ARG"
if [[ -z "$port" && -f "$MF_ROOT/config/.env.production" && -n "${MF_NODE:-}" ]]; then
  port="$(mf_env_get "$MF_ROOT/config/.env.production" PORT 2>/dev/null || true)"
fi
port="${port:-$MF_DEFAULT_PORT}"
[[ "$port" =~ ^[0-9]+$ ]] || mf_die "porta inválida: $port"
mf_port_owner "$port"
case "$MF_PORT_STATE" in
  livre) out "porta=$port livre" ;;
  minhafolga)
    # Processo do mesmo usuário rodando a partir de uma release desta raiz (cwd): é a própria API.
    out "porta=$port ocupada pela API da Minha Folga (release $MF_PORT_RELEASES)"
    ;;
  outro)
    owner="$(ss -ltnpH "sport = :$port" 2>/dev/null | grep -o 'users:(("[^"]*"' | head -n 1 | sed 's/users:(("//; s/"$//' || true)"
    out "porta=$port ocupada ocupante=${owner:-outro usuário/desconhecido}"
    verdict BLOQUEIO "porta $port ocupada por outro serviço ($MF_PORT_DETAIL); escolha outra porta livre (não encerramos o ocupante)"
    ;;
  *)
    out "porta=$port nao_verificada ($MF_PORT_DETAIL)"
    verdict BLOQUEIO "não foi possível verificar se a porta $port está livre ($MF_PORT_DETAIL); confira com o administrador antes de usar"
    ;;
esac
# Portas efêmeras (clientes e aplicativos de desktop) mudam sozinhas: marcadas como voláteis.
read -r eph_lo eph_hi </proc/sys/net/ipv4/ip_local_port_range 2>/dev/null || { eph_lo=32768; eph_hi=60999; }
out "portas TCP em escuta (endereço:porta; efêmeras $eph_lo-$eph_hi marcadas com ~):"
ss -ltnH 2>/dev/null | awk -v lo="$eph_lo" -v hi="$eph_hi" '{a=$4; n=split(a,p,":"); pt=p[n]+0; if (pt>=lo && pt<=hi) print "~   "a; else print "  "a}' | sort -u >>"$REPORT" || true
# Processos deste usuário que escutam portas fixas: PID e início (reinício de outro site sob o mesmo usuário
# aparece na comparação). PIDs de outros usuários não são visíveis sem privilégio.
out "processos deste usuário em portas fixas (porta, programa, PID, início):"
while read -r addr users; do
  pt="${addr##*:}"
  [[ "$pt" =~ ^[0-9]+$ ]] || continue
  if ((pt >= eph_lo && pt <= eph_hi)); then continue; fi
  for pid in $(grep -o 'pid=[0-9]*' <<<"$users" | cut -d= -f2 | sort -un); do
    prog="$(ps -o comm= -p "$pid" 2>/dev/null || echo ?)"
    started="$(ps -o lstart= -p "$pid" 2>/dev/null | tr -s ' ' || echo ?)"
    tag=""
    [[ "$(readlink -- "/proc/$pid/cwd" 2>/dev/null)" == "$MF_ROOT/"* ]] && tag=" [minhafolga]"
    out "  $addr $prog pid=$pid inicio=${started# }$tag"
  done
done < <(ss -ltnpH 2>/dev/null | awk '{print $4, $NF}' | sort -u || true)

section "servidor web"
nginx_bin="$(command -v nginx || { [[ -x /usr/sbin/nginx ]] && echo /usr/sbin/nginx; } || true)"
if [[ -n "$nginx_bin" ]]; then
  out "nginx=$nginx_bin versao=$("$nginx_bin" -v 2>&1 | sed 's/^nginx version: //')"
  out "teste_de_configuracao=\"$nginx_bin -t\" (executar com o privilégio do administrador antes de recarregar)"
fi
apache_bin="$(command -v apache2ctl || command -v apachectl || command -v httpd || true)"
if [[ -n "$apache_bin" ]]; then
  out "apache=$apache_bin versao=$("$apache_bin" -v 2>/dev/null | sed -n 's/^Server version: //p')"
  out "teste_de_configuracao=\"$apache_bin configtest\" (executar com o privilégio do administrador)"
fi
[[ -n "$nginx_bin$apache_bin" ]] || verdict ATENCAO "nenhum Nginx/Apache encontrado no PATH; confirme o proxy/painel da hospedagem"
out "vhosts existentes (arquivo, nomes de servidor, sha256 do arquivo):"
found_mf=""
unreadable=0
readable_files=()
for dir in /etc/nginx/sites-enabled /etc/nginx/conf.d /etc/apache2/sites-enabled /etc/httpd/conf.d /usr/local/etc/nginx/servers \
  "${EXTRA_VHOST_DIRS[@]+"${EXTRA_VHOST_DIRS[@]}"}"; do
  [[ -d "$dir" && -r "$dir" ]] || continue
  for f in "$dir"/*; do
    [[ -e "$f" ]] || continue
    if [[ -r "$f" && -f "$f" ]]; then
      names="$(grep -hoE '^\s*(server_name|ServerName|ServerAlias)\s+[^;#]+' "$f" 2>/dev/null | sed -E 's/^\s*(server_name|ServerName|ServerAlias)\s+//' | tr -s ' \n' ' ' || true)"
      out "  $f nomes=[${names% }] sha256=$(sha256sum -- "$f" | cut -c1-16)"
      if [[ "$names" == *minhafolga.com.br* ]]; then found_mf+=" $f"; else readable_files+=("$f"); fi
    else
      out "  $f (sem permissão de leitura)"
      unreadable=1
    fi
  done
done
for main in /etc/nginx/nginx.conf /etc/apache2/apache2.conf /etc/httpd/conf/httpd.conf; do
  if [[ -r "$main" ]]; then
    out "  principal $main sha256=$(sha256sum -- "$main" | cut -c1-16)"
    readable_files+=("$main")
  fi
done
if [[ -n "$found_mf" ]]; then
  out "vhost_minhafolga_existente=$found_mf"
fi

# Raiz da aplicação dentro do document root de outro site: config/, backups/ e var/ ficariam servíveis.
docroot_hit=""
if ((${#readable_files[@]})); then
  while IFS= read -r droot; do
    [[ -n "$droot" && "$droot" == /* && "$droot" != *'$'* && "$droot" != *'<'* ]] || continue
    droot="$(realpath -m -- "$droot")"
    [[ "$droot" == / ]] && continue
    if [[ "$MF_ROOT" == "$droot" || "$MF_ROOT" == "$droot"/* ]]; then docroot_hit+=" $droot"; fi
  done < <(grep -hoE '^\s*(root|DocumentRoot)\s+[^;#]+' "${readable_files[@]}" 2>/dev/null |
    sed -E 's/^\s*(root|DocumentRoot)\s+//; s/[[:space:]]+$//; s/^"//; s/"$//' | sort -u)
fi
if [[ -n "$docroot_hit" ]]; then
  out "raiz_dentro_de_document_root=$docroot_hit"
  if [[ "${MINHAFOLGA_ALLOW_HTML_ROOT:-0}" == "1" ]]; then
    verdict ATENCAO "a raiz $MF_ROOT fica dentro do document root de outro site ($docroot_hit); MINHAFOLGA_ALLOW_HTML_ROOT=1 ativo (bloqueie acessos diretos no Apache)"
  else
    verdict BLOQUEIO "a raiz $MF_ROOT fica dentro do document root de outro site ($docroot_hit); escolha uma pasta que nenhum vhost publique ou use MINHAFOLGA_ALLOW_HTML_ROOT=1 se bloqueado no Apache"
  fi
fi

# Servidor padrão por endereço:porta. Sem default explícito, o PRIMEIRO server/VirtualHost carregado para a porta
# vira o padrão: se for o da Minha Folga, pedidos de outros domínios (SNI/Host sem vhost próprio) recebem o
# certificado e o 301 da Minha Folga. O modelo não cria default_server; quem garante é a configuração existente.
# Arquivos em sintaxe Nginx (server_name/listen terminados por ";").
nginx_files=()
for f in "${readable_files[@]+"${readable_files[@]}"}"; do
  grep -qE '^[[:space:]]*(server_name|listen)[[:space:]][^#]*;' "$f" 2>/dev/null && nginx_files+=("$f")
done
if ((${#nginx_files[@]})); then
  for lp in 80 443 '[::]:80' '[::]:443'; do
    case "$lp" in
      80 | 443) pat="listen[[:space:]]+((\\*|0\\.0\\.0\\.0):)?${lp}([[:space:]]|;)" ;;
      *) pat="listen[[:space:]]+\\[::\\]:${lp##*:}([[:space:]]|;)" ;;
    esac
    listeners="$(grep -lE "^[[:space:]]*$pat" "${nginx_files[@]}" 2>/dev/null | tr '\n' ' ' || true)"
    defaults="$(grep -lE "^[[:space:]]*$pat.*default(_server)?" "${nginx_files[@]}" 2>/dev/null | tr '\n' ' ' || true)"
    out "nginx listen $lp: arquivos=[${listeners% }] default_server=[${defaults% }]"
    if [[ "$lp" == '[::]:'* && -z "$listeners" ]]; then
      verdict ATENCAO "nenhum outro vhost do Nginx escuta em $lp: remova do modelo da Minha Folga as linhas 'listen $lp' (senão ele vira o único e padrão servidor IPv6 dessa porta)"
    elif [[ -n "$listeners" && -z "$defaults" ]]; then
      verdict ATENCAO "Nginx sem default_server explícito em $lp: o primeiro arquivo incluído vira o padrão; o da Minha Folga precisa ser incluído depois de [${listeners% }] (ou o administrador declara um padrão). Confira depois com smoke.sh (grupo 'Domínio')"
    fi
  done
fi
if [[ -n "$apache_bin" ]]; then
  if vh="$(timeout 10 "$apache_bin" -S 2>/dev/null | grep -E 'default server|^\*:[0-9]+|port [0-9]+ namevhost' | head -n 20)" && [[ -n "$vh" ]]; then
    out "apache -S (servidor padrão por porta):"
    sed 's/^/  /' <<<"$vh" >>"$REPORT"
    grep -qE 'default server .*minhafolga' <<<"$vh" &&
      verdict BLOQUEIO "o VirtualHost da Minha Folga é o servidor padrão de uma porta no Apache; ele precisa ser carregado depois do padrão existente"
  else
    verdict ATENCAO "não foi possível consultar o servidor padrão do Apache ($apache_bin -S); peça ao administrador para conferir que o VirtualHost da Minha Folga não será o primeiro de *:80/*:443"
  fi
fi
((unreadable == 0)) || verdict ATENCAO "há arquivos de vhost sem permissão de leitura: document roots e servidores padrão não puderam ser todos conferidos"
if have getent; then
  # Tempo limitado: um resolvedor sem resposta não pode travar o inventário.
  for dn in www.minhafolga.com.br minhafolga.com.br; do
    addrs="$(timeout 5 getent ahosts "$dn" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ' || true)"
    out "dns $dn=${addrs:-(sem resposta em 5 s)}"
  done
fi

section "banco de dados dedicado"
envf="$MF_ROOT/config/.env.production"
if [[ -f "$envf" && -n "${MF_NODE:-}" ]]; then
  # Mostra apenas esquema/host/porta/banco/usuário; a senha nunca sai do processo Node.
  dbinfo="$("$MF_NODE" -e '
    const { parseEnv } = require("node:util");
    const env = parseEnv(require("node:fs").readFileSync(process.argv[1], "utf8"));
    try { const u = new URL(env.DATABASE_URL || "");
      console.log(`esquema=${u.protocol.replace(":","")} host=${u.hostname} porta=${u.port || 5432} banco=${decodeURIComponent(u.pathname.slice(1))} usuario=${decodeURIComponent(u.username)}`);
    } catch { console.log("DATABASE_URL ausente ou inválida"); }
  ' "$envf" 2>/dev/null || echo "não foi possível ler DATABASE_URL")"
  out "$dbinfo"
  pg_module=""
  if [[ -L "$MF_ROOT/current" && -d "$MF_ROOT/current/backend/node_modules/pg" ]]; then pg_module="$MF_ROOT/current/backend/node_modules/pg"; fi
  if [[ -n "$pg_module" ]]; then
    dbcheck="$("$MF_NODE" -e '
      const { parseEnv } = require("node:util");
      const env = parseEnv(require("node:fs").readFileSync(process.argv[1], "utf8"));
      const { Client } = require(process.argv[2]);
      const c = new Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 5000 });
      c.connect().then(async () => {
        const v = await c.query("SHOW server_version");
        let m = "tabela schema_migrations ausente";
        try { const r = await c.query("SELECT count(*)::int AS n FROM schema_migrations"); m = `migracoes_aplicadas=${r.rows[0].n}`; } catch {}
        console.log(`conexao=ok servidor_postgres=${v.rows[0].server_version} ${m}`);
        await c.end();
      }).catch((e) => { console.log(`conexao=falha codigo=${e.code || "?"}`); process.exit(0); });
    ' "$envf" "$pg_module" 2>/dev/null || echo "conexao=falha")"
    out "$dbcheck"
    [[ "$dbcheck" == conexao=ok* ]] || verdict BLOQUEIO "banco dedicado inacessível com a configuração atual"
  elif have pg_isready; then
    host="$(sed -n 's/.*host=\([^ ]*\).*/\1/p' <<<"$dbinfo")"
    pport="$(sed -n 's/.*porta=\([^ ]*\).*/\1/p' <<<"$dbinfo")"
    out "pg_isready: $(pg_isready -h "${host:-127.0.0.1}" -p "${pport:-5432}" -t 5 2>&1 || true)"
  else
    out "conectividade não testada (sem release publicada nem pg_isready)"
  fi
else
  out "config/.env.production ou MINHAFOLGA_NODE ausente: banco não verificado"
fi
for tool in pg_dump pg_restore psql; do
  if have "$tool"; then out "$tool=$(command -v "$tool") versao=$("$tool" --version 2>/dev/null | awk '{print $NF}')"; else out "$tool=ausente"; fi
done
have pg_dump || verdict ATENCAO "pg_dump ausente: backup prévio às migrações exigirá procedimento da hospedagem"

section "ferramentas"
for tool in bash curl tar gzip git flock ss lsof openssl sha256sum logrotate nice ionice setfacl; do
  if have "$tool"; then out "$tool=sim"; else out "$tool=nao"; fi
done
have curl || verdict BLOQUEIO "curl ausente (necessário para verificação)"
have flock || verdict BLOQUEIO "flock ausente (necessário para impedir implantações simultâneas)"

section "compatibilidade"
if [[ -z "$(mf_pm2_bin 2>/dev/null || true)" ]] && ! systemctl --user show-environment >/dev/null 2>&1; then
  verdict ATENCAO "sem PM2 e sem systemd de usuário: confirme com a hospedagem como manter um processo Node persistente (modo manual)"
fi
if ((${#STATUS_LINES[@]})); then
  for line in "${STATUS_LINES[@]}"; do out "$line"; done
else
  out "nenhum bloqueio ou atenção detectado pelo inventário automático"
fi
out "itens a confirmar com a hospedagem: processo Node persistente permitido; TLS do domínio; inclusão de vhost exclusivo; banco e usuário dedicados."

cat "$REPORT"
if [[ -n "$OUT_FILE" ]]; then
  cp -- "$REPORT" "$OUT_FILE"
  chmod 600 "$OUT_FILE"
  mf_info "inventário gravado em $OUT_FILE"
fi
if [[ $INITIALIZED == 1 && $SAVE == 1 ]]; then
  mkdir -p -- "$MF_ROOT/var/inventory"
  chmod 700 "$MF_ROOT/var/inventory"
  dest="$MF_ROOT/var/inventory/$(date +%Y%m%d-%H%M%S).txt"
  cp -- "$REPORT" "$dest"
  chmod 600 "$dest"
  mf_info "inventário gravado em $dest"
  mf_info "compare depois com: scripts/preflight.sh --compare <antes.txt> <depois.txt>"
elif [[ $INITIALIZED == 0 ]]; then
  mf_info "raiz ainda não inicializada: nada foi gravado (use --out <arquivo> para guardar este inventário)."
fi
# Código 2 quando há bloqueio, para uso em automação.
for line in "${STATUS_LINES[@]:-}"; do
  if [[ "$line" == BLOQUEIO* ]]; then exit 2; fi
done
exit 0
