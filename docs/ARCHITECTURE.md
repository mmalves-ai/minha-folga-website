# Arquitetura — website corporativo Minha Folga

Documento técnico para quem mantém o código. O briefing de produto é `docs/MINHA_FOLGA_WEBSITE_MASTER.md`; as
decisões do contratante que o alteram estão em `docs/DECISOES.md` (onde divergem, vale a decisão). Este arquivo
descreve **como** a entrega foi construída e as convenções que qualquer alteração deve seguir.

## Visão geral

```text
navegador ──HTTPS──> Nginx/Apache existente (vhost exclusivo www.minhafolga.com.br)
                      ├── /            → current/frontend/dist/  (HTML pré-renderizado + assets com hash)
                      ├── /admin e rotas admin conhecidas → admin.html (demais /admin/... → 404)
                      ├── /api/*       → 127.0.0.1:<PORTA> (minhafolga-api, Node 24 + Express 5)
                      └── outras URLs  → 404.html com status 404
minhafolga-api ──> PostgreSQL exclusivo (cadastros, consentimentos, protocolos, admin, auditoria, anti-robô, outbox)
               └─> worker da outbox (inline ou processo minhafolga-worker)
                     ├─> aviso interno de atendimento (webhook assinado, opcional)
                     └─> API pública da Hal-AI: template de cadastro (PLACEHOLDER, desligado)
Hal-AI (Bia) ──X-API-Key (+ assinatura HMAC opcional)──> /api/agent/*  (ferramentas permitidas por fase)
navegador ──(só depois do clique)──> widget de webchat da Hal-AI (PLACEHOLDER) · link wa.me do número oficial
```

**Decisão D1 (26/09/2026).** Este sistema não envia nem recebe WhatsApp. O número oficial (WhatsApp Cloud), a Bia, o
webchat, as filas e os operadores do atendimento humano das conversas, os templates e as campanhas são da plataforma
**Hal-AI**. Aqui ficam o site, o cadastro (formulário com anti-robô e APIs para a Bia), as preferências, o formulário
de atendimento, o painel e a auditoria. Não há provedor de mensagens, webhook de mensagens nem código de
confirmação.

| Camada | Pasta | Tecnologia | Saída |
|---|---|---|---|
| Frontend | `frontend/` | Vue 3.5 + Vite 8 + TypeScript + Vue Router 5, pré-renderização com `vite-ssg` | `frontend/dist/` |
| Backend | `backend/` | Node.js 24 LTS + Express 5 + TypeScript, zod, pg, pino | `backend/dist/` |
| Contratos | `contracts/` | OpenAPI 3.1, JSON de validação, de consentimentos e das ferramentas da Bia | lidos pelas duas aplicações |
| Implantação | `deploy/`, `scripts/` | shell POSIX/bash, PM2 opcional, exemplos Nginx/Apache | release imutável |

Cada aplicação tem `package.json`, `package-lock.json`, `node_modules` e build próprios (`npm ci` no diretório).
Nenhuma ferramenta global é necessária — e nenhuma pode ser usada: **tudo fica restrito ao diretório do projeto**
(`CLAUDE.md`). Em desenvolvimento, o Node é o runtime privado de `.runtime/` (`scripts/node-runtime.sh install`), e
`scripts/node-runtime.sh exec` põe cache do npm, temporários (`TMPDIR`) e caches de ferramentas (XDG, compile cache,
Playwright) em `.cache/` e `.tmp/`. A versão de Node está em `.node-version` (24.21.0, patch LTS mais recente em
26/09/2026; faixa compatível >= 24.15 < 25); a implantação usa sempre o caminho absoluto do executável escolhido (ver
`docs/DEPLOY_SHARED_SERVER.md`).

## Fase financeira

`CREDIT_PHASE` (`PRE_LAUNCH` padrão, `PILOT`, `LIVE`) e `CREDIT_OPERATIONS_ENABLED` governam **somente** o crédito.
O website corporativo é completo em todas as fases.

- Servidor: `backend/src/services/phase.service.ts` é a fonte única. `/api/credit/*` responde 403
  `credit_phase_locked` em PRE_LAUNCH (inclusive chamadas diretas) e 503 `credit_unavailable` enquanto não houver
  integração homologada. As ferramentas financeiras da Bia usam a mesma decisão e nem leem a entrada.
- Conteúdo: textos de disponibilidade por fase ficam em `frontend/content/site.yaml → availability`. Uma fase sem
  textos revisados (`ready: false`) interrompe o build — a mudança de fase é coordenada (conteúdo + servidor + Bia).
- `PRE_LAUNCH` com `CREDIT_OPERATIONS_ENABLED=true` é configuração inválida e impede a API de iniciar.

## Configuração

- Backend: esquema único em `backend/src/config/env.ts`, carregado por `loadConfig()` (`config/index.ts`). Em
  produção o arquivo é informado por `MF_ENV_FILE` e passa a ser a **única** fonte (o processo não herda variáveis
  de outros projetos do servidor). Homologação/produção exigem identidade empresarial real, HTTPS, PostgreSQL e
  segredos fortes e distintos. Variáveis obsoletas pela D1 (`OBSOLETE_KEYS`) são ignoradas com aviso no log.
- Configuração pública: `backend/src/config/public.ts` define a lista permitida. Ela é exportada no build
  (`npm run export:public-config`) para o frontend pré-renderizar rodapé, avisos legais e canais (WhatsApp oficial e
  webchat), e servida em `GET /api/public-config`. Nada fora dessa lista sai do servidor. Canais do site mudam só
  com nova release.
- Frontend: somente `VITE_SITE_URL` e `VITE_API_BASE_URL` entram no bundle. Variáveis `MF_*` são de build.
- Regras compartilhadas: `contracts/validation.json` (campos do cadastro, faixas, UFs, DDDs, `antiBot`, limites,
  eventos) e `contracts/consents.json` (textos e versões) são importados pelas duas aplicações.

## Cadastro, anti-robô e Hal-AI (D1)

Contrato técnico completo em `docs/DECISOES.md` → "Contrato técnico de D1". Resumo de como está implementado:

**Anti-robô próprio, sem terceiros** (`backend/src/services/anti-bot.service.ts`, `lib/proof-of-work.ts`;
`frontend/src/composables/useFormProof.ts`, `src/workers/pow.worker.ts`, `components/forms/AntiBotTrap.vue`):

1. No primeiro foco do formulário, o site pede `GET /api/form-token`: `token` = payload `{ v, c, d, iat }` em
   base64url + HMAC-SHA256 com `SESSION_SECRET`. Nada é gravado no servidor até o uso.
2. Um Web Worker (JavaScript puro) procura o `nonce` com `SHA-256("<desafio>:<nonce>")` com `difficultyBits` bits
   zero à esquerda. Sem Worker, a busca roda na página em fatias curtas.
3. O envio leva `antiBot: { token, nonce }` e o campo-armadilha `website` (fora da tela, sem tabulação, sem
   autopreenchimento). O site espera o tempo mínimo (`minFillSeconds`) antes de enviar.
4. O servidor confere assinatura, idade (entre `minFillSeconds` e `tokenTtlSeconds`), prova e **uso único** (sha256
   do token em `form_token_uses`, gravado na mesma transação da submissão — um pedido recusado por validação ou
   limite não queima o token). Falha → `400 form_expired`; o site pega outro token e reenvia **uma** vez, sem perder o
   que foi digitado. Campo-armadilha preenchido → `201` genérico **sem gravar**.
5. Limites sobre submissões aceitas (`form_attempts`, HMAC da rede de origem, do CPF e do telefone): por IP/hora, por
   CPF/dia e por telefone/dia; no pedido de saída, por IP/hora. Acima → `429 rate_limited`. Há ainda uma barreira
   grossa em memória por IP nas rotas.
6. Dificuldade adaptativa por rede (CGNAT): com `limits.elevatedAfterPerIpPerHour` cadastros aceitos na última hora, o
   `GET /api/form-token` passa a emitir `antiBot.elevatedDifficultyBits`; token mais fácil emitido antes disso →
   `form_expired` no envio (o site reenvia com um token novo). O 429 por rede só vem em
   `limits.submissionsPerIpPerHour`.

**Cadastro pelo site** (`routes/waitlist.ts`, `services/waitlist.service.ts`, `services/customer-data.ts`):
`POST /api/waitlist` com corpo estrito (nome completo, CPF, WhatsApp, e-mail opcional, empregador, vínculo, tempo
no emprego, faixa de salário líquido, cidade/UF, 18+, consentimentos e versões, origem, UTM). Resposta `201` sempre
idêntica — novo, existente, suprimido ou robô. Cadastro novo nasce `received` (telefone não validado). Telefone ou
CPF já cadastrado: nada é sobrescrito; a submissão vai cifrada para `lead_submissions` (revisão). Contato suprimido
(telefone ou CPF): nada é gravado. A equipe de privacidade aplica ou descarta cada submissão no painel
(`services/admin-submissions.service.ts`: só dados cadastrais, nunca telefone nem preferências; justificativa e
auditoria; conteúdo apagado depois da revisão).

**Interruptor do formulário** (`services/collection-switch.service.ts`): `WAITLIST_FORM_ENABLED=false` ou a pausa pelo
painel (`PUT /api/admin/collection/waitlist-form`, papel admin, guardada em `app_settings` e lida com cache de 5 s)
fecham só o formulário do site: `POST /api/waitlist` → `503 collection_unavailable` e `/api/public-config` com
`collection.waitlistEnabled=false`. A Bia e o pedido de saída continuam.

**Bia (entrada)** (`routes/agent.ts`, `integrations/halai/request-auth.ts`, `services/agent-tools.service.ts`,
`services/customer.service.ts`): `X-API-Key` comparada em tempo constante; assinatura v1 opcional
(`HALAI_WEBHOOK_SECRET`) com janela e replay. Ferramentas: `get_approved_faq`, `upsert_customer`,
`get_customer_status`, `update_contact_preferences`, `issue_preferences_link`; reservadas de crédito negadas por fase.
Ferramentas de cadastro e preferências só agem sobre o **telefone atestado pela plataforma** (`senderPhone` +
`senderVerified` no envelope, nunca no `input`). `upsert_customer` cria ou atualiza com os mesmos campos do formulário
e marca o número como validado (`verified`); CPF de outro cadastro, CPF diferente do cadastrado ou contato suprimido
→ `needs_review`, sem mesclar. Detalhes em `docs/BIA_AGENTE.md`.

**Preferências** (`routes/preferences.ts`, `services/preferences.service.ts`, `services/opt-out.service.ts`): a Bia
gera o link seguro de uso único (`/preferencias#token=…`, o token no fragmento, que o navegador não envia ao servidor
web); `POST /api/preferences/token` troca o token por sessão (`mf_contact`, 30 min). Sem sessão, o site só oferece o
**pedido de saída** pelo número (`POST /api/preferences/opt-out`, anti-robô, `202` genérico). A página mostra dados
mascarados; CPF, telefone, nome e empregador não mudam por ali.

**Hal-AI (saída, placeholder)** (`integrations/halai/client.ts`, `services/signup-template.service.ts`): envio de
template `POST /api/v1/smart-crm/send-template` pela outbox (canal `halai`), **desligado** por padrão. Só entra na
fila para cadastro novo pelo site, depois de todas as travas anti-robô, com o aviso de abertura autorizado, no máximo
uma vez por número em 30 dias e dentro do teto diário global. Erros sem o corpo da resposta (que pode ecoar o número).

**Canais no site** (`frontend/src/components/site/FloatingContact.vue`, `channels.ts`, `webchat-loader.ts`,
`WebchatLoader.vue`): botão flutuante em todas as páginas do `DefaultLayout`, com "Conversar com a Bia no site"
(webchat, preferencial, só com `channels.webchat` válido: aviso de tratamento → clique em "Abrir o chat" → só então
o script do widget é inserido) e "WhatsApp" (última alternativa, `wa.me` do número oficial com texto genérico). Sem
canal configurado, nada é renderizado. O widget é placeholder: a CSP do servidor web só libera a origem dele quando
ele for habilitado.

## Frontend

- Rotas em `src/router/routes.ts`; o manifesto `src/router/manifest.ts` (dados puros) alimenta pré-renderização,
  sitemap e as regras do servidor web. Toda página pública tem HTML com conteúdo e metadados por URL
  (`dist/<rota>.html`, estilo "flat" sem barra final).
- Layouts: `DefaultLayout` (cabeçalho, rodapé, consentimento de cookies, botão flutuante de conversa, anúncio de
  navegação) e `AdminLayout`.
- SEO: `useSeo()` define título, descrição, canonical, Open Graph e robots por página. Ambientes que não são
  produção recebem `noindex` e `robots.txt` com `Disallow: /`.
- Conteúdo versionado em `frontend/content/` (ver `docs/CONTENT_GUIDE.md`): YAML para páginas, FAQ, jornada e
  abertura financeira; Markdown para artigos e páginas legais. O plugin `build/content-plugin.ts` renderiza Markdown
  no build com HTML bruto desabilitado e substitui marcadores `{{identity.*}}` pela configuração pública.
- Modo estrito (`MF_STRICT_RELEASE=1`, usado por `scripts/build.sh --release`): o build falha se faltar identidade
  empresarial, revisão de artigos, aprovação de conteúdo ou revisão de avisos legais.
- `scripts/postbuild.mjs` confere HTML de todas as rotas, títulos únicos, canonical, noindex, ausência de segredos,
  de estilo/script inline (a CSP bloqueia) e, no modo estrito, de qualquer marcador `[pendente: …]`.
- Formulários: CPF e telefone com máscara de digitação (`src/lib/cpf.ts`, `src/lib/phone.ts`) e a mesma validação do
  servidor (dígitos verificadores do CPF; DDD de `validation.json`). Dados digitados ficam só na memória da página:
  nada em `localStorage`, URL ou medição. A confirmação de envio usa `history.state`, nunca a URL.
- Navegação: `meta.navSection` em `src/router/routes.ts` define o item ativo do menu quando o caminho não começa por
  ele (ex.: `/consignado-privado` → Soluções). O menu móvel aplica `inert` ao restante de `#app` enquanto está aberto.
  O desfoque do cabeçalho fica num `::before`: `backdrop-filter`, `filter` ou `transform` no próprio `<header>`
  criariam um bloco de contenção e quebrariam o painel `position: fixed` do menu.
- Acessibilidade das ações: confirmação sem mudança de foco sai por `useAnnouncer()` (`src/composables/useAnnouncer.ts`,
  região viva única e persistente); blocos visuais criados por `v-if` não levam `role="status"`; erros usam
  `role="alert"`. Durante o envio, botões usam `aria-disabled` (nunca `disabled`) com guarda no handler. Quando o botão
  acionado some, o foco vai para o resultado ou o controle equivalente (`focusIfLost` em
  `components/forms/form-helpers.ts`). Os diálogos do painel (`AdminDialog`) têm `error` (mensagem focada dentro do
  diálogo) e `returnFocus` (alvo do foco quando o elemento de origem sumiu). O painel do botão flutuante não é
  modal, fecha com Esc e devolve o foco à origem.
- Rotas administrativas: cada filho novo de `/admin` precisa entrar na lista de rotas conhecidas do servidor web
  (`deploy/nginx.minhafolga.conf.example`, `deploy/apache.minhafolga.conf.example`, `scripts/static-server.mjs`);
  as demais URLs sob `/admin/` respondem 404. `scripts/smoke.sh` confere a lista a partir do roteador.
- Medição: `services/analytics.ts` só envia com `ANALYTICS_ENABLED` e consentimento, e só dimensões do contrato
  `contracts/validation.json → events` (o backend recusa as demais).
- Design system em `src/styles/` (tokens da marca + derivados para contraste) e componentes em `src/components/`.
  Classes utilitárias: `.container`, `.section(--paper|--mint|--forest)`, `.split`, `.grid--N`, `.card`, `.btn--*`,
  `.notice`, `.badge`, `.field/.input/.select/.textarea/.choice`, `.accordion`, `.tabs`, `.steps`, `.prose`.

## Backend

```text
src/
  app.ts            createApp(ctx): helmet, no-store, request id, cookies; JSON de até 16 KB em todas as rotas, com
                    corpo bruto guardado para a assinatura opcional da Bia (não há mais /api/webhooks)
  server.ts         processo minhafolga-api (recusa iniciar com migração pendente; desligamento gracioso)
  worker.ts         processo opcional minhafolga-worker (WORKER_MODE=separate)
  bootstrap.ts      contexto: config, banco, logger, cliente de saída da Hal-AI; aviso de variáveis obsoletas
  config/           env.ts (esquema e OBSOLETE_KEYS), index.ts (loadConfig), public.ts (lista permitida), contracts.ts, paths.ts
  db/               database.ts (interface), pg.ts (produção), pglite.ts (dev/test), migrate.ts
  routes/           uma factory por área: health, public, anti-bot (form-token), credit, waitlist, preferences,
                    support, events, agent, admin/
  services/         regras de negócio (lead-lifecycle.ts é o contrato interno do cadastro; customer-data.ts,
                    customer.service.ts, anti-bot.service.ts, opt-out.service.ts, signup-template.service.ts…)
  repositories/     acesso a dados reutilizável (leads, submissions, outbox)
  middleware/       origin-guard (CSRF base), contact-session, rate-limit, validate, error-handler
  integrations/     halai/ (autenticação de entrada, assinatura v1, cliente de saída), notify/ (aviso interno)
  lib/              crypto, cpf, phone, email, cnpj, proof-of-work, totp, password, errors, logger
  jobs/             outbox-worker, retenção
  cli/              migrate, admin-create, export-public-config, retention-review
migrations/         SQL versionado (001_initial.sql, 002_limits_and_links.sql, 003_d1_cadastro_halai.sql,
                    004_interruptor_e_revisao.sql),
                    aplicado por `npm run migrate`
tests/              vitest + supertest com PGlite em memória (PostgreSQL real em WebAssembly)
```

A migração `003_d1_cadastro_halai.sql` é **aditiva**: acrescenta os campos do cadastro, `lead_submissions`,
`form_token_uses`, `form_attempts` e o canal `halai` da outbox, sem remover tabelas. `verification_challenges`
fica sem uso (legado, alcançada pela retenção e pela anonimização); itens antigos do canal `whatsapp` na outbox são
cancelados pelo worker sem envio (`whatsapp_removed`). A `004_interruptor_e_revisao.sql` só cria `app_settings`
(estado da pausa do formulário, sem dado pessoal).

Convenções obrigatórias:

- Validação com zod em modo estrito (`z.strictObject`), convertida por `parseOrThrow` em `validation_error`.
  Campos do cadastro normalizados num lugar só (`services/customer-data.ts`), usados pelo site, pela Bia e por
  Preferências.
- Queries sempre parametrizadas. Contagens com `::int`. IDs `crypto.randomUUID()` gerados na aplicação.
- Dados pessoais cifrados com AES-256-GCM (`encryptField(valor, keyring, contexto)`), contexto distinto por campo e
  por registro (`lead.phone:<id>`, `lead.cpf:<id>`, `lead.email:<id>`, `lead.employer:<id>`,
  `lead_submission:<id>`…). Deduplicação com `hmacHex(e164, dedupKey, 'phone')` e `hmacHex(cpf, dedupKey, 'cpf')` —
  pseudonimização, não anonimização. Painel e titular veem dicas mascaradas (`***.***.***-12`, `(11) •••••-••34`).
- Tokens (sessões, links, acompanhamento, anti-robô) guardados apenas como `sha256Hex`. Comparações sensíveis com
  `safeEqual`.
- Logs: `requestContext` registra método, rota, status e duração. Nunca registrar corpo, telefone, CPF, e-mail,
  empregador, mensagem, token, cookie, chave ou IP em claro (usamos HMAC do IP). Erros de integração só com status e
  código, nunca o corpo da resposta.
- Erros: lançar `AppError`/`Errors.*` com código estável e mensagem em português. Sem sucesso falso.
- Toda ação administrativa relevante chama `recordAudit()`; mudanças do titular geram `lead_events`; chamadas da Bia
  geram `agent_tool_calls` (sem conteúdo).
- Mensagens para fora do sistema passam pela outbox (`enqueueMessage`) na mesma transação do evento; o worker
  confere de novo, no envio, supressão, finalidade autorizada e se o recurso continua ligado.
- Respostas que poderiam revelar cadastro (cadastro, pedido de saída) são idênticas para todos os casos.

## Segurança em camadas

- Mesma origem para site e API; cookies `HttpOnly; Secure; SameSite=Strict`; `originGuard` exige JSON e origem
  permitida; a área administrativa soma token CSRF por sessão, MFA (TOTP) e permissões por papel no backend.
- Formulários públicos com anti-robô próprio (prova de trabalho, token assinado de uso único, idade mínima,
  campo-armadilha) e limites no banco por rede de origem, CPF e telefone; limites de requisição em memória por HMAC
  do IP (uma instância; IPv6 agrupado por /56).
- Templates pagos da Hal-AI: desligados por padrão; ligados, só depois das travas anti-robô, uma vez por número em
  30 dias e com teto diário global.
- MFA com contador de falhas próprio por conta (5 a cada 15 min); um novo login com senha correta não o zera.
- Ferramentas da Bia com `X-API-Key` em tempo constante e, opcionalmente, assinatura HMAC com janela de tempo e
  proteção contra replay; o telefone vem do atestado da plataforma, nunca do modelo.
- Cabeçalhos de segurança da API via helmet; CSP, HSTS e cabeçalhos do site no virtual host
  (`deploy/nginx.minhafolga.conf.example`). A CSP não libera nenhuma origem externa enquanto o webchat estiver
  desligado; `worker-src 'self'` cobre o Web Worker da prova de trabalho.
