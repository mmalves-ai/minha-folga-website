# Minha Folga — implementação visual e aquisição

> **Versão atual:** [experiência simples em celular/computador e notificações gerenciáveis](visual-review/CONVERSAO_V3.md). O texto abaixo registra a entrega inicial e seus resultados históricos.

> Revisão posterior: [oportunidade, alívio nas parcelas e fila](visual-review/CONVERSAO_V2.md), com a confirmação do usuário sobre capacidade limitada e ordem de cadastro. As capturas anteriores documentam a primeira versão.

Revisão de 26/09/2026, executada a partir de `MINHA_FOLGA_BRIEFING_ASTRA_VISUAL_CONVERSAO.md` e das correções do responsável durante a implementação.

## Versão revisável

- Site local: https://localhost:8000/
- Landing de aquisição: https://localhost:8000/avise-me
- Bia: https://localhost:8000/bia
- [Comparativo visual interativo](visual-review/comparativo.html).
- [Capturas e auditoria](visual-review/README.md).

A revisão está no código e no build local; não houve publicação em produção, commit ou push. Os processos e os dados de revisão continuam restritos ao projeto. Nenhuma versão global, serviço de outro site ou configuração do servidor compartilhado foi alterada.

## Experiência entregue

A home apresenta produto, público previsto, situação atual e cadastro na abertura, com fotografia humana e uma ação principal. A landing `/avise-me` mantém a continuidade visual da campanha e tem título próprio: “Uma nova opção de consignado. Pensada para você.”

A sequência combina fotografia, ajuda concreta, demonstração HTML da Bia, três próximos passos, acesso à empresa e ao atendimento, cadastro e perguntas frequentes. A navegação corporativa e todas as páginas anteriores foram preservadas. Conteúdos, artigos, página da Bia e apresentação da empresa também receberam imagens contextuais.

O posicionamento comercial se apoia em clareza, acolhimento e autonomia. Não foram inventados rankings, menor taxa, condições exclusivas, aprovação, depoimentos, clientes, parceiros, vagas ou prazo de lançamento. Os benchmarks e a aplicação de suas escolhas estão em [BENCHMARKS.md](visual-review/BENCHMARKS.md).

## Cadastro completo, conforme instrução expressa

A correção do responsável — manter CPF, empregador e demais dados — prevalece sobre a sugestão de redução do briefing. A decisão está registrada em `DECISOES.md`, D1.2.

O formulário divide o preenchimento em duas etapas, preservando nome, CPF, WhatsApp, e-mail opcional, empregador, vínculo, tempo no emprego, faixa salarial, cidade/UF, tema opcional, maioridade e consentimentos separados. Voltar preserva os dados. Avançar não grava cadastro; o envio final continua usando o mesmo contrato e as proteções anti-robô.

O sucesso depende de resposta válida do backend. Erros levam foco ao campo correspondente; conexão perdida permite reenvio; clique duplo não produz envio duplo. A resposta para cadastro existente continua genérica para não expor CPF/telefone, com explicação clara de que um envio repetido não sobrescreve o registro. Painel, revisão de submissões, protocolos e ferramentas da Bia foram preservados.

Validação detalhada: [SIGNUP_VALIDATION.md](visual-review/SIGNUP_VALIDATION.md).

## Imagens, identidade e manutenção

Foram geradas quatro fotografias com a ferramenta integrada de geração de imagens, entregues em 36 variantes AVIF/WebP/JPEG de 480, 800 e 1200 px. A foto principal ocupa aproximadamente 22 KB em AVIF/1200 px. O componente responsivo usa dimensões explícitas, `srcset`, `sizes`, prioridade para a abertura e carregamento sob demanda nas demais imagens. O enquadramento móvel foi inspecionado para preservar rosto, mãos e celular.

Os personagens são ilustrativos e não representam clientes ou equipe. Os logos Minha Folga foram preservados; a assinatura de tecnologia usa o arquivo oficial Hal-AI, obtido do projeto local da marca e conferido contra seu site.

- [Prompts, origem, arquivos e reprodução dos assets](VISUAL_ASSETS.md).
- Fotografias publicáveis: `frontend/public/images/editorial/`.
- Originais: `frontend/source-assets/editorial/`, fora da pasta pública.
- Copy compartilhada: `frontend/content/pages/aquisicao.yaml`, com revisão em rascunho.
- Componente de imagem: `frontend/src/components/site/PhotoAsset.vue`.

## Medição

Foram acrescentados clique de cadastro, erro visível e recebimento confirmado, com dimensão limitada à origem da jornada. Não são enviados valores de campos, CPF, telefone, dados financeiros ou mensagens. A medição depende de configuração e consentimento; permanece desligada na configuração atual. O inventário de cookies e os rótulos do painel foram atualizados.

Recebimento confirmado não equivale a cadastro novo: o backend também confirma de forma genérica submissões repetidas. Os totais operacionais de novos cadastros e revisão permanecem separados. Clique na Bia não é contado como conversa iniciada; esta última métrica depende de evento verificável da integração real.

## Verificações e pendências reais

A compilação Vue/SSG e a checagem TypeScript passaram. O pós-build verificou 24 rotas. As suítes completas passaram com 204 testes frontend e 279 backend; as dez jornadas funcionais em navegador foram validadas contra API e banco isolados, incluindo cadastro, repetição, preferências, atendimento e painel. Resultados de responsividade, Axe, imagens e carregamento móvel constam do [relatório visual](visual-review/README.md).

A configuração local continua em `PRE_LAUNCH`. Webchat e WhatsApp da Bia não estão configurados: a interface mostra demonstração identificada e informa essa pendência. Quando o canal real estiver provisionado, os botões usam o fluxo existente; não foi simulado atendimento operacional.

Identidade empresarial, contatos e revisão jurídica/editorial continuam pendentes no projeto. O build de revisão informa os 29 marcadores de dados ainda não fornecidos; o bloqueio de release pública foi preservado. Essa revisão não libera a operação de crédito ou a coleta em produção.

Não houve pesquisa com participantes nem teste A/B. Melhorias de compreensão ou conversão são hipóteses a medir. Próxima validação de produto: rodada em celular com pessoas do público real, observando principalmente entendimento de que cadastro não é crédito aprovado.

Fechamento da validação visual: 53 verificações de rotas aprovadas, dez jornadas funcionais aprovadas, oito capturas desktop/celular sem erros JavaScript, imagens quebradas, overflow ou violações Axe. Quinze combinações adicionais de rota/largura passaram. O menu móvel foi revalidado com teclado e zoom de 200%; os três caminhos de entrada no formulário colocam foco no primeiro campo, visível em celular.

No cenário móvel de laboratório (390 × 844, CPU 4×, 1,6 Mbps, latência 150 ms e cache frio), a mediana de três amostras de LCP foi 2,464 s, com uma amostra acima de 2,5 s; CLS foi 0,000894. São medidas locais, não uma declaração de aprovação em Core Web Vitals de campo nem de aumento de conversão.
