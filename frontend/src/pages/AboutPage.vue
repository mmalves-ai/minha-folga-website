<script setup lang="ts">
import page from '@content/pages/sobre.yaml'
import PhotoAsset from '@/components/site/PhotoAsset.vue'
import AboutIdentity from '@/components/pages/AboutIdentity.vue'
import InstitutionalCta from '@/components/pages/InstitutionalCta.vue'
import InstitutionalNextLinks from '@/components/pages/InstitutionalNextLinks.vue'
import type { IconLink } from '@/components/pages/institutional'
import CreditStatusBadge from '@/components/site/CreditStatusBadge.vue'
import PageHero from '@/components/site/PageHero.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { useSeo } from '@/composables/useSeo'
import { site } from '@/services/site'

// Apresentação da empresa (seção 6.10): propósito, forma de trabalhar, princípios e identidade real.
useSeo({ title: page.meta.title, description: page.meta.description })

const breadcrumbs = [{ label: page.breadcrumb, to: '/sobre' }]
const principles = page.principles.items as { title: string; text: string }[]
const more = page.identity.more as IconLink[]
const closingText = page.closing.text
</script>

<template>
  <PageHero :title="page.hero.title" :lead="page.hero.lead" :eyebrow="page.hero.eyebrow" :breadcrumbs="breadcrumbs">
    <template #aside>
      <figure class="about-photo"><PhotoAsset name="conversation" alt="Duas pessoas conversando à mesa em casa. Cena ilustrativa gerada por IA, não representa a equipe ou clientes." priority sizes="(max-width: 767px) calc(100vw - 40px), 48vw" /><figcaption>Imagem ilustrativa gerada por IA. Não representa clientes ou equipe.</figcaption></figure>
      <div class="about-promise">
        
        
        <p class="about-promise__text">{{ site.brand.promise }}</p>
        
      </div>
    </template>
  </PageHero>

  <section class="section section--paper" aria-labelledby="sobre-forma-titulo">
    <div class="container about-way">
      <h2 id="sobre-forma-titulo">{{ page.way.title }}</h2>
      <p class="about-way__text">{{ page.way.text }}</p>
    </div>
  </section>

  <section class="section" aria-labelledby="sobre-principios-titulo">
    <div class="container">
      <div class="section-head">
        <p class="eyebrow">{{ page.principles.eyebrow }}</p>
        <h2 id="sobre-principios-titulo">{{ page.principles.title }}</h2>
      </div>
      <ol class="about-principles">
        <li v-for="(p, i) in principles" :key="p.title" class="about-principles__item">
          <span class="about-principles__number" aria-hidden="true">{{ String(i + 1).padStart(2, '0') }}</span>
          <h3 class="about-principles__title">{{ p.title }}</h3>
          <p class="about-principles__text">{{ p.text }}</p>
        </li>
      </ol>
    </div>
  </section>

  <section class="section section--paper section--tight" aria-labelledby="sobre-momento-titulo">
    <div class="container about-status">
      <div class="about-status__head">
        <CreditStatusBadge />
        <h2 id="sobre-momento-titulo">{{ page.status.title }}</h2>
      </div>
      <div>
        <p>{{ page.status.text }}</p>
        <RouterLink :to="page.status.link.to" class="link-arrow">{{ page.status.link.label }} <AppIcon name="arrow-right" /></RouterLink>
      </div>
    </div>
  </section>

  <section class="section" aria-labelledby="sobre-identidade-titulo">
    <div class="container about-id">
      <div>
        <div class="section-head">
          <p class="eyebrow">{{ page.identity.eyebrow }}</p>
          <h2 id="sobre-identidade-titulo">{{ page.identity.title }}</h2>
          <p>{{ page.identity.text }}</p>
        </div>
        <details class="about-legal"><summary>{{ page.identity.title }}</summary><AboutIdentity /></details>
      </div>
      <aside class="about-id__more" aria-labelledby="sobre-mais-titulo">
        <h3 id="sobre-mais-titulo">{{ page.identity.moreTitle }}</h3>
        <InstitutionalNextLinks :items="more" :label="page.identity.moreTitle" layout="column" :heading-level="4" />
      </aside>
    </div>
  </section>

  <InstitutionalCta id="sobre-cta" :title="page.closing.title" :text="closingText" :primary="page.closing.primary" joined />
</template>

<style scoped>
.about-legal summary { min-height: 48px; display: list-item; padding-block: 12px; font-weight: 600; cursor: pointer; }
.about-legal[open] summary { margin-bottom: 16px; }
.about-photo { margin: 0 0 20px; }
.about-photo :deep(picture) { display: block; border-radius: 24px 100px 24px 24px; overflow: hidden; }
.about-photo figcaption { font-size: .6875rem; color: var(--mf-muted); margin-top: 8px; }

/* Promessa da marca ao lado do título: símbolo com respiro, sem foto nem história inventada. */
.about-promise {
  position: relative;
  margin: 0;
  padding: 24px;
  border-radius: var(--mf-radius-panel);
  background: var(--mf-mint);
  overflow: hidden;
}

.about-promise__symbol {
  width: 72px;
  height: auto;
  margin-bottom: var(--mf-space-5);
}

.about-promise__label {
  margin-bottom: var(--mf-space-1);
  font-size: 0.875rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mf-forest);
}

.about-promise__text {
  margin: 0 0 var(--mf-space-4);
  font-family: var(--mf-font-heading);
  font-size: clamp(1.625rem, 1.4vw + 1rem, 2.125rem);
  font-weight: 500;
  line-height: 1.2;
  letter-spacing: -0.02em;
  color: var(--mf-ink);
  text-wrap: balance;
}

.about-promise__signature {
  margin: 0;
  padding-top: var(--mf-space-3);
  border-top: 1px solid rgb(18 63 53 / 18%);
  font-weight: 600;
  color: var(--mf-forest);
}

.about-way {
  display: grid;
  grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr);
  gap: var(--mf-space-6);
  align-items: start;
}

.about-way h2 {
  margin: 0;
}

.about-way__text {
  margin: 0;
  font-family: var(--mf-font-heading);
  font-size: clamp(1.25rem, 0.9vw + 1rem, 1.625rem);
  font-weight: 400;
  line-height: 1.5;
  letter-spacing: -0.01em;
  color: var(--mf-ink);
}

.about-principles {
  list-style: none;
  margin: 0;
  padding: 0;
  border-top: 1px solid var(--mf-border);
}

.about-principles__item {
  display: grid;
  grid-template-columns: 96px minmax(0, 0.9fr) minmax(0, 1.1fr);
  gap: var(--mf-space-4);
  align-items: baseline;
  margin: 0;
  padding-block: var(--mf-space-5);
  border-bottom: 1px solid var(--mf-border);
}

.about-principles__number {
  font-family: var(--mf-font-heading);
  font-size: 2.25rem;
  font-weight: 600;
  line-height: 1;
  color: var(--mf-forest);
}

.about-principles__title {
  margin: 0;
}

.about-principles__text {
  margin: 0;
  font-size: 1.0625rem;
}

.about-status {
  display: grid;
  grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr);
  gap: var(--mf-space-4) var(--mf-space-6);
  align-items: start;
}

.about-status__head h2 {
  margin: var(--mf-space-2) 0 0;
  font-size: clamp(30px, 1.2vw + 18px, 34px);
}

.about-status p {
  margin-bottom: var(--mf-space-1);
  max-width: 62ch;
}

.about-id {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
  gap: var(--mf-space-6);
  align-items: start;
}

.about-id .section-head {
  margin-bottom: var(--mf-space-5);
}

.about-id__more {
  padding-top: var(--mf-space-2);
}

.about-id__more h3 {
  margin-bottom: var(--mf-space-3);
  font-size: 1.25rem;
}

@media (max-width: 1023px) {
  .about-way,
  .about-status,
  .about-id {
    grid-template-columns: minmax(0, 1fr);
  }

  .about-way {
    gap: var(--mf-space-4);
  }

  .about-principles__item {
    grid-template-columns: 72px minmax(0, 1fr);
  }

  .about-principles__text {
    grid-column: 2;
  }
}

/* Tablet: o painel ocupa a largura toda; o símbolo vai para o lado para não alongar a dobra. */
@media (min-width: 768px) and (max-width: 1023px) {
  .about-promise {
    display: grid;
    grid-template-columns: 72px minmax(0, 1fr);
    column-gap: var(--mf-space-5);
    padding: var(--mf-space-5);
  }

  .about-promise__symbol {
    grid-row: 1 / span 3;
    margin: 4px 0 0;
  }
}

@media (max-width: 767px) {
  .about-promise {
    padding: var(--mf-space-5) var(--mf-space-4) var(--mf-space-4);
    border-radius: 28px;
  }

  .about-promise__symbol {
    width: 56px;
    margin-bottom: var(--mf-space-4);
  }

  .about-principles__item {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--mf-space-2);
    padding-block: var(--mf-space-4);
  }

  .about-principles__text {
    grid-column: auto;
  }

  .about-principles__number {
    font-size: 1.75rem;
  }
}
</style>
