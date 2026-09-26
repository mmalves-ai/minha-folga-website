# Critérios de aceite — evidências

Registro de verificação dos critérios da seção 13 de `docs/MINHA_FOLGA_WEBSITE_MASTER.md`, executado em
**26/09/2026** sobre a árvore de trabalho da época, com Node **24.21.0** (`.node-version`) do runtime privado do
projeto (`.runtime/`, `scripts/node-runtime.sh`); backend, frontend, build e e2e foram refeitos com ele, sem gravar
nada fora do diretório do projeto.

Legenda: **✅ verificado** nesta entrega · **⏳ depende de dado, contrato ou decisão real** (listado em
`docs/PENDENCIAS_PUBLICACAO.md`; o build estrito e/ou a validação de configuração bloqueiam a publicação enquanto
faltar) · **⚠ parcial** · **↻ reverificar (D1)**: o critério ou a implementação mudou com a decisão D1 e a evidência
registrada é anterior a ela.

## Decisão D1 — o que mudou e o que precisa ser reverificado

Em 26/09/2026, depois da rodada de verificação registrada abaixo, o contratante tomou a decisão **D1**
(`docs/DECISOES.md`): o WhatsApp saiu deste sistema (Bia, número oficial, webchat, atendimento humano das conversas,
templates e campanhas ficam na Hal-AI); o cadastro passou a coletar CPF, empregador, tempo no emprego e faixa de
salário líquido, **sem confirmação por código**, com anti-robô próprio; a Bia passou a cadastrar pelo telefone
atestado; as preferências passaram a abrir por link gerado pela Bia, com pedido de saída pelo número no site.

Consequências para este registro:

- **Os números de suítes, rotas, e2e, desempenho e bateria de implantação abaixo são anteriores à D1.** A
  implementação de D1 trouxe migração nova (`003_d1_cadastro_halai.sql`), suítes novas ou reescritas
  (`backend/tests/anti-bot.test.ts`, `halai.test.ts`, `agent.test.ts`, `waitlist.test.ts`, `preferences.test.ts`,
  `retention.test.ts`, `admin-privacy.test.ts`, `outbox.test.ts`; `frontend/src/workers/pow.test.ts`,
  `src/lib/cpf.test.ts`, `src/components/site/FloatingContact.test.ts`; `frontend/e2e/journeys.spec.ts`) e removeu as
  de código de confirmação e de webhook de mensagens (`verification-limits.test.ts`, `webhooks.test.ts`). **Nenhum
  resultado pós-D1 está registrado aqui**: a rodada completa precisa ser refeita (tipos, vitest, build, e2e,
  `selftest.sh`, bateria de implantação e medição de desempenho) e anotada nesta página.
- Critérios que dependiam de confirmação por código, provedor de WhatsApp, webhook de mensagens ou da ferramenta de
  transbordo da Bia deixaram de se aplicar como estavam escritos; foram reescritos abaixo com a marcação ↻.
- Critérios novos trazidos por D1 estão na seção "Critérios acrescentados pela D1", todos ↻ até a nova rodada.

## Como reproduzir

A partir da raiz do projeto, sempre com o Node privado (nada fora do diretório do projeto; em máquina compartilhada,
um passo de cada vez e `--maxWorkers=2`):

```bash
scripts/node-runtime.sh install && eval "$(scripts/node-runtime.sh env)"   # Node privado em .runtime/, caches em .cache/ e .tmp/
cd backend  && npm ci && npx tsc --noEmit -p tsconfig.json && npx vitest run --maxWorkers=2
cd frontend && npm ci && npm run typecheck && npx vitest run --maxWorkers=2
cd frontend && MF_OUT_DIR="$PWD/../.tmp/aceite/dist" npm run build   # vite-ssg + postbuild.mjs, fora de frontend/dist
cd frontend && npx playwright test            # e2e: site pré-renderizado + API real isolada (PGlite)
MINHAFOLGA_NODE="$(command -v node)" scripts/selftest.sh [--with-pm2]   # scripts de implantação, sem rede
```

| Suíte | Resultado em 26/09/2026 (anterior à D1) | Situação |
|---|---|---|
| Backend: `tsc` + `vitest` | sem erros de tipo; 20 arquivos, 259 testes, todos passando. **Com D1 (26/09/2026, 17h):** sem erros de tipo; 20 arquivos, 262 testes, todos passando. **Com D1.1 (18h):** 21 arquivos, 271 testes, todos passando | ✔ refeito com D1.1 |
| Frontend: `vue-tsc` + `tsc` (build) + `vitest` | sem erros de tipo; 15 arquivos, 139 testes, todos passando. **Com D1:** sem erros de tipo; 18 arquivos, 180 testes, todos passando. **Com D1.1:** 20 arquivos, 194 testes, todos passando | ✔ refeito com D1.1 |
| Build: `vite-ssg` + `postbuild.mjs` | 24 rotas pré-renderizadas; títulos únicos, canonical, noindex nas privadas, sem segredos, sem estilo/script inline. **Com D1:** 24 rotas, `postbuild` ok (padrões de segredo ampliados para as chaves da Hal-AI) | ✔ refeito com D1 |
| E2E (`frontend/e2e`, Chrome) | 57 testes, todos passando (`routes.spec.ts` 51 + `journeys.spec.ts` 6). **Com D1:** 63 testes, todos passando (`routes.spec.ts` 53 + `journeys.spec.ts` 10), com `MF_E2E_DIR` dentro do projeto; refeito com D1.1 (dificuldade adaptativa na jornada da API): 63 passando | ✔ refeito com D1.1 |
| Implantação: `scripts/selftest.sh` | 87 OK com `--with-pm2` e 69 OK, 0 falha sem PM2, em 26/09/2026 (diretório de teste fora do projeto, antes da regra "tudo restrito ao projeto"). Agora o diretório de teste fica sempre dentro do projeto e os scripts recusam raízes com espaço: rode o autoteste a partir de um checkout num caminho sem espaços (este checkout, `…/minha folga/…`, tem espaço) | ⚠ sem mudança de D1 nos scripts; refazer num caminho sem espaço |
| Servidor web: `nginx -t` (nginx:alpine) e `httpd -t` (httpd:2.4-alpine) com os modelos | sintaxe ok nos dois | ↻ refazer: o resíduo `/api/webhooks/` já saiu dos modelos; falta rodar `nginx -t`/`httpd -t` (containers, só com autorização) e, com o webchat, a CSP ampliada |
| Bateria de implantação (raiz de teste, PostgreSQL 17, Nginx e Apache em containers) | ver `docs/DEPLOY_SHARED_SERVER.md`, seção 12 (smoke pelo Nginx: 82 OK) | ↻ refazer com a migração 003 |

## Visual e conteúdo

| Critério | Evidência (anterior à D1, salvo indicação) | Situação |
|---|---|---|
| Todas as páginas da seção 5 completas, com conteúdo próprio, navegação e acesso direto por URL; nada substituído por âncoras de landing | `routes.spec.ts`: 22 rotas públicas por acesso direto (200, um `<h1>`, canonical, descrição própria no HTML sem JavaScript), 4 rotas privadas acessíveis com `noindex`; `postbuild.mjs` exige HTML com `<h1>` por rota; revisão adversarial de conteúdo institucional, editorial e legal (seções 6.1–6.16) | ✅ · ↻ conteúdo de cadastro, Bia, segurança, preferências e avisos legais reescrito para D1 |
| Quatro artigos com corpo completo, fontes pertinentes e revisão registrada; busca/filtros de conteúdo e ajuda funcionando, inclusive sem resultado | Artigos em `frontend/content/articles/` com fontes oficiais conferidas (BCB, gov.br/MTE, Planalto); testes de busca/filtro e estado vazio (`src/components/editorial/*.test.ts`); texto exato de busca vazia da `/ajuda` | ✅ corpo, fontes e busca · ⏳ **revisão financeira registrada** (`review.status: pending`; o build estrito falha) |
| `/avise-me` faz parte do website e usa o mesmo cadastro, identidade e consentimentos | `journeys.spec.ts` (cadastro pela landing contra a API real; textos de consentimento de `contracts/consents.json`) | ↻ formulário novo (CPF, empregador, faixas, anti-robô) |
| 360, 390, 768, 1024 e 1440 px sem rolagem horizontal e sem texto cortado | `routes.spec.ts` mede `scrollWidth` nas 5 larguras em 26 rotas; revisão visual com capturas em todas as larguras e verificação das correções; menu móvel medido (altura da janela, último link e CTA visíveis) | ↻ formulário maior e botão flutuante (não pode cobrir CTAs, aviso de cookies nem campos com o teclado aberto) |
| Logo legível, paleta aplicada, hierarquia clara; primeira dobra apresenta a empresa; disponibilidade financeira legível onde relevante | Revisão visual; logo oficial (SVG) no cabeçalho e rodapé; aviso "Crédito em estruturação" junto aos CTAs de crédito | ✅ |
| Seções, FAQ, rotas e rodapé completos; sem Lorem ipsum, CNPJ fictício, selo falso, número inventado ou botão sem destino | `postbuild.mjs` (padrões proibidos); `routes.spec.ts` (sem Lorem); dados empresariais só da configuração validada (sem ela: marcador visível em desenvolvimento e bloqueio no build estrito e na API em produção); busca de afirmações proibidas na revisão | ✅ · ⏳ identidade empresarial real |
| Demonstração da Bia rotulada; chat real só quando integrado | Rótulo "Exemplo de conversa" e nota em todas as demonstrações. Com D1: botão flutuante só com canal configurado; chat do site só com `channels.webchat` válido e carregado só depois do clique e do aviso de tratamento; WhatsApp como última alternativa (`FloatingContact.test.ts`) | ↻ refazer com o botão flutuante · ⏳ widget da Hal-AI (placeholder) |

## Cadastro e comunicação

| Critério | Evidência | Situação |
|---|---|---|
| Cadastro válido persiste; clique duplo não duplica (D1: sem confirmação de contato por código) | Antes da D1: `journeys.spec.ts` (duplo clique = 1 código). Com D1: token anti-robô de uso único gravado na transação da submissão, botão com guarda durante o envio e submissão repetida guardada à parte (`anti-bot.test.ts`, `waitlist.test.ts`) | ↻ |
| Mesma resposta para CPF/telefone novo ou já cadastrado; cadastro existente não é sobrescrito pelo site | `waitlist.test.ts` (resposta idêntica; submissão guardada cifrada em `lead_submissions`) | ↻ |
| Falha de banco nunca exibe sucesso falso; retentativa e recuperação dos envios | `waitlist.test.ts` (falha de banco → erro, nunca 201); `outbox.test.ts` (retentativa com backoff); com D1 os envios são só o aviso interno e o placeholder da Hal-AI (`halai.test.ts`) | ↻ |
| Consentimentos separados, não pré-marcados e auditáveis; recusar marketing permite cadastro | `journeys.spec.ts` (caixas desmarcadas; cadastro sem marketing); `lead_preferences` + `lead_events` com versão do texto | ✅ · ↻ jornada nova |
| Descadastro funciona e impede próximos disparos da finalidade revogada | Antes da D1: `preferences.test.ts`, `outbox.test.ts`, `webhooks.test.ts` ("SAIR" pelo webhook, removido). Com D1: `revoke_all` da Bia (`agent.test.ts`), sessão de Preferências pelo link da Bia e pedido de saída pelo número (`preferences.test.ts`); worker cancela na hora do envio | ↻ |
| Rate limit e abuso com resposta segura (D1: anti-robô em vez de limites de código) | `anti-bot.test.ts`: token assinado, prova de trabalho, idade mínima, validade, uso único, campo-armadilha (201 sem gravar), limites por IP, CPF e telefone (429) | ↻ |
| Atendimento persiste e gera protocolo; histórico exige autorização; equipe encaminha e conclui pelo painel | `support.test.ts` (cifrado em repouso; protocolo sozinho não lê); `journeys.spec.ts` (protocolo, link seguro, assumir e iniciar atendimento no painel); `admin-*.test.ts` (transições com responsável e horário) | ✅ · ↻ jornada e2e refeita junto |
| Login administrativo, MFA, permissões e auditoria no backend; sem autorização não há acesso pela API | `admin-auth.test.ts` (sem credencial padrão; bloqueio; MFA com contador próprio; CSRF); matriz de permissões em `admin-*.test.ts`; `journeys.spec.ts` (perfil de marketing: API nega cadastros) | ✅ · ↻ revelação agora inclui CPF |

## Fase e IA

| Critério | Evidência | Situação |
|---|---|---|
| Em PRE_LAUNCH, chamadas diretas a endpoints de crédito negadas | `platform.test.ts` (todas as rotas `/api/credit/*` → 403 `credit_phase_locked`); `routes.spec.ts`; `agent.test.ts` (ferramentas financeiras da Bia → 403) | ✅ · ↻ refazer com as suítes novas |
| Perguntas sobre taxa, aprovação e data sem promessa inventada | FAQ com respostas da seção 6.8 (versão 2, D1); `get_approved_faq` responde só da base; respostas obrigatórias em `docs/BIA_AGENTE.md` | ✅ servidor · ↻ base reescrita · ⏳ bateria de 36 casos com o modelo real na Hal-AI (homologação) |
| Bia (D1): pede CPF e dados do cadastro só no roteiro, com aviso de privacidade e permissão; nunca pede documento, senha, código ou dado bancário; não segue instrução para ignorar política ou revelar segredos | `upsert_customer` com entrada estritamente validada, telefone só do atestado da plataforma, `needs_review` sem mescla (`agent.test.ts`); nenhuma ferramenta expõe configuração nem CPF completo; casos em `docs/BIA_AGENTE.md`, Parte E | ↻ servidor · ⏳ comportamento do modelo e confirmação do atestado pela Hal-AI (homologação) |
| Atendimento humano com canal e horário reais; indisponibilidade não mascarada | `HUMAN_SUPPORT_ENABLED=false` → nenhuma promessa de encaminhamento humano; horários só de `SUPPORT_HOURS`. Com D1, a transferência humana das conversas é da Hal-AI (sem ferramenta de transbordo aqui) | ✅ código · ⏳ equipe, horários e procedimento de transferência na Hal-AI |

## Critérios acrescentados pela D1

| Critério | Onde conferir | Situação |
|---|---|---|
| Este sistema não envia nem recebe WhatsApp; não há rota de webhook de mensagens nem código de confirmação | `backend/src/routes/index.ts` (sem `/api/webhooks`); worker cancela itens antigos do canal `whatsapp` sem envio (`outbox.test.ts`); variáveis obsoletas ignoradas com aviso | ↻ |
| Robôs não geram custo nem lixo: template da Hal-AI desligado por padrão; ligado, só depois do anti-robô, para cadastro novo pelo site, 1 por número em 30 dias e com teto diário | `halai.test.ts` (travas do placeholder); `anti-bot.test.ts` | ↻ |
| CPF, telefone, e-mail e empregador cifrados; deduplicação por HMAC; dados mascarados no painel, no CSV, em Preferências e para a Bia; revelação completa só com motivo e auditoria | `waitlist.test.ts`, `agent.test.ts`, `admin-*.test.ts`; `backend/src/lib/cpf.ts` | ↻ |
| Bia cadastra e atualiza só o número atestado; CPF de outro cadastro, CPF divergente ou contato suprimido → `needs_review` sem mudar nada | `agent.test.ts` (`upsert_customer`) | ↻ · ⏳ confirmação da Hal-AI sobre a injeção de `senderPhone`/`senderVerified` |
| Preferências por link seguro de uso único gerado pela Bia; pedido de saída pelo número sem revelar cadastro | `agent.test.ts` (`issue_preferences_link`), `preferences.test.ts` | ↻ |
| Webchat carregado só depois do clique e do aviso de tratamento; nenhuma chave no navegador; CSP sem origem externa enquanto desligado | `FloatingContact.test.ts`; `frontend/src/components/site/webchat-loader.ts`; modelos de vhost | ↻ · ⏳ widget e origens da Hal-AI |
| Anonimização e supressão alcançam os dados de D1 (CPF na lista de supressão; submissões guardadas; tentativas do anti-robô) | `admin-privacy.test.ts`; alcance dos atendimentos em `privacy-reach.test.ts` | ↻ |
| Retenção remove submissões guardadas e artefatos do anti-robô | `retention.test.ts` | ↻ · ⏳ prazos jurídicos (item 4 das pendências) |
| D1.1 — Submissões guardadas: a equipe de privacidade aplica (só dados cadastrais; nunca telefone nem preferências) ou descarta, com justificativa e auditoria; `cpf_conflict`/`suppressed` só descartam; CPF de outro cadastro → `cpf_in_use`; conteúdo apagado após a revisão | `admin-review.test.ts`; painel: detalhe do cadastro (testes do frontend) | ✅ API · ✅ painel (`AdminLeadDetailPage.test.ts`) |
| D1.1 — Interruptor do formulário do site: pausa pelo painel (só admin, justificativa, auditoria) em até ~30 s; `WAITLIST_FORM_ENABLED=false` fecha e o painel não reabre; a Bia continua | `admin-review.test.ts` (503 no site, `public-config` sem cadastro, Bia cadastra); painel: `WaitlistFormCard.test.ts` | ✅ |
| D1.1 — Rede compartilhada (CGNAT) não é barrada cedo: prova mais difícil a partir de 10 cadastros/h da rede; 429 só em 60; token fácil antigo → `form_expired` com reenvio | `anti-bot.test.ts`; `journeys.spec.ts` (jornada da API) | ✅ |
| D1.1 — Botão flutuante não cobre os canais que a página já mostra (recolhe enquanto estão visíveis) | `FloatingContact.test.ts` | ✅ |

## Publicação

| Critério | Evidência | Situação |
|---|---|---|
| Controlador, razão social, CNPJ e canais reais validados; privacidade e termos revisados | Validação de configuração recusa produção sem identidade real (`platform.test.ts`); build estrito lista as pendências | ⏳ (inclui base legal e RIPD dos dados de D1) |
| Backup e restauração do cadastro demonstrados; permissões revisadas | Bateria de implantação: `pg_dump` antes de migrar, restauração em banco separado com as mesmas contagens (`DEPLOY_SHARED_SERVER.md`, seção 12); roteiro trimestral em `OPERATIONS.md`, seção 9 | ✅ em ambiente de teste (antes da migração 003) · ↻ refazer com a 003 · ⏳ destino externo e teste no banco real |
| Teste completo em celular e teclado, incluindo erro e revogação; desempenho medido no cenário definido | Antes da D1: `journeys.spec.ts` (erros de validação, código errado, revogação, menu móvel por teclado); revisão de acessibilidade com zoom 200%; medição de laboratório abaixo | ↻ refazer com o formulário novo, o pedido de saída e o botão flutuante |
| Responsável aprova conteúdo e estado da operação; rollback preserva cadastros | Bateria: rollback manteve protocolo criado antes; aprovação de conteúdo registrada em `revision`/`review` (hoje `draft`) | ✅ rollback (antes da D1) · ⏳ aprovações |

### Desempenho em laboratório (seção 12) — anterior à D1

Cenário: Chrome 390×844 (DPR 3, toque), CPU 4× mais lenta, rede 150 ms de latência, 1,6 Mbps de descida e
750 kbps de subida, cache desabilitado; build de 26/09/2026 anterior à D1, servido por
`frontend/scripts/static-server.mjs`; mediana de 3 carregamentos; interação = clique no menu móvel ou num item da FAQ
(maior duração de evento).

| Página | LCP | CLS | Interação | Transferido |
|---|---|---|---|---|
| `/` | 1,35 s | 0 | 56 ms | 426 KB |
| `/avise-me` | 1,19 s | 0,022 | 56 ms | 408 KB |
| `/consignado-privado` | 1,20 s | 0 | 56 ms | 395 KB |
| `/conteudos/o-que-e-cet` | 1,18 s | 0 | 72 ms | 376 KB |
| `/ajuda` | 1,20 s | 0 | 48 ms | 392 KB |

↻ Medir de novo: o formulário de `/avise-me` ficou maior, todas as páginas ganharam o botão flutuante e a prova de
trabalho roda num Web Worker a partir do primeiro foco no formulário (conferir que a interação continua dentro da
meta em celular lento).

Metas da seção 12: LCP ≤ 2,5 s, INP ≤ 200 ms, CLS ≤ 0,1 no percentil 75 **de campo**. Os números acima são de
laboratório; os de campo só existirão depois da publicação.

## Frontend, backend e isolamento

| Critério | Evidência | Situação |
|---|---|---|
| Pastas, manifests, lockfiles, dependências e builds separados; instalação reproduzível sem pacotes globais novos | `frontend/` e `backend/` com `package.json`/`package-lock.json` próprios; `npm ci` com cache privado nos scripts; bateria com checkout limpo. D1 não acrescentou dependência (anti-robô em JavaScript puro, sem terceiros) | ✅ |
| HTML público com conteúdo e metadados por rota; refresh funciona; URL inexistente → 404; erro de API não retorna HTML da home | `routes.spec.ts` (HTML sem JavaScript, 404 real, `/api/...` → JSON); regras equivalentes nos modelos Nginx/Apache e no servidor de revisão | ✅ · ↻ refazer com as suítes novas |
| API em porta reservada e processo exclusivo; runtime, usuário, caminhos, limites e ambiente documentados | Nomes por instância (`minhafolga-api`, `minhafolga-homolog-api`…); `DEPLOY_SHARED_SERVER.md`, `ENVIRONMENT.md` (variáveis de D1 documentadas) | ✅ |
| Banco, credenciais, migrações, cache/fila e logs delimitados; nenhum segredo no bundle ou no document root | Banco e usuário dedicados (SQL de exemplo); outbox no próprio banco; `postbuild.mjs` procura segredos no `dist` | ✅ · ↻ incluir as chaves novas da Hal-AI na busca de segredos (pendência da frente de frontend) |
| A publicação altera só arquivos e configuração da Minha Folga; inventário antes/depois sem alteração de outros sites | `preflight.sh --out`/`--compare` na bateria (reinício de processo alheio é acusado) | ✅ em ambiente de teste · ⏳ na hospedagem real |
| Atualização e rollback verificados em homologação, sem comandos globais nem perda de cadastros | Bateria em raiz de teste com PM2 próprio e modo manual; `selftest.sh` | ✅ em ambiente de teste · ⏳ homologação real |
| README, contratos de API, exemplos de ambiente, guia de conteúdo e procedimento de implantação/retomada; pendências identificadas | `README.md`, `docs/DECISOES.md`, `contracts/openapi.yaml`, `contracts/agent-tools.json`, `backend/.env.example`, `frontend/.env.example`, `docs/CONTENT_GUIDE.md`, `docs/DEPLOY_SHARED_SERVER.md`, `docs/OPERATIONS.md`, `docs/PENDENCIAS_PUBLICACAO.md`, `docs/BIA_AGENTE.md` — atualizados para D1 | ✅ documentação · ↻ conferência cruzada com a rodada de testes |

## Revisão adversarial

Uma revisão independente em 6 dimensões (conteúdo institucional, conteúdo editorial e legal, segurança e privacidade
do backend, implantação e isolamento, design visual, acessibilidade e jornadas), com verificação cética de cada
achado, confirmou 70 achados (3 bloqueadores, 18 importantes, 49 menores). Todos foram tratados na rodada de
correções de 26/09/2026. Verificadores independentes conferiram o código corrigido: 66 resolvidos de imediato,
3 parciais e 1 pendente de documento (este arquivo), além de 5 regressões menores introduzidas pelas correções.
Os 4 itens restantes e as 5 regressões foram corrigidos em seguida, com testes de regressão (limites de código por
origem, pausa depois de revogação escalonada, número oficial exigido com mensagens pelo WhatsApp, sonda de outro
domínio no smoke, títulos de seção na faixa de 30–44 px medidos em todas as páginas, evidência do limite de 3 MB dos
webhooks refeita).

↻ Essa revisão é anterior à D1. Parte das correções citadas (limites de código por origem, pausa depois de revogação,
número oficial exigido com mensagens pelo WhatsApp, limite de 3 MB dos webhooks) foi **superada** pela D1: o código
correspondente saiu. As superfícies novas — formulário com CPF e empregador, anti-robô, ferramentas da Bia com
telefone atestado, submissões guardadas, pedido de saída, botão flutuante e placeholders da Hal-AI — ainda não
passaram por revisão adversarial.
