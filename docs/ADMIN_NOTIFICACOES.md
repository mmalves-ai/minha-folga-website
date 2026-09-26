# Notificações no painel

A tela `/admin/notificacoes` reúne composição, histórico de campanhas e autorização nominal de remetentes. O backend continua responsável por autenticação, CSRF, autorização, limites, auditoria e processamento dos envios.

## Uso

1. Escreva título e mensagem. Os limites e os destinos permitidos vêm de `contracts/notifications.json`; não há campo para URL externa.
2. Confira a prévia. Ao escolher **Revisar envio**, o painel reconsulta a disponibilidade e a quantidade de aparelhos inscritos.
3. A confirmação mostra a mensagem, a página de destino e o público. O envio só é solicitado depois de marcar a confirmação e clicar em **Confirmar envio**.
4. Acompanhe a campanha no histórico. **Aceitas pelo serviço** não significa exibidas ou lidas. Pendências, processamento, falhas, expiração e cancelamentos aparecem separados.

A confirmação informa o total consultado e que novas inscrições ou cancelamentos podem alterar o público até a criação da campanha. A chamada cria uma fila; não promete recebimento imediato. Em caso de falha de rede, a mesma mensagem mantém a mesma chave de tentativa em memória, inclusive ao fechar e reabrir a prévia, evitando duplicação no retry. A chave não fica em URL ou armazenamento local.

## Acessos

- `notifications:send` libera a tela, a composição e o cancelamento das campanhas criadas pela própria pessoa. Administração pode cancelar qualquer campanha.
- `notifications:manage`, exclusivo de Administração, libera a lista nominal **Quem pode enviar**. Autorizar ou revogar exige justificativa e usa o diálogo auditado do painel. A permissão de Administração não pode ser retirada por essa lista.
- Sem autorização, a tela não consulta a API de campanhas nem de permissões. Um remetente sem gestão não consulta a lista de usuários autorizáveis.
- Com o envio desativado, histórico, cancelamento e gestão de permissões continuam disponíveis. As chaves VAPID e a configuração privada não aparecem no frontend.

## Integração e verificação

A rota foi registrada na navegação, nos tipos e rótulos de permissões, no Vue Router, nos exemplos Apache/Nginx, no servidor estático local e no roteiro de smoke. O painel segue o shell administrativo com `noindex`.

Testes da tela cobrem ausência de acesso, revisão/confirmacão antes de enfileirar, reconsulta do público, CSRF, repetição idempotente após falha, bloqueio de URL fora da lista, cancelamento com envio desativado, escopo por autoria e concessão nominal com justificativa. A tipagem passou e os testes de sessão existentes também passaram. Não houve envio real de mensagem nesta implementação; testes usam respostas locais simuladas. O build e a revisão no navegador ficam para a integração das frentes.
