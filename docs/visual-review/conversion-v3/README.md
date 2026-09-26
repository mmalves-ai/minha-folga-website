# Revisão visual e browser — conversão V3

Prévia local: `https://localhost:8000`. Chrome headless instalado, Playwright, viewport com escala 1 e idioma pt-BR. Capturas realizadas após o build V3 com a estrutura final do rodapé. Não foi realizado envio de push, concessão permanente de permissão ou alteração de certificado.

## Resultado

- **16 cenários de layout**: home e `/avise-me` em 360, 390, 768, 1024 e 1440 px; `/bia`, `/lancamento` e `/consignado-privado` em 390 e 1440 px.
- Todos responderam HTTP 200, com um H1, sem overflow horizontal, imagens quebradas ou erros JavaScript.
- Axe WCAG 2 A/AA, 2.1 A/AA e 2.2 AA: **zero violações nos 16 cenários**. Testes automáticos não substituem auditoria humana completa de acessibilidade.
- **24 verificações de interação registradas** em `interactions.json`, todas com resultado positivo dentro das condições descritas abaixo.
- Nenhum pedido de permissão de notificações ocorreu no carregamento. O opt-in aparece em home/landing; o link de gerenciamento abre `/preferencias#avisos-navegador`.
- Busca no texto principal renderizado não encontrou “fase vigente”, “configuração do servidor”, “desativadas”, “pré-operação” ou “pré-lançamento” nas cinco páginas auditadas.

## Verificação visual

O hero diferencia novo empréstimo e alívio das parcelas, expõe a participação da IA e mantém o CTA visível na primeira tela mobile. Em 360 px, o título ocupa mais linhas, mas o botão continua antes da fotografia e sem corte lateral. No desktop, fotografia e proposta aparecem lado a lado.

Os cartões de novo empréstimo e de alívio de parcelas usam fotografias distintas (`planning` e `aliviar-parcelas`) e CTAs específicos. O fluxo da IA usa quatro etapas verticais legíveis no celular: você conta, a IA busca, a Bia explica e você decide. Recortes adicionais: `avise-me-390-novo-emprestimo.jpg`, `avise-me-390-aliviar-parcelas.jpg` e `avise-me-390-ia-diagrama.jpg`. Nestes três recortes de elemento, a barra fixa foi ocultada somente durante a captura para não cobrir o recorte; as imagens `*-sticky.jpg` preservam sua aparência real na viewport.

Recortes desktop adicionais: `avise-me-1440-oportunidades.jpg` (os dois cartões lado a lado) e `avise-me-1440-ia-diagrama.jpg`.

## Interações e limites

- CTA fixo mobile: ausente enquanto o CTA do hero está na tela; aparece após o hero; desaparece quando o formulário fica visível, mesmo sem campo focado; clique leva ao nome completo e dá foco com o campo visível.
- Menu aberto e diálogo de cookies: CTA fixo recolhido. A configuração local tem analytics desligado, portanto não mostra banner/botão público de preferências. O diálogo real foi aberto pelo evento `mf:open-cookie-settings` somente para verificar sobreposição; isso está marcado no JSON.
- Contato flutuante: ausente na configuração local. O relatório registra a ausência e ausência de sobreposição; **não afirma que foi testado um canal flutuante ativo**.
- Teclado: campo focado e viewport reduzida para 390 × 480; CTA permanece recolhido. É uma simulação de espaço, não validação em teclado físico de celular.
- Hero e âncora direta `/avise-me#formulario`: levam ao campo correto e o mantêm visível.
- Permissão de push: `Notification.requestPermission` foi instrumentado para contar solicitações e retornar `denied` após o clique. A recusa foi respeitada e a UI apresentou instrução de permissão bloqueada. Esse cenário não prova entrega de push nem aceitação real do sistema operacional.

## Bloqueio de certificado na prévia

Uma tentativa isolada de registrar `/notifications-sw.js` na prévia HTTPS, sem inscrever push, retornou `SecurityError`: `An SSL certificate error occurred when fetching the script.` O Chrome mantém essa exigência para service workers mesmo com `ignoreHTTPSErrors` no contexto Playwright. Não houve mudança no certificado ou no navegador do usuário. A ativação completa requer uma origem HTTPS com certificado confiável; a entrega real não foi testada nesta prévia.

## Evidências e reprodução

- `audit.json`: 16 cenários, textos, imagens, erros e resultados axe.
- `interactions.json`: resultados do CTA, foco, overlays, opt-in e diagnóstico de certificado.
- `*-fresh.jpg`: primeiro carregamento; `*-viewport.jpg`: primeira dobra revisada; `*.png`: página inteira após carregar imagens sob demanda.
- Scripts: `.tmp/visual-review/capture-conversion-v3.mjs` e `.tmp/visual-review/check-conversion-v3.mjs`.

```sh
scripts/node-runtime.sh exec node .tmp/visual-review/capture-conversion-v3.mjs
scripts/node-runtime.sh exec node .tmp/visual-review/check-conversion-v3.mjs
```
