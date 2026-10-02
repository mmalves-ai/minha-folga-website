# SEO e descoberta no Google

A origem canônica de produção é `https://www.minhafolga.com.br`. O backend usa
`PUBLIC_SITE_URL` e o frontend recebe o mesmo valor em `VITE_SITE_URL`; canonicals,
metadados sociais, dados estruturados e sitemap devem apontar para essa origem.
Os modelos Apache/Nginx redirecionam HTTP e o domínio sem `www` com 301, preservam
os caminhos e removem a barra final. Páginas inexistentes devem responder **404**.

## Sitemap e indexação

O build gera `frontend/dist/sitemap.xml` automaticamente a partir das rotas
`indexable: true` em `frontend/src/router/manifest.ts` e dos artigos de
`frontend/content/articles/`. Não edite o XML gerado: altere a fonte e refaça o build.
A URL publicada é **https://www.minhafolga.com.br/sitemap.xml**.

O XML contém URLs absolutas, únicas e canônicas. `lastmod` usa datas reais de
publicação/revisão aprovadas e de conteúdos compartilhados exibidos na página;
quando não existe data confiável, a tag é omitida. A data do build não é usada.
Isso segue a [orientação do Google para sitemaps](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap?hl=pt-br).

Páginas administrativas, preferências, confirmação de cadastro, acompanhamento de
atendimento e erros ficam fora do sitemap e recebem `noindex`. O `robots.txt` de
produção permite ao Google ler o HTML dessas páginas para reconhecer essa regra;
`robots.txt` não protege dados nem substitui autenticação. Bloquear uma URL com
`Disallow` impede a leitura de `noindex`, conforme a
[documentação do Google](https://developers.google.com/search/docs/crawling-indexing/block-indexing?hl=pt-br).

O HTML público é pré-renderizado com títulos e descrições próprios, canonical,
Open Graph/Twitter e dados estruturados compatíveis com o conteúdo visível.
Metadados e texto devem manter as condições reais da operação e as revisões
exigidas em [CONTENT_GUIDE.md](CONTENT_GUIDE.md); palavras-chave repetidas,
avaliações fictícias e promessas comerciais não ajudam a qualidade do conteúdo.

## Build de produção

O fluxo de releases usa `scripts/build.sh --release` ou
`scripts/deploy.sh prepare <id> ... --release`, conforme
[DEPLOY_SHARED_SERVER.md](DEPLOY_SHARED_SERVER.md). Builds de revisão/homologação
continuam sem indexação; homologação também exige controle de acesso no servidor.

Os scripts diretos `scripts/deploy-server.sh` e `scripts/update.sh` chamam
`scripts/build-public-frontend.sh` após instalar dependências e compilar o backend.
Esse helper exporta apenas a configuração pública a partir de `backend/.env`,
exige ambiente `production`, identidade completa e a origem canônica acima, e define:

```dotenv
MF_INDEXABLE=1
MF_STRICT_RELEASE=0
VITE_SITE_URL=https://www.minhafolga.com.br
```

`MF_PUBLIC_CONFIG_FILE` aponta para o JSON público exportado. A compilação acontece
em uma pasta temporária dentro de `frontend/.generated/`; `frontend/dist` só é
substituído após build e verificações bem-sucedidos. Falhas de conteúdo ou configuração
preservam o frontend anterior. O helper não executa migrações nem reinicia serviços.

No fluxo direto, a indexação é independente da revisão editorial estrita. O padrão
`MF_STRICT_RELEASE=0` permite compilar com aprovações editoriais pendentes. Elas
continuam registradas no conteúdo, sem preencher datas ou revisores automaticamente.
Isso não aprova o conteúdo nem oculta os marcadores de pendência existentes. As
verificações de configuração de produção, identidade, domínio, SEO, HTML e segredos
continuam ativas.

No servidor, use o comando habitual após atualizar o repositório:

```bash
sudo bash scripts/deploy-server.sh
```

Para exigir também as aprovações editoriais e a ausência de marcadores de pendência,
use `sudo env MF_STRICT_RELEASE=1 bash scripts/deploy-server.sh`. O helper e o
`scripts/update.sh` também aceitam essa variável. `scripts/build.sh --release` e
`scripts/deploy.sh prepare ... --release` continuam estritos por padrão; registre os
dados e aprovações reais para usar esse fluxo.

Executar somente `npm run build` com a configuração de desenvolvimento não gera um
site indexável. Commit/push atualiza o repositório; as mudanças só chegam ao domínio
após a implantação da nova versão.

## Validar e enviar ao Google

Depois da publicação, execute na raiz do projeto:

```bash
scripts/node-runtime.sh exec scripts/smoke.sh https://www.minhafolga.com.br --expect indexable
```

Confira também que `/robots.txt` e `/sitemap.xml` respondem 200, que o robots contém
`Sitemap: https://www.minhafolga.com.br/sitemap.xml` e que as páginas públicas não
recebem `noindex` por HTML ou cabeçalho HTTP. O build verifica os arquivos gerados;
o smoke test confere URLs, redirecionamentos, status e cabeçalhos do servidor real.

1. No [Google Search Console](https://search.google.com/search-console), adicione a
   propriedade de domínio `minhafolga.com.br` e confirme a propriedade pelo registro
   DNS informado pelo Google. Use o token da própria conta e mantenha-o no DNS.
   Veja [verificação de propriedade](https://support.google.com/webmasters/answer/9008080?hl=pt-BR).
2. Em **Sitemaps**, envie `https://www.minhafolga.com.br/sitemap.xml` e confira o
   resultado do processamento. O procedimento está no
   [relatório de sitemaps](https://support.google.com/webmasters/answer/7451001?hl=pt-BR).
3. Use **Inspeção de URL** na home e em um artigo para conferir acesso e canonical;
   solicite indexação após a publicação. Acompanhe indexação, desempenho e Core Web
   Vitals e corrija os problemas observados.

O código não verifica a propriedade no Google nem envia o sitemap pela conta do
responsável. Esses passos exigem acesso ao Search Console e ao DNS. Sitemap ajuda
na descoberta, mas [não garante indexação ou uso pelo Google](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap?hl=pt-br),
e não há garantia de posição nos resultados.
