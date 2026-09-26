# Alinhamento institucional da proposta — 26/09/2026

Direção confirmada pelo responsável durante a implementação: experiência 100% digital e ágil; uso de IA para buscar condições adequadas ao perfil; possibilidade de aliviar parcelas de consignados privados existentes; disponibilidade limitada de crédito e fila pela ordem de cadastro. A fase financeira permanece `PRE_LAUNCH`.

Arquivos editoriais ajustados, preservando sua estrutura, links/âncoras e condições de exibição:

| Arquivo em `frontend/content/pages/` | Alinhamento |
|---|---|
| `sobre.yaml` | Propósito e forma de trabalhar com jornada digital, IA e possibilidade de aliviar o compromisso mensal. |
| `solucoes.yaml` | Consignado para novo interesse ou avaliação de parcela existente; fila e convite conforme disponibilidade. |
| `como-funciona.yaml` | Cadastro ordenado, futura busca de condições oficiais, análise pela instituição, comparação e decisão da pessoa. Dados D1 preservados integralmente. |
| `consignado-privado.yaml` | Benefício de aliviar parcela existente como possibilidade, com comparação de prazo, CET e total; fila e disponibilidade limitada sem posição ou reserva. |
| `bia.yaml` | Exemplo educativo sobre parcela existente, com busca de propostas descrita somente na futura operação integrada; canais atuais continuam condicionados à configuração real. |

As cinco revisões permanecem em `draft`, com data de redação 26/09/2026 e versão incrementada. Não se registrou aprovação editorial fictícia. Sintaxe YAML verificada em todos os arquivos. Nenhum build ou alteração no backend foi executado nesta frente.

## Dependências concretas preservadas

- O sistema registra `created_at` e a exportação de leads já ordena por `created_at, id` crescente (`backend/src/services/admin-leads.service.ts`). A lista comum do painel mostra os mais recentes primeiro. A operação de convites deve respeitar a ordem de cadastro confirmada e aplicar consentimentos, disponibilidade e análise; a copy não afirma ter posição calculada, reserva financeira ou disparo automático.
- Busca real de propostas por perfil depende de integração financeira homologada. Em `PRE_LAUNCH`, Bia continua sem consultar margem ou oferecer propostas; a nova direção não ativa capacidades por edição de texto.
- A redução de parcela depende das condições do contrato existente e da alternativa disponível. Prazo maior pode elevar o total pago. Os textos apresentam essa comparação, sem redução garantida ou dívida extinta automaticamente.
- A promessa de uma jornada digital e ágil não fixa prazo de análise, aprovação ou pagamento. O contrato e os canais reais precisam refletir a operação quando ela abrir.

## Verificação dos estados de cadastro

Na revisão da conversão, os CTAs do bloco de produto em Soluções, do hero de Consignado Privado, da primeira etapa em Como Funciona e da confirmação neutra passaram a acompanhar a preparação quando a coleta estiver fechada. Os encerramentos compartilham a mesma proteção na `CtaBand`. Isso mantém a proposta de fila coerente com a disponibilidade real do formulário. A confirmação recebida continua genérica, sem prometer inclusão individual, posição ou crédito.
