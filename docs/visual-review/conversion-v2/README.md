# Revisão da conversão — versão 2

Direção confirmada em 26/09/2026: jornada 100% digital, uso futuro de IA para buscar propostas adequadas ao perfil, possibilidade de reduzir a parcela de consignado existente e fila de chamada por ordem de cadastro, sujeita aos critérios da operação e à disponibilidade limitada de crédito. A operação permanece em pré-lançamento.

## Auditoria de conteúdo

A revisão da fonte não encontrou promessa de menor taxa garantida, crédito já disponível ou redução automática da dívida. A busca financeira por IA é apresentada como capacidade futura. Os textos distinguem parcela menor de custo total menor e convidam a comparar prazo, CET e total a pagar. A fila não promete posição individual, dinheiro reservado, aprovação ou data de liberação.

A revisão encontrou e corrigiu o uso do presente para a busca de propostas da IA e convites ativos em estados de coleta fechada. Hero, benefícios, etapas, formulário, cabeçalho e encerramentos passam a exibir o acompanhamento da preparação quando o cadastro estiver desabilitado. A mesma condição foi aplicada aos CTAs de Soluções, Consignado Privado, Como Funciona e confirmação neutra. Essa verificação do estado fechado foi feita na fonte; as capturas usam a configuração local com coleta habilitada.

A fila anunciada depende de execução operacional na abertura. O cadastro registra a data original e a exportação administrativa ordena os registros por essa data; a edição editorial não cria reserva de recursos, disparador de chamadas ou integração financeira. Os detalhes estão em [ALINHAMENTO_INSTITUCIONAL.md](../ALINHAMENTO_INSTITUCIONAL.md).

## Escopo das capturas

O roteiro `.tmp/visual-review/capture-conversion-v2.mjs` usa o Node e os temporários isolados do projeto. Preserva as capturas anteriores em `before` e `after`.

São verificados home, `/avise-me` e `/cadastro-confirmado` nas larguras 360, 390, 768, 1024 e 1440 px. A confirmação é examinada tanto no estado neutro de acesso direto quanto no estado recebido. Para a captura do estado recebido, a marca `mfSignupReceived` é inserida apenas no `history.state` do navegador de revisão: trata-se de uma fixture visual, sem gravação de cadastro ou alegação de persistência. Os testes reais de API e jornada são executados separadamente.

Cada captura aguarda o carregamento das imagens após rolagem incremental, volta ao topo, salva a página completa e a primeira tela e executa Axe nos critérios WCAG A/AA incluídos pelo verificador. Também confere transbordamento horizontal, erros de JavaScript, imagens, CTAs para o formulário e download do PDF. Uma execução automatizada sem violações não substitui uma auditoria integral de acessibilidade.

## Resultados verificados

Verificação local concluída em 26/09/2026, em `https://localhost:8000`.

| Verificação | Resultado |
|---|---|
| Home, landing e confirmação nos estados neutro e recebido | 20 capturas; 5 larguras por tela/estado |
| Resposta das páginas capturadas | 20 respostas HTTP 200 |
| Axe, regras WCAG A/AA selecionadas | 0 violações nas 20 capturas |
| Transbordamento horizontal | 0 nas 20 capturas |
| Erros de JavaScript e imagens quebradas | 0 |
| Título principal | 1 H1 por captura |
| Confirmação | Estado neutro preservado no acesso direto; `noindex, nofollow` |
| Navegação para o formulário em 390 × 844 px | 6 de 6 cenários com o nome completo focado e visível |
| Destinos internos dos links de conteúdo | 17 de 17 retornam HTTP 200 |
| Roteiro PDF | HTTP 200, `application/pdf`, assinatura `%PDF-`, 187.378 bytes |
| Download a partir da confirmação | Concluído, sem falha; nome `minha-folga-guia-de-comparacao.pdf` |

Os seis cenários de foco cobrem o CTA principal da home para a landing, entrada nova direta em `/avise-me#formulario`, CTA do hero da landing, CTA da explicação da fila em ambas as páginas e CTA do cabeçalho já dentro da landing. O teste usa `input[name="fullName"]`, pois o identificador HTML é gerado por instância. A primeira aferição usou um identificador fixo incorreto; os seis cenários foram refeitos com o seletor correto e substituídos no relatório final.

O formulário completo D1 continua renderizando CPF, telefone, e-mail, empregador, vínculo, tempo de emprego, faixa de renda, cidade, UF, interesse e escolhas de comunicação. Nenhum cadastro foi enviado por este roteiro de revisão.

A inspeção visual das primeiras telas confirmou títulos e CTA legíveis, motivo para antecipar o cadastro visível antes da foto no celular e confirmação com mensagem genérica. O novo bloco da fila foi inspecionado em 390 e 1440 px. Não foram feitas novas medições de desempenho nesta revisão; os números da pasta `after` pertencem à versão visual anterior e ao cenário de laboratório registrado lá.

### Evidências

- [Relatório completo](audit.json) e [controles de foco](anchor-checks.json).
- Home: [desktop](home-1440-viewport.jpg), [celular](home-390-viewport.jpg) e [página completa no celular](home-390.png).
- Landing: [desktop](avise-me-1440-viewport.jpg), [celular](avise-me-390-viewport.jpg) e [página completa no celular](avise-me-390.png).
- Fila: [desktop](reason-1440.jpg) e [celular](reason-390.jpg).
- Confirmação: [acesso direto](confirmacao-neutra-390.png) e [estado recebido — fixture visual](confirmacao-recebido-390.png).

Os demais arquivos seguem os mesmos nomes com as larguras `360`, `768` e `1024`; os PNGs mostram a página completa e os JPEGs `-viewport` mostram a primeira tela.
