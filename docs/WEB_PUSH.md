# Notificações do navegador

Implementação pedida pelo contratante em 26/09/2026. Visitantes e clientes podem autorizar avisos neste aparelho, sem CPF, conta, lead nem autorização de WhatsApp. O botão público somente solicita permissão do navegador depois do clique da pessoa. O texto e a versão ficam em `contracts/notifications.json`.

## Configuração

Tudo usa runtime, dependências, temporários e cache privados do projeto. Dentro de `backend/`, executar:

```sh
../scripts/node-runtime.sh exec npm run push:keys:dev -- --subject=https://www.minhafolga.com.br
```

A CLI grava `backend/.env.web-push` (ignorado pelo Git), modo 0600, criação exclusiva. Não imprime a chave privada nem sobrescreve arquivo existente. O arquivo começa com `WEB_PUSH_ENABLED=false`. O subject deve ser o endereço HTTPS ou contato real da organização. Não regenerar as chaves em cada deploy: inscrições existentes estão vinculadas à chave VAPID usada para criá-las.

Adicionar ao ambiente exclusivo da API e do worker `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY`, `WEB_PUSH_VAPID_SUBJECT`, `WEB_PUSH_ENABLED` e `WEB_PUSH_DAILY_CAMPAIGN_CAP` (padrão 3; intervalo 1–20). Configuração ativada sem um par P-256 correspondente é recusada no startup. `GET /api/notifications/config` entrega somente disponibilidade, chave pública e versão do consentimento; a chave privada permanece no servidor.

Aplicar a migração `005_web_push.sql` antes de iniciar a release. O worker existente (`WORKER_MODE=inline` ou processo separado) passa a processar também a fila Push. Desativar `WEB_PUSH_ENABLED` pausa novos cadastros/envios; o cancelamento pelo dono continua disponível. Campanhas com mais de 24 horas não são enviadas ao religar. HTTPS é necessário para Service Worker e Push API (localhost pode receber tratamento especial do navegador).

## Gestão e autorização

A gestão opera em `/admin/notificacoes`. Administradores podem redigir, conferir a prévia, confirmar envio, acompanhar o resumo e cancelar pendências. Também autorizam ou revogam usuários nominalmente, com justificativa. Nenhum papel `marketing`, `support` ou `privacy` recebe envio por padrão. A sessão relê a concessão em cada requisição, e o worker relê a autorização do remetente antes de enviar; a revogação cancela as suas pendências.

Título até 60 caracteres, texto até 180; destino escolhido entre páginas públicas fixas da própria Minha Folga. Sem URLs externas, administração, query string ou dados pessoais. Uma UUID por intenção de envio dá idempotência; reenvio de rede preserva essa chave e o mesmo conteúdo. O limite global de campanhas nas últimas 24 horas é conferido em transação, inclusive com remetentes simultâneos. Inscrições posteriores não entram em uma campanha anterior.

Cada campanha apresenta inscritos selecionados e contagens de pendentes, em envio, aceitos pelo serviço Push, falhos, expirados e cancelados. **Aceito pelo provedor não significa entregue, exibido nem lido.** Não há rastreamento de leitura, pixel ou listagem de endpoints na gestão.

## Proteções e limites

- JSON e origem permitida no público; MFA, sessão, CSRF e autorização em todas as operações administrativas.
- Endpoint/chaves da inscrição cifrados com AES-256-GCM, HMAC de deduplicação e token de cancelamento armazenado somente como hash. Reinscrição com as mesmas credenciais recupera o controle local; outras chaves não sobrescrevem a inscrição. O token de cancelamento deriva da chave aleatória de autenticação da própria inscrição, sem depender de rotação da sessão administrativa.
- Endpoint HTTPS sem credenciais, fragmento ou porta não padrão. Allowlist: FCM `fcm.googleapis.com/fcm/send/`, Mozilla `updates.push.services.mozilla.com/wpush/`, Apple `web.push.apple.com`, Windows `notify.windows.com` e seus subdomínios diretos com caminho `/w/`. Outros provedores exigem revisão explícita. Não há configuração que aceite host arbitrário.
- O transporte revalida endpoint/chaves, usa `https.request`, não segue redirecionamentos e tem deadline absoluto de 12 segundos, além do timeout de inatividade de 10 segundos. Corpos/headers de resposta e erros do provedor não são armazenados.
- Inscrições limitadas por rede (30/hora), máximo global de 100 mil. A contagem de novas inscrições é conferida em transação. Não há vínculo com cadastro de crédito; apagar o lead não revoga automaticamente esta autorização independente.
- Fila persistente, lotes de até dez, `SKIP LOCKED`, token por reserva e renovação antes de cada envio. Até três tentativas com espera crescente. O identificador de campanha permite agrupar a mesma notificação no aparelho; Push não oferece garantia de entrega exatamente uma vez.
- Cancelamento apaga a inscrição e cancela pendências. HTTP 404/410 remove endpoint inválido. Uma requisição já aceita pelo provedor pode chegar após o cancelamento, pois não pode ser recolhida.
- Auditoria registra autorizações, concessões, campanhas e resultado técnico, sem endpoint, chaves, conteúdo da mensagem ou dados de crédito. O texto da campanha fica no histórico administrativo para revisão.

## Validação

Testes usam PGlite em memória e transporte simulado; nenhum envio real a terceiros é usado como teste. Cobrem opt-in/opt-out, consentimento, cifragem, SSRF, concessões/revogação, CSRF, audiência, idempotência, limite, retries, recuperação de reserva e expiração. A aceitação efetiva pelos navegadores depende de HTTPS, chaves e permissão reais; deve ser conferida em homologação autorizada antes da publicação.

Fontes primárias: [PushManager.subscribe — MDN](https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe), [Push API — W3C](https://www.w3.org/TR/push-api/), [web-push — biblioteca oficial](https://github.com/web-push-libs/web-push). Implementação usa `web-push@3.6.7` para criptografia e assinatura VAPID, com transporte HTTPS próprio limitado.
