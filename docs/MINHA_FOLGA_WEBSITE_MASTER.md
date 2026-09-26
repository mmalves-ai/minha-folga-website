# Minha Folga — especificação do website corporativo completo

Versão 1.1 • Revisão de escopo e arquitetura: 25/09/2026 • Domínio: `https://www.minhafolga.com.br`

Diretriz expressa do contratante: website corporativo completo em **Vue.js + Node.js**, com frontend e backend separados e implantação isolada para convivência com outros websites no mesmo servidor. A landing de aquisição integra esse website. O pré-lançamento descreve a situação da operação financeira.

## 1. Missão para a equipe ou IA de construção

Construir o **website corporativo completo, funcional e multipágina da Minha Folga**, com uma experiência brasileira de crédito acolhedora, moderna e clara. O site apresenta a empresa, sua proposta, suas soluções e a Bia, oferece educação financeira e atendimento, recebe cadastros e permite a gestão operacional dessas interações. A Minha Folga quer ajudar trabalhadores com vínculo elegível a entender e, quando a operação estiver formalizada, avaliar alternativas de consignado privado. A Bia, agente de IA operado com Hal-AI, explica, organiza informações, mostra diferenças entre alternativas e encaminha o que exige atendimento humano.

**Entrega exigida: website corporativo completo**, com todas as páginas, conteúdo, navegação, frontend, backend, cadastro, preferências, atendimento e administração definidos neste documento. A landing de conversão é uma página desse conjunto. A entrega não estará concluída com uma página única, um protótipo visual ou páginas vazias de “em breve”.

O website entra no ar antes da operação financeira e já deve funcionar integralmente em suas funções institucionais, editoriais, de atendimento e de relacionamento. **Somente as funções de crédito — consulta de margem, proposta, aprovação, assinatura e desembolso — dependem da formalização e das integrações financeiras.** A futura oferta depende de parceiros, política, análise e disponibilidade. A situação do crédito deve estar clara nas páginas do produto e junto aos CTAs correspondentes, sem transformar a identidade inteira do site em uma página de espera.

Este arquivo é autossuficiente para o projeto de interface e sua implementação. Substitui as instruções incompatíveis dos kits antigos, incluindo a marca “Folga”, o domínio anterior, as promessas de rapidez ou economia sem comprovação e a apresentação prematura como correspondente. O documento de implantação no mesmo projeto orienta a ativação financeira. A equipe não deverá publicar campos jurídicos inventados.

### Resultado esperado

- Interface completa, responsiva e acessível, com logo, textos, componentes, estados de erro e confirmação.
- Home corporativa, Sobre, Soluções, Consignado privado, Como funciona, Bia, Conteúdos com artigos, Central de ajuda, Atendimento, Segurança e páginas legais completas, conforme o mapa obrigatório da seção 5.
- Landing de aquisição independente, integrada à navegação e ao mesmo backend de cadastro; páginas internas com conteúdo próprio, URLs acessíveis diretamente e navegação coerente.
- Captura real de cadastro, persistência segura, confirmação de contato e preferência de comunicação.
- Atendimento real via Hal-AI/WhatsApp, quando provisionado; demonstração sempre rotulada como demonstração.
- Formulário de atendimento com protocolo, painel administrativo protegido para leads e solicitações e conteúdo editorial versionado.
- Website corporativo ativo; fase financeira `PRE_LAUNCH` por padrão, com bloqueios também no servidor. `PILOT` e `LIVE` alteram a disponibilidade do crédito, preservando a estrutura completa do website.
- Frontend Vue 3 e backend Node.js separados, configuração por ambiente e documentação de instalação, implantação isolada, operação e rollback.
- Nenhum depoimento, selo, número de clientes, parceiro, taxa ou desempenho fabricado.

## 2. Público e posicionamento

Público primário: adultos com vínculo formal elegível ao Crédito do Trabalhador, que querem reorganizar compromissos, entender o desconto em folha e comparar custo e prazo com calma. Trabalhadores domésticos e rurais registrados poderão entrar quando o produto do parceiro os suportar. Evitar estereótipos sobre renda, escolaridade ou capacidade de decisão.

Titular de MEI, autônomo e motorista de aplicativo não são automaticamente elegíveis. Empregado de MEI pode ter vínculo elegível. A triagem do site é autodeclarada e jamais equivale a consulta de margem, score ou aprovação.

Posicionamento: **uma conversa que ajuda você a entender antes de contratar**. A IA deve parecer melhor porque entrega clareza e continuidade. “Tem IA” sozinho já não diferencia: Consegue.aí e outras plataformas também anunciam atendimento com inteligência artificial.

Promessa de marca: **Mais clareza para escolher. Mais espaço para viver.**

Assinatura curta: **Mais clareza. Mais controle. Mais folga.**

Não usar “o melhor crédito”, “a menor taxa do Brasil”, “aprovação garantida”, “sem análise”, “economia garantida” ou “risco zero”. A percepção de superioridade virá da experiência demonstrada, não de comparação absoluta sem prova.

## 3. Identidade visual e logotipo

### Conceito

“Folga” é espaço para respirar e decidir, não incentivo a gastar. Combinar cores naturais, tipografia firme, áreas vazias e detalhes de produto digital. A Bia deve aparecer como uma interface útil, não como robô, cérebro brilhante ou avatar que simula uma pessoa real.

Logotipo original proposto: duas curvas conectadas formando um “m” aberto, com terminações arredondadas e um pequeno ponto coral. O espaço livre representa fôlego; o ponto sugere conversa ativa. Não usar o ponto como selo de disponibilidade quando não houver serviço online. O símbolo não constitui certificação financeira. A disponibilidade de marca e a possibilidade de registro no INPI precisam ser verificadas antes da adoção definitiva.

Arquivos complementares entregues: `minha-folga-logo.svg`, `minha-folga-logo-reverso.svg` e `minha-folga-simbolo.svg`. Os logotipos completos têm lettering vetorial, sem dependência de fonte instalada. O símbolo abaixo pode ser usado diretamente no código:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 72" role="img" aria-labelledby="mf-title">
  <title id="mf-title">Minha Folga</title>
  <path d="M12 55V30C12 12 36 12 36 30V48M36 30C36 12 60 12 60 30V55"
        fill="none" stroke="#123F35" stroke-width="10" stroke-linecap="round"/>
  <circle cx="69" cy="13" r="5" fill="#E78163"/>
</svg>
```

Usar o logo horizontal no cabeçalho e no rodapé; símbolo em favicon e avatar. Margem livre mínima de 12% da altura; largura mínima recomendada do logo completo de 140 px e símbolo de 24 px. Para 16 px, simplificar o ponto se necessário para preservar leitura. Em fundos escuros, usar a versão reversa. Não distorcer, colocar sombra, gradiente sobre o logo ou redesenhar o símbolo com outra espessura.

### Tokens

```css
:root {
  --mf-forest: #123F35;
  --mf-forest-hover: #0B3028;
  --mf-cream: #F8F6F0;
  --mf-paper: #FFFFFF;
  --mf-mint: #DDECE2;
  --mf-coral: #E78163;
  --mf-lilac: #E8E4F2;
  --mf-ink: #172E28;
  --mf-muted: #50615A;
  --mf-border: #C7D2CC;
  --mf-error: #9C2F26;
  --mf-radius-control: 12px;
  --mf-radius-card: 24px;
  --mf-radius-panel: 36px;
  --mf-shadow: 0 18px 60px rgb(18 63 53 / 8%);
}
```

Coral e lilás são acentos, não cores de texto pequeno. Botão principal: forest com texto branco. Botão secundário: transparente com texto e borda forest. Texto principal ink sobre cream/paper. Validar WCAG AA, inclusive foco, mensagens e estados desabilitados; não confiar apenas na paleta.

Tipografia da interface: Sora para títulos, Inter para corpo, com arquivos WOFF2 licenciados e hospedados no próprio domínio. Fallback `system-ui, sans-serif`. O lettering do logotipo é independente das fontes da interface. Títulos com peso 500/600 e poucas palavras; corpo 16–18 px, entrelinha 1,55. H1 desktop `clamp(40px, 4.3vw, 68px)`, mobile 38–44 px; H2 30–44 px; textos legais pelo menos 14 px, com contraste legível.

Grid desktop com conteúdo máximo de 1200 px; respiro lateral 32 px, mobile 20 px. Escala de espaçamento 8/12/16/24/32/48/64/96 px. Seções alternam fundo cream, white e forest de forma contida. Evitar que todas as seções virem cartões iguais. Nada de carrossel automático no hero.

Fotografia opcional: pessoa adulta brasileira em uma situação cotidiana tranquila, com diversidade real e autorização de uso. Não exigir foto para a primeira versão; o painel de conversa pode sustentar o hero. Não usar imagem gerada como depoimento ou funcionário real. Não copiar fotos e ilustrações de concorrentes.

## 4. Direção do website e navegação

O website deve transmitir uma empresa organizada, próxima e tecnologicamente competente. Criar linguagem visual comum e layouts adequados a cada função: home institucional, apresentação da empresa, página de produto, experiência da Bia, central editorial, artigo, ajuda e conversão. As páginas internas precisam desenvolver os assuntos com conteúdo próprio; não repetir a home com títulos trocados.

Home desktop: hero em duas colunas, texto à esquerda, painel da Bia à direita. Mobile: proposta, texto e CTAs primeiro; painel demonstrativo depois. Navegação principal: **A Minha Folga / Soluções / Como funciona / Bia / Conteúdos / Ajuda**. “Soluções” leva à página explicativa, com situação real do consignado claramente identificada. CTA persistente: **Quero ser avisado**, para `/avise-me`. A comunicação sobre disponibilidade financeira deve ser localizada, legível e coerente em todo o percurso.

Rodapé corporativo em grupos: Empresa, Soluções, Aprenda, Atendimento e Informações legais. Incluir menu mobile acessível, estado de link ativo, breadcrumbs nas páginas internas, retorno à home e página 404 útil. Links principais levam a páginas; âncoras servem à navegação dentro de cada página.

Ordem da home: hero → proposta e princípios da empresa → solução de consignado e seu estado → demonstração da Bia → resumo de como funciona → artigos reais → perguntas frequentes resumidas → convite para cadastro. Acompanhar a abertura financeira é uma seção compacta com link para `/lancamento`; a timeline não deve dominar a home. A landing `/avise-me` usa uma jornada mais curta de conversão dentro do mesmo design system.

Dar destaque a uma experiência de produto concreta: no painel, o usuário pergunta por uma parcela menor e a Bia explica que também é preciso verificar prazo e custo total. Não usar valores inventados de simulação. O objetivo é transmitir “esta IA entende o que importa para mim”.

Microinterações de 160–240 ms, suaves, apenas em foco, expansão e confirmação. Respeitar `prefers-reduced-motion`. Não inserir efeitos de digitação infinitos, confetes de crédito aprovado ou animações que atrapalhem o formulário.

## 5. Mapa obrigatório do website corporativo

| Rota | Entrega obrigatória já no website corporativo | Relação com a ativação do crédito |
|---|---|---|
| `/` | Home institucional completa, soluções, IA, educação, confiança e conversão | CTAs de crédito evoluem quando autorizados |
| `/sobre` | Propósito, forma de trabalhar, princípios e identidade real da empresa | Página institucional permanente |
| `/solucoes` | Visão das soluções: consignado privado em estruturação, Bia e conteúdo educativo | Exibir somente produtos confirmados pela empresa |
| `/consignado-privado` | Página completa do produto: conceito, público previsto, custos a observar, jornada, dúvidas e cadastro | Proposta contratável somente após liberação |
| `/como-funciona` | Jornada explicada, responsabilidades, autorização futura e decisão consciente | Atualizar os passos com o fluxo homologado |
| `/bia` | Apresentação da IA, exemplos, capacidades, limites e atendimento integrado quando provisionado | Ferramentas financeiras são habilitadas por fase |
| `/conteudos` | Central editorial com categorias, busca ou filtro funcional e quatro artigos iniciais completos | Educação disponível desde a publicação |
| `/conteudos/o-que-e-cet` | Artigo completo sobre CET e leitura das condições | Sem promessa de condição comercial |
| `/conteudos/parcela-menor-e-custo-total` | Artigo completo sobre parcela, prazo e total pago | Sem simulação de oferta própria |
| `/conteudos/como-funciona-desconto-em-folha` | Artigo completo sobre desconto e compromissos do contrato | Revisão financeira antes de publicar |
| `/conteudos/antes-de-contratar-credito` | Artigo completo com roteiro de decisão e prevenção a golpes | Conteúdo educativo permanente |
| `/ajuda` | Central de dúvidas pesquisável, categorias e ligação com atendimento | Respostas refletem a fase financeira vigente |
| `/atendimento` | Canais reais, horários, formulário funcional e protocolo | Canais regulados aplicáveis são adicionados quando existentes |
| `/seguranca` | Canais oficiais, prevenção a golpes, atuação da IA e comunicação de incidentes | Identificar parceiros efetivamente ativos |
| `/avise-me` | Landing de aquisição com proposta, formulário, confirmação e consentimentos | Captação de interesse antes da abertura das propostas |
| `/lancamento` | Status verificável da estruturação financeira e próximos marcos | Atualização manual baseada em evidências |
| `/cadastro-confirmado` | Confirmação e próximos passos, sem parâmetros pessoais | Sem afirmação de aprovação financeira |
| `/preferencias` | Gerenciar finalidades e revogar comunicação com acesso seguro | Sempre funcional |
| `/privacidade` | Aviso completo com controlador, canais e tratamentos reais | Atualizar com novos tratamentos e parceiros |
| `/termos` | Regras de uso do website, atendimento e cadastro | Adicionar condições contratuais quando aplicáveis |
| `/cookies` | Política, categorias utilizadas e acesso à gestão das escolhas | Apenas tecnologias efetivamente instaladas |
| `/admin` | Painel interno protegido: leads, preferências e solicitações de atendimento | Acesso restrito; fora da navegação pública |
| Rota inexistente | Página 404 com status HTTP correto e links úteis | Nunca transformar qualquer URL em home com status 200 |

Todas as páginas acima integram a entrega contratada. Conteúdos institucionais e educativos terão texto, hierarquia, links, metadados e responsividade completos. Rotas de confirmação, preferências e administração ficam fora do sitemap e da indexação; `robots.txt` não substitui autenticação. As páginas públicas de produto permanecem acessíveis e informativas durante a estruturação.

Não criar páginas de investidores, captação para fundo ou promessa de rentabilidade. Não exibir `/simular` nem URLs de proposta operacional antes do marco de liberação. “Website completo” compreende as funções corporativas, de conteúdo, relacionamento e operação aqui descritas; um internet banking, uma conta digital ou um portal de investimento não integram este escopo.

## 6. Conteúdo, textos e composição das páginas

As subseções 6.1 a 6.9 fornecem os componentes de texto da home e da landing. As subseções seguintes definem as páginas internas e sua composição. Entregar o conjunto completo; a landing não substitui nenhuma página institucional.

### 6.1 Cabeçalho

Logo Minha Folga. Links: “A Minha Folga”, “Soluções”, “Como funciona”, “Bia”, “Conteúdos”, “Ajuda”. Botão “Quero ser avisado”. No mobile, menu acessível com os mesmos destinos e CTA visível. Nas áreas relacionadas à contratação, usar a identificação **Crédito em estruturação**. Evitar um aviso global que apresente o website como inacabado.

### 6.2 Hero

Eyebrow: **A próxima conversa sobre seu dinheiro pode ser mais clara.**

H1: **Seu salário merece uma folga. Sua escolha, mais inteligência.**

Texto: “Informação clara e inteligência artificial para você entender melhor suas escolhas. Conheça a Minha Folga, converse com a Bia e acompanhe nossa proposta de crédito consignado para quem trabalha com carteira assinada.”

Na home, CTA principal: **Conheça nossas soluções** → `/solucoes`. Na landing `/avise-me`, CTA principal: **Quero ser avisado** → formulário da própria página.

CTA secundário: **Conhecer a Bia** → `/bia`, com demonstração e acesso ao atendimento real.

Aviso de disponibilidade na home e junto ao CTA da landing: “O crédito consignado está em estruturação. O cadastro é gratuito e não garante crédito, taxa ou data de liberação. As ofertas dependerão da conclusão da estruturação e de análise.”

Microcopy: “Sem compromisso. Sem depósito antecipado.”

Painel à direita, título “Uma conversa com mais clareza”. Rótulo sempre visível “Exemplo de conversa”. Bolhas:

- Pessoa: “Se a parcela ficar menor, eu economizo?”
- Bia · IA: “Pode ajudar no mês, mas precisamos olhar também o prazo e o total a pagar. Uma parcela menor nem sempre significa um crédito mais barato.”
- Pessoa: “É isso que eu quero entender.”
- Bia · IA: “Vamos por partes. Eu explico os pontos para você decidir com mais segurança.”

Nota do painel: “Demonstração educativa. Não é uma proposta de crédito.” Não reproduzir esse roteiro como se a pessoa tivesse enviado mensagens ao atendimento.

### 6.3 Valor imediato

H2: **Clareza em cada etapa da sua escolha.**

Três benefícios: “Tire dúvidas com a Bia” — entenda desconto em folha, prazo e custo total; “Receba o aviso de abertura” — saiba quando a análise de propostas estiver disponível; “Decida no seu tempo” — cadastro sem obrigação de contratar.

Esses benefícios se conectam às páginas completas de Bia, Conteúdos e Cadastro. Na home, acrescentar resumo institucional: “A Minha Folga combina linguagem simples, tecnologia e respeito ao seu tempo para tornar a conversa sobre crédito mais compreensível.” Link **Conheça a Minha Folga** → `/sobre`. Não inventar taxa de fundador, benefício exclusivo ou fila prioritária se a empresa não puder realmente cumprir.

### 6.4 Demonstração da IA

H2: **IA que explica. Você que decide.**

Texto: “A Bia transforma termos difíceis em uma conversa simples. Quando as propostas estiverem disponíveis, ela ajudará você a entender valores, prazo e custo total com base nas informações oficiais da operação.”

Três abas com exemplos educativos: “Entender o CET”, “Comparar prazo e parcela”, “Saber o próximo passo”. Cada aba muda a demonstração e mantém o rótulo de exemplo. Não fabricar comparativo numérico.

Frase de confiança: “Se a resposta exigir uma pessoa, a Bia encaminha para o atendimento.” Publicar apenas quando existir equipe e canal de retorno; informar os horários reais em `/atendimento`.

CTA: **Conversar com a Bia** → canal provisionado. Se não existir integração pronta, exibir “Conheça como a Bia vai ajudar” e manter somente a demonstração; não fingir chat funcional.

### 6.5 Como vai funcionar

H2: **Do interesse à decisão, cada etapa explicada.**

1. “Agora: entre na lista” — deixe seu contato e conte qual é o seu tipo de vínculo.
2. “Quando a operação abrir: conheça as opções” — se o produto estiver disponível para seu perfil, você poderá autorizar as consultas necessárias e solicitar análise.
3. “Antes de contratar: veja tudo com clareza” — confira condições, instituição responsável, CET e total a pagar.
4. “Só depois: escolha se faz sentido” — a contratação dependerá de aprovação, formalização e sua decisão.

Link “Entenda o consignado” para `/como-funciona`. Explicar nessa página que a parcela é descontada do salário, que demissão não extingue automaticamente a dívida e que a situação individual depende do contrato e das regras aplicáveis.

### 6.6 Progresso da abertura financeira

H2: **Estamos preparando os próximos passos.**

Em `/lancamento`, linha de progresso com marcos: “Website e atendimento” / “Parcerias e estruturação” / “Testes da operação financeira” / “Abertura das propostas”. O primeiro marco só é concluído quando o website completo e seus canais estiverem publicados e verificados; os demais refletem evidências reais. Na home e na landing, mostrar apenas resumo com link para essa página. Sem percentuais inventados e sem data de lançamento fictícia.

Texto: “Vamos avisar quando houver uma atualização relevante. Você pode sair da lista quando quiser.” Alteração de status exige evidência interna e responsável; não atualizar automaticamente por passagem de tempo.

### 6.7 Formulário

H2: **Quer saber quando as propostas de crédito estiverem disponíveis?**

Texto: “Deixe seu contato. A gente avisa quando a análise de propostas estiver disponível.”

Campos obrigatórios: nome preferido, WhatsApp com DDD, tipo de vínculo e declaração “Tenho 18 anos ou mais”. Não coletar data de nascimento. Opções de vínculo: “CLT”, “Empregado doméstico registrado”, “Trabalhador rural registrado”, “Outro vínculo ou não sei”. Não chamar a opção de vínculo de teste de aprovação.

Campo opcional, em etapa posterior ao envio: “O que você quer entender melhor?” Opções: “Organizar compromissos”, “Entender uma alternativa de crédito”, “Entender portabilidade”, “Só conhecer”. Não pedir valor da dívida, renda ou empresa empregadora nesta fase.

Consentimento necessário para o aviso, desmarcado: “Quero receber pelo WhatsApp o aviso de abertura da operação de crédito da Minha Folga e atualizações sobre esse lançamento. Posso cancelar quando quiser.”

Consentimento separado e opcional, desmarcado: “Também quero receber conteúdos e novidades da Minha Folga.” O cadastro não dependerá da aceitação de publicidade adicional.

Texto junto ao botão: “Usaremos seus dados para as finalidades escolhidas. Saiba quem cuida deles e como exercer seus direitos no Aviso de Privacidade.” Link real para `/privacidade`; o aviso deve identificar o controlador efetivo antes da publicação.

Botão: **Quero receber o aviso**.

Texto abaixo: “Cadastro de interesse. A elegibilidade será verificada na futura análise. Não envie CPF, documentos ou dados bancários aqui.”

Após envio, exigir confirmação do canal por mecanismo contratado, preferencialmente código de uso único. Antes da confirmação: “Recebemos seu cadastro. Confirme seu WhatsApp para receber os avisos.” Depois: “Pronto, seu interesse ficou registrado. Vamos avisar quando a análise estiver disponível. Enquanto isso, você pode conversar com a Bia.”

Não confirmar duplicidade de número para visitante anônimo; usar resposta genérica e permitir que o titular confirme seu próprio contato. Só exibir sucesso depois de persistência no servidor. Para vínculo “Outro”, responder: “O produto inicial será voltado a vínculos formais elegíveis. Seu cadastro não confirma acesso a crédito. Você pode continuar recebendo as novidades escolhidas.”

### 6.8 Perguntas frequentes

**A Minha Folga já está liberando empréstimos?** “Ainda não. Estamos estruturando a operação. Nesta fase, você pode tirar dúvidas e se cadastrar para receber o aviso de abertura.”

**Quem poderá solicitar?** “A proposta inicial é atender trabalhadores com vínculo formal elegível ao consignado privado. A disponibilidade para cada tipo de vínculo dependerá do produto e da instituição responsável. A confirmação ocorrerá na análise.”

**Sou MEI ou trabalho por aplicativo. Posso participar?** “Essas atividades, por si só, não confirmam elegibilidade. Se você também tiver um vínculo de emprego elegível, ele poderá ser analisado quando a operação estiver disponível.”

**Cadastrar meu interesse garante aprovação ou taxa?** “Não. O cadastro não é uma solicitação aprovada nem reserva condições. As propostas futuras dependerão de análise, regras e disponibilidade.”

**O que a Bia faz?** “A Bia é nossa assistente de inteligência artificial. Agora, ela explica o funcionamento do produto e ajuda no cadastro. Na fase de propostas, usará as informações oficiais da operação para explicar as condições disponíveis.”

**Preciso pagar para entrar na lista ou liberar crédito?** “Não cobramos para entrar na lista e não pedimos depósito antecipado para liberar empréstimo. Desconfie de pedidos desse tipo.”

**Uma parcela menor significa pagar menos no total?** “Nem sempre. Prazo maior e outros componentes podem aumentar o total pago. Compare prazo, CET e total a pagar antes de decidir.”

**Quando o crédito estará disponível?** “A data depende da conclusão da estruturação e dos testes da operação financeira. Avisaremos quando a análise de propostas estiver disponível.”

**Como saio da lista?** “Use o link de preferências ou peça para sair no nosso canal oficial. A mudança será registrada e aplicada às comunicações correspondentes.”

### 6.9 Encerramento e rodapé

H2: **Uma decisão melhor começa com uma conversa clara.** CTA **Quero ser avisado**.

Rodapé com marca, razão social, CNPJ, identificação do controlador e contato reais, links de privacidade, termos, segurança, preferências e atendimento. Não colocar CNPJ fictício ou de terceiro sem autorização. Não exibir logotipos de BCB, CVM, MTE ou de bancos como selo de aprovação.

Texto de disponibilidade financeira: “A operação de crédito da Minha Folga está em estruturação. Ainda não há contratação de empréstimos disponível. O cadastro é gratuito e não garante aprovação ou condições futuras.”

Quando houver correspondente contratado e operação ativa, substituir o texto de fase por identificação da atuação e instituições efetivamente contratantes, com seus canais aplicáveis e revisão do parceiro. Não publicar essa identificação antecipadamente.

### 6.10 Sobre a Minha Folga — `/sobre`

H1: **Mais espaço para entender. Mais confiança para escolher.**

Texto de abertura: “A Minha Folga nasce para tornar a conversa sobre crédito mais clara. Nossa proposta combina informação acessível, atendimento e inteligência artificial para ajudar você a compreender suas alternativas e decidir com autonomia.”

Seção “Nossa forma de trabalhar”: “Começamos pelas suas dúvidas. Explicamos os termos, mostramos o que precisa ser observado e deixamos claro o que está disponível em cada etapa. A tecnologia ajuda a organizar a conversa; a decisão continua sendo sua.”

Três princípios, com texto próprio:

- **Clareza antes da contratação.** “Parcela, prazo e custo total precisam fazer sentido juntos. Você deve entender as condições antes de decidir.”
- **Tecnologia com responsabilidade.** “A Bia se identifica como IA, trabalha com informações aprovadas e reconhece quando precisa encaminhar uma dúvida.”
- **Respeito ao seu tempo e aos seus dados.** “Você escolhe as comunicações que quer receber e pode mudar de ideia. Solicitamos informações de acordo com a etapa do atendimento.”

Encerrar com bloco de identidade empresarial real e links para Atendimento, Segurança e Privacidade. Publicar nomes de sócios, trajetória, endereço, fotos da equipe e números somente com informações fornecidas e verificadas. A página funciona com propósito, princípios e identidade legal; não preencher uma história empresarial fictícia. CTA: **Conheça nossas soluções**.

### 6.11 Soluções e consignado — `/solucoes` e `/consignado-privado`

Em `/solucoes`, H1: **Informação, conversa e crédito explicado.** Introdução: “Conheça o que a Minha Folga oferece hoje e acompanhe a preparação da nossa operação de consignado privado.”

Apresentar três áreas, cada uma com destino real: **Consignado privado** — “Estamos estruturando uma experiência para trabalhadores com vínculo formal elegível. Entenda a proposta e receba o aviso de abertura.” → `/consignado-privado`; **Bia, nossa IA** — “Uma conversa para esclarecer dúvidas e organizar os próximos passos.” → `/bia`; **Conteúdos para decidir** — “Entenda os conceitos que fazem diferença na hora de avaliar crédito.” → `/conteudos`. Bia e educação são serviços de apoio, sem aparência de produtos financeiros adicionais. Não inventar cartões, crédito pessoal, seguros ou investimentos para preencher a grade.

Em `/consignado-privado`, H1: **Consignado privado, explicado antes de contratar.** Abertura: “Uma modalidade de crédito com pagamento por desconto em folha, para vínculos elegíveis. Na Minha Folga, essa operação está em estruturação. Enquanto isso, você pode entender como funciona e registrar seu interesse.”

Construir seções completas:

1. **O que é.** Explicar o desconto em folha e o compromisso de pagamento em linguagem simples, com link para o artigo correspondente.
2. **Para quem estamos preparando.** Informar os vínculos previstos na seção 2 e distinguir interesse autodeclarado de elegibilidade confirmada. Sem formulário de CPF ou consulta de margem nessa fase.
3. **O que observar.** “Olhe o valor que você recebe, a parcela, o prazo, o CET e o total a pagar. Confira também quem concede o crédito e as condições do contrato.”
4. **Como será a jornada.** Apresentar os passos da seção 6.5, sempre distinguindo o cadastro atual da futura análise.
5. **Como a Bia ajuda.** Demonstrar explicação de termos, limites atuais e encaminhamento ao atendimento.
6. **Dúvidas do produto.** Selecionar as perguntas de elegibilidade, aprovação, custos e disponibilidade da seção 6.8, com link para a central completa.
7. **Receba o aviso.** CTA para `/avise-me`, acompanhado da condição de disponibilidade financeira.

A página deve ter conteúdo e apresentação de produto acabados durante a estruturação. Taxas, simulação personalizada, “contrate agora” e proposta concreta só entram com dados e operação homologados. Portabilidade pode ser tema educativo e de interesse; sua apresentação como produto depende da confirmação do escopo comercial.

### 6.12 Como funciona e Bia — `/como-funciona` e `/bia`

Em `/como-funciona`, H1: **Do primeiro entendimento à sua decisão.** Abertura: “Cada etapa tem um propósito. Você pode conhecer a Minha Folga, tirar dúvidas e cadastrar seu interesse agora. A análise e a contratação serão disponibilizadas quando a operação financeira estiver pronta.” Desenvolver os quatro passos da seção 6.5 em blocos próprios: objetivo, informação necessária, resultado esperado e o que não ocorre ainda. Incluir explicação de desconto em folha, custos e consequências contratuais, sem substituir o contrato. Encerrar com links para Consignado, Bia e Ajuda.

Em `/bia`, H1: **Conheça a Bia. Inteligência artificial para uma conversa mais clara.** Abertura: “Pergunte, peça uma explicação mais simples e retome o assunto no seu ritmo. A Bia ajuda a entender o consignado e os próximos passos da Minha Folga.”

Incluir demonstração interativa identificada, três exemplos de uso da seção 6.4, painel “O que ela faz hoje”, painel “Quando o crédito estiver disponível”, identificação permanente de IA, privacidade e canal humano. O quadro de capacidades deve refletir a seção 7 e a configuração do servidor. O botão de atendimento usa integração real; uma demonstração não pode gerar confirmação de cadastro nem protocolo fictícios. Integrações contratadas e credenciais externas constam da lista de pendências de publicação quando ainda não fornecidas; a página institucional permanece completa.

### 6.13 Central editorial — `/conteudos` e artigos

H1 da central: **Informação que abre espaço para boas decisões.** Introdução: “Entenda os termos, reconheça o que importa numa proposta e tire suas dúvidas no seu ritmo.” Categorias iniciais: **Entenda o crédito / Planejamento / Segurança**. Mostrar apenas categorias com conteúdo. Filtro ou busca deve funcionar; incluir estado vazio com opção de limpar filtros. Cards exibem título, resumo, categoria e tempo de leitura calculado a partir do texto.

Modelo de artigo: breadcrumb, H1, resumo, autoria editorial verdadeira, data de revisão real, corpo com subtítulos, fontes utilizadas, dois conteúdos relacionados e CTA contextual para Bia ou Ajuda. Não inventar assinatura de especialista. Entregar os quatro artigos com texto completo revisável, usando a base abaixo. Não publicar cartões que abram páginas vazias.

**Artigo 1 — O que é CET e por que olhar além da taxa**

Resumo: “A taxa de juros é uma parte da comparação. Entenda por que o custo total também importa.”

Texto-base: “Ao avaliar uma proposta, é natural começar pela parcela ou pela taxa de juros. Mas esses números, sozinhos, não mostram tudo. O Custo Efetivo Total, ou CET, reúne os encargos e despesas considerados na operação e ajuda a compreender seu custo de forma mais ampla. A proposta deve permitir que você entenda o que está sendo cobrado.

Compare também o valor líquido que será recebido, o número de parcelas, o prazo e o total a pagar. Uma comparação fica mais útil quando as alternativas atendem ao mesmo objetivo e deixam claras as diferenças. Propostas com valores recebidos ou prazos diferentes pedem atenção adicional.

Antes de decidir, confira as informações oficiais da instituição e peça explicação sobre qualquer custo que não tenha entendido. A Bia pode ajudar a compreender os termos. Durante a estruturação da Minha Folga, essa conversa é educativa e não representa uma oferta de crédito.”

**Artigo 2 — Parcela menor significa crédito mais barato?**

Resumo: “Uma parcela que cabe melhor no mês pode vir acompanhada de um prazo maior.”

Texto-base: “Uma parcela menor pode aliviar o compromisso mensal, mas não garante redução do custo total. Se o pagamento se estender por mais tempo, o resultado final pode ser diferente do que parece à primeira vista.

Olhe os números em conjunto: quanto você recebe, quanto paga por mês, por quantos meses, qual é o CET e qual será o total pago. Se estiver avaliando a troca de uma dívida, será necessário conhecer os dados do contrato atual e as condições reais da alternativa. Sem essas informações, não é possível afirmar que haverá economia.

Pergunte o que muda e o que permanece: existe dinheiro adicional? O prazo aumenta? Há custos envolvidos? A resposta deve estar apoiada em documentos e condições oficiais. Uma decisão mais clara considera tanto o orçamento mensal quanto o compromisso ao longo do tempo.”

**Artigo 3 — Como funciona o desconto em folha**

Resumo: “Entenda o mecanismo de pagamento e os pontos que merecem atenção no contrato.”

Texto-base: “No crédito consignado, o pagamento das parcelas acontece por desconto em folha conforme as regras e condições aplicáveis. A elegibilidade, os limites e a contratação dependem do vínculo, da análise e do produto oferecido pela instituição responsável.

O desconto é uma forma de pagamento de uma dívida. Antes de contratar, observe o efeito da parcela sobre o dinheiro disponível no mês e considere seus demais compromissos. Confira prazo, custo total e condições do contrato.

Uma mudança no vínculo de trabalho não significa que a dívida desapareça. As consequências e a forma de continuidade do pagamento precisam ser verificadas nas regras aplicáveis e no contrato. Procure o canal oficial da instituição quando houver uma alteração dessa natureza.

A Minha Folga está estruturando sua operação. O cadastro de interesse atual não consulta margem, não confirma elegibilidade e não gera contratação.”

**Artigo 4 — O que observar antes de contratar crédito**

Resumo: “Um roteiro para avaliar a necessidade, entender as condições e reconhecer sinais de golpe.”

Texto-base: “Comece pelo objetivo: por que você está buscando crédito e como pretende pagar? Considere suas despesas recorrentes e a possibilidade de imprevistos. Receber uma oferta não cria obrigação de contratar.

Identifique a instituição responsável e use seus canais oficiais. Leia valor recebido, parcela, prazo, juros, CET e total a pagar. Pergunte sobre cobranças e condições que não estejam claras. Tenha acesso aos documentos antes de decidir e guarde os registros da contratação.

Desconfie de pressão para decidir imediatamente, promessa de aprovação garantida e pedidos de depósito antecipado para liberar empréstimo. Não compartilhe senhas ou códigos de autenticação no atendimento. Na Minha Folga, o cadastro de interesse é gratuito e não garante condições futuras.

Se algo não estiver claro, interrompa o processo e procure atendimento. A Bia pode ajudar a organizar suas dúvidas; a decisão deve acontecer com informações verificadas e no seu tempo.”

Esses textos são conteúdo editorial proposto, com revisão financeira e de fontes antes da publicação. Usar os materiais oficiais indicados na seção 15 e registrar a data efetiva da revisão, sem preenchê-la automaticamente a cada acesso. Links de fontes precisam corresponder ao assunto tratado.

### 6.14 Ajuda, atendimento e segurança

Em `/ajuda`, H1: **Como podemos ajudar?** Busca local sobre a base aprovada, categorias “Sobre a Minha Folga”, “Consignado”, “Cadastro e avisos”, “Bia” e “Dados e segurança”. Publicar todas as perguntas da seção 6.8, com links para as páginas relacionadas. Mensagem de busca vazia: “Não encontramos uma resposta com esses termos. Tente outra palavra ou fale com o atendimento.” Botão **Falar com o atendimento** → `/atendimento`.

Em `/atendimento`, H1: **Vamos conversar.** Texto: “Escolha o canal que faz mais sentido para você. Informamos aqui os horários de atendimento humano e as formas de acompanhar sua solicitação.” Exibir apenas número, e-mail e horários verdadeiros. Identificar quando o canal usa IA. Formulário obrigatório: nome, meio de retorno escolhido, contato, assunto e mensagem com limite de tamanho; anexos ficam desabilitados nessa fase. Orientar: “Não envie CPF, documentos, senhas ou dados bancários.” Não exigir adesão a marketing para receber atendimento.

Após persistir, gerar protocolo aleatório e confirmar o recebimento. Acompanhar status mediante sessão ou link seguro; o protocolo sozinho não autoriza leitura de dados. Encaminhar à fila interna e ao responsável definido. Falha na notificação não pode apagar a solicitação registrada. Prazos de resposta exibidos precisam corresponder à capacidade real da equipe.

Em `/seguranca`, H1: **Confiança também é saber como se proteger.** Blocos: canais oficiais; cadastro gratuito; ausência de pedido de depósito para liberar empréstimo; identificação de IA; cuidados com links, senhas e códigos; canal para suspeita de fraude; acesso à Privacidade. Promessas de criptografia, monitoramento ou certificação precisam corresponder à implementação verificada. Não criar um selo próprio que pareça certificação de autoridade.

### 6.15 Landing de aquisição e páginas de relacionamento

`/avise-me` usa os textos de conversão, benefícios, resumo da Bia, aviso de disponibilidade e formulário da seção 6.7. É uma rota de campanha dentro do website completo, com marca, links institucionais e rodapé. Compartilha componentes, validação e backend com qualquer formulário contextual; não criar bases paralelas de leads. UTMs seguem lista permitida e não contêm dados pessoais.

`/cadastro-confirmado` oferece próximos passos para Conteúdos, Bia e Preferências. `/preferencias` permite escolher finalidades e cancelar avisos com autenticação adequada, inclusive quando o contato não quiser mais acompanhar a abertura financeira. Acessos diretos sem sessão válida apresentam orientação segura, sem revelar dados de cadastro.

`/lancamento` comunica exclusivamente o andamento da operação de crédito. Não usar essa página como justificativa para adiar a implementação de Sobre, Soluções, Conteúdos, Ajuda ou Atendimento.

### 6.16 Páginas legais e manutenção editorial

Privacidade, Termos e Cookies terão layouts e conteúdo completos a partir da identidade do controlador, dos fornecedores e dos tratamentos efetivos. Preparar textos revisáveis e uma lista objetiva dos dados empresariais ainda necessários. A ausência desses dados impede a publicação da coleta correspondente, sem reduzir a implementação das demais páginas a placeholders.

Termos devem distinguir uso institucional, atendimento com IA, cadastro de interesse e futura contratação. Cookies deve informar tecnologias realmente utilizadas e permitir reabrir as escolhas. Privacidade seguirá a seção 9. Exibir versão e data de revisão reais. Rodapé e páginas legais usam a mesma configuração validada de identidade empresarial.

Artigos, FAQ e textos institucionais ficam em arquivos de conteúdo versionados, com metadados de revisão e publicação. Entregar procedimento simples para editar, revisar e publicar por nova release. Um CMS visual pode ser acrescentado depois; a central editorial e seus artigos já fazem parte da entrega atual.

### 6.17 Administração e operação do website

Entregar painel administrativo enxuto em `/admin`, com autenticação individual, MFA, controle de acesso no backend e trilha de auditoria. Funções: listar e filtrar leads por data, origem, estado e preferências; consultar contato conforme permissão; acompanhar solicitações de atendimento, atribuir responsável e alterar status; registrar cumprimento de pedidos de privacidade e supressão. Acesso a dados pessoais e exportações, quando necessárias, exigem permissão específica e registro. Não incluir um motor de concessão de crédito ou edição livre de decisões financeiras.

Atendimento passa pelos estados `received`, `in_progress`, `answered` e `closed`; toda alteração registra responsável e horário. Preferências registradas pelo titular prevalecem sobre ações administrativas de comunicação. Métricas agregadas de cadastro e atendimento devem permitir acompanhar a operação sem expor conversas à equipe de marketing. Não entregar painel com credenciais padrão ou autorização aplicada apenas na interface.

## 7. Comportamento da Bia e integração Hal-AI

### Abertura durante a estruturação financeira

“Oi! Eu sou a Bia, assistente de IA da Minha Folga. Nossa operação de crédito está em estruturação. Posso explicar como funciona o consignado e ajudar você a receber o aviso de abertura. Ainda não consulto margem nem envio propostas. O que você quer entender?”

Menu inicial: “Como funciona”, “Quero ser avisado”, “Já tenho consignado”, “Falar com uma pessoa”. Não usar um menu para substituir perguntas livres. Respostas curtas, uma pergunta de cada vez, sem infantilização ou pressão.

### Capacidades por fase

| Capacidade | PRE_LAUNCH | PILOT ou LIVE |
|---|---|---|
| Explicar conceitos e cadastro | Sim, com base aprovada | Sim |
| Registrar preferências e descadastro | Sim | Sim |
| Confirmar elegibilidade financeira | Não | Somente resultado autorizado do parceiro |
| Consultar dados e margem | Não | Após autorização específica e integração habilitada |
| Calcular preço por conta própria | Não | Não; apresentar cálculo oficial |
| Mostrar proposta | Não | Somente proposta válida recebida da ferramenta |
| Assinar ou movimentar dinheiro no chat | Não | Encaminhar fluxo formal seguro, sem comando livre do modelo |

Ferramentas previstas desde a entrega do website corporativo: `get_approved_faq`, `create_waitlist_interest`, `verify_contact`, `update_contact_preferences`, `request_human_support`. Os nomes são contrato de implementação proposto, não declaração de APIs já existentes no Hal-AI. Confirmar interfaces com o fornecedor.

Respostas obrigatórias a situações frequentes:

- Taxa ou valor: “Ainda não temos ofertas disponíveis. Quando a operação abrir, as condições serão apresentadas após análise, com CET e total a pagar.”
- Pedido de dinheiro imediato: “Não consigo liberar crédito nesta fase. Posso explicar o funcionamento ou registrar seu interesse, se você quiser.”
- Pedido de burlar análise: não orientar falsificação; explicar o processo legítimo e encaminhar dúvidas cadastrais.
- Dificuldade financeira: não pressionar contratação. Explicar que novo crédito aumenta compromissos e oferecer atendimento humano quando disponível.
- CPF ou documento enviado sem necessidade: não reproduzir; orientar que não é necessário agora e aplicar a política de minimização.
- “Sair”, “pare”, “não me mande”: registrar revogação da finalidade correspondente e confirmar sem exigir justificativa.
- Informação ausente na base: reconhecer que não tem confirmação; não criar regra nem citar norma inexistente.

A IA precisa de base versionada, responsável editorial, bloqueio de ferramentas por fase, logs minimizados, teste de injeção de instruções e canal humano com protocolo. Não usar conteúdo de conversa para treinar modelos sem base, informação e acordo apropriados. Não inferir risco a partir de raça, religião, saúde, filiação sindical ou linguagem coloquial.

### Canais

Preferência inicial: WhatsApp Business com número empresarial provisionado, identificação clara da Bia e templates aprovados quando exigidos. A URL `wa.me` só pode ser montada com número confirmado; não inserir número ilustrativo na produção. O texto pré-preenchido conterá apenas pedido genérico de informação, sem CPF ou dados de crédito.

Webchat é opcional se o Hal-AI oferecer integração segura e acessível. Carregar após interação, explicar o tratamento e oferecer formulário sem chat. Não colocar chave de API no navegador. Caso o serviço falhe, mostrar “Não consegui conectar agora. Você pode deixar seu contato ou usar o atendimento” e preservar apenas dados já confirmados, sem repetir envios.

## 8. Arquitetura obrigatória: Vue.js + Node.js, frontend e backend separados

### 8.1 Stack e responsabilidades

Implementar **Vue 3 + Vite + TypeScript** no frontend, **Vue Router** para navegação e **Node.js LTS + Express + TypeScript** no backend. Usar Composition API e componentes reutilizáveis. Esta revisão substitui a sugestão anterior de Nuxt por dois projetos independentes dentro do mesmo repositório: `frontend/` e `backend/`. Não migrar a solução para outro framework por conveniência da ferramenta construtora.

Em 25/09/2026, a página oficial do Node.js identifica a linha 24 como LTS. Adotar um patch suportado e compatível dessa linha, fixado no projeto; registrar a versão exata de Node, npm e dependências na implementação e revalidar suporte na implantação. Não usar `latest` como estratégia de produção. O Vue recomenda Vite para projetos novos; o build estático fica em `dist/`. `vite preview` serve à revisão local e não será servidor de produção.

| Camada | Responsabilidade | Saída ou interface |
|---|---|---|
| Frontend Vue | Páginas corporativas, conteúdo, formulários, Bia, preferências e painel administrativo | `frontend/dist/` |
| Backend Node | Validação, cadastro, autenticação administrativa, atendimento, preferências e integrações | `backend/dist/`, API sob `/api` |
| Banco relacional | Leads, consentimentos, protocolos, usuários autorizados e auditoria | Banco e credenciais exclusivos da Minha Folga |
| Fila de comunicação | Confirmações e mensagens com retentativa limitada, idempotência e tratamento de falha | Inicialmente pode usar outbox no mesmo banco, sem exigir outro serviço global |
| Servidor web existente | HTTPS do domínio, arquivos públicos e proxy da API | Virtual host exclusivo de `minhafolga.com.br` e `www.minhafolga.com.br` |

Pré-renderizar em build as páginas públicas institucionais e os artigos para entregar HTML com conteúdo e metadados por URL. **O `vite build` básico não resolve isso sozinho:** incluir e documentar uma etapa de geração estática compatível com Vue/Vite, validar as rotas e a hidratação. Não exigir um segundo servidor SSR de produção para essas páginas. Área administrativa e jornadas de sessão usam o frontend interativo com autorização no backend. A API não renderiza telas nem expõe serviços financeiros diretamente ao navegador.

### 8.2 Estrutura do código

```text
minhafolga/
  README.md
  .gitignore
  .node-version
  frontend/
    package.json
    package-lock.json
    .env.example
    vite.config.ts
    src/
      components/
      layouts/
      pages/
      router/
      services/
      composables/
      styles/
    content/                  páginas, artigos e FAQ versionados
    public/brand/             logotipos e ícones fornecidos
    dist/                     build e HTML público gerado
  backend/
    package.json
    package-lock.json
    .env.example
    src/
      routes/
      controllers/
      services/
      repositories/
      middleware/
      integrations/
      jobs/
      config/
    migrations/
    tests/
    dist/                     JavaScript compilado
  contracts/
    openapi.yaml              contrato versionado da API
  deploy/
    ecosystem.config.cjs      configuração caso o ambiente use PM2
    nginx.minhafolga.conf.example
    apache.minhafolga.conf.example
  scripts/
    preflight.sh
    build.sh
    deploy.sh
    rollback.sh
    smoke.sh
  docs/
    ARCHITECTURE.md
    ENVIRONMENT.md
    DEPLOY_SHARED_SERVER.md
    OPERATIONS.md
    CONTENT_GUIDE.md
    ACCEPTANCE.md
```

Cada aplicação possui `package.json`, lockfile, `node_modules` e build próprios. Usar `npm ci` no diretório correspondente. Dependências e ferramentas de desenvolvimento são locais; nenhuma instalação global é necessária para construir o site. Contratos compartilhados precisam ser versionados e incluídos no pacote de entrega, sem links para diretórios de outros projetos. Documentar scripts de desenvolvimento, verificação de tipos, build e execução em cada aplicação. Os artefatos de frontend e backend devem poder ser construídos separadamente a partir de checkout limpo.

O repositório não contém segredos, dados reais de leads, logs ou backups. `.node-version` declara a versão desejada, mas não substitui a escolha explícita do executável de Node na implantação.

### 8.3 Isolamento no servidor compartilhado

Usar uma raiz exclusiva, representada por `MINHAFOLGA_APP_ROOT`. Exemplo adaptável ao acesso da hospedagem: `/srv/minhafolga`. Não presumir permissão de escrita nesse caminho; em hospedagem com usuário próprio, escolher uma pasta privada permitida. Todo código, dependência, build, configuração privada, log e arquivo temporário da aplicação pertence a essa raiz, sem reutilizar diretórios de outros websites.

```text
<MINHAFOLGA_APP_ROOT>/
  releases/<release-id>/      checkout/build imutável com frontend e backend
  current                    referência para a release pública atual
  .runtime/                  versões privadas de Node, se necessárias
  .cache/npm/                cache exclusivo de instalação
  config/.env.production     segredos fora do diretório público
  var/log/                   logs exclusivos, com retenção e rotação
  var/tmp/                   temporários exclusivos
  var/private/               arquivos privados, se necessários
  backups/                   cópias locais temporárias protegidas
```

O document root público aponta **somente para `current/frontend/dist/`**. Nunca expor a raiz do projeto, `backend/`, `.env`, `node_modules`, logs ou backups. Backups duráveis podem usar armazenamento externo exclusivo e protegido; o destino deve ser documentado e não compartilhado com outros sites sem separação de acesso.

| Recurso | Regra de isolamento |
|---|---|
| Runtime Node | Usar executável compatível já disponível sem alterá-lo, ou instalar runtime privado versionado em `.runtime/`. Fixar o caminho absoluto utilizado pela aplicação. |
| npm e ferramentas | Executar com o Node escolhido, cache próprio e dependências locais. Ajustes de `PATH` valem apenas para o processo/script da Minha Folga. Não alterar perfil global nem versão padrão do servidor. |
| Processos | Nomes exclusivos, como `minhafolga-api` e, se necessário, `minhafolga-worker`. Uma instância inicial por processo, com limites compatíveis com a hospedagem. |
| Porta | API escuta em `127.0.0.1` numa porta livre reservada, por exemplo `3107` após verificação. Não assumir que a porta está disponível nem encerrar seu ocupante. |
| Banco | Banco dedicado e usuário de menor privilégio. Migrações atuam somente nesse banco; não reinicializar a instância compartilhada. |
| Filas e cache | Preferir outbox no banco no início. Se houver Redis, usar namespace e acesso restritos; nunca executar limpeza global em instância compartilhada. |
| Arquivos e permissões | Usuário de serviço e permissões limitados sempre que a hospedagem permitir. Nunca aplicar `chmod` ou `chown` amplo sobre diretórios de outros sites. |
| Logs, tarefas e recursos | Rotação própria, tarefas identificadas, pool de conexões e concorrência limitados. Não sobrescrever o crontab existente nem consumir todos os núcleos por padrão. |
| Ambientes | Desenvolvimento, homologação e produção com portas, processos, bancos, segredos e destinos de comunicação distintos. |

Isolamento de diretório evita colisões de arquivos e dependências, mas não cria sozinho uma fronteira de segurança ou uma reserva de CPU/memória. Usar usuário separado e quotas/limites quando oferecidos. A IA construtora deve registrar as limitações concretas da hospedagem; não prometer ausência absoluta de impacto apenas porque criou uma pasta.

Antes de preparar a implantação, verificar se a hospedagem aceita processo Node persistente, banco, proxy ou integração Node administrada pelo painel, TLS e as permissões necessárias. Se o plano só servir arquivos estáticos/PHP, documentar a incompatibilidade e a adaptação necessária para o backend. Não entregar um formulário fictício para contornar essa limitação.

### 8.4 Processo, domínio e proxy

Respeitar o gerenciador já adotado pela hospedagem. Se houver PM2, entregar configuração exclusiva com `name`, `cwd` da release, `script` do backend compilado, `interpreter` absoluto, `watch: false`, logs próprios e encerramento gracioso. Operações de start/restart/reload devem selecionar apenas os processos Minha Folga. Não executar ações globais como `pm2 restart all`, `pm2 delete all`, `pm2 kill` ou atualização do daemon compartilhado. Não alterar inicialização do servidor nem usar `pm2 save` indiscriminadamente, pois pode afetar a configuração persistida dos demais processos. Documentar a persistência segundo o mecanismo já adotado pelo administrador da hospedagem.

Se não houver gerenciador disponível, a configuração escolhida deverá ser privada ou um serviço exclusivo da Minha Folga. Não iniciar um daemon concorrente nem instalar PM2 globalmente como efeito colateral. Em painéis de hospedagem, usar a aplicação Node dedicada e o mecanismo de porta atribuído pelo provedor.

O servidor Nginx ou Apache existente atende HTTPS e serve `frontend/dist/`; requisições `/api/*` seguem para a API Node. Usar a mesma origem para frontend e API sempre que possível. Configurar somente o virtual host da Minha Folga e manter hosts, listeners e certificados dos outros sites. Não criar `default_server`, substituir a configuração principal nem tomar posse das portas 80/443 com Node.

No Nginx, preservar o prefixo `/api` esperado pelo backend: `location /api/` com `proxy_pass http://127.0.0.1:PORTA;`, sem acrescentar uma URI ao `proxy_pass`. A IA deverá substituir e validar a porta no arquivo gerado; isso é uma diretriz de configuração, não um arquivo pronto para colar. No Apache, produzir a configuração equivalente compatível com o ambiente existente. Ajustar encaminhamento de IP/protocolo e confiança no proxy apenas à topologia real; não confiar indiscriminadamente em cabeçalhos enviados pelo cliente.

Separar rotas de API das regras do frontend. Servir primeiro o HTML pré-gerado da rota; fallback da aplicação somente para rotas interativas conhecidas. Erros da API retornam JSON e status apropriado; URLs desconhecidas retornam 404. Definir cache longo para assets com hash e atualização adequada do HTML; manter assets necessários à transição de releases. Configurar domínio raiz para redirecionar ao www e HTTPS apenas nesse domínio. Arquivos de configuração específicos do host são a exceção documentada à concentração dos arquivos dentro da pasta da aplicação.

### 8.5 Configuração por ambiente

Separar a disponibilidade do website da fase financeira. O website corporativo está completo desde a publicação; a configuração abaixo governa crédito e integrações. Valores com marcadores são documentação e nunca devem ser publicados como conteúdo real.

Backend, arquivo privado fora do document root:

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=<porta exclusiva validada ou fornecida pela hospedagem>
CREDIT_PHASE=PRE_LAUNCH
CREDIT_OPERATIONS_ENABLED=false
PUBLIC_SITE_URL=https://www.minhafolga.com.br
LEGAL_ENTITY_NAME=<identidade real>
LEGAL_ENTITY_CNPJ=<CNPJ real>
PRIVACY_CONTACT=<canal real>
SUPPORT_CONTACT=<canal real>
WHATSAPP_BUSINESS_NUMBER=<número real ou recurso desabilitado>
HALAI_ENABLED=false
HALAI_API_SECRET=<somente servidor, quando contratado>
DATABASE_URL=<banco e usuário exclusivos>
MESSAGE_PROVIDER_SECRET=<somente servidor>
CONTACT_ENCRYPTION_KEY=<segredo gerado e gerenciado>
CONTACT_DEDUP_HMAC_KEY=<segredo distinto>
SESSION_SECRET=<segredo gerado e gerenciado>
ANALYTICS_ENABLED=false
```

Frontend, somente informações públicas:

```dotenv
VITE_SITE_URL=https://www.minhafolga.com.br
VITE_API_BASE_URL=/api
```

Variáveis com prefixo `VITE_` são expostas ao bundle do navegador; nunca incluir segredos nelas. Carregar e validar a configuração do backend por caminho explícito, sem depender do diretório de execução de outro projeto. Gerar `.env.example` sem credenciais reais. Um endpoint público de configuração, se adotado, retorna apenas uma lista permitida de campos públicos; jamais serializar todo o ambiente do processo.

O release público deve falhar se identidade e contatos obrigatórios estiverem ausentes. Toda autorização financeira é validada no backend com `CREDIT_PHASE`, permissões, integração homologada e aceite registrado. Alterar variável do frontend, esconder botão ou editar HTML não habilita crédito. Mudanças de fase atualizam conteúdo público, ferramentas da Bia e controles do servidor de forma coordenada.

### 8.6 API e operação corporativa

Documentar entradas, respostas, autenticação e erros em `contracts/openapi.yaml`. Rotas mínimas:

| Interface | Comportamento obrigatório |
|---|---|
| `POST /api/waitlist` | Criar interesse e iniciar confirmação conforme contrato abaixo |
| `POST /api/waitlist/verify` | Validar código/token, expiração e tentativas |
| `GET/PATCH /api/preferences` | Ler/alterar escolhas somente em sessão ou acesso seguro do titular |
| `POST /api/support` | Persistir solicitação, criar protocolo e encaminhar à fila |
| `GET /api/support/:id` | Consultar solicitação somente após autorização do titular ou da equipe |
| `/api/agent/*` | Mediação com Hal-AI, ferramentas permitidas e transferência humana |
| `/api/admin/*` | Operação de leads e atendimento com autenticação, MFA, papéis e auditoria |
| `/api/webhooks/*` | Apenas provedores contratados, assinatura verificada, replay/idempotência tratados |
| `GET /api/health` | Estado mínimo de processo, sem segredos, dados ou detalhes de infraestrutura |
| Verificação interna de prontidão | Verificar dependências necessárias à operação, protegida e sem vazar credenciais |

Usar validação de schema no servidor, queries parametrizadas, limites de requisição, autorização por recurso e erros estruturados. Sessões administrativas preferem cookies `HttpOnly`, `Secure` e política `SameSite` adequada, com defesa CSRF quando aplicável. Não guardar tokens administrativos em `localStorage`. Sanitizar conteúdo editorial e mensagens na exibição. Integrações externas devem ter timeout, retentativa limitada e recuperação; não reter o envio do formulário indefinidamente por indisponibilidade de um provedor.

### 8.7 Deploy, atualização e rollback restritos ao projeto

Entregar `DEPLOY_SHARED_SERVER.md` e scripts que validem todos os caminhos e parem diante de destino vazio, inesperado ou fora da raiz da Minha Folga. Scripts de implantação precisam distinguir preparação, publicação e rollback; não alterar outros websites nem rodar como root por padrão.

1. **Inventariar sem alterar:** caminhos, recursos disponíveis, runtime, gerenciador, porta reservada e configuração do domínio. Registrar o estado dos demais serviços sem coletar seus segredos.
2. **Preparar release:** instalar pelo lockfile no frontend e backend, executar verificações e gerar os builds fora da pasta pública ativa. Preferir build em CI/ambiente compatível para reduzir carga no servidor compartilhado. Compilar TypeScript antes de remover dependências de desenvolvimento do backend.
3. **Validar dados e configuração:** conferir variáveis, acesso ao banco dedicado, migrações compatíveis com a release anterior, backup e possibilidade de restauração. Segredos permanecem em `config/`, fora da release pública.
4. **Preparar host exclusivo:** produzir configuração de domínio e proxy, verificar sua validade e aplicar somente a inclusão da Minha Folga. Eventual reload gracioso do servidor web compartilhado precisa respeitar o procedimento da hospedagem; não reiniciar serviços sem necessidade.
5. **Publicar:** aplicar migrações compatíveis, promover a referência `current` e reiniciar/recarregar somente a API/worker Minha Folga com os caminhos e runtime da nova release. Documentar a ordem, o possível intervalo de indisponibilidade e a compatibilidade entre frontend antigo e API nova; não prometer zero downtime sem arquitetura validada.
6. **Verificar:** testar páginas internas por acesso direto, API, cadastro, preferências, protocolo, autenticação e bloqueios financeiros. Confirmar que a atualização não alterou configuração nem processos dos outros websites, comparando com o estado anterior.
7. **Reverter se necessário:** restaurar referência e processos da release anterior, preservando cadastros, protocolos e preferências recebidos. Rollback de código não desfaz automaticamente migração; priorizar migrações retrocompatíveis e correção para frente. Restauração de banco exige plano próprio para não perder dados posteriores.

Registrar ID da release, versões exatas, caminho do executável Node, porta, migrações, resultado das verificações e procedimento de retomada. Reter releases e assets conforme política definida; qualquer limpeza limita-se a itens identificados da Minha Folga. Não usar comandos de remoção ampla, limpeza global de cache ou parada de outros processos.

### 8.8 Contrato de cadastro

`POST /api/waitlist` recebe nome preferido, telefone, categoria de vínculo, confirmação de maioridade e escolhas de comunicação. Servidor valida e normaliza. Rejeitar campos inesperados e limitar tamanho. Não registrar o corpo completo em logs.

Registro mínimo: `lead_id` aleatório; nome; telefone cifrado; chave de deduplicação com HMAC; vínculo declarado; `contact_verified_at`; estado; preferências por finalidade; versões dos avisos; timestamps; origem/UTM permitida e não sensível. Não usar hash simples de telefone como anonimização. IP ou evidência antifraude só se necessário e por retenção definida, evitando fingerprint invasivo.

Resposta genérica de recebimento, sem informar se o número já existe. Confirmação por token/código de uso único com expiração, limite de tentativas e proteção contra disparo abusivo. Preferências por token seguro de curta validade ou sessão confirmada; nunca pelo telefone aberto na URL. Não incluir PII em query string, `localStorage`, pixels ou eventos.

Fluxo de estado: `received → verification_pending → verified → waiting → invited`; estados laterais `unsubscribed`, `expired`, `human_support`. `invited` significa somente aviso enviado quando autorizado; não aprovação de empréstimo. Auditar a origem e a mudança de preferência.

### 8.9 Respostas de interface

Validar durante interação sem punir digitação incompleta. Foco no primeiro campo inválido ao enviar. Erro de telefone: “Confira o DDD e o número.” Falha de rede: “Não foi possível concluir. Tente novamente em instantes.” Sem mensagem falsa de sucesso. Loading com texto “Enviando…”, botão bloqueado contra duplicação e anúncio acessível. Preservar campos não sensíveis durante erro sem gravá-los indiscriminadamente no dispositivo.

## 9. Dados, privacidade e segurança

Antes da coleta pública, o aviso de privacidade deve conter controlador e contato reais, dados coletados, finalidades e bases, compartilhamentos efetivos, provedores, transferências internacionais aplicáveis, critérios de retenção, direitos e canal de solicitação. Não publicar texto genérico que promete “nunca compartilhar” se WhatsApp, hospedagem ou Hal-AI processarem dados.

Proposta operacional de retenção de leads: revisão após 180 dias sem interação, seguida de exclusão ou anonimização quando não houver justificativa para continuidade. Isso é política a validar, não prazo imposto universalmente pela LGPD. Evidências mínimas de preferência e supressão podem precisar de retenção separada. Dados financeiros futuros terão políticas próprias.

Cookies essenciais ativos; analytics e publicidade não essenciais condicionados à escolha válida. Botões “Aceitar opcionais”, “Recusar opcionais” e “Configurar” igualmente acessíveis, sem bloqueio ao cadastro. Evitar scripts de marketing na primeira versão se não forem necessários. O consentimento de cookies não autoriza consulta de margem nem mensagens promocionais.

HTTPS, HSTS após validação do domínio, CSP, proteção CSRF conforme autenticação, validação no servidor, rate limit, gestão de segredos, MFA administrativo, menor privilégio, backup com restauração testada e plano de incidentes. Não expor chat completo a equipe de mídia. Produção, homologação e desenvolvimento devem ter bancos e credenciais distintos.

## 10. Métricas e aquisição

Medir no ambiente próprio: visita agregada por seção, leitura de conteúdos, pesquisa de ajuda, início de cadastro, envio recebido, contato confirmado, preferência autorizada, conversa iniciada, dúvida resolvida, transferência humana e descadastro. Acompanhar também solicitações de atendimento e tempo de resposta, conforme capacidade real. Métrica principal de aquisição antes da abertura financeira: **cadastros com contato confirmado e intenção compatível autodeclarada**, acompanhada de custo e reclamações. Não chamar essa métrica de “clientes aprovados”.

Eventos de produto terão nomes transparentes. Não enviar a plataformas de anúncios renda, dívida, CPF, margem, banco, contrato, aprovação, recusa ou mensagens, mesmo com nomes codificados. Hash não transforma dado pessoal em dado anônimo. Qualquer integração publicitária futura depende de validação das políticas vigentes da plataforma, base legal e consentimento aplicável.

Testes iniciais: H1 orientado a clareza versus tranquilidade; CTA “Quero ser avisado” versus “Quero conhecer a Minha Folga”; demonstração da Bia antes versus depois dos benefícios. Não testar aviso legal oculto, pressão artificial ou afirmação de crédito disponível. Decidir por contato confirmado e qualidade, não apenas clique.

Conteúdo inicial: “O que é CET?”, “Parcela menor e custo total”, “Como funciona o desconto em folha”, “O que observar antes de contratar”. Evitar páginas em massa geradas por IA sem revisão financeira. Não usar logotipos de empregadores como parceiros sem autorização.

## 11. Evolução para propostas reais

O website corporativo e suas páginas permanecem completos em todas as fases. Ativar `CREDIT_PHASE=PILOT` somente para grupo autorizado e após liberação jurídica, comercial e técnica. Rotas de proposta exigem autenticação adequada e autorização específica. `CREDIT_PHASE=LIVE` depende da conclusão do piloto e dos limites aprovados. A transição habilita capacidades financeiras e atualiza os textos de disponibilidade, sem exigir reconstruir o site institucional.

Cada proposta real deverá apresentar instituição responsável, valor líquido recebido, valor financiado, parcelas, prazo, datas, juros mensais/anuais, CET, total a pagar, IOF e seguro opcional quando aplicável, validade e condições. Usar dados oficiais da ferramenta; nunca completar informação ausente com uma média ou resposta do LLM. Se faltarem componentes obrigatórios, bloquear a apresentação como oferta contratável.

O cálculo do CET deve seguir a norma aplicável, com fluxos e datas, em serviço financeiro testado e homologado com o parceiro. Não tratar multiplicação da taxa mensal por 12 como taxa anual efetiva. Não somar IOF duas vezes. Não estimar economia sobre um contrato atual que o usuário não forneceu ou que não foi validado.

Comparação: manter mesmo objetivo e revelar diferenças de valor líquido, prazo, total e custos. Menor parcela pode aumentar total. Portabilidade, refinanciamento e novo empréstimo precisam de rótulos próprios. A comparação só cobrirá parceiros e propostas realmente consultados; não dizer “todo o mercado”.

O site jamais receberá aporte para um fundo ou depósito para liberar empréstimo. A formalização ocorrerá no fluxo aprovado do originador, com assinatura, identidade, averbação e rastreabilidade. A Bia não decide nem altera limites por vontade própria.

## 12. Acessibilidade, desempenho e SEO

WCAG 2.2 AA como meta: navegação por teclado, foco visível, ordem lógica, rótulos associados, erros anunciados, contraste e zoom 200%. Áreas de toque de pelo menos 44 px. Accordion com botão e `aria-expanded`; diálogos com foco controlado e retorno ao elemento de origem. Não depender de cor ou animação para informar status.

Meta de desempenho em dispositivos móveis reais: LCP até 2,5 s, INP até 200 ms e CLS até 0,1 no percentil 75 quando houver dados de campo. Antes disso, medir em laboratório sob rede/dispositivo definidos e registrar o cenário. Carregar chat e scripts opcionais sob demanda, fontes limitadas, imagens responsivas e dimensões reservadas. Não sacrificar legibilidade para obter nota.

Título SEO da home: “Minha Folga | Mais clareza para suas escolhas”. Descrição: “Conheça a Minha Folga e a Bia, nossa assistente de IA. Entenda o consignado, explore conteúdos e acompanhe a abertura da operação de crédito.” Cada página terá título, descrição, canonical e metadados sociais próprios. Gerar HTML público e sitemap a partir das rotas publicadas; excluir administração, sessões, preferências e confirmação. Homologação exige controle de acesso e bloqueio de indexação. Não tratar `robots.txt` como mecanismo de proteção.

Dados estruturados só para entidade e informações verdadeiras. Não criar `Review`, `AggregateRating`, preços, licenças ou instituição financeira fictícios. Domínio www principal, redirecionamento do domínio raiz e HTTPS. Configurar SPF, DKIM e DMARC nos serviços de e-mail que forem realmente usados.

## 13. Critérios de aceite

### Visual e conteúdo

- Todas as páginas obrigatórias da seção 5 estão completas, com conteúdo próprio, navegação e acesso direto por URL. Home, Sobre, Soluções, Produto, Bia, Conteúdos, Ajuda e Atendimento não podem ser substituídos por âncoras de uma landing única.
- Os quatro artigos iniciais têm corpo completo, fontes pertinentes e revisão registrada; busca/filtros de conteúdo e ajuda funcionam, inclusive sem resultados.
- A landing `/avise-me` faz parte do website e usa o mesmo cadastro, identidade e gestão de consentimentos.
- Conferir larguras 360, 390, 768, 1024 e 1440 px; sem rolagem horizontal e sem texto cortado.
- Logo legível, paleta aplicada, hierarquia clara; primeira dobra apresenta a empresa e seus caminhos principais. A disponibilidade financeira aparece de forma legível onde relevante.
- Todas as seções, FAQ, rotas e rodapé completos; sem `Lorem ipsum`, CNPJ fictício, falso selo, número inventado ou botão sem destino.
- Demonstração da Bia explicitamente rotulada; chat real só aparece quando integrado.

### Cadastro e comunicação

- Cadastro válido persiste e confirma contato; clique duplo não duplica envio.
- Falha de banco ou provedor nunca exibe sucesso falso; retentativa e recuperação verificadas.
- Consentimentos separados, não pré-marcados e auditáveis; recusar marketing adicional permite cadastro.
- Descadastro funciona e impede próximos disparos da finalidade revogada.
- Rate limit, código expirado, código incorreto e abuso de mensagens têm resposta segura.
- Atendimento persiste a solicitação e gera protocolo; acesso ao histórico exige autorização. A equipe consegue encaminhar e concluir a solicitação pelo painel.
- Login administrativo, MFA, permissões e auditoria funcionam no backend; pessoa sem autorização não acessa leads, contatos ou protocolos pela API.

### Fase e IA

- Em `PRE_LAUNCH`, chamadas diretas a endpoints de crédito também são negadas.
- Perguntas sobre taxa, aprovação e data não recebem promessa inventada.
- Bia não pede CPF nem documentos no cadastro; não segue instrução de usuário para ignorar política ou revelar segredos.
- Atendimento humano tem canal e horário reais; indisponibilidade não é mascarada.

### Publicação

- Controlador, razão social, CNPJ e canais reais validados; privacidade e termos revisados.
- Backup e restauração do cadastro demonstrados; permissões de acesso revisadas.
- Teste completo em celular e teclado, incluindo erro e revogação; medir desempenho no cenário definido.
- Responsável aprova conteúdo e estado da operação; plano de rollback preserva cadastros já recebidos.

### Frontend, backend e isolamento

- Frontend Vue e backend Node têm pastas, manifests, lockfiles, dependências e builds separados; instalação reproduzível sem pacotes globais novos.
- HTML das páginas públicas contém conteúdo e metadados por rota; refresh de página interna funciona. URL inexistente retorna 404; erro de API não retorna HTML da home.
- API usa porta reservada e nome de processo exclusivo. Runtime, usuário, caminhos, limites e configuração de ambiente estão documentados.
- Banco, credenciais, migrações, cache/fila e logs estão delimitados à Minha Folga. Nenhum segredo consta do bundle frontend ou do document root.
- A publicação altera somente os arquivos e a configuração específica da Minha Folga. Inventário anterior e posterior demonstra ausência de alteração de configurações/processos de outros websites; verificar os hosts existentes de forma não invasiva.
- Atualização e rollback foram verificados em homologação para a aplicação, sem comandos globais nem perda de cadastros; dependências privadas e permissões foram conferidas.
- README, contratos de API, exemplos de ambiente, guia de conteúdo e procedimento de implantação/retomada acompanham o código. Pendências de credenciais ou informações empresariais estão identificadas, sem serviços falsamente funcionais.

Esses testes verificam riscos concretos de cadastro, dinheiro, dados e comunicação; não é necessário criar testes que apenas repitam texto estático ou valores de CSS.

## 14. Sequência de implementação

1. **Definir a entrega completa:** confirmar o mapa de páginas da seção 5, identidade empresarial, conteúdo aprovado e canais. Registrar a disponibilidade de credenciais e os requisitos reais da hospedagem; não reduzir o escopo para uma landing em razão da fase financeira.
2. **Criar a base isolada:** repositório com `frontend/` Vue e `backend/` Node, locks separados, runtime definido, exemplos de ambiente, contrato de API, banco dedicado e documentação inicial de implantação.
3. **Construir o website corporativo:** design system, home, Sobre, Soluções, Consignado, Como funciona, Bia, Conteúdos e quatro artigos, Ajuda, Atendimento, Segurança, páginas legais e navegação completa. Revisar desktop e mobile em cada tipo de página.
4. **Construir relacionamento e gestão:** landing `/avise-me`, cadastro, confirmação, preferências, formulário de atendimento, protocolos e painel administrativo. Verificar persistência, autorização, recuperação e proteção contra abuso.
5. **Integrar a Bia e os canais:** Hal-AI/WhatsApp, base aprovada e bloqueios financeiros. Demonstrar integrações em ambiente de teste; se faltarem credenciais do fornecedor, entregar o código e registrar a pendência, mantendo a interface transparente sobre a disponibilidade real.
6. **Concluir conteúdo e operação:** central editorial, busca/filtros, pré-renderização, SEO por página, métricas mínimas, cookies, segurança, procedimentos de atendimento e gestão de conteúdo.
7. **Homologar o conjunto:** executar critérios de aceite do website completo, revisar informações de produto e privacidade, verificar dependências externas e documentar resultados. Preparar release, configuração exclusiva do domínio e plano de rollback. A preparação não implica publicação automática no servidor.
8. **Publicar o website completo:** quando a implantação for solicitada/autorizada, seguir o procedimento restrito ao projeto, validar DNS/HTTPS, banco, processos e funcionalidades reais, preservando os demais websites. A formalização financeira não é requisito para as páginas institucionais; coleta e atendimento dependem de identidade legal, privacidade e canais prontos.
9. **Habilitar a operação financeira depois:** seguir os marcos do plano de implantação para `PILOT` e `LIVE`, com integrações, consentimentos, testes e conteúdo de proposta próprios. Manter o website corporativo disponível durante essa evolução.

**Regra de conclusão para a IA construtora:** entregar código funcional de frontend e backend, todas as páginas e jornadas corporativas especificadas, assets, documentação e evidências dos critérios de aceite. A entrega de uma landing isolada, mesmo visualmente finalizada, não satisfaz este briefing. A implementação financeira futura não deve ser usada para adiar páginas ou funcionalidades corporativas já definidas.

## 15. Referências de pesquisa

Referências de experiência, consultadas no contexto da consolidação; não copiar layouts, assets, taxas nem textos:

- [meutudo — consignado privado](https://meutudo.com.br/consignado-privado/): CTA forte e caminho curto.
- [Neon — consignado](https://neon.com.br/emprestimos/emprestimo-consignado): linguagem acessível, foto humana e WhatsApp.
- [Creditas — consignado privado](https://www.creditas.com/emprestimo/consignado-privado): respiro, hierarquia e educação.
- [Consegue.aí](https://consegue.ai/): concorrência direta na promessa de atendimento com IA.
- [Yubbi — CLT](https://www.yubbi.app/produtos/clt): referência de automação B2B, não prova de desempenho.
- [Cleo](https://web.meetcleo.com/): personalidade de assistente e produto conversacional; contexto regulatório estrangeiro.
- [Vue — ferramentas](https://vuejs.org/guide/scaling-up/tooling.html): Vue com Vite, componentes e TypeScript.
- [Vite — implantação estática](https://vite.dev/guide/static-deploy.html): build, `dist` e limite do servidor de preview.
- [Vite — variáveis de ambiente](https://vite.dev/guide/env-and-mode.html): configuração pública e exposição de `VITE_`.
- [Vue Router — modos de histórico](https://router.vuejs.org/guide/essentials/history-mode.html): acesso direto, fallback e tratamento de rotas.
- [Node.js — versões e suporte](https://nodejs.org/en/about/previous-releases): escolha de linha LTS; revalidar no momento de implantação.
- [Express — instalação](https://expressjs.com/en/starter/installing/): backend independente e dependências locais.
- [PM2 — configuração de aplicações](https://pm2.keymetrics.io/docs/usage/application-declaration/): nome, diretório e interpretador por aplicação quando o ambiente utilizar PM2.
- [Nginx — proxy HTTP](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass): encaminhamento da API e tratamento da URI.
- [MTE — Crédito do Trabalhador](https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/credito-do-trabalhador/perguntas-frequentes): conceitos e fluxo oficial.
- [LGPD](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm): proteção de dados e direitos.

As normas e condições comerciais devem ser revistas antes da fase financeira. O site deve permanecer verdadeiro mesmo que a data de lançamento mude.
