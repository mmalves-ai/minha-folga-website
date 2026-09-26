# Revisão visual e funcional — 26/09/2026

> **Versão atual:** [experiência simples em celular/computador e notificações gerenciáveis](CONVERSAO_V3.md). O texto abaixo registra a entrega inicial e seus resultados históricos.

> Revisão posterior: [oportunidade, alívio nas parcelas e fila](CONVERSAO_V2.md), com a confirmação do usuário sobre capacidade limitada e ordem de cadastro. As capturas anteriores documentam a primeira versão.

## Estado anterior

Screenshots em `before/`, nas rotas `/`, `/avise-me` e `/bia`, em desktop (1440 × 1000) e celular (390 × 844). Capturas feitas com Chrome headless/Playwright sobre o build local existente, servido em `https://localhost:8000`. `before/audit.json` registra status HTTP, texto do título, imagens carregadas, quantidade aproximada de palavras, erros JavaScript e overflow horizontal. Nenhuma escrita foi feita em produção.

Diagnóstico observado:

- As três páginas têm identidade consistente e navegação completa, porém nenhuma fotografia humana: as imagens são logotipo e símbolo da Minha Folga.
- Home anterior tem cerca de 1.205 palavras em desktop; a primeira tela é ocupada por título longo, explicação, ações e aviso extenso. Em celular, a demonstração visual da Bia fica abaixo da primeira tela.
- CTA principal do hero anterior aponta para soluções; o cadastro aparece no cabeçalho. Isso divide a direção da aquisição.
- A demonstração da Bia está marcada como exemplo; a comunicação deve continuar distinguindo essa demonstração do canal operacional.
- As seis capturas retornaram HTTP 200, sem erro JavaScript nem overflow horizontal.

## Configuração e integração verificadas

`GET https://localhost:8000/api/public-config` confirma ambiente de desenvolvimento, `PRE_LAUNCH`, operações financeiras desligadas, formulário e atendimento disponíveis localmente. Webchat desligado, sem URL/identificador; número de WhatsApp ausente; atendimento humano não habilitado. A identidade empresarial está incompleta e os avisos estão em rascunho. Esses resultados descrevem o ambiente local e não certificam a configuração da produção.

O carregador `frontend/src/components/site/webchat-loader.ts` é explicitamente um placeholder de contrato: aguarda URL, `widgetId`, forma real de abertura e origens CSP do fornecedor. A implementação já limita o carregamento ao clique e ao aceite do aviso. O site não pode anunciar chat ao vivo, disponibilidade contínua ou transferência humana sem provisionamento real.

A API de ferramentas da Bia existe; não é prova de que o agente esteja configurado na plataforma Hal-AI. Homologação da importação, telefone atestado pelo canal e procedimento de transferência continuam sendo dependências externas registradas em `docs/BIA_AGENTE.md`.

O cadastro preserva a decisão D1, incluindo CPF, empregador, vínculo e faixas, conforme reafirmação expressa do usuário nesta implementação. Melhorias visuais não autorizam eliminar esses campos.

## Referências internas verificadas

Consulta de leitura pelo conector Google Drive, em 26/09/2026:

- [Plano de implantação](https://docs.google.com/document/d/1J8vmfrb7Zhak4iN0d3V4yfo0gaP7QWzKQfDgH8aRXlE/edit): público com vínculo formal compatível com o produto do parceiro; não declara parceria, preço ou prazo contratados. Estrutura de crédito futura depende dos marcos do plano.
- [Briefing mestre](https://drive.google.com/file/d/1jby0awLHx26fFCltoseGTe7Ka9zjdVkM/view): adultos com vínculo formal elegível; domésticos e rurais registrados somente quando o parceiro suportar. Site corporativo completo, com captação integrada.
- A instrução do usuário sobre D1 prevalece sobre os campos mínimos propostos nesses documentos anteriores.

## Marca Hal-AI

Arquivo oficial copiado sem redesenho para `frontend/public/brand/hal-ai-logo.png` (512 × 512; 72 KB). Origem: `hal-ai/halai-new-website/assets/images/hal-ai-logo.png`, repositório local do website Hal-AI. O `index.html` desse projeto referencia o mesmo asset no JSON-LD em `https://hal-ai.com/assets/images/hal-ai-logo.png`.

SHA-256 da origem e da cópia: `1a0e492ee20262612d4d844b3bc932cd318a76753a64a7e773a40236f7548566`.

## Verificação executada no resultado

A suíte existente em `frontend/e2e/routes.spec.ts` cobre rotas públicas, 404, metadados, cinco larguras (360, 390, 768, 1024, 1440) e WCAG 2.2 AA com axe. `journeys.spec.ts` cobre cadastro D1, estados de falha, anti-robô, duplicidade, preferências, Bia via API, protocolo e painel. A execução usa banco e portas próprios; não depende de produção.

A validação final inclui screenshots desktop/mobile em `after/`, conferência das imagens e variantes, primeira tela, integridade de CTAs e carregamento em cenário móvel de laboratório. Métricas de laboratório não substituem dados de campo nem teste de compreensão com pessoas reais.


### Resultado técnico

- `routes.spec.ts`: **53 testes aprovados**, incluindo acesso direto, pré-renderização, 404, metadados, bloqueios financeiros, rotas removidas pela D1 e responsividade de 22 rotas nas larguras 360, 390, 768, 1024 e 1440 px, com axe sem violações graves/críticas.
- Após o ajuste final do cabeçalho: o teste E2E de teclado do menu móvel passou novamente, incluindo foco contido, Escape, retorno do foco, destinos tocáveis e zoom de 200%.
- Captura final de `/`, `/avise-me`, `/bia` e `/conteudos`, em 1440 × 1000 e 390 × 844: **8 capturas**, todas HTTP 200, sem erros JavaScript, imagens quebradas, overflow ou violações axe (todas as severidades). As fotos sob demanda foram carregadas por rolagem antes da captura completa. Resultado estruturado em `after/audit.json`.
- Após os ajustes finais, a home, landing e Bia foram redimensionadas nas cinco larguras novamente: **15 verificações sem overflow**.
- TypeScript e testes do carregador editorial/sitemap passaram após a extração da copy para `frontend/content/pages/aquisicao.yaml`. Esse arquivo tem revisão em rascunho e participa das datas editoriais de home e landing.
- As jornadas de cadastro D1, protocolos, preferências, Bia/API e painel foram verificadas pela frente de integração em banco isolado. Nenhum cadastro de teste foi enviado à produção.

As capturas demonstram uma home com cerca de **1.016 palavras**, contra 1.205 na versão anterior, e landing com **853**, contra 1.031. São contagens aproximadas da página renderizada em desktop, incluindo navegação e rodapé; não medem compreensão nem conversão. O cadastro completo aprovado foi preservado.

### Desempenho móvel de laboratório

Chrome headless, viewport 390 × 844, CPU reduzida em 4×, download 1,6 Mbps, upload 750 kbps, latência de 150 ms, cache frio. Três execuções após encerrar os testes concorrentes; origem local HTTPS. Dados brutos em `after/performance-check.json`.

| Amostra | LCP | CLS |
|---|---:|---:|
| 1 | 2,464 s | 0,000894 |
| 2 | 2,348 s | 0,000894 |
| 3 | 2,592 s | 0,000894 |

Mediana de LCP: **2,464 s**. Uma amostra ficou acima da referência de 2,5 s; o resultado fica próximo do limiar e não certifica os Core Web Vitals em produção. Não foram medidos INP nem percentil 75 de usuários reais. A primeira amostra, concorrente com E2E, foi 2,668 s e motivou estas repetições isoladas.

O elemento de LCP foi `hero-480.avif`, com aproximadamente **8 KB transferidos**. Recursos somaram 487,3 KB; com o HTML principal, **550,5 KB** na primeira carga. Fontes, JavaScript e CSS compõem a maior parte; fotos têm dimensões reservadas, formatos modernos e variantes responsivas.

### Evidências visuais

| Página | Antes desktop | Depois desktop | Antes celular | Depois celular |
|---|---|---|---|---|
| Home | [PNG](before/home-desktop.png) | [PNG](after/home-desktop.png) | [PNG](before/home-mobile.png) | [PNG](after/home-mobile.png) |
| Cadastro | [PNG](before/avise-me-desktop.png) | [PNG](after/avise-me-desktop.png) | [PNG](before/avise-me-mobile.png) | [PNG](after/avise-me-mobile.png) |
| Bia | [PNG](before/bia-desktop.png) | [PNG](after/bia-desktop.png) | [PNG](before/bia-mobile.png) | [PNG](after/bia-mobile.png) |

Primeira tela sem rolagem: arquivos `after/*-viewport.jpg`. A landing em 390 px mostra título, chamada, situação atual, ação principal e o rosto da fotografia nessa primeira tela. Os arquivos PNG incluem a página inteira.

### Validação humana e abertura pública

Não houve pesquisa com participantes reais nem teste A/B nesta execução. A rodada de compreensão com 5–8 pessoas, a qualidade dos cadastros e as métricas de conversão permanecem trabalho de validação, não resultados presumidos. As dependências reais de identidade/privacidade, disponibilidade de canais e homologação Hal-AI continuam em `docs/PENDENCIAS_PUBLICACAO.md`; esta revisão visual não as encerra e não incluiu implantação.

## Links de campanha e foco no cadastro

Três caminhos foram verificados em 390 × 844 após o build final: CTA da home para a landing, entrada nova direta em `/avise-me#formulario` e CTA dentro da landing. Todos colocam foco em `fullName`, com o campo inteiramente visível. A implementação aguarda a rota ficar pronta após hidratação SSG antes de revelar o formulário. Evidência: [anchor-checks.json](after/anchor-checks.json).

Também foram inspecionadas as composições de [benefícios](after/home-value-desktop.jpg), [demonstração da Bia](after/home-bia-desktop.jpg) e [primeira etapa do formulário móvel](after/form-mobile.jpg). Rosto, mãos, celular e textos HTML permanecem íntegros; a fotografia da Bia é explicitamente uma cena ilustrativa, não um avatar humano da assistente.
