# Implantação em servidor compartilhado — Minha Folga

Procedimento para publicar e atualizar o website da Minha Folga (frontend Vue pré-renderizado + API Node) num
servidor que hospeda outros sites, **sem alterar nada que não seja da Minha Folga**. Normas de origem: seções 8.3,
8.4, 8.5 e 8.7, 9, 11, 12 e 13 de `docs/MINHA_FOLGA_WEBSITE_MASTER.md`.

Documentos relacionados: `docs/ENVIRONMENT.md` (variáveis), `docs/OPERATIONS.md` (rotina, backup, incidentes,
mudança de fase), `docs/ARCHITECTURE.md` (arquitetura), `README.md` (desenvolvimento local e pendências).

## Sumário

1. Visão geral e regras que os scripts garantem
2. Compatibilidade da hospedagem (antes de qualquer coisa)
3. Isolamento da seção 8.3 aplicado
4. Limites reais do isolamento por diretório
5. Preparação única do servidor
6. Procedimento de publicação (os 7 passos da seção 8.7)
7. Ordem de publicação e janela de indisponibilidade
8. Rollback
9. Retenção de releases e backups
10. Inventário antes/depois
11. Homologação
12. Evidência dos testes desta entrega

## 1. Visão geral e regras que os scripts garantem

```text
<MINHAFOLGA_APP_ROOT>/                 (ex.: /srv/minhafolga; dono: usuário da aplicação)
  .minhafolga-root                     marcador criado por "deploy.sh init" (com a instância: prod, homolog...);
                                       sem ele nenhum script atua
  releases/<id>/                       release imutável: backend/ (dist + dependências de produção), frontend/dist/,
                                       deploy/, scripts/, contracts/, o registro .minhafolga-release e o link
                                       .minhafolga-node para o Node usado no prepare
  current -> releases/<id>             link simbólico relativo, trocado de forma atômica
  .runtime/                            Node privado (se a hospedagem não tiver um compatível)
  .cache/npm/                          cache npm exclusivo
  config/.env.production               segredos (chmod 600), fora de qualquer release
  config/logrotate.conf                rotação própria dos logs (docs/OPERATIONS.md)
  var/log/  var/tmp/  var/private/     logs, temporários (TMPDIR de todos os scripts e do build) e arquivos privados
  var/inventory/                       inventários do preflight (comparação antes/depois)
  var/releases.log                     registro de prepare/migrate/publish/verify/rollback/cleanup
  var/run/                             trava de implantação e pids
  backups/                             dumps locais temporários do banco dedicado (chmod 600)
```

| Script | Faz | Nunca faz |
|---|---|---|
| `scripts/preflight.sh` | Inventário somente leitura (caminhos, permissões, espaço, Node, PM2, porta, Nginx/Apache, vhosts, document roots, servidor padrão por porta, banco, limites; início e reinícios de processos) em `var/inventory/` | Alterar arquivos fora de `var/inventory/`, iniciar/encerrar processos, ler segredos de outros sites |
| `scripts/build.sh` | `npm ci` separado em backend e frontend (cache privado), typecheck, testes opcionais, build do backend, exportação da configuração pública, build do frontend, `npm prune --omit=dev` | Instalar pacote global, rodar scripts de instalação de dependências, construir dentro de `current` |
| `scripts/deploy.sh` | `init`, `prepare`, `migrate`, `publish`, `restart`, `stop`, `verify`, `status`, `backup-db`, `cleanup`, `systemd-unit` | `pm2 restart all/delete all/kill/save/update/startup`, `systemctl` de serviços do sistema, `sudo`, alteração de `PATH` global, perfil ou crontab |
| `scripts/rollback.sh` | Volta `current` para a release anterior registrada, com os assets da que sai e o Node da de destino, e recarrega só a API/worker | Desfazer migração, restaurar banco, apagar dados |
| `scripts/smoke.sh <url>` | Testes GET do site publicado (seção 13), inclusive raiz → www, HTTP → HTTPS e vhost padrão | Enviar formulário, criar dado, definir cookie |
| `scripts/selftest.sh` | Autoteste dos scripts em raízes descartáveis (releases sintéticas, sem rede nem build; PM2 só com `--with-pm2`, em `PM2_HOME` próprio) | Tocar em processo, porta ou arquivo fora do diretório de teste |

Regras comuns: `set -euo pipefail`; mensagens em português; `--help`; recusam rodar como root (salvo `--allow-root`);
exigem `MINHAFOLGA_APP_ROOT` absoluto, sem espaços, diferente de `/`, `$HOME` e diretórios do sistema, com o
marcador; qualquer remoção é de caminho validado dentro da raiz e de item identificado (release com metadados, fora
de uso); uma operação por vez (trava em `var/run/deploy.lock`); o Node é escolhido por `MINHAFOLGA_NODE` e o
`PATH` só muda dentro do script; os processos rodam com o Node **registrado na release** (não com o da sessão);
npm sempre com `--cache <raiz>/.cache/npm`; temporários em `<raiz>/var/tmp` (`TMPDIR`); build com prioridade
reduzida (`nice`/`ionice`); nomes de processo derivados da **instância** da raiz (`minhafolga-api` em produção,
`minhafolga-homolog-api` na homologação).

Os scripts não dependem da pasta onde estão, só de `MINHAFOLGA_APP_ROOT`. Use os da versão que está sendo
publicada: extraia o pacote em `<raiz>/var/tmp/pacote-<id>/` (ou use um checkout fora da raiz) para o `prepare` e,
depois, `releases/<id>/scripts/` para `migrate`/`publish`/`verify`; `current/scripts/` serve para `rollback`,
`status`, `restart` e `stop`.

## 2. Compatibilidade da hospedagem (antes de qualquer coisa)

Confirme com o administrador, por escrito, antes de preparar a implantação:

| Requisito | Por quê | Como conferir |
|---|---|---|
| Processo Node **persistente** (API escutando em `127.0.0.1:<porta>`) | Cadastro com anti-robô, APIs da Bia (Hal-AI), preferências, atendimento, painel e bloqueio financeiro são do servidor | PM2 existente, `systemd --user` com *linger*, ou "aplicação Node" do painel com porta atribuída |
| PostgreSQL com banco e usuário **dedicados** | Dados pessoais e auditoria; migrações só no banco da Minha Folga | Administrador cria conforme 5.3; `preflight.sh` testa a conexão |
| Nginx ou Apache existente aceitando **um vhost exclusivo** com proxy para `127.0.0.1` | Mesma origem para site e API; HTTPS terminado no servidor web | `preflight.sh` lista servidor e vhosts; administrador aplica o arquivo e o `reload` |
| TLS para `minhafolga.com.br` e `www.minhafolga.com.br` | HTTPS obrigatório; HSTS depois de validar | Certificado e renovação pelo mecanismo da hospedagem |
| Usuário próprio (ideal) ou pasta privada permitida | Permissões restritas e dono único dos arquivos | `preflight.sh` mostra dono, modo e se a pasta-pai é gravável |
| Recursos: ~1 GB de RAM livre no build (pico medido: ~1 GB); ~400 MB de disco livre durante o build no servidor (a release final ocupa ~30 MB) + ~70 MB de cache npm; 1 núcleo | O build é a etapa mais pesada; prefira CI | `preflight.sh` (disco, memória, núcleos, `ulimit`, cgroup) |

**Plano só estático/PHP (sem processo Node persistente): incompatível com a entrega completa.** As páginas
institucionais podem ser servidas como arquivos, mas cadastro (e o anti-robô), preferências, protocolos, painel
administrativo, as ferramentas da Bia e o bloqueio financeiro no servidor dependem da API. Não publique formulário que finja
funcionar. Adaptações possíveis, em ordem de preferência:

1. Migrar para plano/VPS com processo Node persistente (recomendado).
2. Manter o estático nesta hospedagem e rodar a API em infraestrutura própria, com `/api/*` roteado **na mesma
   origem** (`www.minhafolga.com.br/api/`) por CDN ou proxy de borda. Exige revisar `TRUST_PROXY`, `ALLOWED_ORIGINS`
   e os cabeçalhos repassados, e documentar a nova topologia.
3. Publicar só o institucional temporariamente: o site já informa, sem sucesso falso, quando cadastro e atendimento
   estão indisponíveis. É uma publicação parcial e precisa de aprovação explícita do responsável.

## 3. Isolamento da seção 8.3 aplicado

| Recurso | Regra (8.3) | Como esta entrega aplica |
|---|---|---|
| Runtime Node | Executável compatível sem alterá-lo, ou runtime privado em `.runtime/`; caminho absoluto fixado | `MINHAFOLGA_NODE` obrigatório e validado (>= 24.15, < 25); o `prepare` registra o caminho em `.minhafolga-release` e no link `releases/<id>/.minhafolga-node`; `publish`, `restart` e `rollback` usam o Node **da release** (`interpreter` absoluto no PM2; `ExecStart` pelo link no systemd), então reverter uma troca de runtime volta ao runtime anterior; caminho e versão vão para `var/releases.log` |
| npm e ferramentas | Node escolhido, cache próprio, dependências locais; `PATH` só no processo | `npm ci --cache <raiz>/.cache/npm --ignore-scripts`; `PATH` ajustado só dentro do script; o pm2 do administrador roda com o `PATH` original; nenhum pacote global |
| Processos | Nomes exclusivos, 1 instância, limites | Nome pela instância da raiz (`deploy.sh init --instance`): `minhafolga-api` em produção, `minhafolga-<instância>-api` nas demais (e `-worker` só com `WORKER_MODE=separate`); `publish`/`restart`/`rollback` recusam, antes de qualquer troca, nome já usado no PM2 por outra raiz e unidade `systemd --user` de outra raiz; fork, 1 instância, `max_memory_restart` 384M/256M, `kill_timeout` 12 s, `wait_ready`; toda ação é `--only <nome>` |
| Porta | `127.0.0.1`, porta livre verificada, sem encerrar ocupante | `HOST=127.0.0.1`; a porta é verificada por `ss` (ou pela tabela do kernel, sem `ss`); porta não verificável é `BLOQUEIO`, nunca "livre"; a própria API é reconhecida pelo `cwd` do processo em `<raiz>/releases/`; `publish` recusa porta de outro serviço e o modo manual só sugere encerrar PID comprovadamente da raiz; depois da recarga, a saúde só conta se a porta for atendida pela release publicada; a API encerra se a porta estiver ocupada |
| Banco | Dedicado, menor privilégio, sem reinicializar a instância | SQL da seção 5.3 (testado): papel sem `SUPERUSER/CREATEDB/CREATEROLE`, `CONNECTION LIMIT`, `CONNECT` revogado de `PUBLIC`; migrações só pela CLI da release; backup `pg_dump` antes de migrar |
| Filas e cache | Outbox no banco; sem limpeza global | Outbox em tabela própria; nenhum Redis; o cache npm é o da raiz |
| Arquivos e permissões | Usuário e permissões limitados; sem `chmod`/`chown` amplo | `umask 027`; release `go-rwx`, exceto `frontend/dist` (leitura) e `deploy/http-errors`; `config/`, `var/`, `backups/` em `700`/`600`; arquivo de ambiente recusado com qualquer permissão de grupo/outros; temporários em `var/tmp`; raiz recusada dentro de document root (`public_html`, `htdocs`, `httpdocs`, `wwwroot`, `/var/www/html` e os `root`/`DocumentRoot` dos vhosts, pelo `preflight.sh`); `MINHAFOLGA_WEB_ACCESS` escolhe outro/grupo/ACL |
| Logs, tarefas e recursos | Rotação própria, tarefas identificadas, concorrência limitada, crontab preservado | Logs da API em `var/log/` com `time` e `deploy/logrotate.minhafolga.conf.example` com estado privado; registros do vhost em pasta exclusiva, com formato mínimo (sem query string nem referer) e retenção própria (`deploy/logrotate.minhafolga-web.conf.example`: acesso 6 meses, erro 30 dias); `DATABASE_POOL_MAX` baixo; testes com 2 workers; build com `nice`; nenhum script escreve no crontab |
| Ambientes | Portas, processos, bancos, segredos e destinos distintos | Uma raiz por ambiente, cada uma com sua **instância** (nomes de processo e unidade próprios), `config/.env.production`, porta, banco e pasta de registros do vhost (seção 11); de preferência também um usuário Unix (ou `PM2_HOME`) próprio para a homologação |

## 4. Limites reais do isolamento por diretório

- **Pasta não é fronteira de segurança.** Com o mesmo usuário Unix de outro site, um processo comprometido de um
  lê os arquivos do outro. O ideal é um usuário exclusivo para a Minha Folga; sem isso, `chmod 700` protege apenas
  contra outros usuários.
- **Pasta não reserva CPU nem memória.** Os limites do PM2 (`max_memory_restart`) reiniciam o processo, não o
  contêm. Contenção real vem de cgroup/quotas da hospedagem (`MemoryMax`, `CPUQuota` na unidade `systemd --user`) —
  o `preflight.sh` registra o cgroup e os `ulimit` encontrados.
- **O daemon PM2 é compartilhado** quando a hospedagem usa um só: um `pm2 kill` ou atualização feitos por outra
  pessoa derrubam também a Minha Folga. Combine com o administrador. Produção e homologação no mesmo daemon só
  convivem com instâncias diferentes (nomes diferentes); os scripts recusam publicar se o nome da instância já
  pertencer a processo de outra raiz.
- **O servidor web é compartilhado**: um erro de sintaxe em qualquer vhost impede o `reload` de todos. Por isso o
  arquivo da Minha Folga só é aplicado depois de `nginx -t`/`apachectl configtest` pelo administrador.
- **O PostgreSQL pode ser compartilhado**: menor privilégio e `CONNECTION LIMIT` evitam acesso cruzado e excesso de
  conexões, mas não isolam I/O da instância.
- **O servidor web precisa atravessar a raiz** (`711` ou grupo/ACL) para ler `current/frontend/dist`. Nada além do
  dist e de `deploy/http-errors` fica legível para ele.

## 5. Preparação única do servidor

### 5.1 Raiz exclusiva

```bash
export MINHAFOLGA_APP_ROOT=/srv/minhafolga      # a pasta-pai precisa existir e ser gravável (ou ser criada pelo administrador)
scripts/preflight.sh --out ~/minhafolga-inventario-inicial.txt   # inventário ANTES de criar qualquer coisa
scripts/deploy.sh init                          # produção: instância prod (minhafolga-api)
# homologação, em OUTRA raiz: scripts/deploy.sh init --instance homolog   (minhafolga-homolog-api)
```

`init` só aceita pasta inexistente, vazia ou já inicializada; cria o marcador (com a instância, que não muda
depois) e a árvore com `700` (a raiz e `releases/` ficam `711` para o servidor web atravessar, conforme
`MINHAFOLGA_WEB_ACCESS`). A raiz não pode ficar dentro do document root de nenhum site.

### 5.2 Node privado em `.runtime/` (quando não houver um compatível)

Use a versão de `.node-version` (ou o patch mais recente da linha 24 validado em CI). O jeito mais simples é o
instalador do projeto, que baixa o binário oficial para `<raiz>/.runtime/`, confere o SHA-256 e não toca em nada fora
da raiz:

```bash
scripts/node-runtime.sh --root "$MINHAFOLGA_APP_ROOT" install
export MINHAFOLGA_NODE="$(scripts/node-runtime.sh --root "$MINHAFOLGA_APP_ROOT" path)"
```

O mesmo procedimento, à mão (baixe do site oficial e **confira o checksum** antes de extrair):

```bash
V="$(cat .node-version)"          # ex.: 24.21.0
ARCH=linux-x64                    # linux-arm64 em servidores ARM
cd "$MINHAFOLGA_APP_ROOT/var/tmp"
curl -fsSLO "https://nodejs.org/dist/v$V/node-v$V-$ARCH.tar.gz"
curl -fsSLO "https://nodejs.org/dist/v$V/SHASUMS256.txt"
curl -fsSLO "https://nodejs.org/dist/v$V/SHASUMS256.txt.sig"
# Recomendado: conferir a assinatura com as chaves de release do Node.js (lista em github.com/nodejs/node#release-keys)
#   gpg --verify SHASUMS256.txt.sig SHASUMS256.txt
grep " node-v$V-$ARCH.tar.gz\$" SHASUMS256.txt | sha256sum -c -      # precisa responder "OK"
tar -xzf "node-v$V-$ARCH.tar.gz" -C "$MINHAFOLGA_APP_ROOT/.runtime/"
rm -f -- "node-v$V-$ARCH.tar.gz" SHASUMS256.txt SHASUMS256.txt.sig
export MINHAFOLGA_NODE="$MINHAFOLGA_APP_ROOT/.runtime/node-v$V-$ARCH/bin/node"
"$MINHAFOLGA_NODE" -v
```

Não altere o Node padrão do servidor, `nvm` de outros usuários nem o perfil do shell. Para trocar de versão, extraia
a nova ao lado, prepare uma release com ela (`MINHAFOLGA_NODE` apontando para a nova) e publique: cada release
guarda o Node do próprio prepare, e `publish`, `restart` e `rollback` sempre usam o Node da release, então o
rollback volta também ao runtime anterior. Mantenha o runtime antigo em `.runtime/` enquanto alguma release que o
usa puder ser destino de rollback (`--use-session-node` força o Node da sessão, com aviso).

### 5.3 Banco dedicado e usuário de menor privilégio

Executado **pelo administrador do PostgreSQL**, uma vez (testado em PostgreSQL 17; vale para 14+). A senha **não**
vai no arquivo, na linha de comando (`ps`/`/proc/<pid>/cmdline` a mostram a outros usuários do servidor) nem em
`ALTER ROLE ... PASSWORD '...'` digitado (fica em `~/.psql_history` e no log do servidor com `log_statement`):

```sql
-- psql -v ON_ERROR_STOP=1 -f minhafolga-db.sql
CREATE ROLE minhafolga_app LOGIN
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  CONNECTION LIMIT 10;
CREATE DATABASE minhafolga OWNER minhafolga_app ENCODING 'UTF8' TEMPLATE template0;
-- Outros papéis da instância compartilhada não se conectam a este banco.
REVOKE ALL ON DATABASE minhafolga FROM PUBLIC;
\connect minhafolga
-- Esquema public só da Minha Folga (no PostgreSQL <= 14 ele pertence ao superusuário e aceita CREATE de todos).
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO minhafolga_app;
-- Limites por sessão deste papel neste banco (o pg_dump desliga o statement_timeout na própria sessão).
ALTER ROLE minhafolga_app IN DATABASE minhafolga SET statement_timeout = '30s';
ALTER ROLE minhafolga_app IN DATABASE minhafolga SET idle_in_transaction_session_timeout = '60s';
```

Em seguida, a senha, definida de forma interativa:

```bash
psql -c '\password minhafolga_app'     # digite a senha duas vezes; o psql calcula o verificador SCRAM no cliente
```

O servidor recebe e registra só o verificador `SCRAM-SHA-256$...`, nunca a senha (conferido com
`log_statement=ddl`: o log mostra o verificador e nenhuma ocorrência da senha). Gere a senha sem caracteres que
exijam *percent-encoding* na URL, por exemplo com `"$MINHAFOLGA_NODE" -e
'process.stdout.write(require("node:crypto").randomBytes(24).toString("base64url"))'`, e entregue-a a quem opera a
Minha Folga por canal seguro, só para o `config/.env.production`. Rotação: `docs/OPERATIONS.md`, seção 10.

- O papel é dono **só** do próprio banco (as migrações criam tabelas nele); não cria bancos nem papéis, e outros
  papéis não se conectam (conferido: `permission denied to create database` e `User does not have CONNECT
  privilege`).
- No `pg_hba.conf` (decisão do administrador), restrinja `minhafolga_app` ao banco `minhafolga` e à origem local,
  com `scram-sha-256`.
- `DATABASE_URL=postgres://minhafolga_app:<senha>@127.0.0.1:5432/minhafolga` (senha com caracteres especiais em
  *percent-encoding*). `DATABASE_POOL_MAX` da API + worker precisa ficar abaixo do `CONNECTION LIMIT`.
- Homologação: outro banco (`minhafolga_homolog`) e outro papel, com o mesmo SQL.
- Cliente `pg_dump`/`pg_restore` da mesma versão principal do servidor (ou mais nova) no PATH ou em
  `MINHAFOLGA_PG_DUMP`/`MINHAFOLGA_PG_RESTORE`. Sem ele, o `migrate` para e pede backup pelo procedimento da
  hospedagem (`--skip-backup` só com backup externo confirmado).

### 5.4 Arquivo de ambiente privado

```bash
umask 077
cp backend/.env.example "$MINHAFOLGA_APP_ROOT/config/.env.production"
chmod 600 "$MINHAFOLGA_APP_ROOT/config/.env.production"
# edite os valores reais; gere os segredos conforme docs/ENVIRONMENT.md, "Como gerar os segredos"
```

Nunca coloque o arquivo em `releases/`, no document root ou no repositório. `NODE_ENV=production` recusa marcadores,
identidade incompleta, banco que não seja PostgreSQL, `COOKIE_SECURE=false` e `READINESS_TOKEN` ausente.

### 5.5 Gerenciador de processos (respeite o que a hospedagem já usa)

**PM2 existente** (`--mode pm2`). Os scripts usam o pm2 e o daemon do administrador (`MINHAFOLGA_PM2`,
`PM2_HOME`) e só executam, por nome:

```bash
pm2 startOrReload <raiz>/current/deploy/ecosystem.config.cjs --only minhafolga-api --update-env
pm2 stop minhafolga-api
# homologação (instância homolog): --only minhafolga-homolog-api / pm2 stop minhafolga-homolog-api
```

com `MINHAFOLGA_APP_ROOT` e `MINHAFOLGA_NODE` (o Node da release) no ambiente; o `ecosystem.config.cjs` recusa
carregar sem eles ou sem o marcador e tira os nomes da instância gravada no marcador. Antes de trocar `current`, o
`publish` confere o daemon, o ecosystem da release e se o nome já pertence a processo de outra raiz; se algo falhar,
nada muda. Se o daemon não estiver rodando, os scripts param em vez de iniciar um novo; `--pm2-allow-start` só
depois de confirmar com o administrador que esse é o daemon da hospedagem.

- **Persistência após reinício do servidor:** siga o mecanismo que o administrador já adota. Os scripts **nunca**
  rodam `pm2 save` nem `pm2 startup`, porque `pm2 save` grava a lista inteira de processos do daemon (inclusive o
  estado momentâneo dos outros sites). Se a hospedagem usa `pm2 startup` + `pm2 save`, o administrador decide o
  momento de salvar, depois de conferir `pm2 ls`. Alternativa que não mexe no dump: o script de inicialização do
  administrador executa o comando `startOrReload ... --only minhafolga-api` acima.
- `pm2 reload` em modo fork equivale a reiniciar (há janela curta, seção 7).
- Nunca use `pm2 restart all`, `pm2 delete all`, `pm2 kill`, `pm2 update`, `pm2 flush` ou `pm2 reloadLogs` (todos
  atingem outros processos) nem módulos globais como `pm2-logrotate`.

**systemd de usuário** (`--mode systemd-user`), se o administrador adotar: `scripts/deploy.sh systemd-unit` imprime
as unidades da instância (`minhafolga-api.service`, e `minhafolga-worker.service`; na homologação,
`minhafolga-homolog-api.service`) com `MemoryMax`, `CPUQuota`, `TasksMax`, `NoNewPrivileges`, logs em `var/log/` e
`ExecStart=<raiz>/current/.minhafolga-node ...` (o Node vem da release publicada). Instalação manual em
`~/.config/systemd/user/`, depois `systemctl --user daemon-reload && systemctl --user enable --now
minhafolga-api.service`. O `publish` recusa, antes da troca, unidade ausente, de outra raiz ou com Node fixo.
Sobreviver ao logout e ao reinício exige `loginctl enable-linger <usuário>` — decisão do administrador.

**Painel de hospedagem** com "aplicação Node": aponte a aplicação para `<raiz>/current/backend`, arquivo de entrada
`dist/server.js`, variáveis `NODE_ENV=production` e `MF_ENV_FILE=<raiz>/config/.env.production`, e use a porta que
o painel atribuir em `PORT`. Publique com `--mode manual` e reinicie pelo botão do painel.

**Manual** (`--mode manual`, padrão): os scripts não tocam em processo nenhum e imprimem os passos exatos
(`kill -TERM` do PID que escuta a porta **somente** se o `cwd` dele estiver em `<raiz>/releases/`; porta de outro
serviço é recusada sem sugerir PID; comando de início com `nohup` e o Node da release). Não sobrevive a reinício do
servidor; serve para homologação ou para hospedagens em que outra pessoa opera os processos.

### 5.6 Virtual host (Nginx ou Apache)

Modelos: `deploy/nginx.minhafolga.conf.example` e `deploy/apache.minhafolga.conf.example`. Cada um contém **só** os
vhosts de `minhafolga.com.br` e `www.minhafolga.com.br` (o Nginx, também três definições de nível `http` com nomes
exclusivos: `log_format minhafolga_privado` e os `map` `$minhafolga_log_uri` e `$minhafolga_hsts`), sem
`default_server`, sem alterar `Listen`, módulos, certificados ou a configuração principal.

1. O administrador cria a pasta exclusiva dos registros do vhost, fora do padrão de rotação da hospedagem (ex.:
   `install -d -m 0750 -o root -g adm /var/log/nginx/minhafolga`), e instala a regra de retenção
   `deploy/logrotate.minhafolga-web.conf.example` (acesso: 6 meses; erro: 30 dias).
2. Copie o modelo para um arquivo novo e substitua os marcadores `<MINHAFOLGA_APP_ROOT>`, `PORTA`,
   `<CERTIFICADO_FULLCHAIN>`, `<CHAVE_PRIVADA>`, `<DIRETORIO_DE_LOGS_MINHAFOLGA>` e, se usar HTTP-01, `<DIRETORIO_ACME>`.
3. `grep -nE '<[A-Z_]+>|PORTA' minhafolga.conf` não pode encontrar nada fora de comentários.
4. **Servidor padrão.** Sem `default_server` explícito, o Nginx usa como padrão de cada endereço:porta o
   **primeiro** `server` incluído que escuta nela; no Apache, o primeiro `VirtualHost` carregado. Se o arquivo da
   Minha Folga for o primeiro (ex.: `sites-enabled/` em ordem alfabética), ou o único a escutar em `[::]:443`,
   pedidos de outros domínios sem vhost próprio recebem o certificado e o 301 da Minha Folga. Antes de instalar, o
   `preflight.sh` mostra, por porta, os arquivos que escutam e os `default_server` existentes (Nginx) ou a saída
   de `apachectl -S`, e avisa quando não há padrão explícito ou quando nenhum outro site escuta em IPv6. O
   administrador garante que 80/443 já têm um padrão de outro dono (ou inclui o arquivo da Minha Folga depois do
   atual primeiro servidor) e usa as linhas `listen [::]` só se os demais sites também escutam em IPv6. Depois do
   *reload*, `apachectl -S` precisa continuar mostrando o `default server` da hospedagem.
5. O administrador instala o arquivo no local de vhosts da hospedagem, roda `nginx -t` (ou `apachectl configtest`)
   e só então faz o *reload* gracioso segundo o procedimento dela. Nenhum script da Minha Folga recarrega o servidor
   web.

O que os modelos garantem, conferido pelo `smoke.sh` contra o servidor real: raiz → www e HTTP → HTTPS com 301
preservando caminho e query, sem redirecionamento aberto (grupo "Domínio", que também confirma que um pedido com
Host/SNI de outro domínio, no mesmo servidor, **não** cai no vhost da Minha Folga); document root **somente**
`current/frontend/dist`; `/` → `index.html`; `/sobre` → `sobre.html` (URL canônica sem `.html` nem barra final;
`/sobre/` → 301); fallback de aplicação **só** em `/admin` e nas rotas administrativas conhecidas (`painel`,
`leads`, `leads/<id>`, `atendimentos`, `atendimentos/<id>`, `privacidade`, `auditoria`, `usuarios`, `conta`; o
`smoke.sh` lê a lista de `frontend/src/router/routes.ts` e acusa rota nova ausente do vhost); qualquer outro
caminho → `404.html` com status 404, inclusive `/admin/<desconhecido>`, `/index`, `/404`, dotfiles e `*.html`
direto (sempre a página 404 do site, com CSP); `/assets/` com cache de 1 ano `immutable`; HTML com `no-cache`;
`/api/` para `127.0.0.1:PORTA` **preservando o prefixo `/api`** (Nginx: `proxy_pass` sem URI); erros do próprio
proxy em `/api` (API parada, corpo grande) em JSON, nunca HTML; corpo limitado a 32 KB (a API aceita JSON de até
16 KB em todas as rotas); gzip fora da API; cabeçalhos de segurança.

**Decisão D1 (26/09/2026):** a API não tem mais `/api/webhooks/` (o WhatsApp é todo da Hal-AI; qualquer caminho ali
responde 404 da própria API). A exceção de 3 MB que os modelos tinham para esse caminho foi removida; ao instalar o
vhost, não acrescente limites maiores para nenhum caminho de `/api`.

Notas:

- **Registros de acesso** com formato próprio e dados mínimos: IP, data e hora com fuso, host, método, caminho **sem
  query string**, protocolo, status, bytes, duração e user-agent. Sem referer, cookies ou parâmetros (conferido: um
  pedido com `?utm_source=...&email=...` e `Referer` de teste ficou registrado só com o caminho). É o que o Aviso de
  Privacidade descreve; mudar o formato exige revisar o aviso. O registro de erro guarda, em falhas do proxy, a linha
  da requisição (com a query string) e o referer; por isso a retenção dele é de 30 dias.
- **CSP** conferida contra o HTML gerado: `script-src 'self'` (nenhum script inline executável; JSON-LD não
  executa) e `style-src 'self'` sem exceções: o HTML pré-renderizado não tem atributo `style` nem script inline executável, e
  `frontend/scripts/postbuild.mjs` faz o build falhar se algum componente passar a gerá-los. `worker-src 'self'` cobre
  o Web Worker da prova de trabalho do anti-robô (arquivo do próprio site, gerado no build).
- **Webchat da Hal-AI na CSP (D1, placeholder).** Com o chat desligado (padrão), a CSP não libera nenhuma origem
  externa. Ao habilitar `channels.webchat` (`HALAI_WEBCHAT_*` e nova release), acrescente a origem do widget — a mesma
  de `HALAI_WEBCHAT_SCRIPT_URL` — nas diretivas do vhost de produção e do de homologação:
  `script-src 'self' https://<origem-do-widget-hal-ai>`, `connect-src 'self' https://<origem-do-widget-hal-ai>`
  (mais `wss://…` se o chat usar WebSocket) e `frame-src https://<origem-do-widget-hal-ai>` (no lugar de `'none'`, se
  o widget usar iframe); em `style-src`, `img-src` e `font-src` só se o widget exigir. Confirme a lista exata com a
  Hal-AI. Nunca use curinga (`*`) nem `'unsafe-inline'`/`'unsafe-eval'` em `script-src` (o `smoke.sh` falha com
  `unsafe-inline`/`unsafe-eval`). Microfone e câmera na `Permissions-Policy` só se o widget pedir. A revisão local faz o
  mesmo com `frontend/scripts/static-server.mjs --webchat-origin <origem>` (ou `MF_WEBCHAT_ORIGIN`). Sem essa
  liberação, o navegador bloqueia o script e a pessoa vê a mensagem de falha do chat, com os outros canais.
- **HSTS** fica desligado até validar HTTPS de www e da raiz, inclusive renovação. Nginx: um único interruptor, o
  `map $host $minhafolga_hsts` do início do arquivo (descomente as linhas de `www.minhafolga.com.br` e
  `minhafolga.com.br`); o cabeçalho já está em todas as `location` que têm `add_header` (páginas, assets, API,
  erros JSON) e no server do domínio raiz. Apache: descomente as duas linhas `Header always set
  Strict-Transport-Security` (VirtualHost do domínio raiz e do www, no nível do VirtualHost, que alcança a API e os
  redirecionamentos). Comece com `max-age=300`, confira e aumente; `includeSubDomains`/`preload` só por decisão
  explícita (afetam todos os subdomínios). Depois, use `smoke.sh ... --require-hsts`, que exige o cabeçalho no www,
  no domínio raiz e na API.
- **Link `current`:** se a hospedagem usa `disable_symlinks` (Nginx), o valor compatível é `if_not_owner`; no Apache
  o modelo usa `SymLinksIfOwnerMatch` só na raiz da Minha Folga. Não relaxe a política global.
- **Apache e limite de corpo:** além de `LimitRequestBody` (32 KB), o modelo recusa em `/api` corpos com
  `Content-Length` acima do limite com 413 em JSON; a API limita o restante (16 KB).
- **Apache e `X-Forwarded-For`:** o modelo remove o cabeçalho enviado pelo cliente antes do proxy (sem `early`, que
  dentro de `<LocationMatch>` é ignorado); a API recebe só o IP visto pelo Apache (conferido com captura no upstream).
- `ServerTokens`/`server_tokens` globais são da hospedagem; o modelo desliga só no vhost (Nginx) ou omite a
  assinatura (`ServerSignature Off`).
- Topologia com CDN/balanceador na frente: ajuste `TRUST_PROXY` e os cabeçalhos `X-Forwarded-*` à topologia real.

### 5.7 Leitura do servidor web

O servidor web roda com outro usuário. `MINHAFOLGA_WEB_ACCESS` (padrão `other`) decide como ele lê o dist:

| Valor | Raiz e `releases/<id>` | `frontend/dist` | Quando usar |
|---|---|---|---|
| `other` | `711` (atravessa, não lista) | `755`/`644` | Padrão; o dist é público de qualquer forma |
| `group:<grupo>` | `710` + grupo | `750`/`640` | O usuário da aplicação pertence ao grupo do servidor web |
| `acl:<usuário>` | `700` + ACL `x` | ACL `rX` | Hospedagem com `setfacl` |
| `none` | `700` | `700`/`600` | O servidor web roda como o próprio usuário (painel) |

## 6. Procedimento de publicação (os 7 passos da seção 8.7)

Variáveis na sessão de quem publica (nada vai para perfil):

```bash
export MINHAFOLGA_APP_ROOT=/srv/minhafolga
export MINHAFOLGA_NODE=/srv/minhafolga/.runtime/node-v24.21.0-linux-x64/bin/node
export MINHAFOLGA_PROCESS_MODE=pm2          # ou systemd-user | manual
ID=$(date +%Y%m%d-%H%M)-$(git rev-parse --short HEAD)   # id único e imutável da release
```

### Passo 1 — Inventariar sem alterar

```bash
scripts/preflight.sh            # grava <raiz>/var/inventory/<data>.txt; código 2 = há BLOQUEIO
```

Leia as linhas `BLOQUEIO`/`ATENCAO` da seção `[compatibilidade]`. O inventário registra processos PM2 (nome,
estado, reinícios, início), serviços do sistema e do `systemd --user` (PID principal e início), containers (início e
reinícios), portas em escuta e os processos do usuário nelas, vhosts (nome de arquivo, `server_name` e hash), os
servidores padrão por porta e o hash do crontab, sem coletar ambiente, segredos ou conteúdo de configuração de
outros sites.

### Passo 2 — Preparar a release

**Preferencial: build em CI** (ou máquina compatível) para não carregar o servidor compartilhado. A raiz da CI e a
configuração pública ficam **fora do checkout**: `build.sh --release` recusa checkout com qualquer arquivo não
registrado (o `.gitignore` também ignora `/.ci-root/` e `/.minhafolga-build`, que o build grava na origem):

```bash
# na CI, com o mesmo Node 24 e a configuração pública exportada no servidor (sem segredos na CI):
CI_TMP="${RUNNER_TEMP:-$(mktemp -d)}"                                   # fora do checkout
export MINHAFOLGA_APP_ROOT="$CI_TMP/minhafolga-ci" && scripts/deploy.sh init   # raiz descartável da CI (cache npm)
scripts/build.sh --release --with-tests --public-config "$CI_TMP/public-config.json"
git archive --format=tar --prefix=minhafolga/ HEAD > "$CI_TMP/minhafolga-$ID.tar"
tar --transform 's#^#minhafolga/#' -rf "$CI_TMP/minhafolga-$ID.tar" backend/dist frontend/dist .minhafolga-build
gzip "$CI_TMP/minhafolga-$ID.tar"                # sem node_modules, .env ou links simbólicos
# no servidor:
scripts/deploy.sh prepare "$ID" --from-tarball minhafolga-$ID.tar.gz --prebuilt
```

`--prebuilt` confere `backend/dist` e `frontend/dist`, lê o modo do build do `.minhafolga-build` do pacote (com
`--release`/`--staging`/`--review` junto, recusa pacote de outro modo), instala só as dependências de produção do
backend (`npm ci --omit=dev --ignore-scripts`) e aplica as permissões. A release fica com ~30 MB. Pacote sem
`.minhafolga-build` fica com modo `prebuilt`, que produção recusa no `publish`.

**Build no servidor** (quando não houver CI). O modo é **obrigatório**: `--release` (produção), `--staging`
(homologação) ou `--review` (revisão, com pendências visíveis e `noindex`); esquecer o modo não gera mais um build
de revisão calado:

```bash
scripts/deploy.sh prepare "$ID" --from-git /caminho/do/repositorio --ref <commit> --release
#   ou --from-tarball <pacote-do-commit>   ou --from-dir <checkout limpo fora da raiz>
```

Com `--release`, `--from-dir` recusa checkout com alterações não registradas ou pasta sem git (a mesma regra do
`build.sh`, que não enxerga o `.git` a partir da release); `--allow-dirty` aceita, e fica registrado na release e
no evento `prepare`.

O build roda em `releases/<id>/`, nunca na release pública: `npm ci` em backend e frontend separados → typecheck →
(testes, com `--with-tests`) → build do backend → `export-public-config` (mesma validação da API: identidade
incompleta em produção interrompe o release) → build do frontend com `MF_PUBLIC_CONFIG_FILE`, `VITE_SITE_URL`,
`MF_STRICT_RELEASE=1` e `MF_INDEXABLE=1` → `npm prune --omit=dev` só depois de compilar → remoção de
`frontend/node_modules` → permissões. Também recusa release com arquivo de segredo versionado por engano (`.env`,
chaves privadas, tokens conhecidos) e, com `--from-dir`, checkout git cujo `.gitignore` exclua código-fonte. Uma falha marca a release
como `failed` (removível por `cleanup`) e não afeta a publicada.

### Passo 3 — Validar dados e configuração

```bash
"$MINHAFOLGA_APP_ROOT"/releases/$ID/scripts/deploy.sh migrate "$ID"
```

1. Confere o arquivo de ambiente (dono e `chmod 600`).
2. Compara as migrações da nova release com as da atual e alerta sobre as novas (precisam ser aditivas e
   compatíveis com a release anterior: o rollback não as desfaz).
3. Faz **backup do banco dedicado** com `pg_dump --format=custom` em `backups/db-<data>-antes-<id>.dump` (`0600`;
   senha por `PGPASSFILE` temporário `0600`, apagado em seguida) e confere o arquivo com `pg_restore --list`.
4. Aplica as migrações pendentes com a CLI da própria release (`MF_ENV_FILE=config/.env.production`): idempotente,
   uma transação por arquivo e *advisory lock* exclusivo da Minha Folga contra execuções simultâneas.

Restauração do backup: `docs/OPERATIONS.md`, "Backup e restauração". Uma falha de migração mantém a release atual
publicada.

### Passo 4 — Preparar o host exclusivo

Só na primeira publicação ou quando o modelo de vhost mudar: seção 5.6 (substituir marcadores, `nginx -t` /
`apachectl configtest` e *reload* gracioso pelo administrador). Nenhum outro vhost, listener ou certificado é tocado.

### Passo 5 — Publicar

```bash
"$MINHAFOLGA_APP_ROOT"/releases/$ID/scripts/deploy.sh publish "$ID" --mode pm2
```

Ordem: (1) confere, **antes de qualquer troca**, que o build corresponde ao ambiente (`NODE_ENV=production` só
publica build `--release`; `staging` publica `--staging`, ou `--review` com `--allow-review-build`, registrado), o
Node registrado na release, o gerenciador (daemon PM2 em execução, ecosystem da release carregando e declarando os
nomes da instância, nenhum processo de outra raiz com esses nomes; ou unidade `systemd --user` desta raiz), e que a
porta não é de outro serviço — qualquer falha aqui para sem alterar nada; (2) registra o evento `publish-start`
(release e anterior), para o rollback achar a anterior mesmo se a publicação for interrompida; (3) copia para a
nova release os assets com hash da anterior que não existem na nova (abas abertas continuam carregando); (4) troca
`current` de forma atômica (`ln -s` para temporário + `mv -T`); (5) recarrega **somente** os processos da
instância (`minhafolga-api`, e `minhafolga-worker` com `WORKER_MODE=separate`) com o Node da release — se o
gerenciador falhar, `current` (e o arquivo de ambiente, se promovido) volta sozinho para a anterior, que é
recarregada; (6) espera `127.0.0.1:<porta>/api/health` **e** a porta ser atendida por processo da nova release
(`cwd`); (7) registra em `var/releases.log`: id, release anterior, instância, modo, modo do build, versão e caminho
do Node, versão do npm, porta, worker, migrações, assets mantidos, cópia do ambiente e resultado da saúde. Sem
`migrate` registrado para a release, o `publish` recusa (`--skip-migrate-check` só quando não há banco novo a
validar). Mudança de fase com `--promote-env`: `docs/OPERATIONS.md`, seção 12.

### Passo 6 — Verificar

```bash
"$MINHAFOLGA_APP_ROOT"/releases/$ID/scripts/deploy.sh verify   # saúde local + release que atende a porta + prontidão interna (token) + smoke.sh na PUBLIC_SITE_URL
scripts/preflight.sh                              # inventário DEPOIS
scripts/preflight.sh --compare <raiz>/var/inventory/<antes>.txt <raiz>/var/inventory/<depois>.txt   # código 3 = processo alheio mudou
```

O `smoke.sh` confere as páginas públicas e privadas por acesso direto (200 + `<h1>` + canonical da própria rota),
404 real com a página do site (inclusive para `*.html`, `/index` e `/404`), `/api/health` em JSON, API inexistente →
404 JSON, `/api/admin/*` sem sessão → 401/403 JSON, `/api/credit/proposals` → 403 `credit_phase_locked` (em
`PRE_LAUNCH`), as rotas administrativas conhecidas → `admin.html` e as demais sob `/admin/` → 404, cabeçalhos de
segurança e de cache, arquivos que nunca podem ser públicos, `robots.txt`/`sitemap.xml`, ausência de cookies e,
para `https://www.<domínio>`, o grupo "Domínio" (raiz → www e HTTP → HTTPS com caminho e query, sem redirecionamento
aberto, e o vhost não virar o padrão de outros domínios). Antes da troca de DNS, `--resolve www.<domínio>:443:<ip>`
vale também para o domínio raiz e para a porta 80.

Complete manualmente, num celular e com teclado (seção 13): cadastro pelo formulário (com CPF, empregador e faixas;
o anti-robô é transparente para quem preenche) e a mesma resposta ao reenviar com o mesmo CPF ou telefone; pedido de
saída pelo número em `/preferencias`; se a Bia já estiver integrada, cadastro e link de Preferências pela conversa,
alteração e revogação de preferências; botão flutuante (WhatsApp e, se habilitado, o chat do site, que só carrega
depois do clique); solicitação de atendimento com protocolo, login administrativo com MFA e permissões, e a negação
de crédito. Na comparação de inventário, as únicas diferenças aceitáveis são da Minha Folga (raiz, porta da própria API,
processos marcados `[minhafolga]`); o `--compare` termina com código 3 e lista à parte os processos de outros sites
reiniciados, parados ou recriados (início, reinícios ou estado alterados), que exigem explicação.

### Passo 7 — Reverter se necessário

```bash
"$MINHAFOLGA_APP_ROOT"/current/scripts/rollback.sh --dry-run   # destino e migrações que continuam aplicadas
"$MINHAFOLGA_APP_ROOT"/current/scripts/rollback.sh --mode pm2
```

Detalhes na seção 8.

## 7. Ordem de publicação e janela de indisponibilidade

- **Arquivos estáticos:** a troca de `current` é atômica; cada requisição recebe a release antiga ou a nova, nunca
  uma mistura. Os assets da anterior são mantidos na nova.
- **API:** em modo fork há **uma janela curta sem API** entre o encerramento gracioso (SIGTERM, até 10 s para
  concluir requisições) e o `ready` do novo processo. No teste desta entrega (PM2, `deploy.sh restart`, consulta a
  `/api/health` pelo Nginx a cada 50 ms) a janela foi de cerca de 0,4 s (7 respostas `503` em JSON); no modo manual,
  0,01 s de encerramento + 0,38 s até a nova API responder. Durante ela, o proxy responde `503` em JSON e o site mostra "Não foi possível
  concluir. Tente novamente em instantes."; as páginas continuam no ar. **Não há promessa de zero downtime**:
  exigiria duas instâncias atrás de balanceamento, o que não está validado nesta hospedagem.
- **Compatibilidade:** como `current` troca antes do reinício da API, por alguns segundos o frontend novo fala com a
  API antiga, e abas abertas do frontend antigo falam com a API nova. Por isso, mudanças de contrato são aditivas numa
  release (campos novos opcionais; remoções só numa release posterior), e migrações são aditivas e compatíveis com a
  release anterior.
- Publique fora do horário de maior uso e avise a equipe de atendimento.

## 8. Rollback

`scripts/rollback.sh` volta `current` para a release que estava no ar quando a atual foi publicada (campo
`previous` do último `publish` ou `publish-start` dela — este é gravado antes da troca, então vale também para uma
publicação interrompida) ou para `--to <id>`, e recarrega só os processos da instância. Repetir o comando não
"avança" para a release revertida.

- Confere antes da troca as mesmas pré-condições do `publish` (gerenciador, nomes, porta) e espera a porta ser
  atendida pela release de destino.
- Copia para a release de destino os assets da que sai do ar: abas abertas na release revertida continuam
  carregando as páginas sob demanda.
- Reinicia com o **Node registrado na release de destino** (`--use-session-node` força o da sessão, com aviso).
- Se a publicação da atual promoveu um arquivo de ambiente (`publish --promote-env`), o `config/.env.production`
  anterior volta junto (`--keep-env` mantém o atual); o que estava em uso fica guardado em `config/`.

- **Não desfaz migrações nem restaura banco.** Cadastros, protocolos e preferências recebidos depois da publicação
  são preservados (conferido no teste: um protocolo criado na release nova continuou consultável depois do rollback).
- Se a causa for uma migração, **corrija para frente**: nova migração que restaure a compatibilidade + nova release.
- Restaurar o backup do banco descarta tudo o que chegou depois dele; só com o plano de `docs/OPERATIONS.md`
  ("Backup e restauração") e decisão do responsável.
- Registro: evento `rollback` em `var/releases.log` com as migrações que continuam aplicadas, os assets copiados, o
  Node usado e o ambiente restaurado.

## 9. Retenção de releases e backups

```bash
scripts/deploy.sh cleanup --dry-run
scripts/deploy.sh cleanup --keep 5 --keep-backups 10
```

- Mantém as `--keep` releases prontas mais recentes (mínimo 2), **sempre** a atual e a anterior; remove releases com
  falha. Só remove pastas de `releases/` com o registro `.minhafolga-release`; pastas não reconhecidas ficam.
- Mantém os `--keep-backups` dumps mais recentes em `backups/`. Os backups locais são temporários: copie-os para
  armazenamento externo exclusivo e protegido (cifrado, acesso só da equipe) e registre o destino.
- O cache `.cache/npm` é só da Minha Folga; se precisar liberar espaço, apague **essa** pasta (nunca
  `npm cache clean` global).

## 10. Inventário antes/depois

`scripts/preflight.sh` grava um inventário por execução em `var/inventory/`. `--compare <a> <b>` mostra só
diferenças estáveis: as linhas voláteis (marcadas com `~`: espaço livre, memória, cgroup da sessão, portas
efêmeras, contagem de serviços) são ignoradas. Processos PM2, serviços, containers e processos do usuário em portas
fixas entram com início e contador de reinícios (e PID): um `pm2 restart all` acidental ou o reinício de um serviço
compartilhado durante a janela aparece como diferença, e o `--compare` lista à parte, com código 3, as mudanças de
processos que não são da Minha Folga (marcados `[minhafolga]`). Compare sempre o inventário anterior ao `publish`
com o posterior e guarde os dois junto do registro da release. Antes do `init`, use `--out <arquivo>` para guardar
o primeiro.

## 11. Homologação

- Outra raiz (`/srv/minhafolga-homolog`) criada com `deploy.sh init --instance homolog`: processos e unidades
  `minhafolga-homolog-api`/`minhafolga-homolog-worker`, que nunca colidem com os de produção. De preferência, também
  outro usuário Unix (ou, no mínimo, outro `PM2_HOME`); no mesmo usuário e daemon, os scripts recusam publicar se o
  nome da instância já pertencer a processo de outra raiz.
- Outra porta, outro banco e papel, outros segredos e **integração de teste com a Hal-AI**: `HALAI_INBOUND_API_KEY`
  própria (cadastrada na configuração de homologação da Hal-AI), template de cadastro desligado
  (`HALAI_SIGNUP_TEMPLATE_ENABLED=false`) ou, para testá-lo, canal e números da equipe com teto diário baixo, e widget
  de webchat de homologação, se houver. Nunca aponte homologação para o banco de produção nem para a chave de produção.
- Build `--staging`: modo estrito, mas `robots.txt` com `Disallow: /` e sem indexação. Enquanto houver pendência
  editorial (o modo estrito recusa), homologação pode publicar build `--review` com `publish --allow-review-build`
  (registrado); produção nunca.
- No vhost de homologação (seção final dos modelos): **basic auth obrigatório**, `X-Robots-Tag: noindex, nofollow`
  e pasta de registros própria (ex.: `/var/log/nginx/minhafolga-homolog`, com cópia da regra de retenção). No mesmo
  Nginx, não repita as definições de nível `http` do arquivo de produção. `robots.txt` não é controle de acesso.
- Verificação: `scripts/smoke.sh https://homolog.minhafolga.com.br --auth-file ~/.minhafolga-homolog.auth --expect noindex`
  (arquivo `usuário:senha` com `chmod 600`; a senha não passa pela linha de comando).
- Atualização e rollback precisam ser exercitados em homologação antes de produção (seção 13).

## 12. Evidência dos testes desta entrega

Executados em 26/09/2026 com os scripts atuais e o runtime entregue: **Node v24.21.0** (`.node-version`), npm 11.19.0,
numa raiz de teste descartável (sem tocar em processos, portas ou arquivos de outros sites), a partir de um snapshot
commitado da árvore de trabalho; PostgreSQL 17.11 (servidor e cliente `pg_dump`/`pg_restore`) em container efêmero;
Nginx 1.31.2 e Apache 2.4.68 em containers efêmeros com portas de teste (80/443 → 18480/18443 e 18481/18444),
simulando a hospedagem com um servidor padrão de outro dono; PM2 6.0.14 com `PM2_HOME` próprio do teste.

| Teste | Resultado |
|---|---|
| `scripts/selftest.sh --with-pm2` (releases sintéticas, sem rede nem build) | 87 OK, 0 falha: raiz recusada (vazia, relativa, `/`, `$HOME`, `/tmp`, `/srv`, espaço, `..`, `public_html`, `/var/www/html`, pasta alheia); instâncias e nomes; ambiente `640` recusado; `prepare` sem modo e `--release` de origem suja ou sem git recusados; build de revisão recusado em produção; PM2 sem daemon para **antes** de trocar `current` e sem `publish-start`; porta de outro serviço recusada sem PID sugerido; Node da release no `publish`/`restart`/`rollback`; assets no rollback; rollback após publicação interrompida; `--promote-env` e restauração no rollback; `cleanup`; `preflight` (porta não verificável, document root alheio, servidor padrão, reinício de processo alheio → código 3, nome de processo de outra raiz, que `publish` e `stop` recusam sem tocar no processo alheio); servidor de revisão × regras do vhost |
| `preflight.sh --out` antes do `init`; `deploy.sh init` | Código 0 (ATENCAO só para Nginx/Apache e `pg_dump` ausentes no host); árvore `700`/`711`, marcador `600` |
| SQL do banco dedicado (5.3) + `\password` | Papel sem privilégios extras; outro papel sem `CONNECT`; `CREATE DATABASE` negado; com `log_statement=ddl`, o log do servidor mostra só o verificador SCRAM (nenhuma ocorrência da senha) |
| `prepare --from-git --review` com build completo no servidor | Pronta em 31 s, pico de ~950 MB, 28 MB; `frontend/node_modules` removido; só `frontend/dist` legível pelo servidor web; link `.minhafolga-node` e Node registrados |
| Fluxo de CI do passo 2 (raiz da CI dentro do checkout, o caso mais restritivo) | `git status` vazio depois do `init` e depois do build (com `.minhafolga-build`); `build.sh --release` passou pela exigência de commit e parou, como previsto, no modo estrito: conteúdos sem aprovação registrada (pendências editoriais, `docs/PENDENCIAS_PUBLICACAO.md`) |
| Pacote de CI (`build.sh --review`) + `prepare --prebuilt` | `--prebuilt --release` recusado (pacote de revisão); `--prebuilt` pronta em 2 s |
| `migrate` com `pg_dump` + `pg_restore --list` | Migrações aplicadas na primeira release; na segunda, "nenhuma"; backups `0600` |
| `publish` manual com `NODE_ENV=staging` | Build de revisão recusado sem `--allow-review-build`; aceito com ele (registrado) |
| `publish` manual da segunda release | `kill -TERM` sugerido só para o PID da própria API (release anterior); encerramento em 0,01 s, nova API em 0,38 s, `cwd` na nova release |
| `verify` | `local_health=ok listener=ok readiness=ok`; `smoke.sh` pelo Nginx: 82 OK, 0 falha |
| `rollback` manual | Destino e Node corretos; 54 assets da release que saiu mantidos; protocolo de atendimento criado antes continuou consultável |
| PM2: `publish` sem `--pm2-allow-start`, `publish`, `restart`, `status`, `rollback`, `stop` | Sem daemon: nada alterado; `health=ok` com a porta atendida pela release publicada; janela do `restart` de ~0,4 s (7 respostas `503` em JSON); rollback `health=ok`; protocolo consultável |
| Nginx: `nginx -t` e `smoke.sh` HTTPS | Sintaxe ok; 79 OK, 3 avisos (HSTS desligado); com HSTS ligado no `map` e `--require-hsts`: 82 OK, HSTS no www, no domínio raiz, na API, nos assets e na 404 |
| Apache: `httpd -t`, `httpd -S` e `smoke.sh` HTTPS | Sintaxe ok; `default server` continua o da hospedagem; 79 OK, 4 avisos (HSTS desligado; `ServerTokens` do servidor de teste); com HSTS e `--require-hsts`: 82 OK; `*.html`, `/index` e `/404` → 404 com a página do site e CSP |
| Sem o servidor padrão da hospedagem (Nginx e Apache) | `smoke.sh` falha nos dois ("outro domínio foi atendido pelo vhost da Minha Folga") em 80 e 443 |
| Grupo "Domínio" do `smoke.sh` | HTTP www, HTTP raiz e HTTPS raiz → 301 para `https://www.minhafolga.com.br` com caminho e query; `//outro-site/` sem redirecionamento aberto |
| `X-Forwarded-For` recebido pela API (captura no upstream) | Apache corrigido: só `127.0.0.1`; configuração anterior (`early` no `LocationMatch`): `6.6.6.6, 127.0.0.1` |
| Registros de acesso (Nginx e Apache) | Pedido com query (`utm_source`, `email`) e `Referer` de teste registrado só com IP, data, host, método, caminho sem query, status, bytes, duração e user-agent |
| Corpo de 40 KB em `/api`; 3.145.728 e 3.145.729 bytes em `/api/webhooks/whatsapp` (limite de 3 MB, refeito em 26/09/2026 com o modelo atual, Nginx em container + API real). **Anterior à D1:** a rota `/api/webhooks/whatsapp` foi removida pela D1 e a exceção de 3 MB saiu dos dois modelos; falta refazer este teste só com `/api` (exige servidor web em container, que só roda com autorização) | 40 KB → 413 JSON do proxy; 3.145.728 bytes → chegou à API (503 `webhook_disabled` da própria API, com `x-request-id`); 3.145.729 bytes → 413 JSON do proxy. Apache: mesmo limite (`LimitRequestBody 3145728` + regra de `Content-Length`), sintaxe conferida com `httpd -t` |
| API parada | 503 em JSON (Nginx e Apache) |
| `preflight.sh --compare` antes/depois | Só diferenças da Minha Folga (processo `[minhafolga]`); código 0 |
| Backup avulso + restauração em banco separado | Mesmas contagens (migrações, cadastros, atendimentos) |
| `cleanup` | Removeu só a release com falha; manteve atual, anterior e pasta não gerenciada |
| Rotação de logs | API: `copytruncate`, o processo seguiu gravando; servidor web (`logrotate.minhafolga-web.conf.example`): acesso 185 rotações, erro 30 |
| Credencial do smoke | `644` recusada; com `600`, o arquivo de configuração do curl fica em `<raiz>/var/tmp` |
| Servidor de revisão (`frontend/scripts/static-server.mjs`) | Mesmo resultado do vhost em 21 URLs (dotfiles, `*.html`, `/index`, rotas admin, 404, 301, 400); `smoke.sh` contra ele: 71 OK |

Não exercitado aqui: `systemd --user` (a unidade só é gerada e conferida; instalar exigiria alterar
`~/.config/systemd/user/` do usuário) e um build `--release` completo, que depende das aprovações editoriais pendentes.
Pendências de publicação: `README.md`, "Pendências de publicação".
