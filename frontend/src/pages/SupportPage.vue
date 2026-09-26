<script setup lang="ts">
import { ref } from 'vue'
import page from '@content/pages/atendimento.yaml'
import copy from '@content/pages/formularios.yaml'
import PageHero from '@/components/site/PageHero.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import SupportForm from '@/components/forms/SupportForm.vue'
import type { SupportStage } from '@/components/forms/api-types'
import { useSeo } from '@/composables/useSeo'
import {
  biaOnWhatsapp,
  humanHandoff,
  officialWhatsappLink,
  openWebchat,
  webchatAvailable,
  whatsappNumber,
} from '@/composables/useBiaChannels'
import { formatPhoneBr } from '@/lib/format'
import { publicConfig } from '@/services/site'

/**
 * /atendimento (seção 6.14): canais reais vindos da configuração pública validada, horários de
 * atendimento humano e formulário com protocolo. Dado obrigatório ausente aparece como pendência
 * (bloqueia a release pública); canais opcionais só aparecem quando configurados.
 */
useSeo({ title: page.meta.title, description: page.meta.description })

const id = publicConfig.identity
// Decisão D1: o WhatsApp oficial é hospedado na Hal-AI e atendido pela Bia; o chat do site é o canal preferencial.
const waLink = officialWhatsappLink('Olá! Quero tirar uma dúvida sobre a Minha Folga.')
// E-mail longo quebra depois do "@" em telas estreitas, não no meio do domínio.
const emailAt = id.supportContact ? id.supportContact.indexOf('@') : -1
const emailParts = id.supportContact && emailAt > 0 ? [id.supportContact.slice(0, emailAt + 1), id.supportContact.slice(emailAt + 1)] : null
const beforeItems = page.before.items as string[]
// Chat do site ou WhatsApp na lista de canais: o botão flutuante se recolhe enquanto ela está na tela.
const showsConversation = webchatAvailable || Boolean(whatsappNumber && waLink)
// A introdução do formulário só acompanha a etapa de preenchimento.
const formStage = ref<SupportStage>(publicConfig.collection.supportEnabled ? 'form' : 'unavailable')
</script>

<template>
  <div class="support-page">
    <PageHero :title="page.hero.title" :lead="page.hero.lead" :breadcrumbs="[{ label: page.hero.breadcrumb, to: '/atendimento' }]" />

    <section class="section section--flush-top" aria-label="Canais e formulário de atendimento">
      <div class="container split split--top support-page__grid">
        <div class="support-page__aside">
          <div
            class="support-channels"
            aria-labelledby="canais-titulo"
            role="region"
            :data-inline-contact="showsConversation ? '' : undefined"
          >
            <h2 id="canais-titulo" class="support-channels__title">{{ page.channels.title }}</h2>
            <p class="muted">{{ page.channels.intro }}</p>

            <ul class="support-channels__list">
              <li v-if="id.supportContact" class="support-channels__item">
                <span class="support-channels__icon" aria-hidden="true"><AppIcon name="mail" /></span>
                <div>
                  <h3 class="support-channels__label">{{ page.channels.email.label }}</h3>
                  <p class="support-channels__value">
                    <a v-if="id.supportContact" :href="`mailto:${id.supportContact}`"
                      ><template v-if="emailParts">{{ emailParts[0] }}<wbr />{{ emailParts[1] }}</template
                      ><template v-else>{{ id.supportContact }}</template></a
                    >
                  </p>
                  <p class="small muted">{{ page.channels.email.text }}</p>
                </div>
              </li>

              <li v-if="id.supportPhone" class="support-channels__item">
                <span class="support-channels__icon" aria-hidden="true"><AppIcon name="phone" /></span>
                <div>
                  <h3 class="support-channels__label">{{ page.channels.phone.label }}</h3>
                  <p class="support-channels__value">
                    <a :href="`tel:${id.supportPhone.replace(/[^\d+]/g, '')}`">{{ formatPhoneBr(id.supportPhone) }}</a>
                  </p>
                </div>
              </li>

              <li v-if="webchatAvailable" class="support-channels__item">
                <span class="support-channels__icon" aria-hidden="true"><AppIcon name="chat" /></span>
                <div>
                  <h3 class="support-channels__label">
                    {{ page.channels.webchat.label }}
                    <span class="badge badge--lilac support-channels__ai">{{ page.channels.webchat.aiBadge }}</span>
                  </h3>
                  <p class="small muted">{{ page.channels.webchat.text }}</p>
                  <p class="small muted">{{ page.channels.webchat.note }}</p>
                  <button type="button" class="btn btn--secondary btn--sm" @click="openWebchat">
                    <AppIcon name="chat" />
                    {{ copy.bia.webchat }}
                  </button>
                </div>
              </li>

              <li v-if="whatsappNumber && waLink" class="support-channels__item">
                <span class="support-channels__icon" aria-hidden="true"><AppIcon name="chat" /></span>
                <div>
                  <h3 class="support-channels__label">
                    {{ page.channels.whatsapp.label }}
                    <span v-if="biaOnWhatsapp" class="badge badge--lilac support-channels__ai">{{ page.channels.whatsapp.aiBadge }}</span>
                  </h3>
                  <p class="support-channels__value">{{ formatPhoneBr(whatsappNumber) }}</p>
                  <p class="small muted">{{ biaOnWhatsapp ? page.channels.whatsapp.bia : page.channels.whatsapp.human }}</p>
                  <p v-if="biaOnWhatsapp && humanHandoff" class="small muted">{{ page.channels.whatsapp.handoff }}</p>
                  <a :href="waLink" class="link-arrow" target="_blank" rel="noopener">
                    {{ page.channels.whatsapp.cta }}<span class="visually-hidden"> {{ page.channels.whatsapp.newTab }}</span>
                    <AppIcon name="external" />
                  </a>
                </div>
              </li>

              <li v-if="id.supportHours" class="support-channels__item">
                <span class="support-channels__icon" aria-hidden="true"><AppIcon name="clock" /></span>
                <div>
                  <h3 class="support-channels__label">{{ page.channels.hours.label }}</h3>
                  <p class="support-channels__value">
                    <template v-if="id.supportHours">{{ id.supportHours }}</template>
                  </p>
                </div>
              </li>

              <li v-if="id.supportResponseTime" class="support-channels__item">
                <span class="support-channels__icon" aria-hidden="true"><AppIcon name="calendar" /></span>
                <div>
                  <h3 class="support-channels__label">{{ page.channels.responseTime.label }}</h3>
                  <p class="support-channels__value">{{ id.supportResponseTime }}</p>
                </div>
              </li>

              <li class="support-channels__item support-channels__item--form">
                <span class="support-channels__icon" aria-hidden="true"><AppIcon name="list" /></span>
                <div>
                  <h3 class="support-channels__label">{{ page.channels.form.label }}</h3>
                  <p class="small muted">{{ page.channels.form.text }}</p>
                  <a href="#formulario-atendimento" class="link-arrow support-channels__jump">{{ page.channels.form.cta }} <AppIcon name="arrow-right" /></a>
                </div>
              </li>
            </ul>
          </div>

          <!-- Orientações de segurança ao lado do formulário (no celular, antes dele). -->
          <div class="support-before" aria-labelledby="antes-titulo" role="region">
            <p id="antes-titulo" class="support-before__title panel-label">{{ page.before.title }}</p>
            <ul class="support-before__list">
              <li v-for="item in beforeItems" :key="item">
                <AppIcon name="shield" />
                <span>{{ item }}</span>
              </li>
            </ul>
            <div class="support-before__links">
              <RouterLink :to="page.before.help.to" class="link-arrow">{{ page.before.help.label }} <AppIcon name="arrow-right" /></RouterLink>
              <RouterLink :to="page.before.security.to" class="link-arrow">{{ page.before.security.label }} <AppIcon name="arrow-right" /></RouterLink>
            </div>
          </div>
        </div>

        <div id="formulario-atendimento" class="panel support-page__form">
          <h2 class="support-page__form-title">{{ page.form.title }}</h2>
          <p v-if="formStage === 'form'" class="muted">{{ page.form.intro }}</p>
          <SupportForm :heading-level="3" @stage="formStage = $event" />
        </div>
      </div>
    </section>

    <section class="section section--paper" aria-labelledby="acompanhar-titulo">
      <div class="container">
        <div class="section-head">
          <h2 id="acompanhar-titulo">{{ page.tracking.title }}</h2>
          <p class="lead">{{ page.tracking.intro }}</p>
        </div>
        <RouterLink :to="page.tracking.trackLink.to" class="link-arrow">{{ page.tracking.trackLink.label }} <AppIcon name="arrow-right" /></RouterLink>
      </div>
    </section>
  </div>
</template>

<style scoped>
.support-page__grid {
  grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr);
  gap: var(--mf-space-6);
}

/* Canais: lista vertical com ícones, sem cartões. ------------------------------------------------ */
.support-channels__title {
  font-size: clamp(26px, 1.6vw + 14px, 34px);
}

.support-channels__list {
  list-style: none;
  margin: var(--mf-space-4) 0 0;
  padding: 0;
}

.support-channels__item {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  gap: var(--mf-space-3);
  margin: 0;
  padding: var(--mf-space-4) 0;
  border-top: 1px solid var(--mf-border);
}

.support-channels__icon {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: var(--mf-mint);
  color: var(--mf-forest);
}

.support-channels__icon .icon {
  width: 22px;
  height: 22px;
}

.support-channels__label {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  align-items: center;
  margin: 0 0 4px;
  font-family: var(--mf-font-body);
  font-size: 0.9375rem;
  font-weight: 600;
  letter-spacing: 0;
  color: var(--mf-muted);
}

.support-channels__ai {
  font-size: 0.8125rem;
}

.support-channels__value {
  margin: 0 0 4px;
  font-family: var(--mf-font-heading);
  font-size: 1.1875rem;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.support-channels__value a {
  color: var(--mf-forest);
}

.support-channels__item p.small {
  margin: 0 0 4px;
}

@media (min-width: 1024px) {
  /* No desktop o formulário está ao lado: o atalho só faz sentido no celular. */
  .support-channels__item--form {
    display: none;
  }
}

.support-page__form {
  padding: var(--mf-space-6);
}

.support-page__form-title {
  font-size: clamp(26px, 1.6vw + 14px, 34px);
  margin-bottom: 8px;
}

.support-page__form > .muted {
  margin-bottom: var(--mf-space-4);
}

@media (max-width: 1023px) {
  .support-page__grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 767px) {
  .support-page__form {
    padding: var(--mf-space-4);
  }
}

/* Acompanhamento --------------------------------------------------------------------------------- */
.support-track {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(0, 0.75fr);
  gap: var(--mf-space-6);
  align-items: start;
}

.support-track__steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--mf-space-4);
}

.support-track__steps li {
  margin: 0;
  padding-top: var(--mf-space-3);
  border-top: 2px solid var(--mf-forest);
}

.support-track__num {
  display: block;
  margin-bottom: 8px;
  font-family: var(--mf-font-heading);
  font-size: 2rem;
  font-weight: 600;
  line-height: 1;
  color: var(--mf-coral);
}

.support-track__title {
  font-size: 1.1875rem;
  margin-bottom: 8px;
}

.support-track__statuses {
  padding: var(--mf-space-4);
  border-radius: var(--mf-radius-card);
  background: var(--mf-cream);
}

.support-track__statuses dl {
  margin: 0 0 var(--mf-space-3);
}

.support-track__statuses dl > div {
  padding: 10px 0;
  border-bottom: 1px solid var(--mf-border);
}

.support-track__statuses dt {
  font-weight: 600;
}

.support-track__statuses dd {
  margin: 0;
  font-size: 0.9375rem;
  color: var(--mf-muted);
}

@media (max-width: 1023px) {
  .support-track {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--mf-space-5);
  }
}

@media (max-width: 767px) {
  .support-track__steps {
    grid-template-columns: minmax(0, 1fr);
  }
}

/* Antes de enviar (coluna dos canais) -------------------------------------------------------------- */
.support-before {
  margin-top: var(--mf-space-5);
  padding: var(--mf-space-4);
  border-radius: var(--mf-radius-card);
  background: var(--mf-mint);
}

.support-before__title {
  margin-bottom: var(--mf-space-3);
  font-size: 1.375rem;
}

.support-before__list {
  list-style: none;
  margin: 0 0 var(--mf-space-2);
  padding: 0;
  display: grid;
  gap: 12px;
}

.support-before__list li {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  margin: 0;
}

.support-before__list .icon {
  flex: none;
  width: 20px;
  height: 20px;
  margin-top: 3px;
  color: var(--mf-forest);
}

.support-before__links {
  display: grid;
  justify-items: start;
}

@media (max-width: 767px) {
  .support-before {
    padding: var(--mf-space-3) var(--mf-space-3) var(--mf-space-2);
  }
}

/* Títulos de seção: faixa de 30–44 px da seção 3 (inclusive no celular). */
.support-channels__title,
.support-page__form-title {
  font-size: clamp(30px, 1.2vw + 18px, 36px);
}
</style>
