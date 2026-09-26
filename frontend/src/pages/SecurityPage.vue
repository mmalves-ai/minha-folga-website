<script setup lang="ts">
import articles from 'virtual:mf-articles'
import page from '@content/pages/seguranca.yaml'
import ArticleCard from '@/components/content/ArticleCard.vue'
import PageHero from '@/components/site/PageHero.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { useSeo } from '@/composables/useSeo'
import { biaOnWhatsapp, openContactPanel, webchatAvailable, whatsappContactUrl } from '@/components/site/channels'
import { formatPhoneBr } from '@/lib/format'
import { publicConfig, SITE_URL } from '@/services/site'
import type { LinkItem } from '@/types/content'

useSeo({ title: page.meta.title, description: page.meta.description })

type IconName = InstanceType<typeof AppIcon>['$props']['name']

/**
 * /seguranca. Canais oficiais vêm somente da configuração pública validada: o e-mail de atendimento
 * (identidade obrigatória, que o build estrito exige) aparece como pendência enquanto não configurado;
 * telefone, WhatsApp e chat do site são opcionais e só aparecem quando existirem (sem configuração, o
 * recurso está desligado). WhatsApp e chat do site são da plataforma Hal-AI (decisão D1).
 * O que se diz da Bia acompanha os canais reais: encaminhamento a uma pessoa só com um canal da Bia e
 * atendimento humano ativos. Sem promessas de criptografia, monitoramento ou certificação e sem selo próprio.
 */
const id = publicConfig.identity
const host = new URL(SITE_URL).host
const withHost = (text: string) => text.replaceAll('{dominio}', host)

function contactHref(value: string | null): string | null {
  if (!value) return null
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return `mailto:${value}`
  if (/^https:\/\//.test(value)) return value
  return null
}

interface Channel {
  key: string
  icon: IconName
  label: string
  value: string | null
  href?: string | null
  hint?: string
  /** Rótulo do marcador exibido quando o dado ainda não foi configurado. */
  pending?: string
  /** O valor é um botão que abre o chat do site (painel do botão flutuante). */
  opensWebchat?: boolean
}

const t = page.channels
const whatsapp = publicConfig.channels.whatsappNumber
const channels: Channel[] = [
  { key: 'site', icon: 'lock', label: t.site, value: host, hint: withHost(t.siteHint) },
  {
    key: 'email',
    icon: 'mail',
    label: t.email,
    value: id.supportContact,
    href: contactHref(id.supportContact),
    pending: 'e-mail de atendimento',
  },
  ...(id.supportPhone
    ? [{ key: 'phone', icon: 'phone' as IconName, label: t.phone, value: formatPhoneBr(id.supportPhone), href: `tel:${id.supportPhone}` }]
    : []),
  // WhatsApp oficial só com número confirmado; sem ele, o recurso está desligado e a linha não existe.
  ...(whatsapp
    ? [
        {
          key: 'whatsapp',
          icon: 'chat' as IconName,
          label: t.whatsapp,
          value: formatPhoneBr(whatsapp),
          href: whatsappContactUrl,
          hint: biaOnWhatsapp ? t.whatsappHintBia : t.whatsappHint,
        },
      ]
    : []),
  // Chat do site da Hal-AI, só habilitado e válido; o script continua carregando só depois do aviso.
  ...(webchatAvailable
    ? [{ key: 'webchat', icon: 'chat' as IconName, label: t.webchat, value: t.webchatValue, opensWebchat: true, hint: t.webchatHint }]
    : []),
]

const publishedChannels = channels.filter(channel => Boolean(channel.value))
const care = (page.care.items as string[]).map(withHost)
const steps = page.fraud.steps as { title: string; text: string }[]
const privacyHref = contactHref(id.privacyContact)
const learnArticle = articles.find((a) => a.slug === page.learn.article) ?? null
const faqLinks = page.learn.faq as LinkItem[]
</script>

<template>
  <div>
    <PageHero
      :eyebrow="page.hero.eyebrow"
      :title="page.hero.title"
      :lead="page.hero.lead"
      :breadcrumbs="[{ label: 'Segurança', to: '/seguranca' }]"
    >
      <template #aside>
        <aside class="never" aria-labelledby="nunca-pedimos">
          <span class="never__icon" aria-hidden="true"><AppIcon name="shield" /></span>
          <h2 id="nunca-pedimos" class="never__title">{{ page.never.title }}</h2>
          <ul class="never__list">
            <li v-for="item in page.never.items" :key="item">
              <span class="never__mark" aria-hidden="true"><AppIcon name="close" /></span>
              <span>{{ item }}</span>
            </li>
          </ul>
          <p class="never__foot">{{ page.never.footnote }}</p>
        </aside>
      </template>
    </PageHero>

    <!-- Canais oficiais -->
    <section id="canais" class="section section--paper" aria-labelledby="canais-titulo">
      <div class="container split split--top">
        <div class="channels__intro">
          <h2 id="canais-titulo">{{ t.title }}</h2>
          <p class="lead">{{ t.intro }}</p>
        </div>
        <dl class="channels" :data-inline-contact="whatsapp || webchatAvailable ? '' : undefined">
          <div v-for="c in publishedChannels" :key="c.key" class="channels__row">
            <dt>
              <span class="channels__icon" aria-hidden="true"><AppIcon :name="c.icon" /></span>
              {{ c.label }}
            </dt>
            <dd class="channels__value">
              <template v-if="c.value">
                <button v-if="c.opensWebchat" type="button" class="channels__button" @click="openContactPanel('webchat')">
                  {{ c.value }}
                </button>
                <a v-else-if="c.href" :href="c.href" rel="noopener noreferrer">{{ c.value }}</a>
                <span v-else>{{ c.value }}</span>
              </template>
              <span v-else class="pending-data">[pendente: {{ c.pending }}]</span>
            </dd>
            <dd v-if="c.hint" class="channels__hint">{{ c.hint }}</dd>
          </div>
          <div class="channels__row">
            <dt>
              <span class="channels__icon" aria-hidden="true"><AppIcon name="list" /></span>
              {{ t.support }}
            </dt>
            <dd class="channels__value">
              <RouterLink to="/atendimento" class="link-arrow">{{ t.supportLink }} <AppIcon name="arrow-right" /></RouterLink>
            </dd>
            <dd class="channels__hint">{{ t.supportText }}</dd>
          </div>
        </dl>
      </div>
    </section>

    <!-- Links, senhas e códigos -->
    <section id="cuidados" class="section section--paper" aria-labelledby="cuidados-titulo">
      <div class="container split split--top">
        <div>
          <h2 id="cuidados-titulo">{{ page.care.title }}</h2>
          <p class="lead care__lead">{{ page.care.intro }}</p>
          <ul class="care">
            <li v-for="item in care" :key="item">
              <span class="care__mark" aria-hidden="true"><AppIcon name="check" /></span>
              <span>{{ item }}</span>
            </li>
          </ul>
        </div>
        <div class="operator-panel" role="group" aria-labelledby="operadora-titulo">
          <span class="operator-panel__icon" aria-hidden="true"><AppIcon name="chat" /></span>
          <h3 id="operadora-titulo">{{ page.care.operator.title }}</h3>
          <p>{{ page.care.operator.text }}</p>
          <p class="operator-panel__warning">
            <AppIcon name="alert" />
            <strong>{{ page.care.operator.warning }}</strong>
          </p>
        </div>
      </div>
    </section>

    <!-- Suspeita de fraude -->
    <section id="suspeita" class="section section--forest" aria-labelledby="suspeita-titulo">
      <div class="container">
        <div class="section-head">
          <p class="eyebrow">{{ page.fraud.eyebrow }}</p>
          <h2 id="suspeita-titulo">{{ page.fraud.title }}</h2>
          <p class="lead fraud__lead">{{ page.fraud.intro }}</p>
        </div>
        <ol class="fraud">
          <li v-for="(s, i) in steps" :key="s.title" class="fraud__step">
            <span class="fraud__number" aria-hidden="true">{{ i + 1 }}</span>
            <h3>{{ s.title }}</h3>
            <p>{{ s.text }}</p>
          </li>
        </ol>
        <div class="fraud__action">
          <RouterLink :to="page.fraud.cta.to" class="btn btn--light">
            {{ page.fraud.cta.label }} <AppIcon name="arrow-right" />
          </RouterLink>
          <p class="fraud__note">{{ page.fraud.note }}</p>
        </div>
      </div>
    </section>

    <!-- Incidentes e privacidade -->
    <section class="section" aria-label="Incidentes e privacidade">
      <div class="container grid grid--2 trust">
        <section id="incidentes" class="trust__block" aria-labelledby="incidentes-titulo">
          <span class="trust__icon" aria-hidden="true"><AppIcon name="alert" /></span>
          <h2 id="incidentes-titulo" class="trust__title">{{ page.incidents.title }}</h2>
          <p>{{ page.incidents.text }}</p>
          <p>{{ page.incidents.channels }}</p>
        </section>

        <section id="privacidade" class="trust__block" aria-labelledby="privacidade-titulo">
          <span class="trust__icon" aria-hidden="true"><AppIcon name="eye" /></span>
          <h2 id="privacidade-titulo" class="trust__title">{{ page.privacy.title }}</h2>
          <p>{{ page.privacy.text }}</p>
          <dl class="trust__facts">
            <div v-if="id.privacyContact">
              <dt>{{ page.privacy.contact }}</dt>
              <dd>
                <template v-if="id.privacyContact">
                  <a v-if="privacyHref" :href="privacyHref" rel="noopener noreferrer">{{ id.privacyContact }}</a>
                  <span v-else>{{ id.privacyContact }}</span>
                </template>
              </dd>
            </div>
            <div v-if="id.privacyOfficerName">
              <dt>{{ page.privacy.officer }}</dt>
              <dd>
                <template v-if="id.privacyOfficerName">{{ id.privacyOfficerName }}</template>
              </dd>
            </div>
          </dl>
          <ul class="trust__links">
            <li v-for="l in page.privacy.links" :key="l.to">
              <RouterLink :to="l.to" class="link-arrow">{{ l.label }} <AppIcon name="arrow-right" /></RouterLink>
            </li>
          </ul>
        </section>
      </div>
    </section>

    <!-- Aprofundamento -->
    <section class="section section--paper section--tight" aria-labelledby="aprofundar-titulo">
      <div class="container">
        <h2 id="aprofundar-titulo" class="learn__title">{{ page.learn.title }}</h2>
        <div class="grid grid--2 learn">
          <ArticleCard v-if="learnArticle" :article="learnArticle" />
          <div>
            <h3 class="learn__faq-title">{{ page.learn.faqTitle }}</h3>
            <ul class="learn__faq">
              <li v-for="l in faqLinks" :key="l.to">
                <RouterLink :to="l.to" class="learn__faq-link">
                  <span>{{ l.label }}</span>
                  <AppIcon name="arrow-right" />
                </RouterLink>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* Painel "nunca pedimos" ---------------------------------------------------------------------- */
.never {
  position: relative;
  padding: var(--mf-space-5);
  border-radius: var(--mf-radius-panel);
  background: var(--mf-forest);
  color: var(--mf-cream);
  box-shadow: var(--mf-shadow);
}

.never__icon {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  margin-bottom: var(--mf-space-3);
  border-radius: 14px;
  background: rgb(248 246 240 / 12%);
  color: var(--mf-cream);
}

.never__icon .icon {
  width: 26px;
  height: 26px;
}

.never__title {
  margin-bottom: var(--mf-space-4);
  font-size: 30px;
  color: var(--mf-cream);
}

.never__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--mf-space-3);
}

.never__list li {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: var(--mf-space-2);
  margin: 0;
  line-height: 1.5;
}

.never__mark {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--mf-coral);
  color: var(--mf-forest);
}

.never__mark .icon {
  width: 16px;
  height: 16px;
  stroke-width: 2.5;
}

.never__foot {
  margin: var(--mf-space-4) 0 0;
  padding-top: var(--mf-space-3);
  border-top: 1px solid rgb(248 246 240 / 20%);
  font-size: 0.9375rem;
  color: var(--mf-cream-on-dark-muted);
}

/* Canais oficiais ---------------------------------------------------------------------------- */
.channels__intro .lead {
  margin-bottom: 0;
}

.channels {
  margin: 0;
  padding: var(--mf-space-2) var(--mf-space-4);
  border-radius: var(--mf-radius-card);
  background: var(--mf-cream);
}

.channels__row {
  position: relative;
  min-height: calc(44px + 2 * var(--mf-space-3));
  padding: var(--mf-space-3) 0 var(--mf-space-3) 60px;
}

.channels__row + .channels__row {
  border-top: 1px solid var(--mf-border);
}

.channels__icon {
  position: absolute;
  left: 0;
  top: var(--mf-space-3);
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: var(--mf-paper);
  color: var(--mf-forest);
}

.channels__icon .icon {
  width: 22px;
  height: 22px;
}

.channels dt {
  font-size: 0.8125rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--mf-muted);
}

.channels dd {
  margin: 0;
}

.channels__value {
  margin-top: 2px !important;
  font-size: 1.125rem;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.channels__value .link-arrow {
  font-size: 1rem;
}

/* Abre o painel do chat do site; aparência de link, alvo de 44 px. */
.channels__button {
  min-height: 44px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--mf-forest);
  font: inherit;
  text-align: left;
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}

.channels__hint {
  margin-top: 4px !important;
  font-size: 0.9375rem;
  color: var(--mf-muted);
}

/* Compromissos -------------------------------------------------------------------------------- */
.principles__title {
  max-width: 22ch;
  margin-bottom: var(--mf-space-6);
}

.principles {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  list-style: none;
  margin: 0;
  padding: 0;
}

.principles__item {
  margin: 0;
  padding: 0 var(--mf-space-5);
  border-left: 1px solid var(--mf-border);
}

.principles__item:first-child {
  padding-left: 0;
  border-left: 0;
}

.principles__icon {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  margin-bottom: var(--mf-space-4);
  border-radius: 16px;
  background: var(--mf-mint);
  color: var(--mf-forest);
}

.principles__icon .icon {
  width: 28px;
  height: 28px;
}

.principles__item h3 {
  font-size: 1.25rem;
  margin-bottom: var(--mf-space-2);
}

.principles__item p {
  margin: 0;
}

.principles__item .principles__extra {
  margin-top: var(--mf-space-2);
  color: var(--mf-muted);
}

/* Cuidados -------------------------------------------------------------------------------------- */
.care__lead {
  margin-bottom: var(--mf-space-5);
}

.care {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--mf-space-3);
}

.care li {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: var(--mf-space-2);
  margin: 0;
}

.care__mark {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--mf-mint);
  color: var(--mf-forest);
}

.care__mark .icon {
  width: 16px;
  height: 16px;
  stroke-width: 2.5;
}

.operator-panel {
  padding: var(--mf-space-5);
  border-radius: var(--mf-radius-panel);
  background: var(--mf-mint);
}

.operator-panel__icon {
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  margin-bottom: var(--mf-space-4);
  border-radius: 16px;
  background: var(--mf-forest);
  color: #fff;
}

.operator-panel__icon .icon {
  width: 26px;
  height: 26px;
}

.operator-panel h3 {
  font-size: clamp(22px, 1vw + 16px, 28px);
  margin-bottom: var(--mf-space-2);
}

.operator-panel p {
  margin: 0;
}

.operator-panel__warning {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  gap: 10px;
  margin-top: var(--mf-space-4) !important;
  padding-top: var(--mf-space-3);
  border-top: 1px solid var(--mf-mint-strong);
}

.operator-panel__warning .icon {
  width: 22px;
  height: 22px;
  color: var(--mf-forest);
}

/* Fraude ----------------------------------------------------------------------------------------- */
.fraud__lead {
  color: var(--mf-cream);
}

.fraud {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--mf-space-4);
  list-style: none;
  margin: 0;
  padding: 0;
}

.fraud__step {
  margin: 0;
  padding: var(--mf-space-4);
  border: 1px solid rgb(248 246 240 / 22%);
  border-radius: var(--mf-radius-card);
}

.fraud__number {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  margin-bottom: var(--mf-space-3);
  border-radius: 50%;
  background: var(--mf-cream);
  color: var(--mf-forest);
  font-family: var(--mf-font-heading);
  font-weight: 600;
}

.fraud__step h3 {
  font-size: 1.1875rem;
  margin-bottom: var(--mf-space-1);
  color: var(--mf-cream);
}

.fraud__step p {
  margin: 0;
  color: var(--mf-cream-on-dark-muted);
}

.fraud__action {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--mf-space-3) var(--mf-space-5);
  margin-top: var(--mf-space-6);
}

.fraud__note {
  flex: 1 1 320px;
  max-width: 60ch;
  margin: 0;
  font-size: 0.9375rem;
  color: var(--mf-cream-on-dark-muted);
}

/* Incidentes e privacidade ------------------------------------------------------------------ */
.trust {
  gap: var(--mf-space-6);
}

.trust__block {
  padding-top: var(--mf-space-4);
  border-top: 2px solid var(--mf-forest);
}

.trust__icon {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  margin-bottom: var(--mf-space-3);
  border-radius: 14px;
  background: var(--mf-mint);
  color: var(--mf-forest);
}

.trust__icon .icon {
  width: 24px;
  height: 24px;
}

.trust__title {
  font-size: clamp(30px, 1vw + 22px, 34px);
}

.trust__facts {
  display: grid;
  gap: var(--mf-space-2);
  margin: var(--mf-space-4) 0;
  padding: var(--mf-space-3) var(--mf-space-4);
  border-radius: 16px;
  background: var(--mf-paper);
}

.trust__facts dt {
  font-size: 0.8125rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--mf-muted);
}

.trust__facts dd {
  margin: 2px 0 0;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.trust__links {
  display: flex;
  flex-wrap: wrap;
  gap: 0 var(--mf-space-4);
  list-style: none;
  margin: 0;
  padding: 0;
}

.trust__links li {
  margin: 0;
}

/* Aprofundamento ----------------------------------------------------------------------------- */
.learn__title {
  margin-bottom: var(--mf-space-5);
}

.learn {
  align-items: start;
}

.learn__faq-title {
  margin-bottom: var(--mf-space-2);
  font-family: var(--mf-font-body);
  font-size: 0.8125rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mf-muted);
}

.learn__faq {
  list-style: none;
  margin: 0;
  padding: 0;
  border-top: 1px solid var(--mf-border);
}

.learn__faq li {
  margin: 0;
  border-bottom: 1px solid var(--mf-border);
}

.learn__faq-link {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--mf-space-3);
  align-items: center;
  min-height: 56px;
  padding: var(--mf-space-2) 4px;
  color: var(--mf-ink);
  font-weight: 600;
  text-decoration: none;
}

.learn__faq-link .icon {
  width: 20px;
  height: 20px;
  color: var(--mf-forest);
  transition: transform var(--mf-duration) var(--mf-ease);
}

.learn__faq-link:hover span {
  color: var(--mf-forest);
  text-decoration: underline;
}

.learn__faq-link:hover .icon,
.learn__faq-link:focus-visible .icon {
  transform: translateX(3px);
}

@media (max-width: 1023px) {
  .fraud {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .principles {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--mf-space-5);
  }

  .principles__item,
  .principles__item:first-child {
    display: grid;
    grid-template-columns: 56px minmax(0, 1fr);
    column-gap: var(--mf-space-4);
    padding: var(--mf-space-5) 0 0;
    border-left: 0;
    border-top: 1px solid var(--mf-border);
  }

  .principles__item:first-child {
    padding-top: 0;
    border-top: 0;
  }

  .principles__icon {
    grid-row: span 3;
    margin-bottom: 0;
  }
}

@media (max-width: 767px) {
  .never,
  .operator-panel {
    padding: var(--mf-space-4);
    border-radius: 28px;
  }

  .fraud {
    grid-template-columns: minmax(0, 1fr);
  }

  .channels {
    padding-inline: var(--mf-space-3);
  }

  .principles__item,
  .principles__item:first-child {
    grid-template-columns: minmax(0, 1fr);
  }

  .principles__icon {
    grid-row: auto;
    margin-bottom: var(--mf-space-3);
  }
}
</style>
