# Conversão: oportunidade, alívio nas parcelas e fila

Revisão de 26/09/2026. Prévia local: https://localhost:8000/avise-me.
Esta revisão substitui o argumento anterior, centrado apenas em aviso e orientação.

## O que mudou com a confirmação do usuário

O usuário confirmou jornada 100% digital e ágil, IA para buscar melhores propostas,
possibilidade de aliviar parcelas de consignados existentes, capacidade financeira limitada
e fila por ordem de cadastro. Essas informações sustentam uma oportunidade concreta de
antecipar a inscrição. PRE_LAUNCH continua sendo a situação da operação.

| Pergunta do cliente | Resposta que a página passou a dar |
| --- | --- |
| Por que olhar a Minha Folga? | “Parcela pesada? Seu salário merece uma folga.” A dor é o peso da parcela no mês; o objetivo é buscar condições melhores. |
| Por que é diferente? | Proposta de jornada 100% digital, busca com IA e Bia para explicar as condições, incluindo atenção ao consignado que a pessoa já paga. |
| Por que cadastrar agora? | O valor disponível para emprestar é limitado. A ordem de cadastro será usada nas chamadas da abertura. |
| O que muda se eu esperar? | Outros cadastros podem ficar à frente na ordem de chamada. Se a capacidade se esgotar, será necessário aguardar nova disponibilidade. |
| Já tenho empréstimo. Serve para mim? | A operação vai avaliar a possibilidade de aliviar a parcela existente, conforme o caso e as condições disponíveis. |
| Qual é o próximo passo? | “Quero entrar na fila” leva ao cadastro completo, com CPF, empregador e os demais campos D1. |

## Elementos de conversão aplicados

- Identificação: a parcela pesada aparece no título da landing e na conversa demonstrativa da Bia.
- Benefício: mais folga no salário, traduzindo a proposta em efeito desejado no orçamento.
- Diferenciação demonstrada: IA, jornada digital e explicação dos custos aparecem em blocos próprios.
- Urgência baseada na operação: bloco “A fila começa agora” e explicação direta de quem se cadastra depois.
- Menor barreira: cadastro gratuito, sem obrigação de contratar e com aviso pelo WhatsApp.
- Utilidade imediata: roteiro PDF aberto, de uma página, para comparar duas propostas, também disponível após o envio.

“Melhor proposta” está delimitada às opções disponíveis para o perfil. Não foi criada
alegação de menor taxa de todo o mercado, número de pessoas na fila, posição individual,
prazo de liberação, quantidade de vagas, economia em reais ou redução garantida.
Parcela menor é distinguida de custo total menor. O guia e a demonstração orientam
comparar prazo, CET e total a pagar.

## Jornada e consistência

Home e landing usam a mesma fonte editorial aquisicao.yaml. Foram alinhados navegação,
formulário, FAQ, confirmação, Sobre, Soluções, Como funciona, Consignado privado e Bia.
Metadados das páginas de entrada refletem a nova proposta.

A coleta fechada tem textos e destinos próprios: os convites levam à preparação, o bloco
de urgência é ocultado e nenhum formulário ativo é simulado. O atendimento da Bia continua
condicionado aos canais configurados.

A confirmação permanece genérica (“Cadastro recebido.”): a API também retorna aceite
genérico para duplicatas, revisões e supressões, protegendo o titular. Não se infere uma
posição na fila a partir dessa resposta.

O backend preserva created_at original e o CSV já usa created_at ASC, id. O mecanismo
de chamadas e a busca financeira com IA não foram implementados por esta revisão do
website. Devem aplicar a política documentada em [D1.3](../DECISOES.md) na abertura.

## Verificação

- Tipagem e build: 24 rotas pré-renderizadas, postbuild sem padrões proibidos.
- 204 testes de frontend aprovados após os ajustes.
- 10 jornadas com navegador e API isolada aprovadas: cadastro completo, anti-robô,
  duplicidade, preferências, atendimento, administração, navegação por teclado e canais.
- 20 capturas em cinco larguras (360, 390, 768, 1024 e 1440 px): zero violações Axe,
  overflow, erros JS ou imagens quebradas. Estados de confirmação identificados como
  fixture visual; a persistência real foi validada nas jornadas acima.
- Seis caminhos de CTA/âncora chegam ao campo de nome, com foco e visibilidade no celular.
  Links internos e download PDF aprovados. Evidências em [conversion-v2](conversion-v2/).
- O guia responde como application/pdf; o servidor local também informa os tipos corretos
  de AVIF, WebP e JPEG.

O build continua sendo prévia editorial local. As pendências empresariais/editoriais
anteriores e o bloqueio de publicação estrita permanecem. Nenhum deploy foi realizado.

## Referências

A escassez e a política de ordem de cadastro vêm da confirmação expressa do usuário,
não dos benchmarks.

A estrutura de benefício, CTA e resposta a objeções foi informada por
[Hotmart — landing pages](https://hotmart.com/pt-br/blog/o-que-e-landing-page) e
[NN/g — princípios de homepages](https://www.nngroup.com/articles/homepage-design-principles/).

Os cuidados ao comparar propostas têm base no
[Banco Central — empréstimos e financiamentos](https://www.bcb.gov.br/meubc/faqs/s/emprestimos-e-financiamentos)
e no [Banco Central — portabilidade de crédito](https://www.bcb.gov.br/meubc/faqs/s/portabilidade-de-credito).
A possibilidade específica de redução na Minha Folga é uma proposta de produto confirmada
pelo usuário, sujeita à análise futura; a referência do BCB não comprova desempenho da empresa.

Detalhes do material aberto: [Guia de comparação](GUIA_COMPARACAO.md).
Alinhamento institucional: [registro da revisão](ALINHAMENTO_INSTITUCIONAL.md).
