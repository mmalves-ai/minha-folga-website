# Pendências de publicação

Lista do que falta para abrir a **coleta pública** (cadastro de interesse e atendimento) e publicar as
**páginas legais** como versão definitiva. Cada item diz o que é, onde se configura e o que fica bloqueado
enquanto faltar. Nada aqui deve ser resolvido com dado provisório, fictício ou “de exemplo”: o item só sai da
lista com a informação real, validada por quem responde por ela.

Situação em 26/09/2026: identidade empresarial, contratos, chaves da Hal-AI, revisões e decisões abaixo **ainda não
foram informados**. O site funciona em desenvolvimento com marcadores de pendência visíveis.

**Decisão D1 (26/09/2026, `docs/DECISOES.md`).** O WhatsApp saiu deste sistema: número oficial, Bia, webchat,
atendimento humano das conversas, templates e campanhas são da plataforma Hal-AI. O cadastro passou a coletar CPF,
empregador, tempo no emprego e faixa de salário líquido, sem confirmação por código, com anti-robô próprio. Isso
**eliminou** as pendências de provedor de mensagens e de templates de confirmação e **abriu** as pendências
jurídicas e de integração do item 3 (Hal-AI) e do novo item 4 (dados do cadastro).

## Como conferir o que ainda falta

As travas abaixo já existem no código. Elas não podem ser contornadas por variável do frontend nem por edição
de HTML.

| Trava | Onde está | O que recusa |
|---|---|---|
| Validação da configuração do backend | `backend/src/config/env.ts` (`identityIssues`, `crossFieldIssues`) | Com `NODE_ENV=staging` ou `production`, a API **não inicia** sem identidade completa, CNPJ válido, `COOKIE_SECURE=true`, `READINESS_TOKEN`, HTTPS e PostgreSQL dedicado, ou com marcadores `<...>` nos valores, segredos curtos ou repetidos. Em qualquer ambiente, não inicia com `HALAI_ENABLED=true` sem `HALAI_INBOUND_API_KEY`, com o template ligado sem agente, chave, canal, template e teto diário, ou com o webchat ligado sem endereço e identificador. |
| Coleta de cadastro | `backend/src/config/index.ts` (`collection`) | Em homologação/produção, com identidade incompleta: `waitlistEnabled=false` (formulário do site e `upsert_customer` da Bia) e `supportEnabled=false`. O formulário mostra indisponibilidade, nunca sucesso falso. O cadastro não depende mais de canal de mensagens. |
| Placeholder de template da Hal-AI | `backend/src/services/signup-template.service.ts` | Desligado por padrão; ligado, só enfileira depois das travas anti-robô, para cadastro novo pelo site, uma vez por número em 30 dias e dentro do teto diário. |
| Build estrito (`scripts/build.sh --release` ou `--staging`, que define `MF_STRICT_RELEASE=1`) | `frontend/build/content-plugin.ts` (`releaseIssues` e marcadores) | Falha com qualquer `{{pending: ...}}` no conteúdo, identidade incompleta, `VITE_SITE_URL` diferente de `PUBLIC_SITE_URL`, aviso legal sem revisão aprovada, artigo sem revisão financeira ou sem data de publicação e YAML de conteúdo sem aprovação registrada. |
| Verificação do HTML na release estrita | `frontend/scripts/postbuild.mjs` (`PENDING_MARKERS`) | Falha se qualquer página pré-renderizada tiver `[pendente: …]` ou elemento `pending-data`, inclusive os que vêm de componentes que mostram um dado de configuração ausente. |
| Marcos de lançamento | `frontend/src/components/editorial/milestones.ts` | Falha se um marco estiver `in_progress` ou `done` sem `evidence`, `updatedAt` e `responsible`. |

Comandos úteis (não publicam nada):

- Listar os marcadores de conteúdo: `grep -rn "{{pending:" frontend/content`
- Listar os marcadores dos documentos (Bia): `grep -n "{{pending:" docs/BIA_AGENTE.md`
- Ver todas as pendências do build estrito, a partir de `frontend/`:
  `../scripts/node-runtime.sh exec env MF_STRICT_RELEASE=1 MF_OUT_DIR="$PWD/../.tmp/strict-check/dist" npx vite-ssg build`
  (a pasta de saída fica dentro do projeto; nunca sobrescreva `frontend/dist`).
- O build de revisão (sem `--release`) também lista, como aviso, os dados empresariais pendentes em cada página.

---

## 1. Identidade empresarial

Todos os valores ficam no arquivo privado de ambiente do backend, fora do document root
(`<MINHAFOLGA_APP_ROOT>/config/.env.production`, indicado em `MF_ENV_FILE`; modelo em `backend/.env.example`).
O `scripts/build.sh` exporta a configuração pública a partir dele, e o frontend preenche rodapé, páginas legais e
atendimento com esses dados (`{{identity.*}}` no conteúdo). Nenhum desses dados deve ser digitado nas páginas.

- [ ] **Razão social — `LEGAL_ENTITY_NAME`**
  - O que é: nome empresarial da controladora dos dados e responsável pela marca Minha Folga.
  - Onde aparece: rodapé, Aviso de Privacidade (“Quem cuida dos seus dados”), Termos (“Sobre estes termos” e
    “Propriedade intelectual”), dados estruturados da organização.
  - Bloqueia: início da API em homologação/produção; cadastro (site e Bia) e atendimento; build estrito.
- [ ] **CNPJ — `LEGAL_ENTITY_CNPJ`**
  - O que é: CNPJ real da mesma pessoa jurídica. A validação confere os dígitos verificadores.
  - Bloqueia: o mesmo que a razão social.
- [ ] **Endereço — `LEGAL_ENTITY_ADDRESS`**
  - O que é: endereço da sede ou do estabelecimento responsável, como consta no CNPJ ou como a revisão jurídica
    indicar.
  - Bloqueia: o mesmo que a razão social.
- [ ] **Nome fantasia — `LEGAL_ENTITY_TRADE_NAME`**
  - O que é: “Minha Folga”, já preenchido. Confirmar que é o nome que será usado publicamente (veja o item 10).
- [ ] **Canal de privacidade — `PRIVACY_CONTACT`**
  - O que é: e-mail (ou outro canal escrito) monitorado para pedidos de titulares, aos cuidados do encarregado.
  - Onde aparece: Aviso de Privacidade (várias seções e cartão de contato), Política de cookies, rodapé.
  - Bloqueia: início da API em homologação/produção; cadastro e atendimento; build estrito.
- [ ] **Canal de atendimento — `SUPPORT_CONTACT`** e, se houver, **telefone — `SUPPORT_PHONE`** (formato E.164)
  - O que é: canal público de atendimento. O telefone é opcional e só entra se for atendido de verdade.
  - Onde aparece: Termos (“Contato”), Atendimento, rodapé.
  - Bloqueia: `SUPPORT_CONTACT` bloqueia o início da API em homologação/produção e o build estrito.

## 2. Encarregado de dados

- [ ] **Designação formal do encarregado — `PRIVACY_OFFICER_NAME`**
  - O que é: pessoa (ou empresa) indicada como encarregada pelo tratamento de dados (LGPD, art. 41). A LGPD exige
    que a identidade e o contato do encarregado sejam divulgados publicamente, preferencialmente no site
    (art. 41, § 1º), e admite que a ANPD defina hipóteses de dispensa conforme o porte da entidade
    (art. 41, § 3º). A revisão jurídica decide se a empresa indica encarregado ou se enquadra em alguma dispensa.
    Se houver dispensa, o texto do Aviso precisa ser ajustado; o canal de privacidade continua obrigatório.
  - Onde: variável no ambiente do backend; atribuições descritas em `frontend/content/legal/privacidade.md`.
  - Bloqueia: início da API em homologação/produção; cadastro e atendimento; build estrito.
- [ ] **Rotina de atendimento aos titulares**
  - O que é: quem responde, em que prazo e como registra os pedidos (confirmação e acesso em até 15 dias quando
    pedida a declaração completa — art. 19). O painel já tem a área “Privacidade” (revogar tudo, suprimir contato,
    anonimizar). Com D1, a rotina precisa incluir o **repasse à Hal-AI** dos pedidos que alcançam conversas
    (exclusão, acesso), conforme o contrato do item 3.
  - Onde: permissões dos usuários administrativos (painel `/admin/usuarios`) e procedimento interno
    (`docs/OPERATIONS.md`, seção 6).
  - Bloqueia: não trava o build, mas o Aviso promete que cada pedido é registrado e acompanhado.

## 3. Provedores, contratos e Hal-AI

Cada provedor que trata dados em nome da Minha Folga precisa de contrato com cláusulas de proteção de dados
(papel de operador, instruções, segurança, suboperadores, retenção, devolução ou eliminação ao fim do contrato
e local de processamento). O Aviso de Privacidade só cita provedores efetivamente contratados.

- [ ] **Hospedagem, servidor e banco de dados**
  - O que é: nome do provedor da hospedagem e do PostgreSQL, local dos servidores e contrato.
  - Onde: marcador em `frontend/content/legal/privacidade.md` (“Com quem compartilhamos”); banco dedicado em
    `DATABASE_URL` (usuário exclusivo, menor privilégio).
  - Bloqueia: build estrito (marcador); a API não inicia em produção sem PostgreSQL.
- [ ] **Guarda dos registros de acesso por 6 meses**
  - O que é: o Marco Civil da Internet (Lei nº 12.965/2014, art. 15) exige guardar os registros de acesso a
    aplicações (data, hora e IP) por 6 meses, sob sigilo e com acesso restrito. A API não grava IP em claro (só
    um resumo criptográfico); quem guarda o IP é o log de acesso do servidor web. O Aviso de Privacidade descreve
    esse registro como: IP, data e hora, endereço pedido **sem a query string**, resultado técnico e user-agent,
    **sem referer e sem cookies**, guardado por 6 meses e apagado depois. O formato do log do vhost precisa
    corresponder a essa descrição. É preciso confirmar onde fica, a rotação que garante os 6 meses (e a exclusão
    depois deles) e quem pode consultar.
  - Onde: `access_log`/`log_format` em `deploy/nginx.minhafolga.conf.example` e `CustomLog`/`LogFormat` em
    `deploy/apache.minhafolga.conf.example`, que já gravam exatamente esse formato na pasta exclusiva
    `<DIRETORIO_DE_LOGS_MINHAFOLGA>`; retenção de exemplo em `deploy/logrotate.minhafolga-web.conf.example`
    (acesso 185 dias e apagado depois; erro 30 dias). Resta a hospedagem criar a pasta, instalar a regra e confirmar.
    Marcadores em `frontend/content/legal/privacidade.md` (“Registros técnicos e de segurança”, registro de erro e as
    linhas do servidor web na tabela de retenção).
  - Bloqueia: build estrito (marcadores).
- [ ] **Servidor padrão explícito de outro dono em 80/443**
  - O que é: o vhost da Minha Folga não declara `default_server`; se a hospedagem não tiver um servidor padrão
    explícito para cada endereço e porta usados (inclusive `[::]` se houver IPv6), o primeiro vhost carregado vira o
    padrão implícito e poderia atender domínios de outros sites.
  - Onde: configuração principal do servidor web (administrador da hospedagem); conferido por `scripts/preflight.sh`
    e pelo grupo “Domínio” de `scripts/smoke.sh`.
  - Bloqueia: publicação segura no servidor compartilhado.
- [ ] **Prazo dos registros técnicos da API**
  - O que é: prazo de guarda dos logs da aplicação (método, rota, resultado e duração, sem IP). O Aviso já informa
    14 dias, que é a rotação de `deploy/logrotate.minhafolga.conf.example`; resta instalar a rotação na hospedagem e
    confirmar (ou ajustar o prazo nos dois lugares).
  - Onde: marcador na tabela “Por quanto tempo guardamos” de `frontend/content/legal/privacidade.md`.
  - Bloqueia: build estrito (marcador).
- [ ] **Contrato com a Hal-AI como operadora**
  - O que é: contrato de operador de dados com a Hal-AI, que agora opera, em nome da Minha Folga, o número oficial do
    WhatsApp (WhatsApp Cloud), o webchat, a Bia e o atendimento humano dessas conversas. Deve cobrir: dados tratados
    (mensagens, número e nome do perfil, e os dados de cadastro digitados na conversa — **inclusive CPF, empregador e
    faixa salarial**), retenção das conversas, repasse de pedidos de titulares (exclusão, acesso), proibição de
    treino de modelos sem base legal, acesso da equipe do fornecedor, suboperadores (inclusive a Meta, no WhatsApp
    Cloud), local de processamento e segurança.
  - Onde: marcadores em `frontend/content/legal/privacidade.md` (“Plataforma Hal-AI”, retenção das conversas e
    transferência internacional); `docs/BIA_AGENTE.md`, Parte D e Parte F, itens 8 e 9.
  - Bloqueia: build estrito (marcadores); ativação da Bia e do webchat.
- [ ] **Chaves e canal da Hal-AI (entrada — Bia chamando esta API)**
  - O que é: gerar `HALAI_INBOUND_API_KEY` (32+ bytes, distinta por ambiente) e cadastrá-la na importação das
    ferramentas na Hal-AI (`X-API-Key`); importar as ferramentas de `contracts/openapi.yaml` com um caminho por
    ferramenta; ligar `HALAI_ENABLED=true`; confirmar se a plataforma assina cada requisição (senão
    `HALAI_WEBHOOK_SECRET` fica vazio).
  - Onde: ambiente do backend (`docs/ENVIRONMENT.md`, “Hal-AI — entrada”); `docs/BIA_AGENTE.md`, A.2 e A.4.
  - Bloqueia: a Bia não cadastra nem consulta nada daqui (`503 agent_disabled`); o site não anuncia a Bia no WhatsApp.
- [ ] **Número oficial do WhatsApp hospedado na Hal-AI — `WHATSAPP_BUSINESS_NUMBER`**
  - O que é: o número que a Hal-AI opera para a Minha Folga (E.164), usado no botão flutuante (`wa.me`, última
    alternativa) e no retorno por WhatsApp do formulário de atendimento.
  - Bloqueia: sem ele, o site não mostra WhatsApp e o formulário de atendimento só oferece retorno por e-mail. Mudar
    exige nova release.
- [ ] **Confirmação de como a Hal-AI injeta o telefone atestado**
  - O que é: confirmar, por escrito e com teste em homologação, que `senderPhone` e `senderVerified` (e
    `conversationRef`) são preenchidos **pela plataforma** a partir do canal WhatsApp, fora do alcance do modelo, e
    que o webchat não os envia. É o que impede alguém de cadastrar, consultar ou descadastrar o número de outra
    pessoa pela conversa.
  - Onde: `docs/BIA_AGENTE.md`, A.3 e Parte F, item 3.
  - Bloqueia: até a confirmação, a integração opera sem `senderVerified` — `upsert_customer`,
    `get_customer_status`, `update_contact_preferences` e `issue_preferences_link` respondem `403
    sender_not_verified`; a Bia só responde dúvidas e indica o site.
- [ ] **Transferência para atendimento humano na Hal-AI**
  - O que é: filas e operadores da Hal-AI para as conversas de WhatsApp e webchat, e o procedimento que a Bia usa
    para transferir.
  - Onde: marcador `{{pending: …}}` no roteiro 7.5 de `docs/BIA_AGENTE.md`.
  - Bloqueia: publicação do contexto da Bia (o texto só é configurado sem marcadores).
- [ ] **Templates e campanhas na Hal-AI**
  - O que é: os templates do aviso de abertura e de conteúdos e novidades são aprovados e enviados pela Hal-AI.
    Falta definir **como a lista de quem autorizou cada finalidade chega à plataforma** e como a revogação e a
    supressão registradas aqui são respeitadas por ela — este sistema não tem, hoje, exportação nem API para isso
    (a exportação CSV do painel é mascarada).
  - Onde: decisão de produto e técnica; `docs/BIA_AGENTE.md`, Parte F, item 9.
  - Bloqueia: envio do aviso de abertura quando a operação abrir.
- [ ] **Placeholder de template pós-cadastro (opcional, pago) — `HALAI_SIGNUP_TEMPLATE_*`**
  - O que é: decisão de ligar ou não o template de WhatsApp depois de um cadastro novo pelo site (desligado por
    padrão; `HALAI_SIGNUP_TEMPLATE_ENABLED=false`). Se ligar: template aprovado na Hal-AI e as variáveis
    `HALAI_API_KEY` (chave `hal_…` emitida pela Hal-AI), `HALAI_CHANNEL`, `HALAI_SIGNUP_TEMPLATE` e
    `HALAI_TEMPLATE_DAILY_CAP` (teto diário, decisão de custo); texto e variáveis do template conferidos com o
    Aviso; teste em homologação com números da equipe.
  - Onde: ambiente do backend (`docs/ENVIRONMENT.md`, “Hal-AI — saída”); travas em `docs/OPERATIONS.md`, seção 8.
  - Bloqueia: nada enquanto desligado.
- [ ] **Webchat da Hal-AI (placeholder)**
  - O que é: script e identificador do widget, entregues pela Hal-AI; origens a liberar na CSP do servidor web
    (`script-src`, `connect-src`, `frame-src` e, se preciso, `style-src`/`img-src`/`font-src`); o que o widget grava
    no navegador, com finalidade e duração, para a Política de cookies; revisão do aviso de tratamento exibido antes
    de abrir o chat (`frontend/content/site.yaml → floatingContact.notice`). Em outubro de 2026 o WhatsApp passa a ser
    cobrado: o webchat é o canal preferencial do site.
  - Onde: `HALAI_WEBCHAT_ENABLED`, `HALAI_WEBCHAT_SCRIPT_URL`, `HALAI_WEBCHAT_WIDGET_ID`; CSP em
    `deploy/nginx.minhafolga.conf.example` / `deploy/apache.minhafolga.conf.example`
    (`docs/DEPLOY_SHARED_SERVER.md`, seção 5.6); textos em `frontend/content/legal/cookie-consent.yaml →
    webchatStatus` e na Política de cookies.
  - Bloqueia: o chat do site fica desligado (a Política de cookies e o Aviso dizem que ele está desativado nesta
    versão).
- [ ] **E-mail de atendimento**
  - O que é: serviço de e-mail usado para responder quem escolhe retorno por e-mail. As respostas são registradas no
    painel; o envio sai do e-mail da empresa.
  - Onde: marcador em `frontend/content/legal/privacidade.md`; DNS do domínio (item 7).
  - Bloqueia: build estrito (marcador); retorno por e-mail sem remetente confiável.
- [ ] **Aviso interno de novas solicitações (opcional)**
  - O que é: webhook assinado que avisa a equipe (protocolo, assunto e horário, sem contato nem mensagem).
  - Onde: `SUPPORT_NOTIFY_WEBHOOK_URL` e `SUPPORT_NOTIFY_WEBHOOK_SECRET`.
  - Bloqueia: nada; sem ele, a equipe acompanha pelo painel.
- [ ] **Transferência internacional**
  - O que é: confirmar, para cada provedor (hospedagem, Hal-AI e WhatsApp Cloud/Meta, e-mail), se há tratamento fora
    do Brasil, em quais países e qual hipótese do art. 33 da LGPD sustenta a transferência.
  - Onde: marcador em `frontend/content/legal/privacidade.md` (“Transferência internacional de dados”).
  - Bloqueia: build estrito (marcador).

## 4. Dados do cadastro (D1): CPF, empregador e faixa salarial

- [ ] **Base legal do CPF, do empregador, do tempo no emprego e da faixa salarial nesta fase**
  - O que é: definir se o tratamento se apoia no consentimento (art. 7º, I, LGPD) ou em procedimentos preliminares
    a pedido do titular (art. 7º, V), para o formulário do site e para a coleta pela Bia, e ajustar os textos.
  - Onde: marcador em `frontend/content/legal/privacidade.md` (“Base legal” do cadastro); textos de consentimento em
    `contracts/consents.json` (mudança de texto exige nova versão); `docs/BIA_AGENTE.md`, Parte D.
  - Bloqueia: build estrito (marcador); abertura da coleta pública.
- [ ] **Relatório de impacto à proteção de dados (RIPD)**
  - O que é: RIPD do cadastro com CPF, empregador e faixa salarial antes de qualquer operação de crédito, cobrindo
    site, Bia/Hal-AI, painel, exportação e backups, com as medidas já implementadas (cifragem por campo,
    deduplicação por HMAC, mascaramento, revelação auditada, anti-robô).
  - Onde: documento do encarregado; referenciado no mesmo marcador da base legal.
  - Bloqueia: abertura da coleta pública (decisão do encarregado).
- [ ] **Prazos de retenção dos dados de D1**
  - O que é: prazo do CPF e dos dados do emprego enquanto a operação não abre e depois dela; prazo de exclusão de
    cadastros do site cujo telefone nunca foi validado pela Bia (hoje não são apagados automaticamente); prazo das
    submissões guardadas para revisão (o código apaga todas com mais de 30 dias — confirmar ou ajustar); prazo das
    conversas na Hal-AI.
  - Onde: marcadores na tabela “Por quanto tempo guardamos” de `frontend/content/legal/privacidade.md`; rotina em
    `backend/src/jobs/retention.ts`.
  - Bloqueia: build estrito (marcadores).
- [ ] **Procedimento de revisão das submissões guardadas**
  - O que é: quem revisa as submissões sobre cadastro existente (`docs/OPERATIONS.md`, seção 5), com que frequência
    e o que fazer com cada motivo — em especial `cpf_conflict` (CPF de outro cadastro). O painel mostra as diferenças
    mascaradas, mas **não tem ação para aplicar ou descartar** nem para editar dados de um cadastro: se a equipe de
    privacidade precisar corrigir dados, isso exige nova funcionalidade ou é feito pela própria pessoa com a Bia.
  - Onde: procedimento interno; eventual evolução do painel.
  - Bloqueia: não trava o build; afeta a qualidade dos dados e o atendimento a pedidos de correção.
- [ ] **Revisão das permissões do painel com os novos dados**
  - O que é: confirmar quem pode ver empregador e faixas (`leads:read`) e quem pode revelar telefone, CPF e e-mail
    completos (`leads:read_contact`, com motivo e auditoria).
  - Onde: painel `/admin/usuarios`.
  - Bloqueia: operação segura do painel.

## 5. Revisões e aprovações de conteúdo

- [ ] **Revisão jurídica do Aviso de Privacidade, dos Termos de uso e da Política de cookies**
  - O que é: revisão por profissional habilitado dos três documentos, dos textos de consentimento e do painel de
    cookies, incluindo as bases legais indicadas por atividade (com as do item 4) e os prazos de retenção (item 8).
  - Onde: textos em `frontend/content/legal/privacidade.md`, `termos.md`, `cookies.md` e `cookie-consent.yaml`;
    textos de consentimento em `contracts/consents.json` (`purposes`). Ao aprovar, registrar em
    `contracts/consents.json` → `notices.<privacy|terms|cookies>`: `status: "approved"`, `revisedAt` (data real)
    e `reviewedBy`. Mudança de texto depois da aprovação exige **nova versão** (`version`) — a versão aceita fica
    registrada em cada cadastro. As páginas passam a mostrar “Versão X · revisada em …” automaticamente.
  - Bloqueia: build estrito (“Aviso legal sem revisão aprovada”); enquanto isso, as páginas exibem a versão 1.2 como
    rascunho elaborado em 26/09/2026, pendente de revisão jurídica.
- [ ] **Foro dos Termos de uso**
  - O que é: foro eleito, sem prejuízo do foro do domicílio do consumidor (CDC, art. 101, I).
  - Onde: marcador em `frontend/content/legal/termos.md` (“Legislação e foro”).
  - Bloqueia: build estrito (marcador).
- [ ] **Revisão financeira dos artigos**
  - O que é: revisão técnica de cada artigo de `frontend/content/articles/*.md` e definição da data de publicação.
  - Onde: frontmatter de cada artigo → `review.status: approved`, `review.reviewedAt`, `review.reviewer` e
    `publishedAt`.
  - Bloqueia: build estrito (“Artigo sem revisão financeira registrada” / “sem data de publicação”).
- [ ] **Aprovação do conteúdo das páginas**
  - O que é: aprovação, pelo responsável, dos textos de cada página, da FAQ, da jornada, do andamento, do botão
    flutuante de conversa e do painel de cookies.
  - Onde: bloco `revision` de cada `frontend/content/**/*.yaml` → `status: approved`, `approvedAt`, `approvedBy`
    (orientações em `docs/CONTENT_GUIDE.md`).
  - Bloqueia: build estrito (“sem aprovação registrada”).
- [ ] **Evidências dos marcos de lançamento**
  - O que é: cada marco de `/lancamento` só muda de situação com evidência interna, data e responsável. Hoje os
    quatro marcos estão `pending` (“Pendente”), inclusive o primeiro (“Website e atendimento”), porque ainda não há
    evidência nem responsável registrados. Ele passa a “Em andamento” com a evidência do que já foi verificado e a
    concluído só depois que o site e os canais estiverem publicados e verificados.
  - Onde: `frontend/content/launch.yaml` → `milestones[].status`, `evidence`, `updatedAt`, `responsible`.
  - Bloqueia: o build falha se um marco estiver `in_progress` ou `done` sem esses campos.
- [ ] **Responsável editorial da Bia e aprovação do contexto**
  - O que é: pessoa que responde pela base de respostas e pelo contexto da Bia; aprovação do contexto reescrito para
    D1 (coleta de CPF e empregador com consentimento) e execução da bateria de testes da Parte E em homologação.
  - Onde: marcadores em `docs/BIA_AGENTE.md`.
  - Bloqueia: ativação da Bia (item 3).

## 6. Atendimento: horários e capacidade reais

- [ ] **Horário de atendimento humano — `SUPPORT_HOURS`**
  - O que é: horário que a equipe realmente cumpre no formulário `/atendimento`, com fuso (ex.: “segunda a sexta,
    9h às 18h, horário de Brasília”). O horário dos operadores da Hal-AI nas conversas é configurado lá.
  - Bloqueia: início da API em homologação/produção; cadastro e atendimento; build estrito (identidade
    incompleta).
- [ ] **Prazo de resposta — `SUPPORT_RESPONSE_TIME`** (opcional)
  - O que é: prazo que a equipe consegue cumprir. Só é exibido se informado; se não houver certeza, deixe vazio.
- [ ] **Atendimento humano ativo — `HUMAN_SUPPORT_ENABLED`**
  - O que é: `true` só quando houver equipe escalada para responder no horário divulgado.
  - Bloqueia: enquanto `false`, o site não anuncia atendimento humano disponível.

## 7. Domínio, HTTPS e segurança de transporte

- [ ] **Domínio e DNS**
  - O que é: `www.minhafolga.com.br` como endereço principal e redirecionamento do domínio raiz para ele.
  - Onde: DNS do domínio; `server_name` em `deploy/nginx.minhafolga.conf.example`; `PUBLIC_SITE_URL` (backend),
    `VITE_SITE_URL` (frontend) e, se necessário, `ALLOWED_ORIGINS`.
  - Bloqueia: build estrito se `VITE_SITE_URL` ≠ `PUBLIC_SITE_URL`; chamadas do navegador recusadas pela API se a
    origem não bater.
- [ ] **Certificados TLS e renovação**
  - O que é: certificado válido para `www` e para a raiz, com renovação automática testada.
  - Onde: `ssl_certificate` e `ssl_certificate_key` em `deploy/nginx.minhafolga.conf.example`.
  - Bloqueia: a API exige `PUBLIC_SITE_URL` com HTTPS e `COOKIE_SECURE=true` fora do desenvolvimento; sem HTTPS,
    os cookies de sessão não funcionam e Preferências não abre.
- [ ] **HSTS**
  - O que é: cabeçalho `Strict-Transport-Security`, ativado **somente depois** de validar HTTPS de `www` e da raiz.
    Começar com `max-age=300`, conferir e depois aumentar; `includeSubDomains`/`preload` só com decisão explícita.
  - Onde: linha comentada `add_header Strict-Transport-Security` em `deploy/nginx.minhafolga.conf.example`.
  - Bloqueia: não trava a publicação; é critério de segurança da seção 9 do briefing.
- [ ] **SPF, DKIM e DMARC** (somente se houver e-mail no domínio)
  - O que é: registros DNS do serviço de e-mail realmente usado (item 3), para que respostas de atendimento não
    caiam em spam nem possam ser falsificadas facilmente.
  - Onde: DNS do domínio, conforme instruções do provedor de e-mail.
  - Bloqueia: entrega confiável das respostas por e-mail; prevenção a golpes em nome da marca.

## 8. Políticas e decisões internas

- [ ] **Política de retenção**
  - O que é: validar a proposta de revisão após 180 dias sem interação (política da empresa, não prazo da LGPD) e
    definir os prazos ainda em aberto no Aviso: os de D1 (item 4), guarda das evidências de consentimento e da lista
    de supressão, guarda das solicitações de atendimento encerradas e dos registros de auditoria e segurança.
    Definir também quem executa e com que frequência: o Aviso já informa que sessões, links de preferências e o
    texto e o destinatário das mensagens são apagados pela revisão de retenção 30 dias depois de vencerem (ou de a
    mensagem ser finalizada), e a periodicidade dessa revisão é um marcador do Aviso. Validar também, com o
    encarregado, os limites do anti-robô (5 cadastros por hora por rede de origem, 3 por dia por CPF e 3 por dia por
    telefone; 10 pedidos de saída por hora por rede) e a guarda das tentativas (2 dias), em
    `contracts/validation.json → waitlist.limits`.
  - Onde: marcadores na tabela “Por quanto tempo guardamos” de `frontend/content/legal/privacidade.md`; rotina em
    `backend/src/jobs/retention.ts` e `npm run retention:review` (simulação por padrão; `--apply` só marca
    `expired` e remove artefatos técnicos vencidos — exclusão ou anonimização é decisão da equipe no painel).
    Agendar a execução na hospedagem.
  - Bloqueia: build estrito (marcadores).
- [ ] **Decisão sobre a medição de uso (analytics)**
  - O que é: decidir se a medição agregada própria será ativada. Hoje `ANALYTICS_ENABLED=false`: não há banner de
    cookies, nada é gravado no navegador e nenhum evento é enviado. Se for ativada:
    1. rever e aprovar os textos de medição de `frontend/content/legal/cookie-consent.yaml`, que passam a aparecer
       no Aviso, na Política de cookies, no banner e no painel;
    2. subir a versão da Política de cookies em `contracts/consents.json` (`notices.cookies.version`), porque o
       inventário muda — a escolha salva no navegador fica vinculada a essa versão;
    3. conferir que as páginas enviam os eventos descritos nos textos. Os textos listam **todos** os eventos de
       `contracts/validation.json → events` (lista `events` de `cookie-consent.yaml`, conferida por teste). Hoje o
       site envia os oito: `page_section_view` (caminho da rota pública, `CookieConsent.vue`), `article_read` (slug,
       quando o fim do texto do artigo aparece na tela, `ArticleDetail.vue`), `help_search`/`help_search_empty` (sem
       o texto digitado, quando a digitação para, `HelpPage.vue`), `waitlist_start` (origem do cadastro, uma vez por
       página no primeiro foco ou interação, `WaitlistForm.vue`), `support_form_start` (sem dimensão, mesma regra,
       `SupportForm.vue`), `bia_demo_tab` (id do exemplo, na troca de aba, `BiaExamplesTabs.vue`) e
       `bia_channel_click` (caminho da página, ao abrir o chat do site ou ao clicar no WhatsApp da Bia no botão
       flutuante, `FloatingContact.vue`, e nos botões de `HomeBia.vue` e `BiaPage.vue`). O backend recusa dimensões
       fora do contrato.
  - Onde: `ANALYTICS_ENABLED` no ambiente do backend (exportado ao frontend pela configuração pública).
  - Bloqueia: nada enquanto desligada. Qualquer ferramenta de terceiros, pixel ou publicidade exige nova versão da
    Política de cookies, base legal e escolha do visitante antes de entrar no site.
- [ ] **Segredos de produção**
  - O que é: gerar e guardar `CONTACT_ENCRYPTION_KEY`, `CONTACT_DEDUP_HMAC_KEY`, `SESSION_SECRET`,
    `READINESS_TOKEN` e `HALAI_INBOUND_API_KEY` exclusivos de produção (distintos dos de homologação). **Sem a chave
    de cifragem, telefones, CPFs, e-mails e empregadores guardados não podem ser lidos**: ela precisa de cópia segura
    fora do servidor e procedimento de rotação (`id:base64,id:base64`). Remover do arquivo as variáveis obsoletas
    pela D1 e revogar na origem os segredos antigos do provedor de WhatsApp.
  - Onde: ambiente privado do backend.
  - Bloqueia: início da API (a validação recusa marcadores, chaves repetidas e segredos curtos).
- [ ] **Usuários administrativos**
  - O que é: contas individuais com verificação em duas etapas, permissões por função revisadas (item 4) e nenhuma
    conta compartilhada.
  - Onde: painel `/admin/usuarios`.
  - Bloqueia: operação do atendimento, dos pedidos de privacidade e da revisão de retenção.
- [ ] **Interruptor da coleta pelo site (decisão técnica)**
  - O que é: antes da D1, desligar o provedor de mensagens fechava o cadastro. Hoje não há variável que feche só o
    formulário de cadastro (a coleta depende apenas da identidade completa); em incidente, a alternativa é parar a
    API. Decidir se é preciso um interruptor próprio.
  - Onde: `backend/src/config/index.ts` (`collection`); `docs/OPERATIONS.md`, seção 11.
  - Bloqueia: nada; afeta a resposta a incidentes.

## 9. Backup e restauração

- [ ] **Backup do banco dedicado com restauração testada**
  - O que é: backup periódico do PostgreSQL da Minha Folga, destino protegido e separado de outros sites, e um teste
    de restauração demonstrado (critério de aceite “Publicação”), refeito depois da migração
    `003_d1_cadastro_halai.sql`. O backup contém dados cifrados (e nome completo, faixas, cidade e UF em claro); sem
    a chave do item 8 ele não serve para restaurar os dados cifrados.
  - Onde: `scripts/deploy.sh backup-db` (e o backup automático antes de `migrate`) grava em
    `<MINHAFOLGA_APP_ROOT>/backups/`; definir cópia externa, frequência, retenção dos backups e quem pode acessá-los.
  - Bloqueia: abertura da coleta pública; migrações em produção sem `--skip-backup` explícito.

## 10. Marca e identidade visual

- [ ] **Verificação da marca e registro no INPI**
  - O que é: verificar a disponibilidade do nome e do logotipo Minha Folga e a possibilidade de registro no INPI
    antes da adoção definitiva (seção 2 do briefing).
  - Onde: fora do código; logotipos em `docs/minha-folga-logo*.svg` e nos componentes de marca do frontend.
  - Bloqueia: adoção definitiva da marca, materiais impressos e campanhas; os Termos já tratam a marca como usada
    pela empresa, sem afirmar registro.

---

## Ordem sugerida

1. Identidade, encarregado e canais (itens 1, 2 e 6) — destravam a API em produção e o atendimento.
2. Base legal, RIPD e retenção dos dados de D1 (item 4) e contrato com a Hal-AI como operadora, com a decisão sobre
   transferência internacional (item 3).
3. Política de retenção e foro (itens 8 e 5), para fechar os marcadores do Aviso e dos Termos.
4. Revisão jurídica dos três documentos e aprovação do conteúdo e dos artigos (item 5).
5. Integração com a Hal-AI em homologação: chave de entrada, importação das ferramentas, confirmação do telefone
   atestado, transferência humana e bateria de testes da Bia (item 3 e `docs/BIA_AGENTE.md`, Parte E); webchat quando
   o widget for entregue.
6. Domínio, TLS, segredos, usuários administrativos e backup testado (itens 7, 8 e 9).
7. Build estrito sem pendências, teste completo em celular e teclado (incluindo erro, anti-robô e revogação) e
   aprovação final do responsável. Só então a coleta pública é aberta.
