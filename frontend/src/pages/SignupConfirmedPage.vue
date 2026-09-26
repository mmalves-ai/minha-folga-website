<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import page from '@content/pages/cadastro-confirmado.yaml'
import AvailabilityNotice from '@/components/site/AvailabilityNotice.vue'
import Breadcrumbs from '@/components/site/Breadcrumbs.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import BrowserNotifications from '@/components/site/BrowserNotifications.vue'
import BiaChannelActions from '@/components/forms/BiaChannelActions.vue'
import { officialWhatsappLink, openWebchat, webchatAvailable, whatsappNumber } from '@/composables/useBiaChannels'
import { useSeo } from '@/composables/useSeo'
import type { SignupConfirmedState } from '@/components/forms/api-types'
import type { LinkItem } from '@/types/content'
import { publicConfig, site } from '@/services/site'

/**
 * /cadastro-confirmado (noindex), decisão D1: confirma o recebimento do cadastro quando o formulário
 * desta aba recebeu 201 do servidor (marca no history.state, nunca na URL). Sem sessão ou cookie do
 * titular: não há mais confirmação por código. Explica que o telefone fica "não validado" até a
 * pessoa conversar com a Bia pelo WhatsApp oficial e oferece os próximos passos.
 * O HTML pré-renderizado mostra só o título neutro; o estado real é decidido no navegador.
 */
useSeo({ title: page.meta.title, description: page.meta.description, noindex: true })

type State = 'pending' | 'received' | 'neutral'
type IconName = 'book' | 'chat' | 'eye'

const state = ref<State>('pending')
const employmentOther = ref(false)
const announcement = ref('')

const hasWhatsapp = Boolean(whatsappNumber)
const whatsappLink = officialWhatsappLink()
const nextSteps = page.next.items as { icon: IconName; to: string; title: string; webchatTitle?: string; whatsappTitle?: string; text: string }[]
const neutralActions = (page.hero.neutralActions as LinkItem[]).map(action =>
  !publicConfig.collection.waitlistEnabled && action.to.split('#')[0] === '/avise-me' ? site.nav.closedCta as LinkItem : action,
)

const title = computed(() => (state.value === 'received' ? page.hero.successTitle : page.hero.neutralTitle))

onMounted(() => {
  const navState = (window.history.state ?? {}) as SignupConfirmedState
  if (navState.mfSignupReceived === true) {
    state.value = 'received'
    employmentOther.value = navState.mfEmploymentOther === true
    announcement.value = `${page.hero.successTitle} ${page.hero.successLead}`
  } else {
    state.value = 'neutral'
  }
})
</script>

<template>
  <div class="confirmed">
    <Breadcrumbs :items="[{ label: page.hero.breadcrumb, to: '/cadastro-confirmado' }]" />

    <section class="container container--narrow confirmed__hero" aria-labelledby="titulo-pagina">
      <div class="confirmed__mark" :class="{ 'confirmed__mark--ok': state === 'received' }" aria-hidden="true">
        <AppIcon :name="state === 'received' ? 'check-circle' : 'user'" />
      </div>
      <h1 id="titulo-pagina">{{ title }}</h1>

      <template v-if="state === 'received'">
        <p class="lead">{{ page.hero.successLead }}</p>
        <p class="small muted">{{ page.duplicateNotice }}</p>
        <div v-if="employmentOther" class="notice notice--mint confirmed__other">
          <AppIcon name="info" />
          <p>{{ page.employmentOther }}</p>
        </div>
        <AvailabilityNotice class="confirmed__availability" />
      </template>

      <template v-else-if="state === 'neutral'">
        <p class="lead">{{ page.hero.neutralLead }}</p>
        <div class="cluster confirmed__actions">
          <RouterLink v-for="(a, i) in neutralActions" :key="a.to" :to="a.to" :class="i === 0 ? 'btn btn--primary' : 'btn btn--secondary'">
            {{ a.label }}
          </RouterLink>
        </div>
      </template>

      <p class="visually-hidden" aria-live="polite">{{ announcement }}</p>
    </section>

    <div class="container container--narrow"><BrowserNotifications /></div>
    <section class="container container--narrow confirmed__guide" aria-labelledby="guia-titulo">
      <div class="confirmed__guide-card">
        <span class="card__icon" aria-hidden="true"><AppIcon name="book" /></span>
        <div>
          <p class="confirmed__guide-eyebrow">{{ page.guide.eyebrow }}</p>
          <h2 id="guia-titulo">{{ page.guide.title }}</h2>
          <p>{{ page.guide.text }}</p>
          <a :href="page.guide.to" class="btn btn--primary" download="minha-folga-guia-de-comparacao.pdf">
            {{ page.guide.label }}
            <AppIcon name="arrow-right" />
          </a>
          <p class="small muted confirmed__guide-note">{{ page.guide.note }}</p>
        </div>
      </div>
    </section>

    <!-- Validação do telefone: acontece na conversa com a Bia pelo WhatsApp oficial (número atestado pelo canal). -->
    <section v-if="state === 'received'" class="container container--narrow" aria-labelledby="validacao-titulo">
      <div class="confirmed__validation">
        <span class="card__icon" aria-hidden="true"><AppIcon name="phone" /></span>
        <div class="confirmed__validation-body">
          <h2 id="validacao-titulo" class="confirmed__validation-title">{{ page.validation.title }}</h2>
          <p>{{ hasWhatsapp ? page.validation.whatsapp : page.validation.noWhatsapp }}</p>
          <p v-if="webchatAvailable" class="small muted">{{ page.validation.webchat }}</p>
          <BiaChannelActions v-if="hasWhatsapp" whatsapp-only :whatsapp-text="page.validation.whatsappText" :show-fallback="false" />
        </div>
      </div>
    </section>

    <section class="section confirmed__next" aria-labelledby="proximos-passos">
      <div class="container container--narrow">
        <h2 id="proximos-passos" class="confirmed__next-title">{{ page.next.title }}</h2>
        <ul class="confirmed__steps">
          <li v-for="item in nextSteps" :key="item.to">
            <button v-if="item.icon === 'chat' && webchatAvailable" type="button" class="confirmed__step" data-inline-contact @click="openWebchat">
              <span class="card__icon" aria-hidden="true"><AppIcon :name="item.icon" /></span>
              <span class="confirmed__step-body">
                <strong>{{ item.webchatTitle ?? item.title }}</strong>
                <span class="muted">{{ item.text }}</span>
              </span>
              <AppIcon name="arrow-right" class="confirmed__step-arrow" />
            </button>
            <a
              v-else-if="item.icon === 'chat' && whatsappLink"
              :href="whatsappLink"
              class="confirmed__step"
              target="_blank"
              rel="noopener"
              data-inline-contact
            >
              <span class="card__icon" aria-hidden="true"><AppIcon :name="item.icon" /></span>
              <span class="confirmed__step-body">
                <strong>{{ item.whatsappTitle ?? item.title }}<span class="visually-hidden"> {{ page.next.newTab }}</span></strong>
                <span class="muted">{{ item.text }}</span>
              </span>
              <AppIcon name="external" class="confirmed__step-arrow" />
            </a>
            <RouterLink v-else :to="item.to" class="confirmed__step">
              <span class="card__icon" aria-hidden="true"><AppIcon :name="item.icon" /></span>
              <span class="confirmed__step-body">
                <strong>{{ item.title }}</strong>
                <span class="muted">{{ item.text }}</span>
              </span>
              <AppIcon name="arrow-right" class="confirmed__step-arrow" />
            </RouterLink>
          </li>
        </ul>
      </div>
    </section>
  </div>
</template>

<style scoped>
.confirmed__hero {
  padding-block: var(--mf-space-6) var(--mf-space-5);
  text-align: center;
}

.confirmed__hero .lead {
  margin-inline: auto;
}

.confirmed__mark {
  display: inline-grid;
  place-items: center;
  width: 72px;
  height: 72px;
  margin-bottom: var(--mf-space-4);
  border-radius: 50%;
  background: var(--mf-lilac);
  color: var(--mf-forest);
}

.confirmed__mark--ok {
  background: var(--mf-mint);
}

.confirmed__mark .icon {
  width: 36px;
  height: 36px;
}

.confirmed__hero h1 {
  font-size: clamp(34px, 3.4vw, 54px);
  max-width: 18ch;
  margin-inline: auto;
}

.confirmed__actions {
  justify-content: center;
  margin-top: var(--mf-space-4);
}

.confirmed__other,
.confirmed__availability {
  margin-top: var(--mf-space-4);
  text-align: left;
}

/* Guia aberto de comparação ---------------------------------------------------------------------- */
.confirmed__guide {
  margin-bottom: var(--mf-space-5);
}

.confirmed__guide-card {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr);
  gap: var(--mf-space-3);
  padding: var(--mf-space-5);
  border: 1px solid var(--mf-border);
  border-radius: var(--mf-radius-card);
  background: var(--mf-mint);
}

.confirmed__guide-card .card__icon {
  margin: 0;
  background: var(--mf-paper);
}

.confirmed__guide-eyebrow {
  margin-bottom: var(--mf-space-1);
  font-weight: 700;
  color: var(--mf-forest);
}

.confirmed__guide-card h2 {
  font-size: clamp(30px, 2vw, 32px);
  margin-bottom: var(--mf-space-2);
}

.confirmed__guide-card .btn {
  margin-top: var(--mf-space-2);
}

.confirmed__guide-note {
  margin-block: var(--mf-space-2) 0;
}

/* Validação do telefone -------------------------------------------------------------------------- */
.confirmed__validation {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr);
  gap: var(--mf-space-3);
  padding: var(--mf-space-5);
  border-radius: var(--mf-radius-card);
  background: var(--mf-paper);
  box-shadow: var(--mf-shadow-soft);
}

.confirmed__validation .card__icon {
  margin: 0;
}

.confirmed__validation-title {
  margin-bottom: 8px;
  font-size: 1.3125rem;
}

.confirmed__validation-body p {
  max-width: 62ch;
}

.confirmed__validation-body p:last-of-type {
  margin-bottom: var(--mf-space-3);
}

/* Próximos passos ------------------------------------------------------------------------------- */
.confirmed__next {
  padding-top: var(--mf-space-6);
}

.confirmed__next-title {
  font-size: clamp(24px, 1.4vw + 16px, 32px);
}

.confirmed__steps {
  list-style: none;
  margin: 0;
  padding: 0;
  border-top: 1px solid var(--mf-border);
}

.confirmed__steps li {
  margin: 0;
  border-bottom: 1px solid var(--mf-border);
}

.confirmed__step {
  width: 100%;
  border: 0;
  background: none;
  font: inherit;
  text-align: left;
  cursor: pointer;
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) 24px;
  gap: var(--mf-space-3);
  align-items: center;
  padding: var(--mf-space-3) 4px;
  color: var(--mf-ink);
  text-decoration: none;
}

.confirmed__step .card__icon {
  margin: 0;
}

.confirmed__step-body {
  display: grid;
  gap: 2px;
}

.confirmed__step-body strong {
  font-family: var(--mf-font-heading);
  font-size: 1.125rem;
  color: var(--mf-forest);
}

.confirmed__step:hover strong {
  text-decoration: underline;
}

.confirmed__step-arrow {
  width: 22px;
  height: 22px;
  color: var(--mf-forest);
  transition: transform var(--mf-duration) var(--mf-ease);
}

.confirmed__step:hover .confirmed__step-arrow,
.confirmed__step:focus-visible .confirmed__step-arrow {
  transform: translateX(3px);
}

@media (max-width: 559px) {
  .confirmed__validation,
  .confirmed__guide-card {
    grid-template-columns: minmax(0, 1fr);
    padding: var(--mf-space-4);
  }
}

/* Títulos de seção: faixa de 30–44 px da seção 3 (inclusive no celular). */
.confirmed__next-title {
  font-size: clamp(30px, 1.2vw + 18px, 36px);
}
</style>
