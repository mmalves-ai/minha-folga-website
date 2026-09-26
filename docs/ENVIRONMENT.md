# Variáveis de ambiente — Minha Folga

Referência de todas as variáveis que a aplicação e os scripts de implantação leem. Os valores de exemplo não são
segredos nem dados reais; marcadores entre `< >` são documentação e a validação do backend os recusa fora do
desenvolvimento.

Fontes normativas: seção 8.5 de `docs/MINHA_FOLGA_WEBSITE_MASTER.md` e a decisão **D1** de `docs/DECISOES.md`
(26/09/2026: WhatsApp, Bia e webchat são da plataforma Hal-AI; cadastro com CPF e empregador; anti-robô próprio). Onde
as duas divergem, vale D1. Esquema no código: `backend/src/config/env.ts` (validação campo a campo e regras
cruzadas), `backend/src/config/index.ts` (montagem da configuração) e `backend/src/config/public.ts` (a única lista de
campos que sai do servidor).

## 1. Onde fica cada configuração

| Ambiente | Arquivo | Quem lê |
|---|---|---|
| Produção | `<MINHAFOLGA_APP_ROOT>/config/.env.production` (dono = usuário da aplicação, `chmod 600`) | API, worker, CLIs, `scripts/*.sh` |
| Homologação | a mesma estrutura, em **outra raiz** (`<RAIZ_HOMOLOGACAO>/config/.env.production`, raiz criada com `deploy.sh init --instance homolog`), com banco, porta, segredos, chaves da Hal-AI e nomes de processo próprios | idem |
| Desenvolvimento | `backend/.env` (ignorado pelo git), criado a partir de `backend/.env.example` | `npm run dev`, `npm run migrate:dev` |

- **`MF_ENV_FILE`** (variável de processo): caminho explícito do arquivo. Quando definida, é a **única** fonte de
  configuração: variáveis herdadas do shell, do PM2 ou de outros projetos são ignoradas. O `ecosystem.config.cjs`,
  as unidades `systemd --user` e o modo manual sempre a definem.
- Os scripts recusam o arquivo se ele não pertencer ao usuário atual ou tiver qualquer permissão para grupo/outros
  (inclusive só leitura, `640`; `chmod 600` resolve). O arquivo nunca entra em `releases/` nem no document root.
- Mudança de fase ou de canal: a configuração nova vai numa cópia em `config/` (ex.: `config/.env.next`), usada no
  build com `deploy.sh prepare ... --env-file` e promovida a `config/.env.production` pelo `publish --promote-env`
  (`docs/OPERATIONS.md`, seção 12). O arquivo que a API em execução lê não é editado antes da publicação.
- `scripts/*.sh` leem desse arquivo somente chaves não secretas (`PORT`, `WORKER_MODE`, `PUBLIC_SITE_URL`...), por
  meio de uma lista permitida; `READINESS_TOKEN` e a senha do banco são repassados por arquivo temporário `0600`,
  nunca pela linha de comando nem pelo log.
- **Canais do site dependem do build.** O número do WhatsApp e o webchat chegam ao navegador pela configuração
  pública exportada no build (seção 5). Ligar ou trocar um deles exige nova release, não só reiniciar a API.

## 2. Backend

Legenda da coluna **Produção**: **sim** = obrigatória; **cond.** = obrigatória quando o recurso indicado está ligado;
**—** = opcional (há padrão seguro). "Publicação" = `NODE_ENV=staging` ou `production`.

### Processo e rede

| Variável | Descrição | Produção | Exemplo (sem segredo) | Efeito |
|---|---|---|---|---|
| `NODE_ENV` | `development`, `test`, `staging` ou `production` | sim | `production` | `staging`/`production` ativam as regras de publicação: identidade real, PostgreSQL, HTTPS (também em `HALAI_API_BASE_URL` e `HALAI_WEBCHAT_SCRIPT_URL`), cookies `Secure`, `READINESS_TOKEN` e conferência dos segredos de integração (tamanho, marcador, repetição) |
| `HOST` | Endereço de escuta da API | — | `127.0.0.1` | Em homologação/produção, só loopback (`127.0.0.1`, `::1` ou `localhost`); outro valor impede a API de iniciar |
| `PORT` | Porta da API | sim | `3107` | Precisa estar livre (`scripts/preflight.sh --port`). Porta ocupada: a API encerra sem tentar outra |
| `TRUST_PROXY` | Confiança no proxy para IP/protocolo (`loopback`, `false`, número de saltos ou lista de IPs/CIDRs) | — | `loopback` | Define `req.ip` e `req.secure`. Não use `true`: aceitaria `X-Forwarded-For` de qualquer cliente — e os limites do anti-robô por IP ficariam contornáveis |
| `LOG_LEVEL` | `fatal` … `trace` ou `silent` | — | `info` | Logs JSON (pino) na saída padrão, com campos sensíveis mascarados |
| `WORKER_MODE` | `inline` ou `separate` | — | `inline` | Worker da outbox: aviso interno de atendimento e o placeholder de template da Hal-AI (seção "Hal-AI — saída"). `inline`: roda dentro da API. `separate`: exige o processo `minhafolga-worker` |
| `DATABASE_URL` | Banco **dedicado** da Minha Folga | sim | `postgres://minhafolga_app:<senha>@127.0.0.1:5432/minhafolga` | Publicação exige `postgres://`. Em desenvolvimento aceita `pglite://.dev/pglite` ou `pglite://memory` |
| `DATABASE_POOL_MAX` | Conexões máximas do pool (1–50) | — | `5` | Mantenha baixo em servidor compartilhado; some API + worker abaixo do `CONNECTION LIMIT` do papel |

### Fase financeira

| Variável | Descrição | Produção | Exemplo | Efeito |
|---|---|---|---|---|
| `CREDIT_PHASE` | `PRE_LAUNCH`, `PILOT` ou `LIVE` | sim | `PRE_LAUNCH` | `PRE_LAUNCH` nega no servidor todas as rotas de crédito (`403 credit_phase_locked`) e as ferramentas de crédito da Bia. Mudança de fase: `docs/OPERATIONS.md` |
| `CREDIT_OPERATIONS_ENABLED` | Liga operações financeiras | — | `false` | Recusado como `true` em `PRE_LAUNCH`. Mesmo em `PILOT`/`LIVE`, nesta entrega não há integração homologada |

### Site, origens e identidade empresarial

| Variável | Descrição | Produção | Exemplo | Efeito |
|---|---|---|---|---|
| `PUBLIC_SITE_URL` | URL canônica | sim | `https://www.minhafolga.com.br` | Base dos links (Bia, link de preferências, sitemap). Publicação exige `https://` |
| `ALLOWED_ORIGINS` | Origens aceitas em chamadas do navegador, separadas por vírgula | — | `https://www.minhafolga.com.br` | Padrão: `PUBLIC_SITE_URL`. `POST/PUT/PATCH/DELETE` com `Origin` fora da lista recebem `403 origin_not_allowed` |
| `LEGAL_ENTITY_NAME` | Razão social | sim | `<razão social real>` | Rodapé, avisos legais, Bia |
| `LEGAL_ENTITY_TRADE_NAME` | Nome fantasia | — | `Minha Folga` | Padrão `Minha Folga` |
| `LEGAL_ENTITY_CNPJ` | CNPJ | sim | `<CNPJ real>` | Dígitos verificadores conferidos |
| `LEGAL_ENTITY_ADDRESS` | Endereço | sim | `<endereço real>` | Rodapé e aviso de privacidade |
| `PRIVACY_CONTACT` | Canal de privacidade | sim | `<e-mail real do canal de privacidade>` | Aviso de privacidade, pedidos de titular |
| `PRIVACY_OFFICER_NAME` | Encarregado de dados | sim | `<nome do encarregado>` | Aviso de privacidade |
| `SUPPORT_CONTACT` | Canal de atendimento | sim | `<e-mail real de atendimento>` | Página de atendimento e rodapé |
| `SUPPORT_PHONE` | Telefone de atendimento (E.164) | — | `+55DDNNNNNNNNN` | Só aparece se informado |
| `SUPPORT_HOURS` | Horário de atendimento humano da equipe da Minha Folga (formulário `/atendimento`) | sim | `<horário real>` | Único horário que o site e a Bia informam |
| `SUPPORT_RESPONSE_TIME` | Prazo de resposta | — | `<prazo real>` | Informe só se corresponder à capacidade real da equipe |
| `WAITLIST_FORM_ENABLED` | Formulário de cadastro do site aberto | — | `true` | `false` fecha só o formulário do site (`503 collection_unavailable`; o site mostra "cadastro indisponível"); a Bia e o pedido de saída continuam. O painel também pausa sem reiniciar (papel admin), mas não reabre o que esta variável fechou. Uso: ataque de robôs (`docs/OPERATIONS.md`, seção 11) |
| `HUMAN_SUPPORT_ENABLED` | Atendimento humano da equipe disponível | — | `false` | Desligado: o site e as capacidades da Bia não anunciam atendimento humano. O atendimento humano **das conversas de WhatsApp e webchat** é da Hal-AI (filas e operadores), fora deste sistema |

Com `NODE_ENV=staging|production`, identidade incompleta **impede o build público** (`export-public-config` falha)
e desliga cadastro (site e Bia) e atendimento na API. Não existe valor provisório aceitável: a identidade é pendência
de publicação (`docs/PENDENCIAS_PUBLICACAO.md`, item 1).

### Canais do site (Hal-AI)

Este sistema **não envia nem recebe WhatsApp** (D1). Ele só mostra, no site, o caminho até os canais da Hal-AI: o
webchat (canal preferencial) e o WhatsApp oficial (última alternativa), no botão flutuante de conversa.

| Variável | Descrição | Produção | Exemplo | Efeito |
|---|---|---|---|---|
| `WHATSAPP_BUSINESS_NUMBER` | Número oficial do WhatsApp da Minha Folga, hospedado na Hal-AI (E.164) | — | `+55DDNNNNNNNNN` | Link `wa.me` com texto genérico no botão flutuante e nas páginas; retorno por WhatsApp no formulário de atendimento. Vazio = nenhum link de WhatsApp. Formato conferido (`+55` e 10 ou 11 dígitos) |
| `HALAI_WEBCHAT_ENABLED` | Liga o webchat da Hal-AI no site (**placeholder**: widget ainda não provisionado) | — | `false` | Com `true`, exige as duas variáveis abaixo; o canal só vai para a configuração pública com as três preenchidas |
| `HALAI_WEBCHAT_SCRIPT_URL` | Endereço do script do widget, fornecido pela Hal-AI | cond. (webchat) | `<https://… do script do widget>` | Publicação exige `https://`. O site carrega o script **só depois do clique** da pessoa e da confirmação do aviso de tratamento. A CSP do servidor web precisa liberar a origem dele (`docs/DEPLOY_SHARED_SERVER.md`, seção 5.6) |
| `HALAI_WEBCHAT_WIDGET_ID` | Identificador público do widget | cond. (webchat) | `<identificador do widget>` | O backend aceita letras, números e `. _ : -` (até 128). **Atenção:** o site só mostra o chat com identificador de letras, números, `_` e `-`, e com URL `https://` também em desenvolvimento (`frontend/src/components/site/channels.ts`); fora disso o canal simplesmente não aparece |

Nenhuma chave de API da Hal-AI vai para o navegador: só o endereço público do script e o identificador público.

### Hal-AI — entrada (a Bia chamando esta API)

A Bia é o agente de IA da Hal-AI. Ela conecta as rotas `/api/agent/*` daqui para cadastrar e consultar o cliente
(ferramentas em `docs/BIA_AGENTE.md`).

| Variável | Descrição | Produção | Exemplo | Efeito |
|---|---|---|---|---|
| `HALAI_ENABLED` | Liga as ferramentas da Bia | — | `false` | Desligado (ou sem `HALAI_INBOUND_API_KEY`): toda chamada a `/api/agent/*` responde `503 agent_disabled`. Com `WHATSAPP_BUSINESS_NUMBER`, faz o site anunciar a Bia no WhatsApp (`channels.biaOnWhatsapp`) |
| `HALAI_INBOUND_API_KEY` | Chave que a Hal-AI envia no cabeçalho `X-API-Key` | cond. (`HALAI_ENABLED`) | `<gerada pela equipe>` | Gerada pela equipe da Minha Folga e cadastrada na importação das ferramentas na Hal-AI. Comparação em tempo constante; errada → `401 invalid_api_key`. A API não inicia com `HALAI_ENABLED=true` sem ela. Em publicação: 32+ bytes, sem marcador, distinta de todos os outros segredos |
| `HALAI_WEBHOOK_SECRET` | Segredo da assinatura v1 opcional das chamadas da Bia | — | `<segredo>` | Com ele, cada chamada também precisa de `X-MF-Timestamp`, `X-MF-Signature` e `X-MF-Request-Id` (`docs/BIA_AGENTE.md`, A.2). Deixe vazio enquanto a Hal-AI não confirmar que assina as requisições. Em publicação: 32+ bytes, distinto dos demais |

### Hal-AI — saída (placeholder de template, desligado)

Única chamada deste sistema para a Hal-AI: `POST {HALAI_API_BASE_URL}/api/v1/smart-crm/send-template`
(`Authorization: Bearer hal_…`), para mandar um template de WhatsApp depois de um cadastro **novo** feito pelo site.
É um **placeholder** (agente ainda não provisionado) e fica **desligado** por padrão. Templates são pagos: as travas
estão em `docs/OPERATIONS.md`, seção 8, e no cabeçalho de `backend/src/services/signup-template.service.ts`.

| Variável | Descrição | Produção | Exemplo | Efeito |
|---|---|---|---|---|
| `HALAI_SIGNUP_TEMPLATE_ENABLED` | Liga o envio do template de cadastro | — | `false` | Com `true`, exige `HALAI_ENABLED=true` e as quatro variáveis abaixo; senão a API não inicia. Voltar para `false` também cancela, na hora do envio, o que já estiver na fila (`template_disabled`) |
| `HALAI_API_BASE_URL` | Base da API pública da Hal-AI | — | `https://api.halai.com.br` | Padrão `https://api.halai.com.br`. Publicação exige `https://` |
| `HALAI_API_KEY` | Chave `hal_…` emitida pela Hal-AI (só servidor) | cond. (template) | `<chave emitida pela Hal-AI>` | Enviada como `Authorization: Bearer`. Em publicação: 16+ bytes, sem marcador, distinta dos demais segredos |
| `HALAI_CHANNEL` | Identificador do canal WhatsApp da Minha Folga na Hal-AI | cond. (template) | `<canal>` | Campo `channel` do envio |
| `HALAI_SIGNUP_TEMPLATE` | Nome do template aprovado na Hal-AI | cond. (template) | `<nome do template>` | Idioma fixo `pt_BR`; variável do corpo: o primeiro nome (ajustar ao modelo aprovado) |
| `HALAI_TEMPLATE_DAILY_CAP` | Teto diário global de templates (1–100000), dia no horário de Brasília | cond. (template) | `<teto>` | Acima do teto, o cadastro é aceito normalmente e nada é enfileirado (aviso no log) |

### Anti-robô (sem variável de ambiente)

O anti-robô dos formulários públicos (cadastro e pedido de saída) não tem chave própria: o token do formulário é
assinado com `SESSION_SECRET`, e os parâmetros ficam no contrato `contracts/validation.json`, versionado e lido pelas
duas aplicações:

- `waitlist.antiBot`: `difficultyBits` (16), `elevatedDifficultyBits` (18, para a rede que passou do limiar abaixo),
  `minFillSeconds` (3), `tokenTtlSeconds` (7200) e `honeypotField` (`website`);
- `waitlist.limits`: `elevatedAfterPerIpPerHour` (10: a partir daí a prova fica mais difícil),
  `submissionsPerIpPerHour` (60: aí sim 429; alto de propósito por causa do CGNAT das operadoras),
  `submissionsPerCpfPerDay` (3), `submissionsPerPhonePerDay` (3), `optOutPerIpPerHour` (10);
- `waitlist.preferencesLinkTtlSeconds` (1800): validade do link de preferências gerado pela Bia.

Mudar um desses valores exige nova release das duas aplicações. Fluxo completo: `docs/ARCHITECTURE.md`, "Cadastro,
anti-robô e Hal-AI".

### Outras integrações

| Variável | Descrição | Produção | Exemplo | Efeito |
|---|---|---|---|---|
| `SUPPORT_NOTIFY_WEBHOOK_URL` | Aviso interno de nova solicitação de atendimento | — | `<https://…>` | A solicitação é gravada antes; falha do aviso não a apaga |
| `SUPPORT_NOTIFY_WEBHOOK_SECRET` | Segredo da assinatura desse aviso | cond. (URL) | `<segredo>` | 32+ bytes aleatórios, distinto de todos os outros segredos (conferido em homologação/produção) |
| `ANALYTICS_ENABLED` | Eventos de produto agregados (contadores, sem dado pessoal) | — | `false` | Desligado: `POST /api/events` não grava nada. O site só envia eventos depois do consentimento de cookies opcionais |
| `COOKIE_SECURE` | Cookies com atributo `Secure` | — | `true` | Publicação exige `true`. `false` só em desenvolvimento com HTTP local |

### Variáveis obsoletas (decisão D1)

Estas variáveis deixaram de existir e **não têm mais efeito**: `MESSAGE_PROVIDER`, `MESSAGE_PROVIDER_SECRET`,
`WHATSAPP_CLOUD_PHONE_NUMBER_ID`, `WHATSAPP_CLOUD_API_VERSION`, `WHATSAPP_TEMPLATE_VERIFICATION`,
`WHATSAPP_TEMPLATE_PREFERENCES_LINK`, `WHATSAPP_TEMPLATE_LAUNCH_NOTICE`, `WHATSAPP_TEMPLATE_MARKETING`,
`WHATSAPP_TEMPLATE_SUPPORT_REPLY`, `WHATSAPP_TEMPLATE_LANGUAGE`, `MESSAGE_WEBHOOK_SECRET`,
`MESSAGE_WEBHOOK_VERIFY_TOKEN`, `DEV_MESSAGE_LOG_FILE`, `HALAI_BASE_URL` e `HALAI_API_SECRET`
(lista em `backend/src/config/env.ts → OBSOLETE_KEYS`).

Se alguma ainda estiver no arquivo, a API inicia normalmente e registra no log, só com os nomes:
`variáveis de ambiente obsoletas ignoradas (decisão D1); remova-as do arquivo de ambiente`. Remova-as numa cópia
(`config/.env.next`) promovida na próxima publicação e descarte os segredos antigos no provedor (o token do WhatsApp
Cloud deixou de ser usado por este sistema).

### Segredos gerados

| Variável | Descrição | Produção | Formato | Efeito |
|---|---|---|---|---|
| `CONTACT_ENCRYPTION_KEY` | Chave(s) AES-256-GCM dos dados pessoais: telefone, CPF, e-mail, empregador, submissões guardadas para revisão, contatos e mensagens do atendimento | sim | `id:base64` (32 bytes). Rotação: `k2:<nova>,k1:<antiga>` | A **primeira** cifra; as demais só decifram. Perder a chave torna esses dados ilegíveis |
| `CONTACT_DEDUP_HMAC_KEY` | Chave HMAC de deduplicação de telefone e de CPF, dos limites do anti-robô e da lista de supressão | sim | 32+ bytes, distinta da anterior | **Não troque** sem plano de migração: com outra chave, cadastros existentes, CPFs já cadastrados e **pessoas descadastradas ou suprimidas** deixam de ser reconhecidos (risco de duplicar cadastros e de contatar quem pediu para sair) |
| `SESSION_SECRET` | Chave HMAC de uso interno: IP em logs e limites, assinatura do token anti-robô (`GET /api/form-token`), idempotência de envios, referência de conversas da Bia | sim | 32+ bytes | Trocar reinicia os contadores de limite por IP (em memória e os do anti-robô no banco), invalida os tokens de formulário em andamento (o site pede outro e reenvia uma vez) e a correlação de conversas; não afeta dados cifrados nem as sessões (guardadas como hash do token) |
| `READINESS_TOKEN` | Token de `GET /api/internal/ready` (cabeçalho `X-Readiness-Token`) | sim (publicação) | 24+ caracteres | Sem o token o endpoint responde 404, como se não existisse |
| `HALAI_INBOUND_API_KEY` | Chave de entrada da Bia (seção "Hal-AI — entrada") | cond. | 32+ bytes | Gerada aqui e cadastrada na Hal-AI |

### Como gerar os segredos

Gere no próprio servidor (ou no cofre de segredos da equipe), com o Node escolhido, e grave direto no arquivo
privado, sem colar em chat, ticket ou histórico do shell. Antes, apague do arquivo as linhas com marcador `< >`
copiadas do exemplo, para não ficar com a mesma chave duas vezes:

```bash
umask 077
N="$MINHAFOLGA_NODE"   # caminho absoluto do Node 24 da Minha Folga
{
  echo "CONTACT_ENCRYPTION_KEY=k1:$("$N" -p "require('crypto').randomBytes(32).toString('base64')")"
  echo "CONTACT_DEDUP_HMAC_KEY=$("$N" -p "require('crypto').randomBytes(32).toString('base64')")"
  echo "SESSION_SECRET=$("$N" -p "require('crypto').randomBytes(48).toString('base64')")"
  echo "READINESS_TOKEN=$("$N" -p "require('crypto').randomBytes(24).toString('base64url')")"
  # Só quando a Bia for ligada (HALAI_ENABLED=true); o valor é cadastrado na importação das ferramentas na Hal-AI.
  echo "HALAI_INBOUND_API_KEY=$("$N" -p "require('crypto').randomBytes(32).toString('base64url')")"
} >> "$MINHAFOLGA_APP_ROOT/config/.env.production"
chmod 600 "$MINHAFOLGA_APP_ROOT/config/.env.production"
```

- Produção, homologação e desenvolvimento têm segredos **distintos**; nunca copie o arquivo de um ambiente para
  outro. A chave de entrada da Bia de homologação é outra, cadastrada na configuração de homologação da Hal-AI.
- `HALAI_API_KEY` (saída) não é gerada aqui: é emitida pela Hal-AI e só entra no arquivo se o placeholder de template
  for ligado.
- Guarde uma cópia cifrada de `CONTACT_ENCRYPTION_KEY` e `CONTACT_DEDUP_HMAC_KEY` fora do servidor (cofre da
  equipe): o backup do banco sem essas chaves não recupera telefones, CPFs e demais dados cifrados.
- Rotação: `docs/OPERATIONS.md`, seção 10.

## 3. Scripts de implantação (`scripts/*.sh`)

Variáveis do shell de quem opera; nenhuma é gravada em perfil ou crontab.

| Variável | Obrigatória | Exemplo | Efeito |
|---|---|---|---|
| `MINHAFOLGA_APP_ROOT` | sim | `/srv/minhafolga` | Raiz exclusiva. Recusa vazio, relativo, `/`, `$HOME`, diretórios do sistema, `..` e espaços; exige o marcador `.minhafolga-root` (criado por `deploy.sh init`) |
| `MINHAFOLGA_NODE` | sim (exceto `init`/`preflight`) | `/srv/minhafolga/.runtime/node-v24.21.0-linux-x64/bin/node` | Executável Node validado (>= 24.15, < 25), usado por `prepare`/`build` e registrado na release. `publish`, `restart` e `rollback` rodam os processos com o Node **da release** (`--use-session-node` força este, com aviso). O `PATH` é ajustado só dentro do script |
| `MINHAFOLGA_NPM` | — | junto do Node | npm usado (padrão: `npm` ao lado de `MINHAFOLGA_NODE`) |
| `MINHAFOLGA_ENV_FILE` | — | `<raiz>/config/.env.production` | Outro arquivo, desde que dentro de `<raiz>/config/` |
| (instância) | — | `deploy.sh init --instance homolog` | Não é variável: gravada no marcador `.minhafolga-root` no `init` e fixa depois. Define os nomes de processo e de unidade (`prod` → `minhafolga-api`; `homolog` → `minhafolga-homolog-api`) |
| `MINHAFOLGA_PROCESS_MODE` | — | `pm2`, `systemd-user` ou `manual` | Padrão `manual` (só imprime os passos) |
| `MINHAFOLGA_PM2` | — | `/usr/local/bin/pm2` | Caminho do pm2 **existente** da hospedagem |
| `PM2_HOME` | — | (definido pelo administrador) | Lido para saber se o daemon existente está ativo; nunca alterado. Para a homologação no mesmo usuário, de preferência um `PM2_HOME` próprio |
| `TMPDIR` | — | (definido pelos scripts) | Com a raiz inicializada, os scripts usam `<raiz>/var/tmp` para os próprios temporários e os do npm/Node; antes do `init`, o `TMPDIR` da sessão |
| `MINHAFOLGA_MAX_MEMORY`, `MINHAFOLGA_WORKER_MAX_MEMORY` | — | `384M`, `256M` | `max_memory_restart` no `ecosystem.config.cjs` |
| `MINHAFOLGA_PG_DUMP`, `MINHAFOLGA_PG_RESTORE` | — | `/usr/lib/postgresql/17/bin/pg_dump` | Cliente PostgreSQL da mesma versão principal do servidor (ou mais nova) |
| `MINHAFOLGA_WEB_ACCESS` | — | `other`, `group:www-data`, `acl:www-data`, `none` | Como o servidor web (outro usuário) lê `current/frontend/dist`. Padrão `other` (leitura pública só no dist) |
| `MINHAFOLGA_NICE` | — | `10` | Prioridade reduzida de CPU/disco no build (`0` desliga) |
| `MINHAFOLGA_TEST_WORKERS` | — | `2` | Workers do vitest em `build.sh --with-tests` |
| `MINHAFOLGA_NPM_SCRIPTS` | — | `0` | `1` permite scripts de instalação no `npm ci` (nenhuma dependência atual precisa) |
| `MINHAFOLGA_ALLOW_ROOT` | — | `0` | `1` equivale a `--allow-root` (não recomendado) |

## 4. Build do frontend

Variáveis `VITE_*` entram no bundle do navegador: **nunca** coloque segredo nelas. As `MF_*` são lidas só pelo
`vite.config.ts` e pelos scripts de build. `scripts/build.sh` define todas sozinho; os valores abaixo servem para
revisão local e CI.

| Variável | Onde | Exemplo | Efeito |
|---|---|---|---|
| `VITE_SITE_URL` | bundle | `https://www.minhafolga.com.br` | Canonicals, Open Graph e sitemap (padrão: `siteUrl` da configuração pública) |
| `VITE_API_BASE_URL` | bundle | `/api` | Base das chamadas; mantenha a mesma origem |
| `MF_PUBLIC_CONFIG_FILE` | build | `frontend/.generated/public-config.json` | Configuração pública exportada pelo backend (padrão: `frontend/config/public-config.dev.json`, só revisão) |
| `MF_STRICT_RELEASE` | build | `1` | Release pública: falha com pendência de identidade, revisão editorial ou fase com `ready: false` (`docs/CONTENT_GUIDE.md`, seção 9) |
| `MF_INDEXABLE` | build | `1` | `robots.txt` de produção com `Sitemap:`. Sem ela: `Disallow: /` |
| `MF_OUT_DIR` | build | `<projeto>/.tmp/revisao/dist` | Pasta de saída alternativa (`build.sh` sempre usa `frontend/dist`). Em desenvolvimento, mantenha-a dentro do projeto (`CLAUDE.md`) |
| `MF_DEV_API_TARGET` | `npm run dev` | `http://127.0.0.1:3170` | Destino do proxy `/api` do servidor de desenvolvimento (porta 5180) |
| `MF_STATIC_PORT`, `MF_API_TARGET` | `npm run preview:static` | `5190`, `http://127.0.0.1:3170` | Servidor Node de revisão do `dist` com as mesmas regras do Nginx |
| `MF_WEBCHAT_ORIGIN` (ou `--webchat-origin`) | `npm run preview:static` | `https://<origem-do-widget-hal-ai>` | Só para revisar um build com webchat ligado: acrescenta a origem do widget a `script-src`, `connect-src` e `frame-src` da CSP do servidor de revisão. Sem ela, a CSP não libera nenhuma origem externa. Só `https://host[:porta]` |
| `MF_E2E_DIR` | `npx playwright test` | `<projeto>/.tmp/e2e` | Diretório de trabalho do e2e (banco PGlite, pessoas usuárias de teste, ambiente da API, resultados e relatório). Padrão: `frontend/.e2e`. Sempre dentro do projeto |
| `MF_E2E_API_PORT`, `MF_E2E_SITE_PORT` | `npx playwright test` | `3190`, `5190` | Portas da API isolada e do site servidos pelo e2e (padrão 3190 e 5190) |
| `MF_E2E_DIST` | `npx playwright test` | `<projeto>/.tmp/aceite/dist` | Build a testar (padrão `frontend/dist`) |

Modos do `scripts/build.sh`:

| Modo | `MF_STRICT_RELEASE` | `MF_INDEXABLE` | Uso |
|---|---|---|---|
| `--review` (padrão só no `build.sh` direto) | 0 | 0 | Revisão local; pendências visíveis, `robots.txt` bloqueando tudo. Publicável só em homologação, com `publish --allow-review-build` |
| `--staging` | 1 | 0 | Homologação (com basic auth no servidor web) |
| `--release` | 1 | 1 | Produção; exige configuração pública de produção e `https://`. Único modo que o `publish` aceita com `NODE_ENV=production` |

`deploy.sh prepare` exige um dos três modos explicitamente (ou `--prebuilt`, que lê o modo do pacote da CI).

## 5. Arquivo de configuração pública exportado

`node backend/dist/cli/export-public-config.js --env-file <arquivo> --out <json>` (chamado por `build.sh`) aplica a
**mesma validação da API** e grava somente a lista permitida de `backend/src/config/public.ts`:

- `schemaVersion`, `siteUrl`, `environment`;
- `credit.phase`, `credit.operationsEnabled`;
- `identity.*` (nome fantasia, razão social, CNPJ, endereço, canais, horários, `complete`, `missing`);
- `channels.whatsappNumber` (número oficial hospedado na Hal-AI), `channels.biaOnWhatsapp` (`HALAI_ENABLED` e número
  configurados), `channels.humanSupport`;
- `channels.webchat`: `{ enabled, scriptUrl, widgetId }` — endereço e identificador só saem com o webchat ligado e
  completo; desligado, sai `{ enabled: false, scriptUrl: null, widgetId: null }`;
- `collection.waitlistEnabled`, `collection.supportEnabled` (em homologação/produção, os dois dependem só da
  identidade completa: o cadastro não depende mais de canal de mensagens), `analyticsEnabled`;
- versões e textos dos avisos de consentimento (`contracts/consents.json`).

Nenhum segredo, URL de banco, token, chave da Hal-AI ou nome de variável secreta sai por aí; `scripts/smoke.sh`
confere isso em `GET /api/public-config`. O JSON fica em `frontend/.generated/` da release (ignorado pelo git) e é
público por definição: o conteúdo dele aparece no HTML pré-renderizado.

Em CI sem acesso aos segredos, exporte o JSON no servidor (ou num cofre) e passe-o ao build com
`build.sh --public-config <json>` ou `deploy.sh prepare ... --public-config <json>`.
