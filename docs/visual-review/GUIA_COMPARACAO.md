# Guia de comparação do consignado

Ativo gratuito, aberto sem cadastro, criado em 26/09/2026 para entregar ajuda concreta a quem está comparando crédito. A entrega não é condicionada à inscrição na fila.

- PDF público: [`frontend/public/guias/roteiro-consignado.pdf`](../../frontend/public/guias/roteiro-consignado.pdf), servido em `/guias/roteiro-consignado.pdf`.
- Fonte editável: [`frontend/source-assets/guides/roteiro-consignado.html`](../../frontend/source-assets/guides/roteiro-consignado.html).
- Geração: [`frontend/scripts/build-credit-guide.mjs`](../../frontend/scripts/build-credit-guide.mjs).
- Confirmação: cartão de download em `/cadastro-confirmado`, disponível tanto com recebimento válido quanto no estado neutro. O download não altera o estado do cadastro.

## Conteúdo e limites

O guia contém um checklist e seis campos para comparar duas propostas: valor líquido recebido, parcela, quantidade de parcelas/prazo, CET anual na mesma periodicidade, total a pagar e instituição responsável. Os valores devem ser informados pelas instituições. O material orienta a comparar mesma quantia/prazo quando possível, a perguntar por informações ausentes e a guardar as propostas.

Não contém taxas, parcelas ou valores fictícios, cálculo financeiro, promessa de economia, ranking de instituições, coleta de dados ou instrução de pagamento. CET é explicado como taxa que reúne os custos da operação; não deve ser somado às parcelas como cobrança adicional. O aviso informa a natureza educativa e que a Minha Folga está em estruturação. As referências ao Banco Central são fontes de educação financeira; não representam endosso da marca.

## Fontes oficiais consultadas

1. [Banco Central — Quais cuidados devo tomar antes de contratar um empréstimo consignado?](https://www.bcb.gov.br/meubc/faqs/p/quais-cuidados-devo-tomar-antes-de-contratar-um-emprestimo-consignado). Suporte à pesquisa e comparação de condições. A [página da categoria Empréstimos consignados](https://www.bcb.gov.br/meubc/faqs/s/emprestimos-consignados) também foi consultada. Conteúdo indexado conferido em 26/09/2026; as páginas individuais exigem JavaScript.
2. [Banco Central — Cuidados na hora de contratar uma operação de crédito](https://www.bcb.gov.br/meubc/faqs/p/cuidados-na-hora-de-contratar-uma-operacao-de-credito). Suporte à leitura do CET, que reúne juros, tarifas, impostos e demais custos. Conteúdo indexado conferido em 26/09/2026; página individual exige JavaScript.

As duas fontes principais também estão vinculadas no rodapé do PDF.

## Regenerar sem instalar dependências

Na raiz do projeto:

```sh
scripts/node-runtime.sh exec node frontend/scripts/build-credit-guide.mjs
pdfinfo frontend/public/guias/roteiro-consignado.pdf
```

O script usa Playwright já instalado, o Chrome existente, o logotipo SVG e as fontes Sora/Inter locais. Exige o runtime privado em `.runtime/`. Perfis, temporários, caches e a prévia PNG ficam dentro do projeto. Não baixa fontes, navegador ou pacotes. O PDF é versionável e a compilação do site o copia normalmente a partir de `public/`.

O gerador verifica recursos carregados e dimensões A4 antes de salvar. A prévia fica em `.tmp/credit-guide/roteiro-consignado-preview.png`. Validação visual: conferir tabela completa, margens, títulos, acentuação e fontes do rodapé; conferir `Pages: 1` com `pdfinfo`.

Validação realizada em 26/09/2026: PDF com 1 página A4, 187.378 bytes, texto selecionável e estrutura marcada (`Tagged: yes`). Fontes Sora/Inter embutidas e ambos os links oficiais preservados. A página efetiva foi rasterizada com `pdftoppm` e inspecionada visualmente, sem cortes, sobreposições ou perda de acentuação. `npm --prefix frontend run typecheck`, executado pelo runtime privado, passou após a integração do cartão.
