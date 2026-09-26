# Revisão do fluxo público de avisos — 26/09/2026

A revisão independente encontrou uma falha de recuperação: após resposta 201, bloqueio do armazenamento local e falha simultânea na revogação do servidor e do navegador, a interface perdia a credencial de cancelamento e escondia a ação de desativar. A reprodução usou API e navegador simulados, sem envio de notificações reais.

## Correção

- A credencial fica em memória antes da tentativa de persistência. Se a revogação falhar, permanece acessível mesmo depois de `load(true)` ao navegar entre páginas na mesma sessão.
- Inscrição incompleta oferece reativar ou desativar. A interface não confirma ativação nem cancelamento quando as respectivas etapas falham.
- Recibo salvo sem assinatura nativa aparece como inscrição interrompida. Reativação exige gesto do visitante e revogação confirmada do registro anterior antes de criar outro.
- Assinatura nativa sem recibo continua permitindo desativação local, inclusive quando a API de configuração não responde.
- Carregar ou remontar o componente não solicita permissão nem inscreve. Uma inscrição confirmada não é reenviada por nova chamada de ativação.
- A mensagem de indisponibilidade não pressupõe que o visitante tenha cadastro.

## Verificação

- 15 testes direcionados do composable/componente aprovados, incluindo falha simultânea dos rollbacks, remount, cancelamento posterior, reativação explícita e falha nativa sem recibo.
- `typecheck` aprovado; alterações posteriores limitaram-se a texto e cobertura de teste.
- Reprodução isolada antes/depois em `.tmp/visual-review/public-push-review.json` e `.tmp/visual-review/public-push-review-after.json`: os três estados auditados mantêm a ação de desativar após a correção.
- Nenhum build, envio real, mudança de configuração, migração ou deploy realizado nesta revisão.

Limite: se o navegador bloquear armazenamento e o visitante encerrar a sessão antes de concluir o cancelamento, a credencial apenas em memória não sobrevive. Na próxima visita, a consulta da assinatura nativa ainda oferece a desativação no aparelho; a reativação continua sendo uma ação explícita.
