<script setup lang="ts">
import page from '@content/pages/solucoes.yaml'
import InstitutionalCta from '@/components/pages/InstitutionalCta.vue'
import { byWaitlist } from '@/components/pages/institutional'
import AvailabilityNotice from '@/components/site/AvailabilityNotice.vue'
import CreditStatusBadge from '@/components/site/CreditStatusBadge.vue'
import PageHero from '@/components/site/PageHero.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { useSeo } from '@/composables/useSeo'
import { site } from '@/services/site'
import type { ChatMessage, LinkItem } from '@/types/content'

// Visão das soluções (seção 6.11): somente o consignado em estruturação e dois serviços de apoio.
useSeo({ title: page.meta.title, description: page.meta.description })

const breadcrumbs = [{ label: page.breadcrumb, to: '/solucoes' }]
const explore = page.consignado.explore as LinkItem[]
const secondary = byWaitlist(page.consignado.secondary as LinkItem, page.consignado.secondaryClosed as LinkItem)
const biaPoints = page.support.bia.points as string[]
// Trecho do roteiro do hero (parcela menor x custo total), sempre com o rótulo de exemplo visível.
const heroDemo = site.heroDemo as { label: string; note: string; messages: ChatMessage[] }
const sample = heroDemo.messages.slice(0, 2)
</script>

<template>
  <PageHero :title="page.hero.title" :lead="page.hero.lead" :eyebrow="page.hero.eyebrow" :breadcrumbs="breadcrumbs">
    <template #badge><CreditStatusBadge /></template>
    <div class="cluster sol-product__actions">
      <RouterLink :to="secondary.to" class="btn btn--primary">{{ secondary.label }} <AppIcon name="arrow-right" /></RouterLink>
      <RouterLink :to="page.consignado.primary.to" class="btn btn--secondary">{{ page.consignado.primary.label }}</RouterLink>
    </div>
  </PageHero>

  <section id="consignado" class="section section--paper" aria-labelledby="sol-consignado-titulo">
    <div class="container sol-product">
      <div class="sol-product__main">
        <div class="cluster">
          <p class="eyebrow sol-product__eyebrow">{{ page.consignado.eyebrow }}</p>
        </div>
        <h2 id="sol-consignado-titulo">{{ page.consignado.title }}</h2>
        <p class="lead">{{ page.consignado.text }}</p>
        <div class="cluster sol-product__actions">
          <RouterLink :to="page.consignado.primary.to" class="btn btn--primary">
            {{ page.consignado.primary.label }} <AppIcon name="arrow-right" />
          </RouterLink>
          <RouterLink :to="secondary.to" class="btn btn--secondary">{{ secondary.label }}</RouterLink>
        </div>
        <AvailabilityNotice class="sol-product__notice" />
      </div>

      <nav class="sol-product__explore" aria-labelledby="sol-explorar-titulo">
        <h3 id="sol-explorar-titulo">{{ page.consignado.exploreTitle }}</h3>
        <ol>
          <li v-for="(item, i) in explore" :key="item.to">
            <RouterLink :to="item.to">
              <span class="sol-product__index" aria-hidden="true">{{ String(i + 1).padStart(2, '0') }}</span>
              <span>{{ item.label }}</span>
              <AppIcon name="arrow-right" />
            </RouterLink>
          </li>
        </ol>
      </nav>
    </div>
  </section>

  <section id="apoio" class="section" aria-labelledby="sol-apoio-titulo">
    <div class="container">
      <div class="section-head">
        <p class="eyebrow">{{ page.support.eyebrow }}</p>
        <h2 id="sol-apoio-titulo">{{ page.support.title }}</h2>
        <p>{{ page.support.text }}</p>
      </div>

      <div class="sol-support">
        <article class="sol-support__item sol-support__item--bia" aria-labelledby="sol-bia-titulo">
          <span class="badge badge--outline">{{ page.support.tag }}</span>
          <h3 id="sol-bia-titulo">{{ page.support.bia.title }}</h3>
          <p>{{ page.support.bia.text }}</p>
          <ul class="sol-support__points">
            <li v-for="point in biaPoints" :key="point"><AppIcon name="check" /> {{ point }}</li>
          </ul>
          <figure class="sol-sample" :aria-label="heroDemo.label">
            <span class="badge badge--outline">{{ heroDemo.label }}</span>
            <ol class="chat sol-sample__chat">
              <li v-for="(m, i) in sample" :key="i" class="chat__row" :class="m.from === 'person' ? 'chat__row--person' : 'chat__row--bia'">
                <p class="bubble" :class="m.from === 'person' ? 'bubble--person' : 'bubble--bia'">
                  <span class="bubble__author">{{ m.from === 'person' ? 'Pessoa' : 'Bia · IA' }}</span>
                  {{ m.text }}
                </p>
              </li>
            </ol>
            <figcaption class="sol-sample__note">{{ heroDemo.note }}</figcaption>
          </figure>
          <RouterLink :to="page.support.bia.cta.to" class="btn btn--secondary sol-support__cta">
            {{ page.support.bia.cta.label }} <AppIcon name="arrow-right" />
          </RouterLink>
        </article>

        <article class="sol-support__item sol-support__item--content" aria-labelledby="sol-conteudos-titulo">
          <span class="badge badge--outline">{{ page.support.tag }}</span>
          <h3 id="sol-conteudos-titulo">{{ page.support.content.title }}</h3>
          <p>{{ page.support.content.text }}</p>

          <RouterLink :to="page.support.content.cta.to" class="btn btn--secondary sol-support__cta">
            {{ page.support.content.cta.label }} <AppIcon name="arrow-right" />
          </RouterLink>
        </article>
      </div>


    </div>
  </section>

  <InstitutionalCta
    id="sol-cta"
    :title="page.closing.title"
    :text="page.closing.text"
    :primary="page.closing.primary"
    :secondary="page.closing.secondary"
    availability
    joined
  />
</template>

<style scoped>
.sol-overview {
  padding: var(--mf-space-5);
  border-radius: var(--mf-radius-card);
  background: var(--mf-paper);
  box-shadow: var(--mf-shadow);
}

.sol-overview__title {
  margin-bottom: var(--mf-space-2);
  font-family: var(--mf-font-body);
  font-size: 0.875rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mf-muted);
}

.sol-overview__list {
  margin: 0;
}

.sol-overview__list > div {
  display: grid;
  gap: 6px;
  padding-block: var(--mf-space-3);
  border-top: 1px solid var(--mf-border);
}

.sol-overview__list dt a {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  font-family: var(--mf-font-heading);
  font-size: 1.1875rem;
  font-weight: 600;
  color: var(--mf-ink);
  text-decoration: none;
}

.sol-overview__list dt a:hover {
  color: var(--mf-forest);
  text-decoration: underline;
}

.sol-overview__list dd {
  margin: 0;
}

.sol-product {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(0, 0.75fr);
  gap: var(--mf-space-7);
  align-items: start;
}

.sol-product__eyebrow {
  margin: 0;
}

.sol-product__main h2 {
  margin-top: var(--mf-space-3);
  font-size: clamp(32px, 2.2vw + 12px, 44px); /* teto do H2 na seção 3 */
}

.sol-product__actions {
  margin-top: var(--mf-space-5);
  gap: var(--mf-space-2) var(--mf-space-3);
}

.sol-product__notice {
  max-width: 600px;
  margin-top: var(--mf-space-4);
}

.sol-product__explore {
  padding: var(--mf-space-4) var(--mf-space-4) var(--mf-space-2);
  border-radius: var(--mf-radius-card);
  background: var(--mf-cream);
}

.sol-product__explore h3 {
  margin: 0 0 var(--mf-space-1);
  font-family: var(--mf-font-body);
  font-size: 0.875rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mf-muted);
}

.sol-product__explore ol {
  list-style: none;
  margin: 0;
  padding: 0;
}

.sol-product__explore li {
  margin: 0;
}

.sol-product__explore li + li {
  border-top: 1px solid var(--mf-border);
}

.sol-product__explore a {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) 20px;
  gap: var(--mf-space-2);
  align-items: center;
  min-height: 56px;
  padding-block: 10px;
  color: var(--mf-ink);
  font-weight: 600;
  text-decoration: none;
}

.sol-product__explore a:hover {
  color: var(--mf-forest);
}

.sol-product__explore a:hover span:nth-child(2) {
  text-decoration: underline;
}

.sol-product__explore .icon {
  width: 18px;
  height: 18px;
  color: var(--mf-forest);
  transition: transform var(--mf-duration) var(--mf-ease);
}

.sol-product__explore a:hover .icon,
.sol-product__explore a:focus-visible .icon {
  transform: translateX(3px);
}

.sol-product__index {
  font-family: var(--mf-font-heading);
  font-size: 0.9375rem;
  color: var(--mf-forest);
}

.sol-support {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--mf-space-4);
}

.sol-support__item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: var(--mf-space-5);
  border-radius: var(--mf-radius-card);
}

.sol-support__item--bia {
  background: var(--mf-lilac);
}

.sol-support__item--content {
  background: var(--mf-paper);
  border: 1px solid var(--mf-border);
}

.sol-support__item h3 {
  margin: var(--mf-space-3) 0 var(--mf-space-1);
}

.sol-support__points {
  display: grid;
  gap: var(--mf-space-1);
  list-style: none;
  margin: 0 0 var(--mf-space-4);
  padding: 0;
}

.sol-support__points li {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  margin: 0;
}

.sol-support__points .icon {
  flex: none;
  width: 20px;
  height: 20px;
  margin-top: 3px;
  color: var(--mf-forest);
}

.sol-sample {
  width: 100%;
  margin: 0 0 var(--mf-space-4);
  padding: var(--mf-space-3);
  border-radius: 20px;
  background: var(--mf-paper);
}

.sol-sample__chat {
  list-style: none;
  margin: var(--mf-space-2) 0;
  padding: 0;
}

.sol-sample__chat li {
  margin: 0;
}

.sol-sample__chat .bubble {
  margin: 0;
}

.sol-sample__note {
  font-size: 0.875rem;
  color: var(--mf-muted);
}

.sol-support__listtitle {
  margin: 0 0 4px;
  font-size: 0.875rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mf-muted);
}

.sol-support__articles {
  width: 100%;
  list-style: none;
  margin: 0 0 var(--mf-space-4);
  padding: 0;
}

.sol-support__articles li {
  margin: 0;
  padding-bottom: var(--mf-space-2);
  border-bottom: 1px solid var(--mf-border);
}

.sol-support__articles a {
  display: inline-flex;
  align-items: center;
  min-height: 48px;
  font-weight: 600;
}

.sol-support__summary {
  max-width: 60ch;
  margin: 0;
}

.sol-support__time {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 4px 0 0;
}

.sol-support__time .icon {
  width: 16px;
  height: 16px;
}

.sol-support__cta {
  margin-top: auto;
}

.sol-scope {
  max-width: 820px;
  margin-top: var(--mf-space-5);
}

@media (max-width: 1023px) {
  .sol-product {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--mf-space-5);
  }
}

/* Tablet: o quadro de situação fica abaixo do título, em três colunas, sem alongar a dobra. */
@media (min-width: 768px) and (max-width: 1023px) {
  .sol-overview__list {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0 var(--mf-space-4);
  }

  .sol-overview__list > div {
    align-content: start;
  }
}

@media (max-width: 767px) {
  .sol-overview,
  .sol-support__item {
    padding: var(--mf-space-4);
  }

  .sol-support {
    grid-template-columns: minmax(0, 1fr);
  }

  .sol-product__actions .btn,
  .sol-support__cta {
    width: 100%;
  }
}
</style>
