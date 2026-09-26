<script setup lang="ts">
import faq from '@content/faq.yaml'
import page from '@content/pages/consignado-privado.yaml'
import BiaChatDemo from '@/components/bia/BiaChatDemo.vue'
import FaqAccordion from '@/components/content/FaqAccordion.vue'
import JourneySteps from '@/components/content/JourneySteps.vue'
import RichText from '@/components/content/RichText.vue'
import InstitutionalCta from '@/components/pages/InstitutionalCta.vue'
import { byWaitlist } from '@/components/pages/institutional'
import PayrollAudience from '@/components/pages/PayrollAudience.vue'
import AvailabilityNotice from '@/components/site/AvailabilityNotice.vue'
import CreditStatusBadge from '@/components/site/CreditStatusBadge.vue'
import PageHero from '@/components/site/PageHero.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { useSeo } from '@/composables/useSeo'
import { site } from '@/services/site'
import type { ChatMessage, FaqBase, LinkItem } from '@/types/content'

// Página de produto (seção 6.11) com as sete seções. O crédito está em estruturação: sem taxas,
// simulação, consulta de margem ou contratação (o CPF só entra no cadastro de interesse — decisão D1).
// A identificação "Crédito em estruturação" fica visível no topo.
useSeo({ title: page.meta.title, description: page.meta.description })

const toc = page.toc as LinkItem[]
const flow = page.what.flow as { title: string; text: string }[]
const observe = page.observe.items as { title: string; text: string }[]
const readLinks = page.observe.links as LinkItem[]
const faqItems = (faq as FaqBase).items.filter((item) => item.showOn.includes('consignado'))
const examples = site.biaExamples as { id: string; tab: string; messages: ChatMessage[] }[]
const demo = examples.find((e) => e.id === page.bia.demoExample) ?? examples[0]
// Sem canal real, as capacidades aparecem como o que a Bia fará quando o canal for ativado.
// "Registrar seu interesse" só com a coleta aberta no servidor.
const heroLead = byWaitlist(page.hero.lead as string, page.hero.leadWaitlistClosed as string)
const heroPrimary = byWaitlist(page.hero.primary as LinkItem, page.hero.primaryClosed as LinkItem)
const journeyText = byWaitlist(page.journey.text as string, page.journey.textWaitlistClosed as string)
</script>

<template>
  <PageHero :title="page.hero.title" :lead="heroLead" :breadcrumbs="page.breadcrumbs">
    <template #badge>
      <CreditStatusBadge />
    </template>
    <div class="payroll-hero__actions cluster">
      <RouterLink :to="heroPrimary.to" class="btn btn--primary">{{ heroPrimary.label }} <AppIcon name="arrow-right" /></RouterLink>
      <a :href="page.hero.secondary.to" class="btn btn--secondary">{{ page.hero.secondary.label }}</a>
    </div>
    <AvailabilityNotice class="payroll-hero__notice" microcopy />
    <template #aside>
      <nav class="payroll-toc" aria-labelledby="payroll-toc-titulo">
        <p id="payroll-toc-titulo" class="payroll-toc__title panel-label">{{ page.hero.tocTitle }}</p>
        <ol>
          <li v-for="(item, i) in toc" :key="item.to">
            <a :href="item.to"><span aria-hidden="true">{{ i + 1 }}</span> {{ item.label }}</a>
          </li>
        </ol>
      </nav>
    </template>
  </PageHero>

  <!-- 1. O que é -->
  <section id="o-que-e" class="section section--paper" aria-labelledby="o-que-e-titulo">
    <div class="container payroll-what">
      <div class="payroll-what__main">
        <h2 id="o-que-e-titulo">{{ page.what.title }}</h2>
        <RichText :html="page.what.body_md" class="payroll-what__body" />
        <p class="payroll-what__read">
          <AppIcon name="book" />
          <span>{{ page.what.readLabel }}</span>
          <RouterLink :to="page.what.articleLink.to">{{ page.what.articleLink.label }}</RouterLink>
        </p>
      </div>
      <div class="payroll-what__aside">
        <h3 class="payroll-flow__title">{{ page.what.flowTitle }}</h3>
        <ol class="payroll-flow">
          <li v-for="(step, i) in flow" :key="step.title">
            <span class="payroll-flow__dot" aria-hidden="true">{{ i + 1 }}</span>
            <div>
              <h4>{{ step.title }}</h4>
              <p>{{ step.text }}</p>
            </div>
          </li>
        </ol>
      </div>
      <div class="payroll-portability">
        <h3>{{ page.what.portability.title }}</h3>
        <p>{{ page.what.portability.text }}</p>
        <RouterLink :to="page.what.portability.link.to" class="link-arrow">
          {{ page.what.portability.link.label }} <AppIcon name="arrow-right" />
        </RouterLink>
      </div>
    </div>
  </section>

  <!-- 2. Para quem estamos preparando -->
  <PayrollAudience />

  <!-- 3. O que observar -->
  <section id="o-que-observar" class="section section--paper" aria-labelledby="o-que-observar-titulo">
    <div class="container split split--top payroll-observe">
      <div class="payroll-observe__intro">
        <h2 id="o-que-observar-titulo">{{ page.observe.title }}</h2>
        <p class="lead">{{ page.observe.text }}</p>
        <h3 class="payroll-observe__readtitle">{{ page.observe.linksTitle }}</h3>
        <ul class="payroll-observe__read">
          <li v-for="link in readLinks" :key="link.to">
            <RouterLink :to="link.to" class="link-arrow">{{ link.label }} <AppIcon name="arrow-right" /></RouterLink>
          </li>
        </ul>
      </div>
      <ol class="payroll-checklist" :aria-label="page.observe.listLabel">
        <li v-for="item in observe" :key="item.title">
          <AppIcon name="check" class="payroll-checklist__icon" />
          <div>
            <strong>{{ item.title }}</strong>
            <span>{{ item.text }}</span>
          </div>
        </li>
      </ol>
    </div>
  </section>

  <!-- 4. Como será a jornada -->
  <section id="jornada" class="section" aria-labelledby="jornada-titulo">
    <div class="container">
      <div class="section-head">
        <h2 id="jornada-titulo">{{ page.journey.title }}</h2>
        <p>{{ journeyText }}</p>
      </div>
      <JourneySteps />
      <p class="payroll-more">
        <RouterLink :to="page.journey.link.to" class="link-arrow">{{ page.journey.link.label }} <AppIcon name="arrow-right" /></RouterLink>
      </p>
    </div>
  </section>

  <!-- 5. Como a Bia ajuda -->
  <section id="bia" class="section section--forest" aria-labelledby="bia-titulo">
    <div class="container split split--top payroll-bia">
      <div>
        <p class="eyebrow">{{ page.bia.eyebrow }}</p>
        <h2 id="bia-titulo">{{ page.bia.title }}</h2>
        <p class="lead payroll-bia__lead">{{ page.bia.text }}</p>
        <RouterLink :to="page.bia.link.to" class="btn btn--light">{{ page.bia.link.label }} <AppIcon name="arrow-right" /></RouterLink>
      </div>
      <BiaChatDemo v-if="demo" :messages="demo.messages" :title="page.bia.demoTitle" :note="site.biaExamplesNote" />
    </div>
  </section>

  <!-- 6. Dúvidas do produto -->
  <section id="duvidas" class="section section--paper" aria-labelledby="duvidas-titulo">
    <div class="container split split--top payroll-faq">
      <div>
        <h2 id="duvidas-titulo">{{ page.faq.title }}</h2>
        <p>{{ page.faq.text }}</p>
        <RouterLink :to="page.faq.link.to" class="link-arrow">{{ page.faq.link.label }} <AppIcon name="arrow-right" /></RouterLink>
      </div>
      <FaqAccordion :items="faqItems" id-prefix="consignado-faq" />
    </div>
  </section>

  <!-- 7. Receba o aviso -->
  <InstitutionalCta
    id="consignado-cta"
    anchor-id="receba-o-aviso"
    :title="page.closing.title"
    :text="page.closing.text"
    :primary="page.closing.primary"
    background="paper"
    availability
    joined
  />
</template>

<style scoped>
.payroll-hero__actions {
  margin-top: var(--mf-space-5);
  gap: var(--mf-space-2) var(--mf-space-3);
}

.payroll-hero__notice {
  max-width: 620px;
  margin-top: var(--mf-space-4);
}

.payroll-toc {
  padding: var(--mf-space-4);
  border-radius: var(--mf-radius-card);
  background: var(--mf-paper);
  border: 1px solid var(--mf-border);
}

.payroll-toc__title {
  margin-bottom: var(--mf-space-1);
  font-family: var(--mf-font-body);
  font-size: 0.875rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mf-muted);
}

.payroll-toc ol {
  list-style: none;
  margin: 0;
  padding: 0;
}

.payroll-toc li {
  margin: 0;
}

.payroll-toc li + li {
  border-top: 1px solid var(--mf-border);
}

.payroll-toc a {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 46px;
  color: var(--mf-ink);
  font-weight: 500;
  text-decoration: none;
}

.payroll-toc a:hover {
  color: var(--mf-forest);
  text-decoration: underline;
}

.payroll-toc a span {
  display: inline-grid;
  flex: none;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--mf-mint);
  color: var(--mf-forest);
  font-size: 0.8125rem;
  font-weight: 700;
}

/* Desktop: texto e portabilidade à esquerda, etapas do pagamento à direita.
   Telas menores: texto → etapas → portabilidade (tema secundário por último). */
/* Tablet: o índice fica abaixo do texto de abertura; em duas colunas ele não alonga a dobra. */
@media (min-width: 768px) and (max-width: 1023px) {
  .payroll-toc ol {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-template-rows: repeat(4, auto);
    grid-auto-flow: column;
    column-gap: var(--mf-space-5);
  }

  .payroll-toc li {
    border-top: 1px solid var(--mf-border);
  }

  .payroll-toc li:nth-child(1),
  .payroll-toc li:nth-child(5) {
    border-top: 0;
  }
}

.payroll-what {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
  grid-template-rows: auto 1fr;
  grid-template-areas:
    'main flow'
    'port flow';
  gap: var(--mf-space-5) var(--mf-space-7);
  align-items: start;
}

.payroll-what__main {
  grid-area: main;
}

.payroll-what__aside {
  grid-area: flow;
}

.payroll-what__body {
  max-width: 62ch;
  font-size: 1.0625rem;
}

.payroll-what__read {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  margin: var(--mf-space-4) 0 0;
  font-weight: 600;
}

.payroll-what__read .icon {
  width: 20px;
  height: 20px;
  color: var(--mf-forest);
}

.payroll-what__read a {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
}

.payroll-flow__title {
  margin-bottom: var(--mf-space-3);
  font-size: 1.1875rem;
}

.payroll-flow {
  position: relative;
  list-style: none;
  margin: 0;
  padding: 0;
}

.payroll-flow li {
  position: relative;
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr);
  gap: var(--mf-space-3);
  margin: 0;
  padding-bottom: var(--mf-space-4);
}

/* Linha que liga as etapas do pagamento. */
.payroll-flow li:not(:last-child)::before {
  content: '';
  position: absolute;
  top: 40px;
  bottom: 0;
  left: 19px;
  width: 2px;
  background: var(--mf-mint-strong);
}

.payroll-flow__dot {
  display: inline-grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--mf-mint);
  color: var(--mf-forest);
  font-family: var(--mf-font-heading);
  font-weight: 600;
}

.payroll-flow h4 {
  margin: 8px 0 4px;
}

.payroll-flow p {
  margin: 0;
  color: var(--mf-muted);
}

.payroll-portability {
  grid-area: port;
  max-width: 62ch;
  padding: var(--mf-space-4);
  border-radius: 20px;
  background: var(--mf-lilac);
}

.payroll-portability h3 {
  margin-bottom: var(--mf-space-1);
  font-size: 1.125rem;
}

.payroll-portability p {
  margin-bottom: 4px;
  font-size: 0.9875rem;
}

/* A lista é longa: no desktop o enunciado acompanha a leitura. */
@media (min-width: 1024px) {
  .payroll-observe__intro {
    position: sticky;
    top: calc(var(--mf-header-height) + var(--mf-space-4));
  }
}

.payroll-observe__readtitle {
  margin: var(--mf-space-5) 0 4px;
  font-family: var(--mf-font-body);
  font-size: 0.875rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mf-muted);
}

.payroll-observe__read {
  list-style: none;
  margin: 0;
  padding: 0;
}

.payroll-observe__read {
  display: grid;
  gap: var(--mf-space-1);
}

.payroll-observe__read li {
  margin: 0;
}

.payroll-checklist {
  list-style: none;
  margin: 0;
  padding: 0;
  border-radius: var(--mf-radius-card);
  border: 1px solid var(--mf-border);
  background: var(--mf-cream);
}

.payroll-checklist li {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: var(--mf-space-2);
  margin: 0;
  padding: var(--mf-space-3) var(--mf-space-4);
}

.payroll-checklist li + li {
  border-top: 1px solid var(--mf-border);
}

.payroll-checklist__icon {
  width: 22px;
  height: 22px;
  margin-top: 2px;
  color: var(--mf-forest);
}

.payroll-checklist strong {
  display: block;
  font-family: var(--mf-font-heading);
  font-size: 1.0625rem;
}

.payroll-checklist span {
  display: block;
  color: var(--mf-muted);
  font-size: 0.9875rem;
}

.payroll-more {
  margin: var(--mf-space-4) 0 0;
}

.payroll-bia__lead {
  color: var(--mf-cream);
}

.payroll-bia__lists {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--mf-space-4);
  margin-block: var(--mf-space-4);
}

.payroll-bia__lists h3 {
  margin-bottom: var(--mf-space-2);
  font-family: var(--mf-font-body);
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: 0;
}

.payroll-bia__lists ul {
  display: grid;
  gap: var(--mf-space-1);
  list-style: none;
  margin: 0;
  padding: 0;
}

.payroll-bia__lists li {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  margin: 0;
  font-size: 0.9875rem;
}

.payroll-bia__lists .icon {
  flex: none;
  width: 18px;
  height: 18px;
  margin-top: 3px;
}

.payroll-bia__handoff {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  margin-bottom: var(--mf-space-2);
}

.payroll-bia__handoff .icon {
  flex: none;
  width: 20px;
  height: 20px;
  margin-top: 3px;
}

.payroll-bia__handoff a {
  font-weight: 600;
}

.payroll-bia__pending {
  margin-bottom: var(--mf-space-4);
  color: var(--mf-cream-on-dark-muted);
  font-size: 0.9375rem;
}

.payroll-faq {
  grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr);
}

@media (max-width: 1023px) {
  .payroll-what,
  .payroll-faq {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--mf-space-5);
  }

  .payroll-what {
    grid-template-rows: none;
    grid-template-areas:
      'main'
      'flow'
      'port';
  }
}

@media (max-width: 767px) {
  .payroll-hero__actions .btn {
    flex: 1 1 100%;
  }

  .payroll-bia__lists {
    grid-template-columns: minmax(0, 1fr);
  }

  .payroll-checklist li {
    padding: var(--mf-space-3);
  }
}
</style>
