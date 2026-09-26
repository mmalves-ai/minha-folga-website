# Minha Folga — experiência simples e avisos do navegador

Revisão de 26/09/2026, a partir das correções do responsável após a versão 2. Prévia local: https://localhost:8000/avise-me. Gestão: https://localhost:8000/admin/notificacoes. Não houve publicação em produção.

## Mensagem e navegação

A abertura de home e landing apresenta **“Crédito para seus planos. Folga para seu mês.”** e explica em poucas linhas que a IA vai buscar opções para quem precisa de um empréstimo novo ou quer aliviar parcelas existentes. Duas situações ilustradas dão o mesmo destaque a essas necessidades.

O fluxo visual resume o papel da tecnologia: **Você conta → A IA busca → A Bia explica → Você decide.** As condições futuras continuam sujeitas à análise; a página não promete aprovação, economia garantida nem menor taxa de todo o mercado. A urgência vem da capacidade limitada e da ordem de cadastro confirmadas pelo responsável, sem contagem artificial ou prazo inventado.

Informações de configuração, fases internas e a tabela de capacidades da Bia saíram da apresentação comercial. As páginas de lançamento, produto, funcionamento, empresa, ajuda e segurança receberam a mesma revisão de linguagem. Os bloqueios financeiros no servidor permanecem.

No celular, a ação de cadastro acompanha a rolagem após a abertura. Ela se oculta durante o preenchimento e a exibição do formulário, menu ou preferências de cookies. O formulário mantém as duas etapas e todos os campos obrigatórios da decisão D1, incluindo CPF, empregador e vínculo. Os links focam o início do formulário.

## Imagens

A foto de planejamento ilustra o empréstimo novo; a nova cena familiar ilustra a organização das parcelas. São fotografias sintéticas editoriais, sem representação de clientes ou resultados reais. Textos e diagrama permanecem em HTML acessível. Imagens usam AVIF/WebP/JPEG responsivos, dimensões reservadas e carregamento sob demanda.

[Prompts, origem, tamanhos e caminhos da nova foto](ASSETS_V3.md). [Conjunto inicial e logos oficiais](../VISUAL_ASSETS.md).

## Notificações voluntárias

O visitante pode escolher **“Ativar avisos neste aparelho”** na home, landing ou confirmação. O navegador só solicita permissão depois desse clique. Essa inscrição é independente do cadastro de crédito e do consentimento de WhatsApp. O cancelamento fica em `/preferencias#avisos-navegador`, mesmo quando novos avisos estão desligados. Falhas combinadas de armazenamento e conexão preservam a credencial de cancelamento na sessão; a interface oferece recuperação explícita, sem afirmar que a ativação deu certo. [Revisão dos estados de recuperação](PUSH_RECOVERY_REVIEW.md).

A administração em `/admin/notificacoes` permite escrever, conferir a prévia, confirmar um envio, consultar resultados técnicos e cancelar pendências. Administradores podem autorizar pessoas nominalmente, com justificativa, e revogar essa permissão. Outros perfis não recebem autorização de envio automaticamente. A API e o worker conferem a permissão; ocultar o menu não é a proteção.

Campanhas têm fila persistente, idempotência, limite diário, tentativas limitadas e expiração. Inscrições inválidas são removidas. O histórico distingue a aceitação pelo provedor de uma entrega ou leitura, que não são comprovadas pelo Push.

[Operação, configuração e limitações](../WEB_PUSH.md). [Uso da gestão](../ADMIN_NOTIFICACOES.md). Consentimento e inventário de tecnologias atualizados; a autorização Push não é inferida da escolha de cookies.

## Ambiente revisável e limites

A migração `005_web_push.sql` foi aplicada à prévia local. Chaves VAPID próprias do ambiente foram geradas e mantidas em arquivos privados dentro do projeto, sem exposição ou inclusão no repositório. A API local responde `enabled: true`. Nenhuma campanha real foi enviada como teste.

Entrega efetiva em aparelhos depende de permissão, suporte do navegador e HTTPS confiável. A prévia utiliza certificado autoassinado; ela não substitui a homologação com certificado válido. No iPhone/iPad compatível, a interface orienta adicionar o site à Tela de Início. Os testes de transporte usam simulação, sem envio a pessoas.

As pendências anteriores de identidade empresarial, canais e revisão de publicação continuam registradas em `PENDENCIAS_PUBLICACAO.md`. Esta implementação não ativa contratação de crédito nem publica o site. Os avisos legais seguem em rascunho; os bloqueios de release foram preservados.

## Validação

- Frontend: 264 testes aprovados, incluindo ativação/cancelamento, estados administrativos e 38 casos do Service Worker.
- Backend: 297 testes aprovados, incluindo permissões, consentimento, fila, concorrência, limites, criptografia e transporte.
- Tipagem frontend/backend aprovada; build SSG com 24 rotas verificadas.
- Rotas: 53 testes aprovados, incluindo acesso direto, metadados, proteções financeiras e responsividade/acessibilidade das páginas públicas.
- Dez jornadas funcionais aprovadas: oito na primeira execução; teclado/menu e botão flutuante revalidados após retirar o wrapper adicional do rodapé. O atributo `inert` voltou diretamente ao rodapé, preservando o contrato do menu móvel.
- [Revisão visual](conversion-v3/README.md): 16 cenários responsivos sem overflow, violações axe, erros JavaScript ou imagens quebradas; 24 verificações de interação passaram. Home e landing em 360, 390, 768, 1024 e 1440 px; Bia, lançamento e produto em 390 e 1440 px.
- As 24 verificações de interação foram repetidas e aprovadas no build final, após a correção de recuperação dos avisos. A gestão respondeu 200/noindex, o Service Worker e manifesto foram servidos corretamente e a API administrativa recusou acesso anônimo com 401.
- O diálogo de cookies foi exercitado pelo evento interno; o banner opcional e o contato flutuante não estão ativos na configuração local. Ausência não foi tratada como validação dos canais habilitados.
- O servidor de prévia agora tolera arquivos ausentes durante a troca de build. Verificação isolada confirmou resposta temporária 503 e recuperação para 200 sem encerrar o processo. As rotas foram reexecutadas contra uma cópia estável do build para evitar interferência de reconstruções.

Não houve teste A/B nem pesquisa com visitantes reais; aumento de conversão não é tratado como resultado medido.
