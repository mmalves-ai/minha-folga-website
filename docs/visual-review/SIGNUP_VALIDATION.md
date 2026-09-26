# Cadastro e medição — validação da revisão visual

26/09/2026. Verificações locais com Node privado, API de testes e bancos PGlite exclusivos; sem dados reais.

## Comportamento implementado

- Campos completos da decisão D1 preservados, conforme reafirmação direta do contratante (D1.2).
- Duas etapas: dados pessoais; trabalho, localidade e escolhas de comunicação. Avançar ou voltar não grava cadastro.
- Erros associados ao campo, foco transferido para a etapa correta e valores preservados ao voltar ou repetir envio.
- Confirmação somente depois de resposta válida `received` do backend. Resposta lenta mantém “Enviando…”.
- Resposta genérica para CPF/telefone existente preserva privacidade; confirmação explica que dados anteriores não são sobrescritos.
- Eventos agregados de clique, erro exibido e recebimento confirmado usam apenas origem de lista fixa, com a medição
  habilitada e consentimento vigente. Não carregam campos, valores nem mensagens de erro.
- Clique duplo não duplica envio nem evento de CTA. Recebimento no navegador é distinto de cadastro novo no servidor.
- Clique na Bia não é contado como conversa iniciada: falta callback verificável da Hal-AI, documentado em DECISOES.md.

## Resultados

| Verificação | Resultado |
|---|---|
| Formulário, analytics, inventário legal e componentes do painel | 57 testes passaram |
| Backend: eventos e métricas administrativas | 46 testes passaram |
| Backend: cadastro, validação, duplicidade, anti-robô e privacidade | 25 testes passaram |
| Build isolado e postbuild (HTML, CSP, rotas) | 24 rotas verificadas |
| Jornadas reais Chrome: cadastro, Bia API, preferências, opt-out, protocolo, painel/MFA/permissões | 8 passaram |
| Chrome: teclado/menu móvel e canais desativados | 2 passaram após atualizar expectativa para a copy atual do CTA |

A primeira execução E2E encontrou uma expectativa antiga de texto (“Quero ser avisado”) no teste do menu, depois de
8 jornadas funcionais aprovadas. A expectativa foi atualizada para “Quero receber o aviso”; os dois testes restantes
foram executados novamente e passaram. Não houve falha do cadastro ou alteração de suas exigências.

Relatórios e resumos locais ficam em `.tmp/visual-review-signup/` (ignorado pelo Git). O build usado nas jornadas é
anterior à chegada dos arquivos fotográficos finais; revisão visual e desempenho das fotos pertencem ao relatório
visual principal. A medição continua desativada na configuração local. Aprovação jurídica e identidade empresarial
não foram inferidas dos testes.
