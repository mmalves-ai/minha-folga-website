<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import page from '@content/pages/preferencias.yaml'
import validation from '@contracts/validation.json'
import PageHero from '@/components/site/PageHero.vue'
import RichText from '@/components/content/RichText.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import BrowserNotifications from '@/components/site/BrowserNotifications.vue'
import BiaChannelActions from '@/components/forms/BiaChannelActions.vue'
import OptOutForm from '@/components/forms/OptOutForm.vue'
import PreferencesManager from '@/components/forms/PreferencesManager.vue'
import { errorMessage, fill, focusAndReveal, parsePreferencesToken } from '@/components/forms/form-helpers'
import { webchatAvailable, whatsappNumber } from '@/composables/useBiaChannels'
import { useAnnouncer } from '@/composables/useAnnouncer'
import { useSeo } from '@/composables/useSeo'
import { api, ApiError } from '@/services/api'
import type { Preferences } from '@/components/forms/api-types'
import type { LinkItem } from '@/types/content'

/**
 * /preferencias (noindex), decisão D1: acesso seguro às finalidades do titular.
 * 1) link seguro da Bia (#token=…) → POST /preferences/token, com o fragmento removido da barra na hora;
 * 2) sessão existente → GET /preferences (dados mascarados);
 * 3) sem sessão → como pedir o link à Bia (pelo WhatsApp oficial, onde o número é atestado) e o pedido
 *    de saída das comunicações pelo número, com resposta genérica. Sem sessão, nenhum dado aparece.
 * Avisos da página: depois de uma ação (encerrar sessão, sessão expirada durante uma ação) o foco vai
 * para o aviso, porque o gerenciador que tinha o foco sai da tela; avisos que surgem ao carregar são
 * anunciados pela região viva persistente, sem mover o foco. Erros usam role="alert".
 */
useSeo({ title: page.meta.title, description: page.meta.description, noindex: true })

type State = 'checking' | 'nolink' | 'manage' | 'error'
const state = ref<State>('checking')
const prefs = ref<Preferences | null>(null)
const banner = ref<{ tone: 'info' | 'error'; text: string } | null>(null)
const route = useRoute()
const router = useRouter()
const { announce } = useAnnouncer()
const bannerEl = ref<HTMLElement | null>(null)
const securityItems = page.security.items as string[]
const securityLinks = page.security.links as LinkItem[]
const linkSteps = page.noLink.steps as string[]
const linkMinutes = Math.round(validation.waitlist.preferencesLinkTtlSeconds / 60)
const hasWhatsapp = Boolean(whatsappNumber)

async function focusGreeting() {
  await nextTick()
  document.getElementById('preferencias-titulo')?.focus()
}

async function load(): Promise<void> {
  try {
    prefs.value = await api<Preferences>('/preferences')
    state.value = 'manage'
  } catch (e) {
    prefs.value = null
    if (e instanceof ApiError && (e.status === 401 || e.status === 404 || e.code === 'session_required')) {
      state.value = 'nolink'
    } else {
      banner.value = { tone: 'error', text: errorMessage(e) }
      state.value = 'error'
    }
  }
}

async function retry() {
  banner.value = null
  state.value = 'checking'
  await load()
}

function onUpdated(next: Preferences) {
  prefs.value = next
}

/** Mostra um aviso informativo: com `focus`, leva o foco a ele; senão, só o anuncia. */
async function showInfo(text: string, focus: boolean) {
  banner.value = { tone: 'info', text }
  await nextTick()
  if (focus) focusAndReveal(bannerEl.value)
  else announce(text)
}

/** Sessão encerrada (pela pessoa ou por expiração): volta às orientações com o foco no aviso. */
function toNoLink(text: string) {
  prefs.value = null
  state.value = 'nolink'
  void showInfo(text, true)
}

onMounted(async () => {
  const token = parsePreferencesToken(window.location.hash)
  if (/token=/.test(window.location.hash)) {
    // O token não fica na barra de endereço nem no estado do histórico.
    await router.replace({ path: route.path, query: route.query, hash: '' })
  }
  if (token) {
    try {
      await api('/preferences/token', { method: 'POST', body: { token } })
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.code === 'invalid_or_expired_link')) {
        await load()
        if (state.value !== 'manage') await showInfo(page.linkInvalid, false)
        return
      }
      banner.value = { tone: 'error', text: errorMessage(e) }
      state.value = 'error'
      return
    }
  }
  await load()
  if (token && state.value === 'manage') await focusGreeting()
})
</script>

<template>
  <div class="prefs-page">
    <PageHero :title="page.hero.title" :lead="page.hero.lead" :breadcrumbs="[{ label: page.hero.breadcrumb, to: '/preferencias' }]" />

    <section class="section section--flush-top" aria-label="Gestão das preferências">
      <div class="container split split--top prefs-page__grid">
        <div class="prefs-page__main">
          <div
            v-if="banner"
            ref="bannerEl"
            class="notice prefs-page__banner"
            :class="banner.tone === 'error' ? 'notice--error' : 'notice--mint'"
            :role="banner.tone === 'error' ? 'alert' : undefined"
            tabindex="-1"
          >
            <AppIcon :name="banner.tone === 'error' ? 'alert' : 'info'" />
            <div>
              <p>{{ banner.text }}</p>
              <p v-if="state === 'error'">
                <button type="button" class="btn btn--secondary btn--sm prefs-page__retry" @click="retry">{{ page.retry }}</button>
              </p>
            </div>
          </div>

          <div v-if="state === 'checking'" class="panel prefs-page__checking" role="status">
            <span class="spinner" aria-hidden="true" />
            <span>{{ page.checking }}</span>
          </div>

          <template v-else-if="state === 'nolink'">
            <section class="panel prefs-page__panel" aria-labelledby="pedir-link-titulo">
              <h2 id="pedir-link-titulo" class="prefs-page__title">{{ page.noLink.title }}</h2>
              <template v-if="hasWhatsapp">
                <p>{{ fill(page.noLink.text, { minutes: linkMinutes }) }}</p>
                <ol class="prefs-page__steps">
                  <li v-for="(step, i) in linkSteps" :key="step">
                    <span class="prefs-page__num" aria-hidden="true">{{ i + 1 }}</span>
                    <span>{{ step }}</span>
                  </li>
                </ol>
                <BiaChannelActions whatsapp-only :whatsapp-text="page.noLink.whatsappText" :show-fallback="false" />
                <p v-if="webchatAvailable" class="small muted prefs-page__note">{{ page.noLink.webchatNote }}</p>
              </template>
              <p v-else class="notice notice--pending prefs-page__unavailable">
                <AppIcon name="clock" />
                <span>{{ page.noLink.unavailable }}</span>
              </p>
            </section>

            <div class="panel prefs-page__panel">
              <OptOutForm :heading-level="2" />
              <RichText :html="page.noLink.deletion_mdi" tag="p" class="small muted prefs-page__deletion" />
            </div>
          </template>

          <PreferencesManager
            v-else-if="state === 'manage' && prefs"
            :prefs="prefs"
            @updated="onUpdated"
            @logged-out="toNoLink(page.loggedOut)"
            @session-expired="toNoLink(page.sessionEnded)"
          />
        </div>

        <aside class="prefs-page__aside" aria-labelledby="protecao-titulo">
          <p id="protecao-titulo" class="prefs-page__aside-title panel-label">
            <AppIcon name="lock" />
            {{ page.security.title }}
          </p>
          <ul class="prefs-page__list">
            <li v-for="item in securityItems" :key="item">{{ item }}</li>
          </ul>
          <ul class="prefs-page__links">
            <li v-for="link in securityLinks" :key="link.to">
              <RouterLink :to="link.to" class="link-arrow">{{ link.label }} <AppIcon name="arrow-right" /></RouterLink>
            </li>
          </ul>
        </aside>
      </div>
    </section>
  </div>
  <div id="avisos-navegador" class="container container--narrow"><BrowserNotifications manage /></div>
</template>

<style scoped>
#avisos-navegador { scroll-margin-top: calc(var(--mf-header-height) + 24px); }
.prefs-page__grid {
  grid-template-columns: minmax(0, 1.45fr) minmax(0, 0.8fr);
  gap: var(--mf-space-6);
}

.prefs-page__main {
  display: grid;
  gap: var(--mf-space-4);
  align-content: start;
}

.prefs-page__panel {
  padding: var(--mf-space-6);
}

.prefs-page__title {
  font-size: clamp(1.375rem, 1vw + 1rem, 1.75rem);
}

.prefs-page__steps {
  display: grid;
  gap: 10px;
  list-style: none;
  margin: 0 0 var(--mf-space-4);
  padding: 0;
}

.prefs-page__steps li {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  gap: 12px;
  align-items: center;
  margin: 0;
}

.prefs-page__num {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--mf-mint);
  color: var(--mf-forest);
  font-family: var(--mf-font-heading);
  font-weight: 600;
}

.prefs-page__note,
.prefs-page__deletion {
  margin: var(--mf-space-3) 0 0;
}

.prefs-page__unavailable {
  margin: 0;
}

.prefs-page__checking {
  display: flex;
  gap: 12px;
  align-items: center;
  color: var(--mf-muted);
}

.prefs-page__retry {
  margin-top: 8px;
}

.prefs-page__banner:focus {
  outline: 3px solid var(--mf-focus);
  outline-offset: 2px;
}

.prefs-page__aside {
  padding: var(--mf-space-5);
  border-radius: var(--mf-radius-card);
  background: var(--mf-mint);
}

.prefs-page__aside-title {
  display: flex;
  gap: 10px;
  align-items: center;
  font-size: 1.25rem;
  margin-bottom: var(--mf-space-3);
}

.prefs-page__aside-title .icon {
  flex: none;
  width: 24px;
  height: 24px;
  color: var(--mf-forest);
}

.prefs-page__list {
  padding-left: 1.1em;
  margin-bottom: var(--mf-space-4);
}

.prefs-page__list li + li {
  margin-top: 10px;
}

.prefs-page__links {
  list-style: none;
  margin: 0;
  padding: 0;
}

.prefs-page__links li {
  margin: 0;
}

@media (max-width: 1023px) {
  .prefs-page__grid {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--mf-space-5);
  }
}

@media (max-width: 767px) {
  .prefs-page__panel {
    padding: var(--mf-space-4);
  }
  .prefs-page__aside {
    padding: var(--mf-space-4);
  }
}
</style>
