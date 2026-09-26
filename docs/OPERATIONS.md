# Operação — Minha Folga

Rotina de quem opera o website depois de publicado: processos, logs, pessoas usuárias do painel, atendimento,
cadastros, privacidade, retenção, Hal-AI, backup, chaves, incidentes e mudança de fase. Publicação e atualização
estão em `docs/DEPLOY_SHARED_SERVER.md`; variáveis em `docs/ENVIRONMENT.md`; a decisão que tirou o WhatsApp deste
sistema, em `docs/DECISOES.md` (D1).

Em todos os comandos abaixo:

```bash
export MINHAFOLGA_APP_ROOT=/srv/minhafolga
export MINHAFOLGA_NODE=/srv/minhafolga/.runtime/node-v24.21.0-linux-x64/bin/node
export MINHAFOLGA_PROCESS_MODE=pm2        # ou systemd-user | manual
R="$MINHAFOLGA_APP_ROOT"
ENVF="$R/config/.env.production"
```

Regra geral: **toda ação é só sobre a Minha Folga** (raiz, processos da instância, banco dedicado). Nada de
`pm2 restart all`, `pm2 kill`, `pm2 save`, `pm2 flush`, `systemctl` de serviços do sistema, limpeza global de cache
ou edição do crontab por script.

Nomes dos processos: vêm da instância gravada na raiz por `deploy.sh init` — `minhafolga-api` (e
`minhafolga-worker`) em produção, `minhafolga-homolog-api` na homologação. Os exemplos abaixo usam os de produção;
`deploy.sh status` mostra os da raiz em uso.

**O que não se opera aqui (D1).** Este sistema não envia nem recebe WhatsApp. O número oficial, a Bia, o webchat, as
filas e os operadores do atendimento humano das conversas, os templates e as campanhas ficam na plataforma
**Hal-AI**. Daqui a Hal-AI só consome APIs (ferramentas da Bia); a única chamada de saída para ela é o placeholder de
template de cadastro, desligado (seção 8).

## 1. Iniciar, parar e reiniciar os processos

| Ação | Comando | O que atinge |
|---|---|---|
| Estado | `"$R"/current/scripts/deploy.sh status` | Release atual, releases, eventos recentes, porta, saúde, processos `minhafolga-*` |
| Reiniciar | `"$R"/current/scripts/deploy.sh restart --mode pm2` | `minhafolga-api` (e `minhafolga-worker` com `WORKER_MODE=separate`), com o Node registrado na release atual |
| Parar | `"$R"/current/scripts/deploy.sh stop --mode pm2` | idem |
| Verificar | `"$R"/current/scripts/deploy.sh verify` | Saúde local, prontidão interna e `smoke.sh` |

Equivalentes diretos, sempre **por nome**:

- PM2: `pm2 startOrReload "$R"/current/deploy/ecosystem.config.cjs --only minhafolga-api --update-env`,
  `pm2 stop minhafolga-api`, `pm2 logs minhafolga-api --lines 100`, `pm2 describe minhafolga-api` (o ambiente
  mostrado pelo `describe` não traz segredos: eles ficam só em `config/.env.production`).
- systemd de usuário: `systemctl --user restart|stop|status minhafolga-api.service`.
- Manual: prefira o comando impresso por `deploy.sh restart --mode manual`, que só sugere `kill -TERM` para o PID
  que escuta a porta **e** roda de uma release desta raiz (e recusa, sem sugerir PID, porta ocupada por outro
  serviço). Se fizer à mão: `ss -ltnp 'sport = :<PORT>'` mostra o PID; antes de encerrar, confira que
  `readlink /proc/<pid>/cwd` começa por `$R/releases/` — se não começar, o processo **não** é da Minha Folga e não
  deve ser encerrado (confira `PORT` em `config/.env.production`); `kill -TERM <pid>` encerra graciosamente (até
  10 s); para iniciar, use o comando impresso pelo script.

A API recusa iniciar com migração pendente (log `migrações pendentes`) e encerra se a porta estiver ocupada: nos dois
casos ela não tenta outra porta nem encerra o ocupante. Ao iniciar, avisa no log (só os nomes) se o arquivo de
ambiente ainda tiver variáveis que D1 tornou obsoletas (`docs/ENVIRONMENT.md`, "Variáveis obsoletas"): elas não têm
efeito e devem sair do arquivo na próxima publicação.

## 2. Logs e rotação

| Log | Onde | Conteúdo |
|---|---|---|
| API | `$R/var/log/api.out.log` e `api.err.log` | JSON por linha (pino), com horário; campos sensíveis mascarados; nunca corpo de cadastro, CPF, telefone, contato, token nem chave da Hal-AI |
| Worker (`WORKER_MODE=separate`) | `$R/var/log/worker.*.log` | idem |
| Implantação | `$R/var/releases.log` | Um evento por linha (`prepare`, `migrate`, `publish`, `verify`, `rollback`, `cleanup`...) |
| Servidor web — acesso | pasta exclusiva da hospedagem (ex.: `/var/log/nginx/minhafolga/access.log`) | IP, data e hora com fuso, host, método, caminho sem query string, protocolo, status, bytes, duração e user-agent; sem referer, cookies ou parâmetros. Retenção de 6 meses (`deploy/logrotate.minhafolga-web.conf.example`, instalada pelo administrador); acesso só de quem a hospedagem autorizar |
| Servidor web — erro | mesma pasta (`error.log`) | Falhas do servidor web e do proxy (pode trazer IP, a linha da requisição com a query string e o referer). Retenção de 30 dias |

O link de preferências gerado pela Bia leva o token no fragmento (`/preferencias#token=…`), que o navegador não envia
ao servidor web: ele não aparece nos registros de acesso nem de erro.

Para achar uma requisição: `grep '"requestId":"<id>"' "$R"/var/log/api.out.log` (o `requestId` volta em todo erro
JSON da API).

**Rotação própria**, com o `logrotate` do sistema executado pelo usuário da aplicação e estado privado:

```bash
umask 077
sed "s#<MINHAFOLGA_APP_ROOT>#$R#g" "$R"/current/deploy/logrotate.minhafolga.conf.example > "$R"/config/logrotate.conf
logrotate -d -s "$R"/var/run/logrotate.state "$R"/config/logrotate.conf    # simulação
logrotate    -s "$R"/var/run/logrotate.state "$R"/config/logrotate.conf    # execução
```

Diária, 14 cópias comprimidas, rotação antecipada acima de 50 MB, `copytruncate` (os processos seguem gravando no
mesmo arquivo; nenhum sinal é enviado ao PM2). Agende de uma destas formas, sem sobrescrever agendamentos
existentes:

1. **Timer `systemd --user`** (se o administrador adotar):

   ```ini
   # ~/.config/systemd/user/minhafolga-logrotate.service
   [Unit]
   Description=Minha Folga — rotação de logs
   [Service]
   Type=oneshot
   Nice=10
   ExecStart=/usr/sbin/logrotate -s /srv/minhafolga/var/run/logrotate.state /srv/minhafolga/config/logrotate.conf

   # ~/.config/systemd/user/minhafolga-logrotate.timer
   [Unit]
   Description=Minha Folga — rotação diária de logs
   [Timer]
   OnCalendar=*-*-* 03:15
   RandomizedDelaySec=15m
   Persistent=true
   [Install]
   WantedBy=timers.target
   ```

   `systemctl --user daemon-reload && systemctl --user enable --now minhafolga-logrotate.timer`.
2. **Agendador do painel** da hospedagem, com o mesmo comando.
3. **Crontab do usuário**, só pelo administrador e acrescentando uma linha identificada: `crontab -l > ~/crontab.antes`
   (cópia), `crontab -e` e adicione
   `15 3 * * * /usr/sbin/logrotate -s /srv/minhafolga/var/run/logrotate.state /srv/minhafolga/config/logrotate.conf # minhafolga-logrotate`.
   Nunca `crontab <arquivo>`, que substitui tudo.

Não use `pm2-logrotate` (módulo global do daemon) nem `pm2 flush`/`pm2 reloadLogs` sem nome (atingem todos os
processos).

Os registros do servidor web não são rotacionados pelo usuário da aplicação: ficam numa pasta exclusiva, fora do
padrão de rotação da hospedagem, com a regra `deploy/logrotate.minhafolga-web.conf.example` instalada pelo
administrador (acesso: 185 dias, cobrindo os 6 meses do Marco Civil, e depois apagados; erro: 30 dias).

## 3. Pessoas usuárias do painel e MFA

O banco novo não tem nenhuma pessoa usuária. A primeira é criada pela CLI da release publicada:

```bash
cd "$R"/current/backend
MF_ENV_FILE="$ENVF" "$MINHAFOLGA_NODE" dist/cli/admin-create.js --email pessoa@dominio-real --name "Nome" --role admin
```

- Papéis: `admin` (gerencia pessoas), `support` (atendimento), `privacy` (pedidos de titular), `marketing` (métricas
  agregadas). Dê a cada pessoa só o papel necessário. Com D1 o cadastro guarda CPF, empregador e faixa salarial:
  revise com mais cuidado quem tem `leads:read` (vê nome, empregador, faixas, cidade/UF, com telefone, CPF e e-mail
  mascarados) e `leads:read_contact` (revela telefone, CPF e e-mail completos, com motivo registrado).
- A **senha temporária aparece uma única vez** na saída: rode num terminal sem gravação de sessão, não redirecione
  para arquivo e entregue por canal seguro.
- No primeiro acesso a `/admin`, a pessoa cadastra o **MFA** (aplicativo autenticador, código TOTP) e troca a senha;
  sem MFA não há acesso aos dados.
- Demais pessoas: criadas no painel (seção Usuários) por quem tem papel `admin`. Pelo painel também se desativa uma conta,
  se gera nova senha temporária e se **reinicia o MFA** (celular perdido). Tudo fica na auditoria.
- Desligamento de alguém da equipe: desative a conta no mesmo dia; as sessões abertas dela são encerradas na hora.
- Revisão trimestral: lista de contas ativas × equipe real × papéis.

## 4. Rotina de atendimento

- Solicitações chegam pelo formulário `/atendimento`. Cada uma recebe protocolo aleatório (`MF-XXXX-XXXX-XX`); o
  titular acompanha pelo link seguro. **Conversas de WhatsApp e do webchat que precisam de uma pessoa são
  transferidas dentro da Hal-AI** (filas e operadores de lá): não chegam a este painel e não há ferramenta de
  transbordo da Bia para cá.
- No painel (seção Atendimentos): assumir, responder (a resposta marcada como visível aparece para o titular no
  acompanhamento), anotar internamente (cifrado), mudar estado e concluir. O contato de quem abriu a solicitação
  (e-mail ou telefone) aparece **completo, decifrado, no detalhe do atendimento** para quem tem a permissão
  `support:read` (papéis `admin`, `support` e `privacy`), porque é necessário para responder; não é pedido motivo,
  mas cada abertura do detalhe fica registrada na auditoria (`admin.support_viewed`: quem, qual solicitação, quando).
  Na lista de atendimentos aparece só a forma de contato e um trecho mascarado. Já o telefone e o CPF de um
  **cadastro** de interesse continuam exigindo motivo registrado para serem revelados (permissão `leads:read_contact`).
- **Retorno por WhatsApp** (opção do formulário, só com `WHATSAPP_BUSINESS_NUMBER` configurado): a equipe responde
  pelo WhatsApp oficial da Minha Folga, operado na Hal-AI. Este sistema não envia a mensagem; registre a resposta no
  painel para manter o histórico do protocolo.
- Assunto **"Segurança ou suspeita de golpe"**: trate no mesmo dia e, se houver indício de fraude usando a marca,
  siga a seção 11.
- Assunto **"Privacidade e meus dados"**: vira também um pedido de privacidade (seção 6).
- Prazo e horário: só os de `SUPPORT_RESPONSE_TIME` e `SUPPORT_HOURS`, que precisam corresponder à capacidade real.
  `HUMAN_SUPPORT_ENABLED=true` só com equipe e canal de retorno reais.
- Se `SUPPORT_NOTIFY_WEBHOOK_URL` estiver configurado, cada nova solicitação gera um aviso interno assinado; a
  solicitação é gravada antes e não se perde se o aviso falhar.

## 5. Cadastros de interesse (D1)

### Estados e telefone validado

| Estado | Quando | Onde aparece |
|---|---|---|
| `received` | Cadastro novo pelo formulário do site. O telefone **não está validado**: não há confirmação por código | Painel → Cadastros: "Não validado" na coluna Telefone (filtro Telefone → Não validado) |
| `verified` | A própria pessoa falou com a Bia pelo WhatsApp oficial e a ferramenta `upsert_customer` foi chamada com o número atestado pela plataforma. `contact_verified_at` guarda o momento | "Validado pela Bia" na coluna Telefone; contador `contact_verified_bia` |
| `invited` | Convite da abertura (fases futuras) | — |
| `unsubscribed` | O aviso de abertura foi revogado (Bia, Preferências, pedido de saída ou painel). Sai só com nova autorização explícita | — |
| `expired` | Revisão de retenção: 180 dias sem interação (seção 7). A pessoa voltando pela Bia reativa o cadastro | — |

Os estados `verification_pending`, `waiting` e `human_support` só existem em cadastros anteriores à D1.

Cadastros criados pela Bia já nascem `verified` (o número é o da conversa). O placeholder de template da Hal-AI
nunca dispara para eles.

### Submissões em revisão

O site **não altera um cadastro existente**. Quando alguém envia o formulário com um telefone ou um CPF que já têm
cadastro, a resposta ao navegador é a mesma de um cadastro novo (não revela nada), e a submissão fica guardada à
parte, **cifrada**, em `lead_submissions`. A Bia também guarda ali, sem mudar nada, o que recebeu quando o CPF é de
outro cadastro, quando é diferente do CPF já cadastrado para aquele número ou quando o contato está suprimido
(resultado `needs_review` para ela).

| Motivo (`reason`) | Significado |
|---|---|
| `existing_phone` | O telefone já tem cadastro |
| `existing_cpf` | O CPF já tem cadastro (com outro telefone) |
| `existing_phone_and_cpf` | Telefone e CPF do mesmo cadastro (reenvio) |
| `cpf_conflict` | O CPF pertence a outro cadastro, com outro telefone |
| `cpf_mismatch` | (Bia) CPF diferente do já registrado para o número |
| `suppressed` | (Bia) telefone ou CPF na lista de supressão |

No painel: **Cadastros → detalhe** mostra "Submissões em revisão", com canal, origem, horário e só os campos que
diferem do cadastro atual (telefone, CPF e e-mail mascarados). A lista de cadastros indica "N submissões em revisão"
no cadastro e o painel principal mostra o total. Abrir o detalhe fica na auditoria (`admin.lead_viewed`).

**Aplicar ou descartar (equipe de privacidade, `privacy:manage`).** No detalhe do cadastro, cada submissão pendente
tem **Aplicar ao cadastro** e **Descartar**, sempre com justificativa (5 a 200 caracteres), registrada na auditoria
(`admin.lead_submission_applied` / `admin.lead_submission_discarded`, com os nomes dos campos alterados e nunca os
valores). Regras:

- Aplicar muda só dados cadastrais: nome, CPF, e-mail, empregador, vínculo, tempo no emprego, faixa de salário,
  cidade/UF e tema de interesse. **O telefone e as preferências de comunicação nunca mudam por aqui** (telefone só é
  validado pela Bia; preferências só pelo titular, com a Bia ou pelo link de preferências). E-mail e tema vazios na
  submissão não apagam o que já existe. A trilha do cadastro ganha `profile_updated` com autor "admin".
- `existing_cpf` (mesmo CPF, **outro telefone**): o telefone da submissão não é validado e não é aplicado; confirme com
  a pessoa pelo canal já cadastrado antes de aplicar.
- `existing_phone` e `cpf_mismatch` com CPF diferente: aplicar **troca o CPF**; se o CPF novo já pertence a outro
  cadastro, a API recusa (`cpf_in_use`) e a submissão continua pendente.
- `cpf_conflict` e `suppressed` **não se aplicam**, só se descartam (mesclar cadastros ou contrariar um pedido de
  exclusão/oposição não é decisão do painel).
- Depois de aplicada ou descartada, o conteúdo cifrado da submissão é apagado (fica só o registro de que existiu).
- Troca de número de telefone: não há caminho pelo painel. A pessoa fala com a Bia pelo número novo; se o CPF já
  estiver no cadastro antigo, a Bia guarda `cpf_conflict` e a equipe resolve pelo pedido de privacidade (seção 6).
- A revisão de retenção **apaga toda submissão com mais de 30 dias** (pendente ou não). O prazo é proposta técnica:
  a decisão está em `docs/PENDENCIAS_PUBLICACAO.md` (retenção dos dados de D1).
- Uma submissão `cpf_conflict` pode indicar CPF de outra pessoa digitado por engano ou uso indevido: não entre em
  contato com o titular do cadastro existente para "confirmar" (isso revelaria o cadastro a quem enviou); trate como
  possível incidente se houver padrão (seção 11).

### Dados guardados e mascaramento

- Cifrados (AES-256-GCM, contexto por campo e por cadastro): telefone, CPF, e-mail e nome da empresa empregadora.
  Nome completo, vínculo, tempo no emprego, faixa de salário líquido, cidade e UF ficam em claro (faixas e UF como
  códigos de `contracts/validation.json`).
- Deduplicação por HMAC do telefone e do CPF (`CONTACT_DEDUP_HMAC_KEY`): um CPF pertence a no máximo um cadastro
  ativo.
- Painel e exportação CSV: telefone `(11) •••••-••34`, CPF `***.***.***-12`, e-mail mascarado. O CSV não traz
  nenhum desses dados completo e exige justificativa (auditado).
- Revelação completa (telefone, CPF e e-mail): **Revelar contato**, permissão `leads:read_contact`, motivo
  obrigatório, auditoria `admin.lead_contact_revealed` com a lista de campos revelados.

## 6. Pedidos de privacidade (titulares)

- Entradas: assunto "Privacidade e meus dados" no atendimento, pedidos de exclusão feitos na página de
  preferências e registros manuais da equipe `privacy` no painel (seção Privacidade), quando o pedido chega pelo
  `PRIVACY_CONTACT`.
- Fluxo: registrar (data de recebimento) → confirmar que quem pede é o titular, sem exigir documentos além do
  necessário → executar no painel (acesso/cópia, revogação de finalidade, supressão ou anonimização) → responder
  pelo canal do pedido → concluir com o resultado registrado. Correção de dados é feita pela própria pessoa (Bia ou
  Preferências, conforme o campo); o painel não edita cadastro. Os prazos são definidos pelo encarregado
  (`PRIVACY_OFFICER_NAME`) conforme a LGPD.
- **Saída das comunicações**, por qualquer caminho, vale na hora e revoga o aviso de abertura e as novidades; os
  envios pendentes da finalidade são cancelados e o worker confere a autorização de novo no momento do envio:
  - pela Bia ("sair", "pare", "não me mande" → ferramenta `update_contact_preferences` com `revoke_all`);
  - em Preferências, com a sessão aberta pelo link seguro que a Bia gera;
  - pelo **pedido de saída do site** (`/preferencias`, sem sessão): a pessoa informa só o número; a resposta é sempre
    a mesma e não mostra nada, nem se o número está cadastrado (protegido pelo anti-robô e pelo limite de 10
    pedidos por hora por rede de origem);
  - pela ação **Revogar tudo** de um pedido de privacidade no painel.
  Voltar a receber exige nova autorização explícita do próprio titular: pela Bia, no WhatsApp do mesmo número, ou em
  Preferências com a sessão do link da Bia. Não há mais "pausa de 180 dias" nem limite de códigos: não existem
  códigos de confirmação.
- **Supressão** (ação "Suprimir contato" do pedido de privacidade): o telefone **e o CPF** do cadastro entram na lista
  de supressão. A partir daí, um cadastro pelo site com esse telefone ou CPF recebe a resposta de sempre e nada é
  gravado; pela Bia, o resultado é `needs_review` sem mudar nada; nenhum envio sai para o número, nem a pedido do
  titular, inclusive depois da anonimização. Use-a em pedidos de exclusão ou de oposição, antes de anonimizar.
- **Anonimização** de um cadastro: apaga nome, telefone, CPF, e-mail, empregador e cidade (ficam só vínculo, faixas e
  UF, para contagens agregadas), revoga as finalidades, apaga sessões, links de preferências, as submissões em
  revisão ligadas ao cadastro **ou** ao mesmo telefone ou CPF e as tentativas do anti-robô com essas chaves, e limpa
  o conteúdo de mensagens da outbox. Alcança também todos os atendimentos do titular: os vinculados, o do pedido e
  os que têm a mesma chave de contato (mesmo WhatsApp ou e-mail). Os ids alcançados ficam na auditoria
  (`admin.privacy_anonymize_lead` → `supportRequestIds`).
- **Conversas na Hal-AI**: o que a pessoa escreveu para a Bia (inclusive CPF digitado na conversa) fica na
  plataforma da Hal-AI, fora deste banco. Um pedido de exclusão precisa ser repassado à Hal-AI conforme o contrato
  de operador (pendência em `docs/PENDENCIAS_PUBLICACAO.md`).
- Evidências mínimas de preferência e supressão podem precisar de retenção separada (seção 9 da especificação):
  decisão do encarregado, registrada.

## 7. Revisão de retenção e monitoramento do anti-robô

Política proposta (a validar pelo encarregado): revisão após **180 dias sem interação**.

```bash
cd "$R"/current/backend
"$MINHAFOLGA_NODE" dist/cli/retention-review.js --env-file "$ENVF"            # simulação: só contagens
"$MINHAFOLGA_NODE" dist/cli/retention-review.js --env-file "$ENVF" --apply    # depois da revisão
```

- Simulação mensal; `--apply` só depois de a equipe de privacidade revisar os números. Ele marca como `expired` os
  cadastros sem interação no período (sem revogar consentimentos) e remove itens técnicos vencidos há mais de 30
  dias: sessões e links de preferências, conteúdo e destinatário de mensagens finalizadas, eventos de replay das
  chamadas da Bia, **submissões em revisão com mais de 30 dias** e desafios de verificação antigos (tabela sem uso
  desde D1). Também remove usos de token do anti-robô já vencidos e tentativas com mais de 2 dias.
- Exclusão ou anonimização dos cadastros expirados é decisão da equipe de privacidade, no painel. Cadastros do site
  cujo telefone nunca foi validado pela Bia **não** são apagados automaticamente: o prazo deles é pendência jurídica.
- A saída não contém dados pessoais; guarde-a como registro da revisão.

**Anti-robô.** Os formulários públicos (cadastro e pedido de saída) exigem um token assinado de uso único com prova
de trabalho, tempo mínimo de preenchimento e campo-armadilha, e têm limites por rede de origem, CPF e telefone
(`contracts/validation.json → waitlist.antiBot` e `waitlist.limits`). Acompanhe no painel (Painel → Contadores
operacionais), sempre agregado e sem identificar ninguém:

| Contador | Dimensão | Leitura |
|---|---|---|
| `antibot_rejected` | `<formulário>:<motivo>`, com formulário `waitlist` ou `opt_out` e motivo `malformed`, `invalid_signature`, `too_young`, `expired`, `bad_proof`, `reused`, `honeypot`, `needs_elevated`, `limit_ip`, `limit_cpf`, `limit_phone` | Pico de `honeypot`, `bad_proof`, `invalid_signature` ou `malformed`: robô. `needs_elevated`: token fácil emitido antes de a rede passar do limiar (normal em pequena quantidade; o site reenvia sozinho). Pico de `limit_*`: disparo contra um CPF, um número ou a partir de uma rede |
| `waitlist_received` | origem | Cadastros novos |
| `waitlist_held` | motivo (e `bia:<motivo>`) | Submissões guardadas para revisão |
| `waitlist_suppressed` | origem | Tentativas com telefone ou CPF suprimido (nada gravado) |
| `optout_site` | — | Pedidos de saída pelo site que revogaram alguma finalidade |
| `contact_verified_bia` | — | Telefones validados pela Bia |

Recusas `too_young` e `expired` isoladas são normais (formulário enviado rápido demais ou aberto por horas: o site
pede outro token e reenvia uma vez).

**Rede compartilhada (CGNAT).** Muita gente de operadora móvel sai pelo mesmo IP. Por isso o limite por rede não barra
cedo: a partir de `waitlist.limits.elevatedAfterPerIpPerHour` (10) cadastros aceitos na última hora, a rede recebe
prova de trabalho mais difícil (`waitlist.antiBot.elevatedDifficultyBits`, 18 bits, cerca de 4 vezes o esforço, calculado em
segundo plano enquanto a pessoa preenche) e o `429` só vem em `submissionsPerIpPerHour` (60). Os
limites por CPF (3/dia) e por telefone (3/dia) continuam os mesmos. Configure alerta para picos de `antibot_rejected` e para 429 `rate_limited` em
`/api/waitlist` e `/api/preferences/opt-out` nos logs da API.

## 8. Hal-AI: Bia, placeholder de template e webchat

### Bia (entrada)

- Ligar: `HALAI_ENABLED=true` e `HALAI_INBOUND_API_KEY` (gerada pela equipe, `docs/ENVIRONMENT.md`) no arquivo de
  ambiente; a mesma chave é cadastrada na importação das ferramentas na Hal-AI (`X-API-Key`). Reinicie a API.
  Para o site anunciar a Bia no WhatsApp, também `WHATSAPP_BUSINESS_NUMBER` e **nova release** (o anúncio vem da
  configuração pública do build).
- Conferir: `GET /api/agent/capabilities` com a chave devolve fase, ferramentas e motivos; sem a chave, `401
  invalid_api_key`; com a Bia desligada, `503 agent_disabled`.
- Desligar em emergência: `HALAI_ENABLED=false` + `deploy.sh restart`. Todas as ferramentas respondem `503`; a Bia
  continua conversando na Hal-AI, mas sem cadastrar nem consultar nada daqui.
- Registro: cada chamada gera uma linha em `agent_tool_calls` (ferramenta, desfecho, fase e HMAC da conversa, sem
  conteúdo) e o contador `agent_tool_call` (`<ferramenta>:<desfecho>`). `upsert_customer` também gera auditoria
  `lead.customer_upserted` com os nomes dos campos alterados, sem valores.
- **Pré-requisito ainda aberto:** a Hal-AI precisa confirmar que `senderPhone`/`senderVerified` são preenchidos pela
  plataforma a partir do canal, e nunca pelo modelo (`docs/BIA_AGENTE.md`, A.3). Até lá, a integração opera sem
  `senderVerified`: as ferramentas de cadastro e preferências respondem `403 sender_not_verified`.

### Placeholder de template de cadastro (saída, desligado)

Existe no código, **desligado** (`HALAI_SIGNUP_TEMPLATE_ENABLED=false`), para quando houver decisão e agente
provisionado. Um template é pago; por isso ele só entra na fila depois de **todas** as travas:

1. `HALAI_SIGNUP_TEMPLATE_ENABLED=true` com `HALAI_ENABLED=true`, `HALAI_API_KEY`, `HALAI_CHANNEL`,
   `HALAI_SIGNUP_TEMPLATE` e `HALAI_TEMPLATE_DAILY_CAP` (sem qualquer um, a API não inicia);
2. o envio passou pelo anti-robô completo (token válido e não usado, prova de trabalho, idade mínima,
   campo-armadilha vazio e limites por IP, CPF e telefone) e criou um cadastro **novo** — submissão sobre cadastro
   existente, cadastro pela Bia e campo-armadilha preenchido nunca disparam;
3. o aviso de abertura foi autorizado (conferido de novo pelo worker no envio, com a lista de supressão);
4. o número não recebeu template nos últimos 30 dias;
5. o teto diário global não foi atingido (dia no horário de Brasília).

Ligar: decisão registrada (custo e texto do template), template aprovado na Hal-AI, variáveis numa cópia do ambiente
promovida na publicação e, antes, um teste em homologação com o canal e os números da equipe. Acompanhar:
`halai_template_queued` e `halai_template_withheld` (motivos `not_authorized`, `recent`, `daily_cap`), e o aviso de
log `teto diário de templates da Hal-AI atingido; nada foi enfileirado`. Desligar: `HALAI_SIGNUP_TEMPLATE_ENABLED=false`
e reinício; o que estiver na fila é cancelado no momento do envio (`template_disabled`). Erros da Hal-AI: rede,
tempo esgotado, 408, 429 e 5xx são retentados (até 3 tentativas, espera crescente); 401/403 e demais 4xx falham de
vez — confira a chave e o canal.

### Webchat (placeholder)

O widget da Hal-AI ainda não foi provisionado. Para ligar, com os dados entregues pela Hal-AI:

1. `HALAI_WEBCHAT_ENABLED=true`, `HALAI_WEBCHAT_SCRIPT_URL` (HTTPS) e `HALAI_WEBCHAT_WIDGET_ID` numa cópia do
   ambiente;
2. **CSP do servidor web**: acrescentar a origem do script em `script-src`, `connect-src` (e `wss://…` se o chat usar
   WebSocket) e `frame-src`, e só se o widget exigir em `style-src`, `img-src` e `font-src`
   (`docs/DEPLOY_SHARED_SERVER.md`, seção 5.6). Sem isso o navegador bloqueia o chat e a pessoa vê a mensagem de falha;
3. revisar a Política de cookies e o Aviso de Privacidade com o que o widget grava no navegador;
4. **nova release** (`deploy.sh prepare ... --env-file config/.env.next` e `publish --promote-env`): o canal vem da
   configuração pública do build;
5. conferir no navegador: o script só é pedido depois de "Conversar com a Bia no site" e "Abrir o chat".

No webchat não há número atestado: a Bia responde dúvidas e indica o formulário do site para o cadastro.

## 9. Backup e restauração do banco dedicado

### Rotina

- **Antes de cada migração**: automático (`deploy.sh migrate`).
- **Diário**: `"$R"/current/scripts/deploy.sh backup-db diario`, agendado como na seção 2 (timer ou painel, com
  `MINHAFOLGA_APP_ROOT` e `MINHAFOLGA_NODE` definidos na unidade). Retenção local:
  `deploy.sh cleanup --keep-backups 10`.
- **Cópia externa**: os dumps em `backups/` são temporários. Copie-os, cifrados, para armazenamento exclusivo e
  protegido (acesso só da equipe responsável) e registre o destino. As chaves `CONTACT_ENCRYPTION_KEY` e
  `CONTACT_DEDUP_HMAC_KEY` ficam em cofre separado: o dump sem elas não recupera telefones, CPFs, e-mails,
  empregadores e demais dados cifrados, e as chaves sem o dump não expõem nada. Nome completo, faixas, cidade e UF
  ficam em claro no dump: trate o dump inteiro como dado pessoal.
- O dump é `pg_dump --format=custom` do banco dedicado, conferido com `pg_restore --list`, `chmod 600`.

### Teste de restauração (trimestral e antes da primeira publicação — critério da seção 13)

Restaure num banco **separado**, nunca por cima do de produção:

```bash
# administrador do PostgreSQL:
#   CREATE DATABASE minhafolga_restauracao OWNER minhafolga_app TEMPLATE template0 ENCODING 'UTF8';
DUMP="$(ls -t "$R"/backups/db-*.dump | head -n 1)"
pg_restore --list "$DUMP" >/dev/null
pg_restore --no-owner --role=minhafolga_app --exit-on-error -h 127.0.0.1 -U minhafolga_app -d minhafolga_restauracao "$DUMP"
psql -h 127.0.0.1 -U minhafolga_app -d minhafolga_restauracao -Atc \
  "select (select count(*) from schema_migrations) as migracoes, (select count(*) from leads) as cadastros, (select count(*) from support_requests) as atendimentos"
# compare com o banco de produção no mesmo instante; depois: DROP DATABASE minhafolga_restauracao;
```

Registre data, arquivo, contagens e quem conferiu. (Procedimento exercitado na bateria de implantação de 26/09/2026,
antes da migração `003_d1_cadastro_halai.sql`: contagens idênticas. Refaça depois de aplicar a 003.)

### Restauração real (incidente)

Restaurar descarta tudo o que chegou depois do dump (cadastros, protocolos, preferências, descadastros). Só com
decisão do responsável e do encarregado.

1. `deploy.sh stop` (a página segue no ar; os formulários informam que não foi possível enviar, sem sucesso falso;
   as ferramentas da Bia deixam de responder).
2. Faça um dump do estado atual (`deploy.sh backup-db antes-da-restauracao`), mesmo danificado: ele guarda os
   descadastros e pedidos posteriores ao backup.
3. Restaure num banco novo (`minhafolga_restaurado`), confira as contagens.
4. Troque `DATABASE_URL` em `config/.env.production` para o banco restaurado (ou peça ao administrador para renomear
   os bancos) e rode `deploy.sh migrate <release atual>` se o dump for anterior a alguma migração.
5. `deploy.sh restart` e `deploy.sh verify`.
6. Reaplique a partir do dump do passo 2 os descadastros, supressões e pedidos de privacidade posteriores ao backup
   (a lista de supressão nunca pode regredir).

## 10. Rotação de chaves e segredos

| Segredo | Como rotacionar | Cuidado |
|---|---|---|
| `CONTACT_ENCRYPTION_KEY` | Gere a nova e **coloque-a primeiro**: `CONTACT_ENCRYPTION_KEY=k2:<nova>,k1:<antiga>`; `deploy.sh restart`. Novos dados passam a usar `k2`; os antigos continuam legíveis por `k1` | Remova `k1` só quando nenhum registro a usar (consulta abaixo). Esta entrega não tem ferramenta de recifragem: registros antigos com `k1` saem pela retenção/anonimização |
| `CONTACT_DEDUP_HMAC_KEY` | **Não rotacione** sem migração planejada | Com outra chave, cadastros, CPFs e a **lista de supressão** deixam de ser reconhecidos |
| `SESSION_SECRET` | Troque e reinicie | Reinicia os contadores de limite por IP (em memória e os do anti-robô no banco; os por CPF e telefone continuam), invalida tokens de formulário em andamento (o site pede outro) e a correlação de conversas |
| `READINESS_TOKEN` | Troque, reinicie e atualize o monitoramento | — |
| Senha do banco | `psql -c '\password minhafolga_app'` (administrador, ou o próprio papel conectado com a senha atual) → nova senha em `DATABASE_URL` no `config/.env.production` → `restart` | Nunca `ALTER ROLE ... PASSWORD '...'` digitado nem senha na linha de comando: ficariam em `~/.psql_history`, no log do servidor e no `ps`. O `\password` envia só o verificador SCRAM. Faça em sequência curta: entre os passos a API perde novas conexões |
| `HALAI_INBOUND_API_KEY` | Gere a nova, troque no arquivo e reinicie; atualize a chave na importação das ferramentas na Hal-AI na mesma janela | O servidor aceita uma chave por vez: entre a troca aqui e lá, as chamadas da Bia respondem `401 invalid_api_key`. Faça em horário de pouco movimento |
| `HALAI_WEBHOOK_SECRET` (se usado) | Coordene com a Hal-AI: durante a troca ela envia as duas assinaturas em `X-MF-Signature` (lista separada por vírgula); troque aqui e reinicie; depois ela para de enviar a antiga | — |
| `HALAI_API_KEY` (se o placeholder estiver ligado) | Emita a nova na Hal-AI, troque aqui e reinicie; só então revogue a antiga lá | Se a antiga for revogada antes do reinício, os envios do intervalo falham como `http_401` e não são retentados |
| `SUPPORT_NOTIFY_WEBHOOK_SECRET` | Troque aqui e no destino do aviso, em sequência | Avisos no intervalo falham e são retentados |

Rotacione imediatamente qualquer segredo exposto (log, chat, commit, print) e trate como incidente (seção 11).
Segredos antigos do provedor de WhatsApp (`MESSAGE_PROVIDER_SECRET`, `MESSAGE_WEBHOOK_*`) e `HALAI_API_SECRET`
não são mais usados: remova-os do arquivo e revogue-os na origem.

Quais ids de chave ainda cifram registros:

```sql
SELECT campo, chave, count(*) AS registros FROM (
  SELECT 'leads.phone' AS campo, split_part(phone_ciphertext, '.', 1) AS chave FROM leads WHERE phone_ciphertext <> ''
  UNION ALL SELECT 'leads.cpf', split_part(cpf_ciphertext, '.', 1) FROM leads WHERE cpf_ciphertext IS NOT NULL
  UNION ALL SELECT 'leads.email', split_part(email_ciphertext, '.', 1) FROM leads WHERE email_ciphertext IS NOT NULL
  UNION ALL SELECT 'leads.employer', split_part(employer_ciphertext, '.', 1) FROM leads WHERE employer_ciphertext IS NOT NULL
  UNION ALL SELECT 'lead_submissions.payload', split_part(payload_ciphertext, '.', 1) FROM lead_submissions WHERE payload_ciphertext <> ''
  UNION ALL SELECT 'verification_challenges.pending_payload (legado)', split_part(pending_payload_ciphertext, '.', 1) FROM verification_challenges WHERE pending_payload_ciphertext IS NOT NULL
  UNION ALL SELECT 'outbox_messages.recipient', split_part(recipient_ciphertext, '.', 1) FROM outbox_messages WHERE recipient_ciphertext IS NOT NULL
  UNION ALL SELECT 'outbox_messages.payload', split_part(payload_ciphertext, '.', 1) FROM outbox_messages WHERE payload_ciphertext <> 'redacted'
  UNION ALL SELECT 'admin_users.mfa_secret', split_part(mfa_secret_ciphertext, '.', 1) FROM admin_users WHERE mfa_secret_ciphertext IS NOT NULL
  UNION ALL SELECT 'support_requests.contact', split_part(contact_ciphertext, '.', 1) FROM support_requests
  UNION ALL SELECT 'support_requests.message', split_part(message_ciphertext, '.', 1) FROM support_requests
  UNION ALL SELECT 'support_events.note', split_part(note_ciphertext, '.', 1) FROM support_events WHERE note_ciphertext IS NOT NULL
) AS t GROUP BY campo, chave ORDER BY campo, chave;
```

## 11. Plano de incidentes

Exemplos: vazamento de segredo, acesso indevido ao painel, dados expostos (inclusive CPF), página alterada, golpe
usando a marca, indisponibilidade prolongada, disparo de robôs contra os formulários, templates enviados por engano.

1. **Conter** (minutos):
   - ferramentas da Bia: `HALAI_ENABLED=false` + `deploy.sh restart` (respondem `503 agent_disabled`, sem sucesso
     falso);
   - templates pagos: `HALAI_SIGNUP_TEMPLATE_ENABLED=false` + `deploy.sh restart` (a fila é cancelada no envio);
   - formulário de cadastro do site: **Painel → início → "Formulário de cadastro do site" → Pausar formulário**
     (papel admin, com justificativa; vale em até ~30 s, sem reiniciar). O site passa a mostrar "cadastro
     indisponível"; a Bia (telefone atestado) e o pedido de saída continuam. Sem acesso ao painel:
     `WAITLIST_FORM_ENABLED=false` no arquivo de ambiente + `deploy.sh restart` (o painel não consegue reabrir enquanto
     a variável estiver assim). Para suspender toda a coleta, `deploy.sh stop` (as páginas seguem no ar e os
     formulários informam que não foi possível enviar);
   - revogar sessões do painel: `UPDATE admin_sessions SET revoked_at = now() WHERE revoked_at IS NULL;` (e, se
     preciso, as dos titulares em `contact_sessions`); desativar contas suspeitas no painel;
   - segredo exposto: rotacionar (seção 10);
   - release comprometida: `rollback.sh` para uma release íntegra, ou `deploy.sh stop`.
2. **Preservar evidências**: copie `var/log/`, `var/releases.log` e a auditoria do painel para
   `var/private/incidente-<data>/` (`chmod 700`) antes da rotação apagá-los, e peça ao administrador a cópia dos
   registros do servidor web do período (pasta exclusiva da Minha Folga). Não altere registros de auditoria.
3. **Avaliar**: quais dados, quantos titulares, desde quando, se o acesso foi confirmado. Compare inventários
   (`preflight.sh --compare`) para saber se algo fora da Minha Folga mudou. Se o incidente envolver conversas,
   acione a Hal-AI (as conversas ficam na plataforma dela).
4. **Comunicar**: responsável pela operação e encarregado de dados imediatamente. A comunicação à ANPD e aos
   titulares, quando o incidente puder acarretar risco ou dano relevante (art. 48 da LGPD), é decisão do
   controlador. Golpe usando a marca: aviso na página `/seguranca` e nos canais oficiais.
5. **Recuperar**: corrigir para frente (nova release), restaurar backup só conforme a seção 9.
6. **Aprender**: registro do incidente (linha do tempo, causa, correção, prevenção) em até 5 dias úteis.

Contatos de acionamento (responsável técnico, encarregado, hospedagem, Hal-AI): **pendência** — preencher com nomes e
canais reais antes da publicação.

## 12. Mudança de fase (PRE_LAUNCH → PILOT → LIVE)

O website fica completo em todas as fases; a fase governa só crédito e integrações. Mudar de fase é uma ação
**coordenada** entre conteúdo, servidor e Bia (seções 8.5 e 11 da especificação):

| Frente | O que muda | Referência |
|---|---|---|
| Aprovação | Liberação jurídica, comercial e técnica registrada; para `LIVE`, conclusão do piloto e limites aprovados | Especificação, seção 11 |
| Conteúdo | Textos da fase em `frontend/content/site.yaml → availability` com `ready: true`, marcos em `launch.yaml` com evidência, FAQ e páginas de produto revisadas | `docs/CONTENT_GUIDE.md`, seção 10 |
| Servidor | `CREDIT_PHASE` (e `CREDIT_OPERATIONS_ENABLED` somente com integração homologada) em `config/.env.production` | `docs/ENVIRONMENT.md` |
| Bia | Capacidades por fase e ferramentas de crédito; contexto na Hal-AI | `docs/BIA_AGENTE.md`, A.5 e B.5 |

Ordem — o arquivo que a API em execução lê (`config/.env.production`) **não** é editado antes da publicação: um
reinício não planejado (queda, `max_memory_restart`, `restart`) no meio do build subiria a API na fase nova com o
HTML da anterior. A fase nova vai num arquivo à parte e é promovida junto com a release (o mesmo vale para ligar o
webchat ou trocar o número do WhatsApp, que também mudam o HTML):

1. Homologação primeiro: mesma sequência abaixo na raiz de homologação, com testes de ponta a ponta.
2. Em produção, prepare a cópia com a fase nova:

   ```bash
   umask 077
   cp -p "$ENVF" "$R"/config/.env.next
   # edite SOMENTE "$R"/config/.env.next: CREDIT_PHASE=PILOT (e o que mais a fase exigir)
   ```

3. `deploy.sh prepare <id> ... --release --env-file "$R"/config/.env.next`: o build exporta a fase nova para o HTML
   pré-renderizado (os textos de disponibilidade vêm da configuração pública) e falha se os textos da fase não
   estiverem prontos. A release registra o arquivo e o hash dele.
4. `deploy.sh migrate <id>` e `deploy.sh publish <id> --promote-env`: o `publish` confere que `.env.next` não mudou
   desde o prepare, guarda o atual em `config/.env.production.antes-<id>` (`0600`), troca `config/.env.production`
   de forma atômica, promove `current` e recarrega a API — frontend e API passam juntos para a fase nova. Se a
   recarga falhar, ambiente e `current` voltam sozinhos.
5. `smoke.sh https://www.minhafolga.com.br --phase PILOT` e testes manuais do grupo autorizado.
6. Atualize a configuração da Bia na Hal-AI na mesma janela (contexto e ferramentas importadas).
7. Reversão: `rollback.sh` volta para a release da fase anterior **e** restaura `config/.env.production.antes-<id>`
   (os dados recebidos ficam). Depois de estabilizar, apague as cópias antigas de `config/.env.*` que não servem mais
   de destino de rollback (elas contêm segredos).

Nesta entrega não há integração financeira homologada: em `PILOT`/`LIVE` as rotas e ferramentas de crédito seguem
indisponíveis até que ela exista. Alterar variável do frontend, esconder botão ou editar HTML não habilita crédito:
a autorização é sempre do backend.
