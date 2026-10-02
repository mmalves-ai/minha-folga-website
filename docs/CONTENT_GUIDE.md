# Guia de conteúdo — website Minha Folga

Como editar, revisar e publicar os textos do website. Todo o conteúdo é **versionado no repositório** e chega ao
público **por uma nova release** (não há CMS nem edição no servidor). O briefing de produto é
`docs/MINHA_FOLGA_WEBSITE_MASTER.md`; as convenções técnicas estão em `docs/ARCHITECTURE.md`.

## 1. Regras que valem para qualquer texto

- Português do Brasil, tom acolhedor e claro, sem pressão e sem infantilizar.
- **Nada inventado**: depoimento, número de clientes, parceiro, taxa, CNPJ, telefone, endereço, data de lançamento,
  prêmio, selo, certificação ou nome de pessoa só entram quando forem reais e fornecidos pela empresa. Dados
  empresariais vêm da configuração pública (ver seção 6), nunca digitados no texto.
- Proibido: "o melhor crédito", "a menor taxa", "aprovação garantida", "sem análise", "economia garantida",
  "risco zero", promessa de rapidez ou de economia, CTA de "contrate agora", links para `/simular`, apresentar a
  Minha Folga como correspondente antes de haver contrato.
- Onde o briefing fornece o texto exato (H1, perguntas da seção 6.8, avisos de disponibilidade, mensagem de busca
  vazia etc.), ele é mantido palavra por palavra. Os arquivos marcam esses trechos com o comentário `# Texto exato`.
  Onde a decisão **D1** de `docs/DECISOES.md` mudou o briefing (cadastro com CPF e empregador, sem código de
  confirmação; WhatsApp, Bia e webchat operados pela Hal-AI), vale a decisão; os arquivos alterados trazem um
  comentário que cita a decisão D1.
- Canais e dados depois da D1: o site **pede CPF** no formulário de cadastro e a Bia pode pedir, com autorização,
  para fazer o cadastro. Nenhum texto pode dizer que a Minha Folga nunca pede CPF; continua proibido pedir senha,
  código recebido por mensagem, foto de documento ou dados bancários, e os textos de segurança orientam a informar o
  CPF só no formulário do site ou na conversa com a Bia nos canais oficiais. Não existe mais "código de
  confirmação": nenhum texto pode pedir código nem descrever confirmação por código; o telefone fica validado quando a
  própria pessoa conversa com a Bia no WhatsApp oficial. O chat do site é o canal preferencial; o WhatsApp oficial, a
  última alternativa.
- Datas de revisão e de publicação são **datas reais**, registradas por quem revisou. Nenhuma data é preenchida
  automaticamente pelo build ou pelo acesso. O `<lastmod>` do `sitemap.xml` sai só dessas datas
  (`frontend/build/sitemap.ts`): artigo → `publishedAt`/`review.reviewedAt` aprovada; páginas legais → `revisedAt`
  aprovado em `contracts/consents.json`; demais páginas → `revision.approvedAt` do YAML e dos conteúdos que ela
  exibe. Sem data real, a tag fica de fora.

## 2. Onde fica cada conteúdo

| O quê | Arquivo | Formato |
|---|---|---|
| Textos de cada página | `frontend/content/pages/<pagina>.yaml` | YAML (campos `_md` são Markdown) |
| Copy visual compartilhada da home e da landing de aquisição | `frontend/content/pages/aquisicao.yaml` | YAML (hero, benefícios, Bia, passos, cadastro, confiança e FAQ/encerramento da landing) |
| Artigos da central `/conteudos` | `frontend/content/articles/<slug>.md` | Markdown com frontmatter |
| Perguntas frequentes (`/ajuda`, resumos e **Bia**) | `frontend/content/faq.yaml` | YAML |
| Marcos da abertura financeira (`/lancamento`, home, landing) | `frontend/content/launch.yaml` | YAML |
| Navegação, rodapé, categorias editoriais e **textos por fase** | `frontend/content/site.yaml` | YAML |
| Privacidade, Termos e Cookies | `frontend/content/legal/*.md` + metadados em `contracts/consents.json` | Markdown |
| Identidade empresarial e canais | ambiente do backend → configuração pública exportada | ver seção 6 |

A copy dos componentes `HomeHero`, `HomeValue`, `HomeBia`, `AcquisitionSteps`, `AcquisitionSignup`,
`AcquisitionTrust` e da composição visual de `/avise-me` vem de `pages/aquisicao.yaml`. Edite ali também os
textos alternativos, as mensagens da demonstração e as variantes para coleta ou canais indisponíveis; mantenha o
bloco `revision`. Metadados e seleção de FAQ de `/avise-me` continuam em `pages/avise-me.yaml`; campos, dicas e
validação do formulário continuam em `pages/formularios.yaml` e nos contratos. Os tipos de apresentação estão em
`frontend/src/types/acquisition.ts`.

O HTML de todas as páginas públicas é gerado no build (pré-renderização). Um texto alterado só aparece depois de
novo build e nova release.

## 3. Ciclo de uma alteração

1. **Editar** o arquivo em um branch. Mantenha a estrutura do YAML (indentação de dois espaços; textos com `:` ou
   `#` vão entre aspas).
2. **Conferir localmente** em `frontend/`, com o Node privado do projeto (`../scripts/node-runtime.sh exec <comando>`
   ou a sessão preparada como no `README.md`):
   ```bash
   npm run dev                      # http://127.0.0.1:5180 — marcadores de pendência ficam visíveis
   npx vue-tsc --noEmit -p tsconfig.app.json
   npm run build                    # pré-renderiza e roda scripts/postbuild.mjs (títulos únicos, canonical, noindex)
   ```
3. **Revisar**: conteúdo educativo e FAQ passam por revisão financeira; páginas legais, por revisão jurídica.
   Use a lista de verificação da seção 11.
4. **Registrar a aprovação** no próprio arquivo (seções 4 e 5): quem aprovou e quando, com a data real.
5. **Build estrito** (`scripts/build.sh --staging` para homologação, `scripts/build.sh --release` para produção).
   Ele recusa a release se houver qualquer pendência (seção 9).
6. **Publicar** pela implantação do projeto (`scripts/deploy.sh`). O rollback volta a release anterior inteira,
   inclusive os textos.

## 4. Bloco `revision` (todo arquivo YAML de `content/`)

```yaml
revision:
  version: 1            # aumente a cada mudança de conteúdo aprovada
  status: draft         # draft | approved
  draftedAt: 2026-09-25 # data real da redação desta versão
  approvedAt: null      # data real da aprovação (AAAA-MM-DD)
  approvedBy: null      # nome ou função de quem aprovou
```

- Alterou um texto já aprovado? Volte `status` para `draft`, aumente `version`, atualize `draftedAt` e limpe
  `approvedAt`/`approvedBy` até a nova aprovação.
- O modo estrito exige `status: approved`, `approvedAt` e `approvedBy` em **todos** os YAML de `content/`.

## 5. Artigos (`content/articles/*.md`)

### Frontmatter

```yaml
---
slug: o-que-e-cet                 # igual ao nome do arquivo (o build confere)
order: 1                          # ordem na central
title: O que é CET e por que olhar além da taxa
summary: A taxa de juros é uma parte da comparação. Entenda por que o custo total também importa.
category: entenda-o-credito       # um id de site.yaml → contentCategories
author: Equipe editorial Minha Folga   # autoria verdadeira; não inventar especialista
draftedAt: 2026-09-25             # data real da redação
publishedAt: null                 # data real da primeira publicação aprovada
review:
  status: pending                 # pending | approved
  reviewedAt: null                # data real da revisão financeira
  reviewer: null                  # nome ou função de quem revisou
sources:
  - title: Título do material
    publisher: Banco Central do Brasil — Perguntas e respostas
    url: https://www.bcb.gov.br/...
    accessedAt: 2026-09-25        # data real da última conferência do link
related: [parcela-menor-e-custo-total, antes-de-contratar-credito]   # dois slugs existentes
cta: bia                          # bia | ajuda — chamada ao final do artigo
seo:
  title: Título para buscadores (único no site)
  description: Descrição própria de 120 a 160 caracteres.
---
```

### O que o leitor vê

- "Texto elaborado em …" vem de `draftedAt`; "Publicado em …" aparece só com `publishedAt`.
- Enquanto `review.status` não for `approved` **com** `reviewedAt` e `reviewer`, o artigo mostra
  **"Revisão financeira pendente"**. Aprovado, mostra "Revisado em <data> por <revisor>".
- O tempo de leitura é calculado do texto (cerca de 200 palavras por minuto). O sumário lateral é montado com os
  subtítulos `## …`.
- Fontes, conteúdos relacionados, CTA e o aviso "Conteúdo educativo…" são inseridos pelo modelo da página.

### Corpo

- Subtítulos com `## ` (entram no sumário e ganham âncora). Use `###` só dentro de uma seção.
- Links internos com caminho relativo: `[Parcela menor e custo total](/conteudos/parcela-menor-e-custo-total)`.
  Links externos recebem `rel="noopener noreferrer"` automaticamente.
- HTML bruto é desativado (é exibido como texto). Não use imagens sem autorização de uso.
- Sem números de simulação, sem promessa de condição e sem citar norma que não tenha sido conferida na fonte.
- Os textos-base do briefing (seção 6.13) e suas frases-chave devem ser preservados.

### Publicar um artigo novo

1. Crie `content/articles/<slug>.md` com o frontmatter completo (o build falha se faltar `title`, `summary`,
   `category`, `author`, `draftedAt`, `sources` ou `related`).
2. Use uma categoria existente em `site.yaml → contentCategories`, ou acrescente uma nova ali. A central mostra
   apenas categorias que têm artigos.
3. Aponte `related` para dois artigos existentes e, se fizer sentido, atualize o `related` deles.
4. Nada mais a registrar: a rota `/conteudos/<slug>` é pré-renderizada e entra no sitemap automaticamente (o build
   lê a pasta `content/articles`). Slugs inexistentes continuam respondendo 404.
5. Para retirar um artigo, remova o arquivo e as referências em `related`, `faq.yaml` e páginas que o citam.

## 6. Fontes

- Somente materiais oficiais e pertinentes: Banco Central do Brasil (inclusive "Perguntas e respostas" e busca de
  normas), gov.br/MTE — Crédito do Trabalhador, Planalto (texto compilado das leis), Senacon/consumidor.gov.br,
  Procons, ANPD.
- Antes de registrar, **abra o link** e confirme que ele trata do assunto do trecho em que é usado. Registre a data
  real em `accessedAt`. Link quebrado ou sem relação é removido, não "aproximado".
- Cite artigo de lei ou resolução apenas depois de conferir o texto vigente na fonte. Na dúvida, descreva a regra
  de forma geral e aponte para a fonte, sem inventar número.
- Normas e condições comerciais devem ser revistas antes da fase financeira (`PILOT`/`LIVE`) e a cada revisão
  periódica dos artigos.

## 7. Perguntas frequentes (`content/faq.yaml`)

```yaml
- id: quando-disponivel          # estável: vira âncora (/ajuda#quando-disponivel) e é referenciado por outras páginas
  category: consignado           # sobre | consignado | cadastro | bia | dados
  showOn: [home]                 # onde mais aparece: home, consignado (resumos das páginas)
  question: Quando o crédito estará disponível?
  answer_md: A data depende da conclusão da estruturação ...
  related:
    - { label: Andamento da abertura financeira, to: /lancamento }
```

- As **nove perguntas da seção 6.8** têm texto exato e só mudam com decisão registrada (no briefing ou em
  `docs/DECISOES.md`: a D1 mudou a resposta de “Como saio da lista”, que passou a indicar a Bia e o pedido de saída do
  site).
- A `/ajuda` mostra todos os itens por categoria, com busca local (sem acento e sem diferença de maiúsculas) em
  pergunta, resposta e nome do tema. Um link `/ajuda#<id>` abre a resposta.
- **A Bia usa esta mesma base** pela ferramenta `get_approved_faq` (backend, `faq.service.ts`):
  - em produção, a Bia só responde com a base se `revision.status` for `approved`;
  - itens com marcador de pendência ou com dado de identidade ainda não configurado são retidos (não chegam à Bia);
  - a resposta sai em texto simples, com links absolutos. Escreva respostas que façam sentido fora da página.
- Não mude o `id` de uma pergunta existente sem procurar referências (`grep -rn "<id>" frontend backend`).
- Mudança de fase financeira exige revisão desta base: as respostas descrevem a fase vigente.

## 8. Marcadores de dados reais

Dados empresariais nunca são digitados nos textos. Use marcadores, substituídos no build pela configuração pública
exportada do backend (`npm run export:public-config`, feito por `scripts/build.sh`):

| Marcador | Dado |
|---|---|
| `{{identity.legalName}}` | razão social |
| `{{identity.cnpj}}` | CNPJ (formatado automaticamente) |
| `{{identity.address}}` | endereço |
| `{{identity.privacyContact}}` / `{{identity.privacyOfficerName}}` | canal de privacidade / encarregado |
| `{{identity.supportContact}}` / `{{identity.supportPhone}}` | canal / telefone de atendimento |
| `{{identity.supportHours}}` / `{{identity.supportResponseTime}}` | horário / prazo de resposta reais |
| `{{channels.whatsappNumber}}` | número oficial do WhatsApp, hospedado na Hal-AI (formatado) |
| `{{pending: descrição}}` | qualquer decisão ou dado ainda não fornecido |

- Funcionam em campos `_md` e em textos comuns dos YAML e dos arquivos legais.
- Sem o dado, o build de revisão mostra `[pendente: …]` destacado na página. No modo estrito, `{{pending: …}}`
  interrompe o build, e a identidade obrigatória (razão social, CNPJ, endereço, canal e encarregado de privacidade,
  canal e horário de atendimento) é exigida por inteiro. **Atenção:** marcadores de dados opcionais
  (`supportPhone`, `supportResponseTime`, `channels.whatsappNumber`) não bloqueiam o build de conteúdo; use-os
  apenas em textos cujo dado já esteja configurado. Se um deles ficar vazio, o `[pendente: …]` que ele gera é
  barrado pela segunda trava do modo estrito (seção 9). Um marcador desconhecido interrompe qualquer build.
- Páginas que exibem canais direto da configuração (rodapé, Sobre, Atendimento, Segurança, botão flutuante)
  seguem a mesma regra: dados opcionais — telefone, WhatsApp e chat do site — só aparecem quando configurados (sem
  `WHATSAPP_BUSINESS_NUMBER` a linha do WhatsApp nem aparece; sem `channels.webchat` válido, o chat do site não é
  oferecido; sem nenhum dos dois, o botão flutuante não é renderizado); a identidade obrigatória, como o e-mail de
  atendimento, aparece como pendência no build de revisão e bloqueia a release enquanto faltar.
- Textos sobre a Bia e sobre o atendimento humano acompanham os canais reais (`channels.webchat`,
  `channels.biaOnWhatsapp`, `channels.humanSupport`), pelos requisitos da seção 10a. O atendimento humano **das
  conversas** (WhatsApp e chat) é feito na Hal-AI; `humanSupport` descreve a equipe da Minha Folga no formulário
  `/atendimento`. Nos arquivos legais, que não mudam com a configuração, escreva de forma condicional (“quando o
  canal estiver ativo”) ou use os blocos que já mostram a situação do chat (`cookie-consent.yaml → webchatStatus`).

## 9. Modo estrito (`MF_STRICT_RELEASE=1`)

Ativado por `scripts/build.sh --release` e `--staging`. Nos scripts diretos
`deploy-server.sh` e `update.sh`, é opcional: use `MF_STRICT_RELEASE=1` para exigir
esta revisão (o padrão desse fluxo é `0`, independente do SEO indexável; veja
[SEO.md](SEO.md#build-de-produção)). Isso não altera os status ou datas de aprovação.

Com o modo estrito ativo, a release é **recusada** se houver:

- identidade empresarial incompleta na configuração pública, ou `VITE_SITE_URL` diferente de `PUBLIC_SITE_URL`;
- aviso legal sem revisão aprovada em `contracts/consents.json` (`status: approved` e `revisedAt`);
- artigo sem `review` aprovado (`status`, `reviewedAt`, `reviewer`) ou sem `publishedAt`;
- arquivo YAML de `content/` sem bloco `revision` aprovado;
- qualquer marcador `{{pending: …}}` (os de dados opcionais, ver seção 8, não bloqueiam nesta etapa);
- depois da pré-renderização, qualquer `[pendente: …]` ou elemento `pending-data` no HTML gerado
  (`scripts/postbuild.mjs`, com `MF_STRICT_RELEASE=1`) — pega também o que vem de componentes que mostram um dado
  de configuração ausente.

Para conferir antes da implantação, em `frontend/`:

```bash
../scripts/node-runtime.sh exec env MF_STRICT_RELEASE=1 MF_PUBLIC_CONFIG_FILE=<config-publica.json> \
  MF_OUT_DIR="$PWD/../.tmp/mf-check/dist" npx vite-ssg build
```

A mensagem de erro traz a lista completa do que falta. Para a segunda trava, rode também
`../scripts/node-runtime.sh exec env MF_STRICT_RELEASE=1 MF_OUT_DIR="$PWD/../.tmp/mf-check/dist" node scripts/postbuild.mjs`
sobre a mesma pasta (o `npm run build` e o `scripts/build.sh` já fazem isso). A pasta de saída fica sempre dentro do
projeto (`.tmp/`), nunca em `/tmp` nem por cima de `frontend/dist`.

## 10. Textos por fase e abertura financeira

### Disponibilidade do crédito (`site.yaml → availability`)

Cada fase (`PRE_LAUNCH`, `PILOT`, `LIVE`) tem seus textos: selo "Crédito em estruturação", aviso curto, texto do
rodapé e microcopy. Uma fase com `ready: false` **interrompe o build**. Mudar de fase é uma ação coordenada:
textos revisados com `ready: true` + `CREDIT_PHASE` no servidor + ferramentas da Bia + revisão da FAQ e das páginas
de produto. Alguns trechos das páginas (por exemplo, o que a Bia "não faz nesta fase" em `/seguranca`) só aparecem
em `PRE_LAUNCH`.

### Marcos (`launch.yaml`)

```yaml
- id: website-atendimento
  title: Website e atendimento
  description: ...
  status: pending            # pending | in_progress | done
  evidence: null             # texto público descrevendo a evidência conferida
  updatedAt: null            # data real da última mudança de status
  responsible: null          # quem conferiu a evidência (registro interno; não aparece na página)
```

- A atualização é **manual e baseada em evidência interna**. Nada muda por passagem de tempo; não há percentuais nem
  datas previstas, em nenhum campo.
- **Qualquer status diferente de `pending`** (`in_progress` ou `done`) exige `evidence`, `updatedAt` e
  `responsible`; sem eles o build de `/lancamento` **falha**. Sem evidência registrada, o marco fica `pending`, que a
  página mostra como “Pendente” (não quer dizer que nada foi feito, e sim que ainda não há evidência registrada).
- O primeiro marco só é concluído quando o website completo e seus canais estiverem publicados e verificados. Os
  demais refletem evidências reais (parcerias formalizadas, testes concluídos).
- `evidence` é exibida ao público: descreva o fato verificável sem expor contrato, pessoa ou dado interno
  (exemplo: "Website publicado e canais de atendimento verificados em homologação e produção").
- A linha de marcos fica em `/lancamento`. A home e a landing visual de aquisição usam links para acompanhar a
  preparação; não exibem os marcos. A aprovação da copy compartilhada em `pages/aquisicao.yaml` participa do
  `lastmod` dessas duas rotas, junto dos demais conteúdos que elas de fato exibem.

## 10a. Textos que dependem da configuração do servidor

Alguns blocos só são verdadeiros quando um canal ou a coleta estão ativos. O conteúdo declara isso; os componentes
escolhem o texto no build, a partir da configuração pública (`publicConfig`).

- `requires` em itens de lista (`frontend/src/components/pages/institutional.ts → meets`): `humanSupport` (equipe e
  canal humano reais), `biaChannel` (algum canal real com a Bia: chat do site **ou** WhatsApp), `webchat` (chat do
  site da Hal-AI habilitado), `biaWhatsapp` (Bia no WhatsApp oficial), `noBiaChannel` (texto para quando nenhum canal
  com a Bia está ativo), `waitlist` (cadastro de aviso aberto), `noWaitlist` (cadastro fechado) e `support`
  (formulário de atendimento aberto). Item cujo requisito não é atendido não aparece.
- Campos de variante: `*WaitlistClosed` (ex.: `hero.lead` e `steps.text` de `como-funciona.yaml`, `journey.text` da
  home, `hero.lead` e `journey.text` de `consignado-privado.yaml`), `linkWaitlistClosed` (benefícios da home),
  `textNoBiaChannel` (encerramento de `sobre.yaml`), `canTitleNoChannel` (bloco da Bia em `consignado-privado.yaml`),
  `channelPendingIntro` (`bia.yaml → panels.today`), `liveTextWebchat` (`bia.yaml`, só com o chat do site),
  `biaLiveWebchat` e `biaLiveBoth` (`solucoes.yaml`) e `noWhatsapp` (`cadastro-confirmado.yaml`). Sempre escreva
  todas as versões e revise cada uma.
- Botão flutuante de conversa (`site.yaml → floatingContact`): rótulos do painel, a ordem "Conversar com a Bia no
  site" (recomendado) e "WhatsApp" (última alternativa), o **aviso de tratamento** exibido antes de carregar o chat
  (`notice`: quem opera o chat, o que é tratado, cuidados e link para o Aviso de Privacidade) e as mensagens de
  carregamento, sucesso e falha. `failed` é o texto da seção 7 do briefing ("Não consegui conectar agora…"). O aviso
  de tratamento precisa corresponder ao que o contrato com a Hal-AI e o Aviso de Privacidade dizem.
- Formulários (`pages/formularios.yaml`): rótulos, dicas e mensagens de erro de cada campo do cadastro (CPF,
  WhatsApp, empregador, faixas...), o aviso de privacidade junto ao botão, o campo-armadilha (`trap`, nunca visível) e
  o pedido de saída (`optOut`). As opções das listas (vínculo, tempo no emprego, faixas de salário, UFs, temas) **não**
  ficam aqui: vêm de `contracts/validation.json`, as mesmas que a Bia recebe; mudar uma opção exige nova versão do
  contrato e revisão de `docs/BIA_AGENTE.md`.
- Jornada (`site.yaml → journey`): a etapa com `currentWhen: waitlist` só aparece como "etapa disponível" com o
  cadastro aberto; os rótulos vêm de `journeyStatus.current` e `journeyStatus.preparing`
  (`como-funciona.yaml → steps.statusPreparing` no caso de /como-funciona).

Regra de YAML: dentro de mapas em linha (`{ label: …, text: … }`), todo valor que tenha vírgula precisa de aspas
(`text: 'Se precisar, abra uma nova solicitação.'`). Sem aspas, o YAML corta o texto na vírgula; o build para com a
indicação do arquivo e da linha, em qualquer modo (desenvolvimento, revisão ou release).

## 11. Lista de verificação antes de aprovar

- [ ] Nenhum dado empresarial, número, depoimento, parceiro, taxa, prazo ou data inventado.
- [ ] Nenhuma expressão proibida (seção 1) e nenhuma promessa de condição, aprovação, rapidez ou economia.
- [ ] Textos exatos do briefing preservados.
- [ ] Fontes abertas e conferidas, com `accessedAt` real; normas citadas conferidas no texto vigente.
- [ ] `meta.title` único e `meta.description` própria (120–160 caracteres) em cada página nova.
- [ ] Links internos levam a páginas existentes; âncoras da FAQ (`/ajuda#id`) existem. O teste
      `cd frontend && npx vitest run --maxWorkers=2 src/components/editorial` confere isso
      automaticamente (links de artigos, FAQ e páginas editoriais; assunto de `/atendimento?assunto=`),
      além de fontes só em domínios oficiais com `accessedAt`, dois relacionados por artigo, revisão
      "aprovada" só com data e responsável e marco fora de `pending` só com evidência, data e responsável.
- [ ] Texto sobre medição de uso (banner, painel, Aviso e Política de cookies) descreve exatamente os eventos do
      contrato (`contracts/validation.json → events`): a lista `events` de `content/legal/cookie-consent.yaml` é
      conferida pelo teste `src/components/legal/legal.test.ts`.
- [ ] Respostas da FAQ fazem sentido fora da página (a Bia as usa em texto simples).
- [ ] Datas de revisão, aprovação e publicação reais e com responsável.
- [ ] Build de revisão sem erro; build estrito sem pendências antes da release pública.
