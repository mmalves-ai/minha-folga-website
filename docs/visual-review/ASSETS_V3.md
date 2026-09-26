# Fotografia editorial — revisão visual 3

Data: 26/09/2026. Ferramenta: `image_gen` nativa, sem CLI ou chave de API.
Skill: `/home/mmalves/.codex/skills/.system/imagegen/SKILL.md`.

## Entrega disponível

- Fonte: `frontend/source-assets/editorial/aliviar-parcelas.png` — 1536 × 1024, proporção 3:2.
- Publicação: `frontend/public/images/editorial/aliviar-parcelas-{480,800,1200}.{avif,webp,jpg}`.
- SHA-256 da fonte: `3e7c4c9f7b0014a8b7b74807690c897b44d11a15fe7a2a1cb3ae64d10f2b8f80`.
- Origem da geração: `01a0dfd0-8f31-7d30-9582-0b8dfde9ac6c/exec-74406246-58e4-4c45-a143-8f8384af3136.png`.
- Tamanhos AVIF: 480 px 8,1 KB; 800 px 13,8 KB; 1200 px 21,0 KB.

A cena mostra uma mulher brasileira organizando contas com o celular, em casa, com sua família ao fundo. Inspeção visual: rosto, mãos, telefone e envelopes legíveis; fundo discreto; nenhum número, marca, valor financeiro ou texto legível. A imagem é editorial e sintética: não representa cliente, depoimento ou resultado de empréstimo. Alt sugerido: “Mulher organiza contas de casa enquanto consulta o celular, com a família ao fundo.”

## Prompt final utilizado

> Use case: photorealistic-natural. Asset type: landscape editorial photograph for a Brazilian private payroll credit website, 3:2 aspect ratio, no text. Primary request: Brazilian woman approximately 42 years old, Black, short natural curly hair, wearing a simple muted forest-green blouse, seated at an ordinary wooden dining table at home organizing her household bills and looking at her smartphone. Show an understandable real-life situation of taking control of monthly expenses, with attentive and quietly hopeful expression, a relaxed posture and subtle natural smile. Scene: welcoming lived-in Brazilian home with warm cream walls, soft daylight from a side window, one small plant, everyday ceramic mug, three plain paper envelopes and a notebook on the table. Paper surfaces show no readable text or numbers. Her smartphone screen faces only her. In softly blurred background, her partner sits on a sofa reading with a child; keep their presence understated, representing normal family life, not a posed commercial. Composition: horizontal medium documentary photograph, woman dominant, face and both hands clearly framed within central 80 percent, table objects recognizable on a 320px mobile card. Realistic skin texture, believable hands and body proportions, natural household details, warm balanced tones, subtle forest green accents, 35mm lens feel and gentle depth of field. Constraints: no text, no labels, no numbers, no logos, no watermarks, no banknotes, no money symbols, no diagrams, no charts, no app interface or visual overlay, no loan contract, no luxury setting, no distressed or desperate expression, no extravagant happiness or implied financial approval. One single natural photographic scene, not a collage.

## Reprodução das variantes

```sh
scripts/node-runtime.sh exec node frontend/scripts/optimize-editorial-images.mjs aliviar-parcelas
```

O script usa o ffmpeg já instalado, sem downloads ou novas dependências. Os PNGs originais permanecem fora de `public/`; apenas variantes otimizadas vão para o site. O manifesto público inclui os nove arquivos novos.

## Cena para novo empréstimo

A cena planejada de casal preparando uma pequena melhoria doméstica foi solicitada três vezes à ferramenta nativa, com prompts progressivamente simplificados. O serviço retornou timeout em todas as três tentativas; nenhum arquivo final dessa cena foi entregue. Nenhuma chave ou ferramenta alternativa foi instalada. A seção de novo empréstimo pode reutilizar `planning` ou `hero`, já presentes e otimizadas, sem apresentar uma imagem ausente.

Último prompt tentado:

> Generate a single natural editorial photograph in horizontal 3:2 format: a smiling Brazilian couple around age 40 sits at a wooden kitchen table, planning a modest home renovation together. Woman in cream blouse looks at a smartphone while man in olive shirt holds plain paint swatches. A small paint roller lies on the table. Cozy everyday Brazilian home with cream walls and dark green cabinets, gentle morning window light, realistic skin and hands, understated hopeful mood. Medium shot includes faces, hands and objects clearly for a small mobile website image. No text, logos, numbers, watermarks, money, graphs, luxury or exaggerated celebration.
