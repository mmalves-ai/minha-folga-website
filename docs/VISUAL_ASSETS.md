# Assets fotográficos — Minha Folga

Data: 26/09/2026.

## Origem e representação

As quatro fotografias foram criadas com a ferramenta integrada `image_gen` do Codex, seguindo o skill `imagegen`, no modo built-in. Não houve uso de API/CLI como fallback, download de fotografias de terceiros ou alteração dos logotipos oficiais. As pessoas são personagens gerados por IA: imagens ilustrativas, sem representar clientes, equipe, parceiros, autores ou depoimentos. O uso dessas imagens não comprova aprovação de crédito, elegibilidade ou disponibilidade da operação.

Os PNGs originais, incluindo os metadados de proveniência recebidos, estão em `frontend/source-assets/editorial/`, fora da pasta pública. As versões web são derivadas técnicas para entrega responsiva; não se atribui uma licença de banco de imagens inexistente. Origem: geração para este projeto. Não usar as cenas como testemunho de resultado.

| Nome | Finalidade | Original gerado |
|---|---|---|
| `hero` | Identificação na abertura; mulher usando celular em casa | `exec-4df09c8a-83f3-475f-bd7e-9301c545acf0.png` |
| `planning` | Organização e entendimento; homem à mesa com celular e caderno | `exec-d62d384d-64d4-4de6-861f-31b5b5f31ddd.png` |
| `bia` | Contexto de atendimento; mulher usando celular em um intervalo | `exec-5b927a20-9973-45fc-b01e-8b73fd5befa3.png` |
| `conversation` | Conteúdo educativo; dois adultos conversando com caderno | `exec-3d021025-1fd1-486a-8222-8236b641b7bc.png` |

## Arquivos publicados e integração

- Fontes: `frontend/source-assets/editorial/{hero,planning,bia,conversation}.png` (1536 × 1024).
- Entrega: `frontend/public/images/editorial/{nome}-{480,800,1200}.{avif,webp,jpg}`.
- Dimensões: 480 × 320, 800 × 534 e 1200 × 800; a altura de 534 mantém pixels pares exigidos pela codificação.
- Inventário de dimensões e bytes: `frontend/public/images/editorial/manifest.json`.
- Componente: `frontend/src/components/site/PhotoAsset.vue`.
- O componente oferece AVIF, WebP e fallback JPEG com `srcset`, `sizes`, dimensões explícitas e `alt` obrigatório. `priority` ativa carregamento imediato e `fetchpriority="high"`; demais imagens usam lazy loading.
- O hero adapta o enquadramento ao contêiner de celular por `object-fit: cover` e posição horizontal à direita, preservando rosto, mãos e celular. A tentativa de exportar uma variante por edição no image_gen foi bloqueada pela falha de leitura do sandbox (`bwrap: loopback: Failed RTM_NEWADDR`); não foi criado um arquivo de recorte artificial nem uma variante substituta com outra pessoa.
- Textos, CTA, conversas demonstrativas e marcas permanecem no HTML/SVG oficial.

Peso AVIF em 1200 px: hero 22,1 KB; planning 17,8 KB; bia 29,8 KB; conversation 24,1 KB. Em 480 px: 7,5 KB, 7,0 KB, 11,7 KB e 8,4 KB, respectivamente. Cada navegador baixa apenas a variante/formato aplicável; o conjunto de alternativas não é transferido inteiro.

## Regenerar formatos

A conversão usa o `ffmpeg` existente, com `libaom-av1`, `libwebp` e JPEG. Não adiciona dependências globais nem modifica serviços, cache ou configuração do usuário.

```sh
scripts/node-runtime.sh exec node frontend/scripts/optimize-editorial-images.mjs
# Um asset:
scripts/node-runtime.sh exec node frontend/scripts/optimize-editorial-images.mjs hero
```

O script limita codificação a duas threads, grava exclusivamente nos assets do projeto e atualiza o manifesto. O processo de build não precisa da ferramenta de geração nem do ffmpeg, pois os derivados são entregues no repositório.

## Revisão visual

As quatro saídas foram inspecionadas visualmente: rostos diferentes entre cenas, mãos plausíveis, objetos coerentes, luz natural, sem texto incorporado, logotipo, dinheiro, luxo ou promessa de resultado. A cena de conversa mantém o caderno sem conteúdo legível. O JPEG otimizado do hero também foi inspecionado. Um recorte real no Chrome de 350 × 350 px com object-position de 66% preservou integralmente cabeça, mãos e celular; captura local em `.tmp/photography-check/hero-mobile350.png`. Os 36 derivados passaram por decodificação e conferência de dimensões usando ffprobe. Recortes finais do layout devem ser avaliados nas capturas desktop/celular da implementação, pois uma altura de contêiner inadequada pode cortar qualquer fotografia.

## Prompts finais utilizados

### hero

> Photorealistic natural editorial lifestyle photograph, horizontal 3:2. Brazilian parda woman age 40, dark shoulder-length curly hair, deep forest-green casual blouse, sitting comfortably on cream sofa in warm everyday Brazilian home, using smartphone with attentive quiet smile. Phone screen faces her, realistic fingers and hands fully visible, complete head. Medium-wide composition subject center-right, keep face phone and hands within central-right vertical area for portrait crop. Ordinary wooden furniture, cream wall, natural window daylight, subtle green plant. Natural skin texture, dignity and autonomy, candid unposed mood. No text, logos, brands, readable screen, money, luxury, loan approval, fake testimony, stereotypes. Fictional illustrative person for Minha Folga website.

### planning

> Use case: photorealistic-natural. Create one horizontal 3:2 realistic candid editorial photograph for Brazilian website Minha Folga. A Brazilian man around 50 years old with short salt-and-pepper hair, medium brown skin and a relaxed pale olive casual shirt, seated at a simple wooden kitchen table in a tidy ordinary home. He uses his smartphone, the screen faces him, while an open notebook and pen lie nearby. Expression of calm attention and autonomy, no posing for camera. Natural skin texture. Medium-wide composition retaining head, both hands, phone and notebook; natural diffused window light, cream painted wall and small deep green accents. A plausible everyday Brazilian home without visible economic caricature. Anatomically natural hands/fingers. No text, visible writing, readable screens, logos, brands, watermark, currency, credit approval, luxury or sadness. This is a fictional illustrative person and never a real customer or staff member.

### bia

> Candid realistic editorial photograph, 3:2 landscape. A Brazilian Black woman around 35 in cream casual clothing, natural curly hair, sitting on a courtyard bench using her smartphone. Calm attentive face and natural hands fully visible. Soft daylight, pale wall, potted plants with deep green leaves, everyday welcoming setting. No text, logos, brands, screen contents or luxury. Fictional illustrative person.

### conversation

> A candid, photorealistic editorial photograph: a Brazilian woman in her 30s and a Brazilian man in his 50s calmly discussing a blank notebook together at a simple wooden table in an everyday home. Natural window light, cream walls, green casual clothing, visible natural hands and faces. Horizontal 3:2. No text, logos, brands, money or luxury. Fictional illustrative people.


