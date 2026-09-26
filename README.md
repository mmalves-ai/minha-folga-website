# Minha Folga — website corporativo

Website completo da Minha Folga: páginas institucionais pré-renderizadas (Vue 3 + Vite SSG), conteúdos e ajuda,
cadastro de interesse (nome, CPF, WhatsApp, empregador e dados gerais, com proteção anti-robô própria), preferências de
comunicação, atendimento com protocolo, painel administrativo com MFA e auditoria, e as APIs que a Bia (assistente de
IA da plataforma Hal-AI) usa para cadastrar e consultar o cliente. A operação de crédito está em estruturação: na fase
`PRE_LAUNCH`, toda rota financeira é negada **no servidor**.

**Este sistema não envia nem recebe WhatsApp** (decisão D1, 26/09/2026). O número oficial, a Bia, o webchat, o
atendimento humano das conversas, os templates e as campanhas ficam na Hal-AI; o site só mostra o caminho até eles
(botão flutuante: chat do site primeiro, WhatsApp como última alternativa). Não há código de confirmação: o telefone
de um cadastro feito pelo site fica "não validado" até a própria pessoa falar com a Bia no WhatsApp.

Especificação normativa: [`docs/MINHA_FOLGA_WEBSITE_MASTER.md`](docs/MINHA_FOLGA_WEBSITE_MASTER.md), com as decisões
posteriores do contratante em [`docs/DECISOES.md`](docs/DECISOES.md) (onde divergem, vale a decisão).

## Arquitetura em uma linha

Nginx/Apache existente serve `current/frontend/dist/` (HTML por rota) e encaminha `/api/*` para a API Node em
`127.0.0.1:<porta>` (Express + PostgreSQL dedicado), na mesma origem; a Hal-AI chama `/api/agent/*` com `X-API-Key`.
Detalhes em [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Requisitos

| Item | Versão | Observação |
|---|---|---|
| Node.js | 24.15 ou mais novo da linha 24 (< 25); fixado 24.21.0 | Versão fixada em `.node-version`; nenhum pacote global é necessário |
| npm | o que acompanha o Node 24 | Instalação sempre por `npm ci` (lockfiles separados em `backend/` e `frontend/`) |
| PostgreSQL | 14+ (testado com 17) | Homologação e produção; em desenvolvimento a API usa PGlite embutido |
| Nginx ou Apache 2.4 | o da hospedagem | Modelos em `deploy/` |
| Google Chrome | estável | Testes e2e e geração das imagens da marca (Playwright com `channel: 'chrome'`) |

## Estrutura

```text
backend/                API Node (Express, TypeScript): src/{routes,services,repositories,db,integrations,jobs,cli},
                        migrations/, tests/ (vitest), .env.example
frontend/               Site Vue: src/{pages,components,layouts,router,services,composables},
                        content/ (textos, artigos, FAQ, páginas legais), build/ (plugin de conteúdo),
                        scripts/ (postbuild, servidor estático de revisão, imagens da marca), e2e/ (Playwright)
contracts/              openapi.yaml, validation.json, consents.json, agent-tools.json (fonte única dos contratos)
deploy/                 ecosystem.config.cjs (PM2), modelos de vhost Nginx/Apache, logrotate, corpos JSON de erro
scripts/                preflight.sh, build.sh, deploy.sh, rollback.sh, smoke.sh (+ lib.sh), node-runtime.sh
docs/                   especificação, decisões, arquitetura, implantação, ambiente, operação, conteúdo, Bia,
                        pendências e aceite
```

## Desenvolvimento local

**Regra do projeto: tudo fica restrito a este diretório** (ver `CLAUDE.md`). O Node da versão de `.node-version`
é um runtime privado em `.runtime/`, instalado e usado por `scripts/node-runtime.sh` — nada de `nvm`, `npm -g`,
`~/.npm` ou `/tmp`:

```bash
scripts/node-runtime.sh install                 # uma vez: baixa o Node oficial para .runtime/ (SHA-256 conferido)
scripts/node-runtime.sh exec <comando>          # roda com esse Node; npm cache, temporários e caches em .cache/ e .tmp/
eval "$(scripts/node-runtime.sh env)"           # ou: prepara a sessão atual do shell com as mesmas variáveis
```

Os exemplos abaixo supõem a sessão preparada com o `eval` acima (ou cada comando prefixado por
`scripts/node-runtime.sh exec`).

### Backend (porta 3170)

```bash
cd backend
npm ci
cp .env.example .env
```

Ajuste o `.env` para desenvolvimento:

```dotenv
NODE_ENV=development
PORT=3170
PUBLIC_SITE_URL=http://127.0.0.1:5180
DATABASE_URL=pglite://.dev/pglite
COOKIE_SECURE=false
```

As integrações com a Hal-AI já vêm desligadas no exemplo (`HALAI_ENABLED=false`, `HALAI_SIGNUP_TEMPLATE_ENABLED=false`,
`HALAI_WEBCHAT_ENABLED=false`); mantenha assim para o desenvolvimento comum.

- Deixe **vazias** as linhas de identidade com marcadores `< >` (`LEGAL_ENTITY_NAME=`, `LEGAL_ENTITY_CNPJ=`...): em
  desenvolvimento o site mostra os marcadores de pendência no lugar dos dados reais.
- Gere os segredos (mesmo em desenvolvimento a validação recusa marcadores):

  ```bash
  node -p "'CONTACT_ENCRYPTION_KEY=k1:' + require('crypto').randomBytes(32).toString('base64')"
  node -p "'CONTACT_DEDUP_HMAC_KEY=' + require('crypto').randomBytes(32).toString('base64')"
  node -p "'SESSION_SECRET=' + require('crypto').randomBytes(48).toString('base64')"
  node -p "'READINESS_TOKEN=' + require('crypto').randomBytes(24).toString('base64url')"
  ```

- Não há mensagens simuladas: nada sai por WhatsApp daqui. O formulário de cadastro funciona sem integração nenhuma
  (anti-robô incluído). Variáveis antigas como `MESSAGE_PROVIDER` e `DEV_MESSAGE_LOG_FILE` não têm mais efeito; a API
  avisa no log se ainda estiverem no `.env` (`docs/ENVIRONMENT.md`, "Variáveis obsoletas").
- Para exercitar as ferramentas da Bia localmente: `HALAI_ENABLED=true` e uma `HALAI_INBOUND_API_KEY` gerada (32+
  bytes); as chamadas a `/api/agent/*` levam o cabeçalho `X-API-Key`, e `senderPhone`/`senderVerified` no corpo fazem
  o papel do atestado da plataforma (`docs/BIA_AGENTE.md`, Parte A). O placeholder de template e o webchat ficam
  desligados.

```bash
npm run migrate:dev          # cria o banco PGlite em backend/.dev/ e aplica as migrações
npm run dev                  # API em http://127.0.0.1:3170 (tsx watch)
npm run admin:create:dev -- --email voce@exemplo.test --name "Seu nome" --role admin   # primeira pessoa do painel
```

### Frontend (porta 5180)

```bash
cd frontend
npm ci
npm run dev                  # http://127.0.0.1:5180, com proxy /api → http://127.0.0.1:3170
```

Em desenvolvimento a configuração pública vem de `frontend/config/public-config.dev.json` (sem identidade real).
Outro destino para o proxy: `MF_DEV_API_TARGET=http://127.0.0.1:<porta> npm run dev`.

### Revisar o build como em produção

```bash
cd frontend
npm run build                # vite-ssg + verificações (postbuild)
npm run preview:static       # http://127.0.0.1:5190 com as mesmas regras de URL do Nginx; /api → 127.0.0.1:3170
../scripts/smoke.sh http://127.0.0.1:5190 --expect noindex   # com a API de desenvolvimento rodando
```

O servidor de revisão reproduz as regras de URL (inclusive dotfiles, `*.html`, `/index` e `/404` → 404 e o fallback
`admin.html` só nas rotas administrativas conhecidas), cache e proxy e envia a mesma `Content-Security-Policy` dos
modelos Nginx/Apache (para revisar um build com o chat da Hal-AI ligado, `--webchat-origin <origem>` ou
`MF_WEBCHAT_ORIGIN` libera a origem do widget). A verificação definitiva de cabeçalhos (HSTS, TLS, redirecionamentos de domínio) é feita contra o
servidor web real (`docs/DEPLOY_SHARED_SERVER.md`).

## Testes e verificações

| O quê | Comando |
|---|---|
| Backend: tipos | `cd backend && npm run typecheck` |
| Backend: testes | `cd backend && npm test -- --maxWorkers=2` |
| Frontend: tipos | `cd frontend && npm run typecheck` |
| Frontend: testes | `cd frontend && npm test -- --maxWorkers=2` |
| Frontend: e2e (Playwright + Chrome) | `cd frontend && npm run test:e2e` |
| Site publicado ou de revisão | `scripts/smoke.sh <url-base>` (`--help` para opções) |
| Scripts de implantação (sem rede nem build) | `MINHAFOLGA_NODE=<node 24> scripts/selftest.sh` (`--with-pm2` usa um `PM2_HOME` próprio do teste) |
| Imagens da marca | `cd frontend && node scripts/generate-brand-images.mjs` (gera `public/favicon-32.png`, `public/apple-touch-icon.png`, `public/brand/og-minha-folga.png`) |

Em máquinas compartilhadas, limite os workers (`--maxWorkers=2`) e rode typecheck, build e servidor de
desenvolvimento um de cada vez.

## Build e publicação

- Build de release: `scripts/build.sh --release` (ou `--staging` para homologação); variáveis em
  [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md). No servidor, `scripts/deploy.sh prepare` exige o modo explícito
  (`--release`, `--staging` ou `--review`) e o `publish` recusa, em produção, build que não seja `--release`.
- Implantação, atualização e rollback em servidor compartilhado: [`docs/DEPLOY_SHARED_SERVER.md`](docs/DEPLOY_SHARED_SERVER.md).
- Operação (processos, logs, painel, atendimento, privacidade, backup, chaves, incidentes, mudança de fase):
  [`docs/OPERATIONS.md`](docs/OPERATIONS.md).

## Documentação

| Documento | Conteúdo |
|---|---|
| [`docs/MINHA_FOLGA_WEBSITE_MASTER.md`](docs/MINHA_FOLGA_WEBSITE_MASTER.md) | Especificação normativa |
| [`docs/DECISOES.md`](docs/DECISOES.md) | Decisões do contratante que alteram a especificação (D1: WhatsApp e Bia na Hal-AI; cadastro com CPF e empregador) e o contrato técnico delas |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Arquitetura e convenções |
| [`docs/DEPLOY_SHARED_SERVER.md`](docs/DEPLOY_SHARED_SERVER.md) | Implantação isolada, publicação, rollback, homologação |
| [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md) | Todas as variáveis de ambiente e de build |
| [`docs/OPERATIONS.md`](docs/OPERATIONS.md) | Rotina operacional e planos |
| [`docs/CONTENT_GUIDE.md`](docs/CONTENT_GUIDE.md) | Como editar e aprovar conteúdo |
| [`docs/BIA_AGENTE.md`](docs/BIA_AGENTE.md) | Comportamento e integração da Bia com a Hal-AI (ferramentas, contexto, testes) |
| [`docs/PENDENCIAS_PUBLICACAO.md`](docs/PENDENCIAS_PUBLICACAO.md) | O que falta para abrir a coleta pública |
| [`docs/ACCEPTANCE.md`](docs/ACCEPTANCE.md) | Critérios de aceite e evidências |
| [`contracts/openapi.yaml`](contracts/openapi.yaml) | Contrato da API |
| [`contracts/agent-tools.json`](contracts/agent-tools.json) | Contrato proposto das ferramentas da Bia |

## Pendências de publicação

O código está pronto para homologação; a publicação pública depende de informações e credenciais reais que **não**
são inventadas neste repositório:

1. **Identidade empresarial e canais reais** — razão social, CNPJ, endereço, canal e encarregado de privacidade,
   canal e horário de atendimento (`LEGAL_ENTITY_*`, `PRIVACY_*`, `SUPPORT_*`). Sem eles o build `--release` falha e
   a API desliga cadastro e atendimento.
2. **Dados do cadastro (D1)** — base legal e relatório de impacto (RIPD) para CPF, empregador e faixa salarial, e
   os prazos de retenção desses dados (`docs/PENDENCIAS_PUBLICACAO.md`, item 4).
3. **Hal-AI** — contrato como operadora (conversas, inclusive CPF digitado; suboperadores; transferência
   internacional), chave de entrada e importação das ferramentas, número oficial, confirmação de como a plataforma
   injeta o telefone atestado, transferência humana, templates e campanhas, e o script do webchat. Decisões pendentes
   em `docs/BIA_AGENTE.md`, Parte F.
4. **Hospedagem** — confirmação de processo Node persistente, PostgreSQL com banco e usuário dedicados, inclusão de
   vhost, TLS, usuário/pasta da aplicação e porta reservada (`docs/DEPLOY_SHARED_SERVER.md`, seção 2); cliente
   `pg_dump`/`pg_restore` compatível no servidor; servidor padrão explícito da hospedagem em 80/443 (o vhost da
   Minha Folga não pode virar o padrão); pasta exclusiva e retenção de 6 meses dos registros de acesso do vhost
   (`deploy/logrotate.minhafolga-web.conf.example`), instaladas pelo administrador.
5. **Domínio** — DNS de `minhafolga.com.br` e `www`, certificado para ambos, HSTS depois da validação; SPF, DKIM e
   DMARC nos serviços de e-mail realmente usados.
6. **Revisões** — aviso de privacidade, termos e cookies revisados juridicamente; conteúdos com revisão aprovada
   (`docs/CONTENT_GUIDE.md`); o build estrito falha enquanto houver pendência.
7. **Operação** — equipe e horários reais de atendimento (`HUMAN_SUPPORT_ENABLED`), destino do backup externo,
   contatos de acionamento de incidentes (`docs/OPERATIONS.md`, seção 11), teste de restauração registrado.

Pendências técnicas encontradas na verificação de implantação de 26/09/2026 e já corrigidas na integração:
`.gitignore` deixou de ignorar `frontend/build/`; `tsconfig.node.json` inclui a biblioteca DOM; o limitador por IP
agrupa IPv6 pela sub-rede /56; `.node-version` passou a 24.21.0 (sem aviso `EBADENGINE`); a CSP não precisa mais
de `style-src-attr 'unsafe-inline'`.
