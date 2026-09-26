#!/usr/bin/env bash
# Runtime Node PRIVADO do projeto (regra: tudo restrito ao diretório do projeto — ver CLAUDE.md).
#
#   scripts/node-runtime.sh install          baixa a versão de .node-version para .runtime/ (SHA-256 conferido)
#   scripts/node-runtime.sh path             imprime o caminho absoluto do executável node privado
#   scripts/node-runtime.sh exec <cmd...>    roda <cmd> com esse Node e com caches/temporários dentro do projeto
#   scripts/node-runtime.sh env              imprime os "export" equivalentes (para uma sessão de shell do projeto)
#
# Nada é gravado fora do projeto: não usa nvm, npm -g, ~/.npm, ~/.cache, ~/.local, ~/.config nem /tmp.
# Opção: --root <dir> para instalar/usar o runtime de outra raiz (ex.: MINHAFOLGA_APP_ROOT na implantação).
set -euo pipefail

PROJECT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
ROOT="$PROJECT"
if [[ "${1:-}" == "--root" ]]; then
  [[ -n "${2:-}" && "$2" == /* ]] || { echo "--root precisa de um caminho absoluto" >&2; exit 2; }
  ROOT="$(cd -- "$2" && pwd -P)"
  shift 2
fi

VERSION="$(tr -d '[:space:]' <"$PROJECT/.node-version")"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo ".node-version inválido: $VERSION" >&2; exit 2; }
case "$(uname -m)" in
  x86_64) ARCH=linux-x64 ;;
  aarch64 | arm64) ARCH=linux-arm64 ;;
  *) echo "arquitetura não suportada: $(uname -m)" >&2; exit 2 ;;
esac
NODE_DIR="$ROOT/.runtime/node-v$VERSION-$ARCH"
NODE_BIN="$NODE_DIR/bin/node"

# Caches e temporários de todas as ferramentas (npm, vitest, tsx, Vite, Playwright, Chrome) dentro do projeto.
project_env() {
  mkdir -p "$ROOT/.tmp" "$ROOT/.cache/npm" "$ROOT/.cache/xdg-cache" "$ROOT/.cache/xdg-data" "$ROOT/.cache/xdg-config" \
    "$ROOT/.cache/xdg-state" "$ROOT/.cache/node-compile" "$ROOT/.cache/ms-playwright"
  export PATH="$NODE_DIR/bin:$PATH"
  export npm_config_cache="$ROOT/.cache/npm"
  export npm_config_update_notifier=false
  export npm_config_fund=false
  export npm_config_audit=false
  export npm_config_userconfig="$ROOT/.cache/npmrc-vazio"
  : >"$npm_config_userconfig"
  export TMPDIR="$ROOT/.tmp" TMP="$ROOT/.tmp" TEMP="$ROOT/.tmp"
  export XDG_CACHE_HOME="$ROOT/.cache/xdg-cache" XDG_DATA_HOME="$ROOT/.cache/xdg-data"
  export XDG_CONFIG_HOME="$ROOT/.cache/xdg-config" XDG_STATE_HOME="$ROOT/.cache/xdg-state"
  export NODE_COMPILE_CACHE="$ROOT/.cache/node-compile"
  export PLAYWRIGHT_BROWSERS_PATH="$ROOT/.cache/ms-playwright"
}

need_runtime() {
  [[ -x "$NODE_BIN" ]] || { echo "runtime ausente: rode  scripts/node-runtime.sh${ROOT:+ --root $ROOT} install" >&2; exit 3; }
}

cmd_install() {
  if [[ -x "$NODE_BIN" ]]; then
    echo "já instalado: $NODE_BIN ($("$NODE_BIN" -v))"
    return 0
  fi
  local tarball base="https://nodejs.org/dist/v$VERSION"
  mkdir -p "$ROOT/.runtime" "$ROOT/.tmp"
  WORK_DIR="$(mktemp -d "$ROOT/.tmp/node-runtime.XXXXXX")"
  local work="$WORK_DIR"
  trap 'rm -rf -- "${WORK_DIR:-}"' EXIT
  tarball="node-v$VERSION-$ARCH.tar.xz"
  echo "baixando $base/$tarball"
  curl -fsSL --retry 2 -o "$work/$tarball" "$base/$tarball"
  curl -fsSL --retry 2 -o "$work/SHASUMS256.txt" "$base/SHASUMS256.txt"
  (cd "$work" && grep " $tarball\$" SHASUMS256.txt | sha256sum -c -) || { echo "checksum NÃO confere; nada instalado" >&2; exit 4; }
  tar -xJf "$work/$tarball" -C "$work"
  mv -- "$work/node-v$VERSION-$ARCH" "$NODE_DIR"
  echo "instalado: $NODE_BIN ($("$NODE_BIN" -v)); npm $("$NODE_DIR/bin/npm" -v 2>/dev/null || echo '?')"
}

case "${1:-}" in
  install) cmd_install ;;
  path) need_runtime; echo "$NODE_BIN" ;;
  env)
    need_runtime
    project_env
    for v in PATH npm_config_cache npm_config_update_notifier npm_config_fund npm_config_audit npm_config_userconfig TMPDIR TMP TEMP \
      XDG_CACHE_HOME XDG_DATA_HOME XDG_CONFIG_HOME XDG_STATE_HOME NODE_COMPILE_CACHE PLAYWRIGHT_BROWSERS_PATH; do
      printf 'export %s=%q\n' "$v" "${!v}"
    done
    ;;
  exec)
    shift
    [[ $# -gt 0 ]] || { echo "uso: scripts/node-runtime.sh exec <comando...>" >&2; exit 2; }
    need_runtime
    project_env
    exec "$@"
    ;;
  -h | --help | help | "")
    sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
    ;;
  *) echo "comando desconhecido: $1 (use --help)" >&2; exit 2 ;;
esac
