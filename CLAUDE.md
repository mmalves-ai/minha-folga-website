# Regras obrigatórias deste projeto

## TUDO restrito ao diretório do projeto

Nada pode ser instalado, gravado ou alterado fora deste diretório (`folga-website/`). A máquina de
desenvolvimento é compartilhada com outros apps do mesmo usuário; qualquer mudança no nível do usuário ou da
máquina pode quebrá-los.

- **Node.js:** somente o runtime privado do projeto em `.runtime/`, instalado por `scripts/node-runtime.sh install`
  (download oficial com conferência de SHA-256). Para rodar qualquer comando com ele:
  `scripts/node-runtime.sh exec <comando>` — o `PATH` muda só nesse processo.
  Proibido: `nvm install/use/alias/uninstall`, `npm -g`, `corepack enable`, mudar perfis de shell.
- **npm:** cache dentro do projeto (`.cache/npm`; o `scripts/node-runtime.sh exec` já define `npm_config_cache`).
  Nunca usar `~/.npm` nem `~/.npmrc`.
- **Temporários e caches de ferramentas:** dentro do projeto (`.tmp/`, `.cache/`, `frontend/.e2e/`, scratch da
  sessão do Claude). Não gravar em `/tmp`, `~/.cache`, `~/.local`, `~/.config`.
- **Processos, portas e serviços:** só os da Minha Folga (ver `docs/DEPLOY_SHARED_SERVER.md`). Nunca parar,
  reiniciar ou reconfigurar processos, containers, PM2, crontab ou systemd de outros apps.
- **Docker:** não baixar imagens, criar containers, volumes ou redes sem pedido explícito do usuário; o que for
  criado com autorização deve ser removido ao final.
- Antes de qualquer comando que possa escrever fora deste diretório: **parar e perguntar ao usuário.**
- Subagentes recebem estas regras (este arquivo é carregado para eles).

## Outras regras

- Commits e push somente quando o usuário pedir.
- `connection.txt` contém credencial: não exibir nem usar sem pedido explícito.
- Respostas em português do Brasil.
