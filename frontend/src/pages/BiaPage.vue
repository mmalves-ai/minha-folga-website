<script setup lang="ts">
import page from '@content/pages/bia.yaml'
import PhotoAsset from '@/components/site/PhotoAsset.vue'
import BiaExamplesTabs from '@/components/bia/BiaExamplesTabs.vue'
import { byWaitlist } from '@/components/pages/institutional'
import { biaOnWhatsapp, openContactPanel, webchatAvailable, whatsappContactUrl } from '@/components/site/channels'
import PageHero from '@/components/site/PageHero.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { useSeo } from '@/composables/useSeo'
import { track } from '@/services/analytics'
import { publicConfig, site } from '@/services/site'

// Experiência da Bia (seções 6.4, 6.12 e 7; decisão D1). Demonstração sempre rotulada; o atendimento real
// só aparece com o canal provisionado — nunca um chat simulado, confirmação ou protocolo fictícios.
// Chat do site da Hal-AI (preferencial) abre o painel do botão flutuante no aviso de tratamento; sem ele,
// o botão leva ao WhatsApp oficial.
useSeo({ title: page.meta.title, description: page.meta.description })

const breadcrumbs = [{ label: page.breadcrumb, to: '/bia' }]
const uses = page.demo.uses as { title: string; text: string }[]
const channelUrl = !webchatAvailable && biaOnWhatsapp ? whatsappContactUrl : null
const hasChannel = webchatAvailable || Boolean(channelUrl)
const closingText = webchatAvailable ? page.closing.liveTextWebchat : channelUrl ? page.closing.liveText : byWaitlist(page.closing.pendingText, site.nav.closedCtaText)
const humanSupport = publicConfig.channels.humanSupport
const fallbackCta = byWaitlist(page.closing.contentCta, site.nav.closedCta)
</script>

<template>
  <PageHero :title="page.hero.title" :lead="page.hero.lead" :breadcrumbs="breadcrumbs">
    <template #badge>
      <span class="badge bia-hero__badge"><AppIcon name="chat" /> {{ page.hero.badge }}</span>
    </template>
    <div class="cluster bia-hero__actions" :data-inline-contact="hasChannel ? '' : undefined">
      <button v-if="webchatAvailable" type="button" class="btn btn--primary" @click="openContactPanel('webchat')">
        {{ page.hero.webchatCta }} <AppIcon name="chat" />
      </button>
      <template v-else-if="channelUrl">
        <a :href="channelUrl" class="btn btn--primary" target="_blank" rel="noopener noreferrer" @click="track('bia_channel_click', '/bia')">
          {{ page.hero.channelCta }} <AppIcon name="external" />
          <span class="visually-hidden">{{ page.hero.channelHint }}</span>
        </a>
      </template>
      <a v-else :href="page.hero.demoCta.to" class="btn btn--primary">{{ page.hero.demoCta.label }}</a>
      <RouterLink :to="page.hero.humanCta.to" class="btn btn--secondary">{{ page.hero.humanCta.label }}</RouterLink>
    </div>
    <p v-if="!hasChannel" class="small muted bia-hero__pending">
      <span>{{ page.hero.channelPending }}</span>
    </p>
    <template #aside>
      <figure class="bia-portrait"><PhotoAsset name="bia" alt="Mulher usando seu celular em uma pausa do dia. Cena ilustrativa gerada por IA." priority sizes="(max-width: 767px) calc(100vw - 40px), 48vw" /><figcaption>Cena ilustrativa gerada por IA. A pessoa não representa a Bia.</figcaption><div class="bia-portrait__signature"><img src="/brand/hal-ai-logo.png" alt="Hal-AI" width="32" height="32" /><span>IA de suporte: <strong>Hal-AI</strong></span></div></figure>
    </template>
  </PageHero>

  <section id="demonstracao" class="section section--paper" aria-labelledby="bia-demo-titulo">
    <div class="container split split--top bia-demo-section">
      <div>
        <p class="eyebrow">{{ page.demo.eyebrow }}</p>
        <h2 id="bia-demo-titulo">{{ page.demo.title }}</h2>
        <p>{{ page.demo.text }}</p>
        <h3 class="bia-uses__title">{{ page.demo.usesTitle }}</h3>
        <ol class="bia-uses">
          <li v-for="(use, i) in uses" :key="use.title">
            <span class="bia-uses__n" aria-hidden="true">{{ i + 1 }}</span>
            <div>
              <strong>{{ use.title }}</strong>
              <span>{{ use.text }}</span>
            </div>
          </li>
        </ol>
      </div>
      <div class="bia-demo-examples"><BiaExamplesTabs id-prefix="bia-pagina" /></div>
    </div>
  </section>

  <section class="section" aria-labelledby="bia-transparencia-titulo">
    <div class="container">
      <div class="section-head">
        <p class="eyebrow">{{ page.trust.eyebrow }}</p>
        <h2 id="bia-transparencia-titulo">{{ page.trust.title }}</h2>
      </div>
      <div class="bia-trust">
        <article class="bia-trust__item" aria-labelledby="bia-ia-titulo">
          <span class="card__icon" aria-hidden="true"><AppIcon name="info" /></span>
          <h3 id="bia-ia-titulo">{{ page.trust.identity.title }}</h3>
          <p>{{ page.trust.identity.text }}</p>
        </article>
        <article class="bia-trust__item" aria-labelledby="bia-dados-titulo">
          <span class="card__icon" aria-hidden="true"><AppIcon name="lock" /></span>
          <h3 id="bia-dados-titulo">{{ page.trust.privacy.title }}</h3>
          <p>{{ page.trust.privacy.text }}</p>
          <p>{{ page.trust.privacy.sensitive }}</p>
          <RouterLink :to="page.trust.privacy.link.to" class="link-arrow">{{ page.trust.privacy.link.label }} <AppIcon name="arrow-right" /></RouterLink>
        </article>
        <article class="bia-trust__item" aria-labelledby="bia-pessoa-titulo">
          <span class="card__icon" aria-hidden="true"><AppIcon name="user" /></span>
          <h3 id="bia-pessoa-titulo">{{ page.trust.human.title }}</h3>
          <p v-if="humanSupport">{{ page.trust.human.handoff }}</p>
          <p>{{ page.trust.human.text }}</p>
          <RouterLink :to="page.trust.human.link.to" class="link-arrow">{{ page.trust.human.link.label }} <AppIcon name="arrow-right" /></RouterLink>
        </article>
      </div>
    </div>
  </section>

  <div class="bia-closing">
    <section class="section section--forest bia-closing__band" aria-labelledby="bia-final-titulo">
      <div class="container bia-closing__inner">
        <div>
          <h2 id="bia-final-titulo">{{ page.closing.title }}</h2>
          <p class="lead">{{ closingText }}</p>
        </div>
        <div class="cluster bia-closing__actions" :data-inline-contact="hasChannel ? '' : undefined">
          <button v-if="webchatAvailable" type="button" class="btn btn--light" @click="openContactPanel('webchat')">
            {{ page.hero.webchatCta }} <AppIcon name="chat" />
          </button>
          <a
            v-else-if="channelUrl"
            :href="channelUrl"
            class="btn btn--light"
            target="_blank"
            rel="noopener noreferrer"
            @click="track('bia_channel_click', '/bia')"
          >
            {{ page.hero.channelCta }} <AppIcon name="external" />
            <span class="visually-hidden">{{ page.hero.channelHint }}</span>
          </a>
          <RouterLink v-else :to="fallbackCta.to" class="btn btn--light">
            {{ fallbackCta.label }} <AppIcon name="arrow-right" />
          </RouterLink>
          <RouterLink :to="page.closing.humanCta.to" class="btn btn--outline-light">{{ page.closing.humanCta.label }}</RouterLink>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.bia-portrait { position: relative; margin: 0; }
.bia-portrait :deep(picture) { display: block; height: 510px; overflow: hidden; border-radius: 120px 24px 24px 24px; }
.bia-portrait :deep(picture img) { height: 100%; width: 100%; object-fit: cover; }
.bia-portrait figcaption { font-size: .6875rem; color: var(--mf-muted); text-align: right; margin-top: 8px; }
.bia-portrait__signature { position: absolute; bottom: 44px; left: 20px; display: flex; align-items: center; gap: 10px; background: white; border-radius: 999px; padding: 10px 18px 10px 10px; font-size: .8125rem; }
.bia-demo-examples { display: grid; gap: 32px; }
@media (max-width: 767px) { .bia-portrait :deep(picture) { height: 360px; } }

.bia-hero__badge {
  background: var(--mf-lilac);
  color: #2f2a45;
}

.bia-hero__actions {
  margin-top: var(--mf-space-5);
  gap: var(--mf-space-2) var(--mf-space-3);
}

.bia-hero__pending {
  max-width: 580px;
  margin: var(--mf-space-4) 0 0;
}

.bia-uses__title {
  margin: var(--mf-space-5) 0 var(--mf-space-2);
  font-size: 1.1875rem;
}

.bia-uses {
  list-style: none;
  margin: 0;
  padding: 0;
}

.bia-uses li {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  gap: var(--mf-space-2);
  margin: 0;
  padding-block: var(--mf-space-3);
  border-top: 1px solid var(--mf-border);
}

.bia-uses__n {
  display: inline-grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--mf-lilac);
  color: #2f2a45;
  font-weight: 700;
  font-size: 0.9375rem;
}

.bia-uses strong {
  display: block;
  font-family: var(--mf-font-heading);
}

.bia-uses span:not(.bia-uses__n) {
  display: block;
  color: var(--mf-muted);
  font-size: 0.9875rem;
}

.bia-panels {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--mf-space-4);
}

.bia-panel {
  padding: var(--mf-space-5);
  border-radius: var(--mf-radius-panel);
}

.bia-panel h2 {
  font-size: clamp(30px, 1.2vw + 18px, 34px);
}

.bia-panel--today {
  background: var(--mf-mint);
}

.bia-panel--later {
  background: var(--mf-paper);
  border: 1px dashed var(--mf-control-border);
}

.bia-panel__tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 var(--mf-space-2);
  font-size: 0.875rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mf-forest);
}

.bia-panel__tag .icon {
  width: 18px;
  height: 18px;
}

.bia-panel__list {
  display: grid;
  gap: var(--mf-space-2);
  list-style: none;
  margin: 0 0 var(--mf-space-3);
  padding: 0;
}

.bia-panel__list li {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  margin: 0;
}

.bia-panel__list .icon {
  flex: none;
  width: 20px;
  height: 20px;
  margin-top: 3px;
  color: var(--mf-forest);
}

.bia-panel__not {
  margin: 0;
  padding-top: var(--mf-space-3);
  border-top: 1px solid rgb(18 63 53 / 18%);
}

.bia-panel__intro {
  margin: 0 0 var(--mf-space-3);
  padding: 12px 16px;
  border-radius: 16px;
  background: rgb(255 255 255 / 60%);
  font-weight: 600;
}

.bia-panel__status {
  margin: 0 0 var(--mf-space-3);
}

.bia-trust {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--mf-space-5);
}

.bia-trust__item {
  padding-top: var(--mf-space-4);
  border-top: 2px solid var(--mf-forest);
}

.bia-trust__item h3 {
  font-size: 1.25rem;
}

.bia-trust__item p {
  font-size: 0.9875rem;
}

.bia-closing {
  padding: 0 var(--mf-gutter) var(--mf-space-7);
}

.bia-closing__band {
  max-width: var(--mf-container);
  margin-inline: auto;
  padding-block: var(--mf-space-7);
  border-radius: var(--mf-radius-panel);
}

.bia-closing__inner {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--mf-space-5);
  align-items: center;
}

.bia-closing .lead {
  margin-bottom: 0;
  color: var(--mf-cream);
}

.bia-closing__actions {
  gap: var(--mf-space-2) var(--mf-space-3);
}

@media (max-width: 1023px) {
  .bia-panels,
  .bia-closing__inner {
    grid-template-columns: minmax(0, 1fr);
  }

  .bia-trust {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--mf-space-4);
  }
}

@media (max-width: 767px) {
  .bia-hero__actions .btn,
  .bia-closing__actions .btn {
    flex: 1 1 100%;
  }

  .bia-panel {
    padding: var(--mf-space-4);
    border-radius: 28px;
  }

  .bia-closing {
    padding: 0 12px var(--mf-space-5);
  }

  .bia-closing__band {
    padding-block: var(--mf-space-6);
    border-radius: 28px;
  }
}
</style>
