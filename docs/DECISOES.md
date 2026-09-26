# Decisões de produto e arquitetura

Registro das decisões do contratante que alteram a especificação `docs/MINHA_FOLGA_WEBSITE_MASTER.md`. Onde houver
conflito, **vale o que está aqui**. Cada decisão tem data; alterações futuras entram como novas seções.

## D1 — 26/09/2026 · WhatsApp e Bia 100% na Hal-AI; cadastro com CPF e empregador

Decisão do contratante (mmalves), em 26/09/2026:

1. **Este sistema não mexe com WhatsApp.** Todo o WhatsApp (número oficial, WhatsApp Cloud, Bia, atendimento humano,
   filas, operadores, templates, campanhas) é da plataforma **Hal-AI**. Sai daqui: envio de código de confirmação,
   provedores de mensagem (`dev_log`, `whatsapp_cloud`), webhook `/api/webhooks/whatsapp`, reenvio e verificação de
   código no cadastro e no acesso às preferências.
2. **O agente da Hal-AI (Bia) conecta as APIs daqui** para cadastrar e consultar o cliente. Quando a pessoa fala com a
   Bia no WhatsApp, o telefone **já está validado** pelo próprio canal (atestado pela plataforma).
3. **Formulário de cadastro no site com dados úteis:** nome completo, CPF, WhatsApp, empregador (nome), tipo de
   vínculo, tempo no emprego atual (faixas), faixa de salário líquido (faixas, com "prefiro não informar"), cidade/UF,
   e-mail (opcional), confirmação de 18+, consentimentos. **Sem confirmação por WhatsApp ao enviar o formulário.**
   O telefone de um cadastro feito pelo site fica "não validado" até a própria pessoa falar com a Bia.
4. **Robôs não podem gerar custo nem lixo.** Proteção anti-robô própria, sem terceiros (prova de trabalho no
   navegador, token assinado de uso único, campo-armadilha, tempo mínimo, validação de CPF e DDD, limites por IP,
   CPF e número). O **placeholder** de envio de template pela API da Hal-AI existe no código, **desligado**; se um dia
   for ligado, só dispara depois das travas anti-robô, uma vez por número em 30 dias e com teto diário global.
5. **Webchat da Hal-AI** é o canal preferencial no site (em outubro/2026 o WhatsApp passa a ser cobrado). Placeholder
   do widget: carregado **só depois do clique**, com aviso de tratamento. **WhatsApp é a última alternativa** (botão
   flutuante para o número oficial hospedado na Hal-AI), útil também para validar o telefone.
6. **Preferências:** a Bia gera, por API, um **link seguro de uso único** para `/preferencias` (o número é atestado
   pela conversa). No site, qualquer pessoa pode **pedir saída** informando o número, sem ver dados.
7. **Atendimento humano do WhatsApp fica na Hal-AI** (filas, operadores, transferência). O painel daqui continua com
   as solicitações do formulário `/atendimento`, cadastros, privacidade, auditoria e usuários.

Itens da especificação superados por D1: 6.7 (sem CPF/empregador; confirmação por código), 6.8 ("Como saio da lista"
passa a indicar Bia ou pedido de saída), 7 (Bia não pede CPF → a Bia pode coletar os dados do cadastro com
consentimento), 8.6 (rotas de verificação e webhooks de mensagem), 8.8 (fluxo de estados com verificação), 9 (dados
tratados).

Pendências jurídicas abertas por D1 (ver `docs/PENDENCIAS_PUBLICACAO.md`): base legal para CPF, empregador e faixa
salarial nesta fase (consentimento ou procedimentos preliminares a pedido do titular — art. 7º, I ou V, LGPD), relatório
de impacto (RIPD), prazo de retenção desses dados, contrato com a Hal-AI como operadora e transferência internacional.

## Contrato técnico de D1 (fonte para backend e frontend)

### Anti-robô (`contracts/validation.json → waitlist.antiBot`)

- `GET /api/form-token` → `200 { token, challenge, difficultyBits, expiresInSeconds, minFillSeconds }`.
  - `token` = `base64url(JSON payload) + "." + base64url(HMAC-SHA256(SESSION_SECRET, payload))`,
    payload `{ v: 1, c: <challenge base64url 16 bytes>, d: <bits>, iat: <epoch ms> }`. Sem estado no servidor até o uso.
- Prova de trabalho: o navegador procura `nonce` (inteiro decimal, a partir de 0) tal que
  `SHA-256(UTF-8("<challenge>:<nonce>"))` tenha pelo menos `difficultyBits` bits zero à esquerda. Roda num Web Worker,
  em JavaScript puro (sem dependência externa), começando no primeiro foco do formulário.
- Envio: corpo com `antiBot: { token, nonce }` e o campo-armadilha `website` (sempre vazio para humanos).
- Servidor: assinatura válida; idade do token ≥ `minFillSeconds` e ≤ `tokenTtlSeconds`; prova de trabalho correta;
  **uso único** (hash do token gravado até expirar). Falha de token/prova → `400 form_expired` (o frontend pega novo
  token e reenvia uma vez, sem perder o que foi digitado). Campo-armadilha preenchido → `201` genérico **sem gravar**
  (não ensina o robô).
- Limites (`waitlist.limits`): por IP/hora, por CPF/dia e por telefone/dia. Acima → `429 rate_limited`.
- Rede compartilhada (CGNAT): a partir de `elevatedAfterPerIpPerHour` cadastros aceitos na última hora, o token sai com
  `antiBot.elevatedDifficultyBits`; token mais fácil emitido antes → `400 form_expired` (o site reenvia). O 429 por
  rede só vem em `submissionsPerIpPerHour` (ver D1.1).

### Cadastro pelo site

- `POST /api/waitlist` — corpo estrito:
  `{ fullName, cpf, phone, email?, employerName, employmentType, jobTenure, incomeRange, city, uf, ageConfirmed: true,
  interestTopic?, consents: { launch_notice: true, marketing }, consentVersions: { launch_notice, marketing },
  source, utm?, antiBot: { token, nonce }, website? }`.
- Resposta `201 { status: "received", message }` — **idêntica** para CPF/telefone novo ou já existente (não revela
  cadastro). Dados de um cadastro existente **não são sobrescritos** pelo site: a nova submissão é guardada à parte
  (cifrada) para revisão, e só a Bia (telefone atestado) ou a equipe de privacidade (no painel, D1.1) alteram o cadastro.
- Erros: `400 validation_error` (`fields`: `cpf` → "Confira o CPF.", `phone` → "Confira o DDD e o número.", …),
  `400 form_expired`, `409 consent_version_outdated`, `429 rate_limited`, `503 collection_unavailable`.
- Armazenamento: CPF, telefone, e-mail e empregador cifrados (AES-256-GCM, contexto por campo); chaves de
  deduplicação HMAC para CPF e telefone; dicas mascaradas para o painel (`***.***.***-12`, `(11) •••••-••34`).
  Faixas e UF em claro (códigos). Nada disso em logs, URLs, métricas ou `localStorage`.
- Estado do cadastro: `received` (site, telefone não validado) → `verified` (telefone atestado pela Bia) →
  `invited`; laterais `unsubscribed`, `expired`. `contact_verified_at` = momento em que a Bia atestou o número.

### Preferências

- `POST /api/preferences/token { token }` → sessão do titular (cookie `mf_contact`), como antes. O token vem do link
  gerado pela Bia (`issue_preferences_link`), no fragmento da URL (`/preferencias#token=…`), uso único, validade de
  `waitlist.preferencesLinkTtlSeconds`.
- `GET/PATCH /api/preferences`, `POST /api/preferences/deletion-request`, `POST /api/preferences/logout` — como antes
  (sessão obrigatória). A visão mostra dados mascarados.
- `POST /api/preferences/opt-out { phone, antiBot }` → `202` genérico; revoga aviso e novidades do número se existir.
  Sem sessão, não mostra nada.
- Removidos: `/api/preferences/access` e `/api/preferences/access/verify`.

### Ferramentas da Bia (Hal-AI → esta API)

- Autenticação: cabeçalho `X-API-Key: <HALAI_INBOUND_API_KEY>` (comparação em tempo constante) — é o modelo que a
  Hal-AI usa para APIs; assinatura HMAC por requisição continua aceita quando disponível.
- Telefone atestado: `senderPhone` + `senderVerified: true` preenchidos **pela plataforma** a partir do canal (nunca
  pelo modelo) — a confirmar com a Hal-AI.
- Ferramentas: `get_approved_faq`, `upsert_customer` (cria/atualiza pelo telefone atestado, com os mesmos campos do
  formulário; CPF de outro cadastro com outro telefone → `needs_review`, sem mesclar), `get_customer_status`,
  `update_contact_preferences` (inclui "sair" = revogar tudo), `issue_preferences_link`. Reservadas (bloqueadas em
  PRE_LAUNCH): `check_eligibility`, `query_margin`, `get_proposal`, `simulate_credit`.
  Removidas: `create_waitlist_interest`, `verify_contact`, `request_human_support` (atendimento humano é da Hal-AI).

### Hal-AI (saída — placeholder)

- API pública `https://api.halai.com.br` (`Authorization: Bearer hal_…`, envelope `{ success, data, meta }`).
- Envio de template: `POST /api/v1/smart-crm/send-template` `{ to, channel, templateName, language, bodyVariables }`.
- Configuração: `HALAI_API_BASE_URL`, `HALAI_API_KEY`, `HALAI_CHANNEL`, `HALAI_SIGNUP_TEMPLATE`,
  `HALAI_SIGNUP_TEMPLATE_ENABLED=false` (padrão), `HALAI_TEMPLATE_DAILY_CAP`.

### Canais no site (configuração pública)

- `channels.whatsappNumber` — número oficial hospedado na Hal-AI (botão flutuante, `wa.me`, texto genérico).
- `channels.webchat` — `{ enabled, scriptUrl, widgetId }` do widget da Hal-AI (placeholder; carrega após o clique;
  a CSP do servidor web precisa liberar a origem do widget quando habilitado). Vem de `HALAI_WEBCHAT_ENABLED`,
  `HALAI_WEBCHAT_SCRIPT_URL` (sempre `https://`, também em desenvolvimento) e `HALAI_WEBCHAT_WIDGET_ID`
  (`[A-Za-z0-9_-]`, até 128). A API e o site aplicam a mesma regra.

### Em aberto

- Como a lista de quem aceitou receber novidades chega às campanhas da Hal-AI (exportação pelo painel, consulta da
  Hal-AI a esta API ou envio daqui para a API da Hal-AI). Até a decisão, nenhuma lista sai deste sistema.

## D1.1 — 26/09/2026 · Revisão das submissões, pausa do formulário e limite por rede

Aprovado pelo contratante (mmalves) em 26/09/2026, completando D1:

1. **Revisão das submissões guardadas no painel** (`privacy:manage`). A equipe de privacidade aplica ao cadastro ou
   descarta cada submissão, sempre com justificativa e auditoria (sem valores). Aplicar muda só dados cadastrais
   (nome, CPF, e-mail, empregador, vínculo, tempo no emprego, faixa de renda, cidade/UF, tema); **nunca o telefone**
   (só a Bia valida número) **nem as preferências** (só o titular muda). `cpf_conflict` e `suppressed` só se
   descartam; CPF que já é de outro cadastro → `409 cpf_in_use`. Depois da revisão o conteúdo cifrado é apagado.
   - `POST /api/admin/leads/{id}/submissions/{submissionId}/apply|discard { reason }` →
     `200 { status: "applied" | "discarded", changed: [<campos>] }`.
2. **Interruptor do formulário do site.** O papel admin pausa e reabre pelo painel, sem reiniciar
   (`GET /api/admin/collection`, `PUT /api/admin/collection/waitlist-form { paused, reason }`, permissão
   `collection:manage`). `WAITLIST_FORM_ENABLED=false` fecha pelo servidor, e o painel não reabre. Fecha só o
   formulário do site; a Bia e o pedido de saída continuam.
3. **Limite por rede sem barrar CGNAT.** O limite de 5 cadastros por IP/hora barrava gente de verdade atrás do mesmo
   IP da operadora. Passa a ser **dificuldade adaptativa**: prova de 16 bits até 10 cadastros aceitos da rede na
   última hora, 18 bits depois disso, e 429 só a partir de 60. CPF (3/dia) e telefone (3/dia) continuam iguais.
4. **Botão flutuante** se recolhe enquanto a própria página mostra os canais de conversa (Bia, WhatsApp, chat), para
   não cobri-los no celular.


## D1.2 — 26/09/2026 · Campos completos preservados na experiência visual

Durante a execução do briefing visual, o contratante reafirmou: **“o cadastro tem de ter CPF, empregador, etc.”**.
Essa instrução direta prevalece sobre a sugestão de captação reduzida da seção 9 do briefing visual.

- Permanecem os campos e as exigências de D1: nome completo, CPF, WhatsApp, empregador, vínculo, tempo no emprego,
  faixa salarial, cidade/UF, maioridade e consentimentos separados; e-mail e tema de interesse opcionais.
- A experiência pode dividir o preenchimento em etapas. Avançar uma etapa não envia nem grava dados; o cadastro
  completo continua sendo enviado uma única vez ao mesmo `POST /api/waitlist`, com todas as proteções existentes.
- Cadastro existente continua com resposta genérica e revisão separada; a interface explica essa possibilidade
  sem revelar se CPF ou telefone estão cadastrados. Sucesso exige resposta válida do backend.
- D1 e D1.1, inclusive integrações, painel, contratos e pendências jurídicas, permanecem vigentes.


### Medição da aquisição nesta revisão

Os eventos opcionais `waitlist_cta_click`, `waitlist_error` e `waitlist_confirmed` usam somente a origem de uma lista
fechada (`waitlist.sources`). Não enviam campo, valor digitado, CPF, contato, texto de erro ou conteúdo de conversa.
Continuam condicionados à configuração da medição e à escolha vigente de cookies; o inventário foi atualizado e a
Política de Cookies passa à versão 1.3, ainda em rascunho para revisão.

- Clique: intervalo inferior a 1 segundo na mesma origem conta uma vez.
- Erro: somente quando exibido à pessoa, no máximo uma vez por origem durante o carregamento da página.
- Recebimento: somente depois de resposta válida do backend, no máximo uma vez por origem na página. A resposta
  genérica também atende submissões repetidas; portanto esse evento **não representa novos cadastros**. Os totais
  operacionais do backend (`waitlist_received`, `waitlist_held`, `waitlist_suppressed`) continuam separados.
- `bia_channel_click` continua significando clique. A medição de **conversa iniciada** depende de callback verificável
  da Hal-AI ainda não configurado; nenhum clique ou carregamento de widget é tratado como conversa.


## D1.3 — Oportunidade, capacidade limitada e fila (26/09/2026)

O usuário confirmou expressamente que a Minha Folga terá jornada 100% digital e ágil, IA
para buscar propostas melhores por perfil e possibilidade de aliviar parcelas dos consignados
privados existentes. Confirmou também que o valor disponível para emprestar é limitado e haverá
fila: quanto antes concluir o cadastro, antes entra na ordem de chamada.

A home, a landing e as páginas institucionais passam a apresentar esses benefícios como proposta
para a abertura da operação, preservando PRE_LAUNCH. O CTA é “Quero entrar na fila”. A fila é
para chamada/análise; não reserva dinheiro, não aprova crédito nem garante redução de parcela.
“Melhor proposta” significa a melhor entre as opções disponíveis para o perfil, sem alegar
cobertura de todo o mercado ou menor taxa comprovada.

Referência operacional: usar a antiguidade do cadastro válido/autorizado (created_at original),
considerando critérios da operação e disponibilidade. O repositório preserva created_at nas
atualizações/duplicatas; a exportação CSV já ordena por created_at ASC, id. O painel lista
recentes primeiro e não deve ser tomado como ordem de chamada. Não foi implementado motor de
propostas, contador de posição ou disparador de convites nesta revisão do website. A operação
de chamadas deve aplicar e registrar essa ordem na abertura.

A confirmação de envio continua genérica, pois a resposta aceita da API também protege
duplicatas, revisões e supressões. Ela não afirma posição ou inclusão individual garantida.
CPF, empregador e todos os demais campos D1 e consentimentos separados permanecem.
