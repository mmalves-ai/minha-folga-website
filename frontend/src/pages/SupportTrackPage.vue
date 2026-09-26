<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useId } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import copy from '@content/pages/formularios.yaml'
import page from '@content/pages/atendimento-acompanhar.yaml'
import PageHero from '@/components/site/PageHero.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { errorMessage, fill, parseTrackingRef, type TrackingRef } from '@/components/forms/form-helpers'
import { useSeo } from '@/composables/useSeo'
import { formatDateTime } from '@/lib/format'
import { api, ApiError } from '@/services/api'
import type { SupportState, SupportStatus, SupportTimelineItem } from '@/components/forms/api-types'
import type { LinkItem } from '@/types/content'

/**
 * /atendimento/acompanhar (noindex): lê protocolo e token do fragmento (#p=…&t=…), retira o
 * fragmento da barra e consulta GET /api/support/{protocolo} com o cabeçalho X-Support-Token.
 * Erro sempre genérico: a tela não revela se um protocolo existe.
 */
useSeo({ title: page.meta.title, description: page.meta.description, noindex: true })

type State = 'idle' | 'loading' | 'result' | 'error'
const state = ref<State>('idle')
const result = ref<SupportStatus | null>(null)
const errorText = ref('')
const fromFragment = ref(false)
const refreshing = ref(false)
const refreshed = ref('')
const input = ref('')
const inputError = ref('')
const inputEl = ref<HTMLInputElement | null>(null)
const resultHeading = ref<HTMLElement | null>(null)
const errorEl = ref<HTMLElement | null>(null)
const route = useRoute()
const router = useRouter()
const uid = useId()
// Mantido só em memória para "Atualizar"; some ao sair da página.
let current: TrackingRef | null = null

const statuses = page.statuses as Record<SupportState, { label: string; text: string }>
const breadcrumbs = page.hero.breadcrumbs as LinkItem[]
const statusInfo = computed(() => (result.value ? statuses[result.value.status] ?? null : null))
const timeline = computed(() => [...(result.value?.timeline ?? [])].sort((a, b) => a.at.localeCompare(b.at)))

function eventTitle(item: SupportTimelineItem): string {
  if (item.type === 'created') return page.timeline.created
  if (item.type === 'reply') return page.timeline.reply
  const label = item.status ? statuses[item.status]?.label ?? item.status : ''
  return fill(page.timeline.statusChanged, { status: label })
}

async function fetchStatus(tracking: TrackingRef): Promise<SupportStatus> {
  return api<SupportStatus>(`/support/${encodeURIComponent(tracking.protocol)}`, { headers: { 'X-Support-Token': tracking.token } })
}

async function consult(tracking: TrackingRef) {
  state.value = 'loading'
  errorText.value = ''
  try {
    result.value = await fetchStatus(tracking)
    current = tracking
    state.value = 'result'
    await nextTick()
    resultHeading.value?.focus()
  } catch (e) {
    current = null
    result.value = null
    // 404 cobre protocolo inexistente e token inválido: mesma mensagem, sem distinguir.
    errorText.value =
      e instanceof ApiError && e.code === 'not_found'
        ? page.notFound
        : e instanceof ApiError && e.code === 'rate_limited'
          ? copy.common.rateLimited
          : errorMessage(e)
    state.value = 'error'
    await nextTick()
    errorEl.value?.focus()
  }
}

async function refresh() {
  if (!current || refreshing.value) return
  refreshing.value = true
  refreshed.value = ''
  try {
    result.value = await fetchStatus(current)
    refreshed.value = page.result.refreshed
  } catch (e) {
    refreshed.value = e instanceof ApiError && e.code === 'not_found' ? page.notFound : errorMessage(e)
  } finally {
    refreshing.value = false
  }
}

async function submitLink() {
  inputError.value = ''
  if (!input.value.trim()) inputError.value = page.form.required
  const tracking = inputError.value ? null : parseTrackingRef(input.value)
  if (!tracking) {
    inputError.value ||= page.form.invalid
    await nextTick()
    inputEl.value?.focus()
    return
  }
  // O link colado não fica guardado no campo depois da consulta.
  input.value = ''
  fromFragment.value = false
  await consult(tracking)
}

async function another() {
  current = null
  result.value = null
  refreshed.value = ''
  state.value = 'idle'
  await nextTick()
  inputEl.value?.focus()
}

onMounted(async () => {
  const hash = window.location.hash
  if (!hash) return
  const tracking = parseTrackingRef(hash)
  // Retira protocolo e token da barra de endereço e do estado do histórico antes de consultar.
  await router.replace({ path: route.path, query: route.query, hash: '' })
  if (!tracking) {
    errorText.value = page.notFound
    state.value = 'error'
    return
  }
  fromFragment.value = true
  await consult(tracking)
})
</script>

<template>
  <div class="track-page">
    <PageHero :title="page.hero.title" :lead="page.hero.lead" :breadcrumbs="breadcrumbs" />

    <section class="section section--flush-top" aria-label="Consulta da solicitação">
      <div class="container container--narrow track-page__body">
        <div v-if="state === 'loading'" class="panel track-page__loading" role="status">
          <span class="spinner" aria-hidden="true" />
          <span>{{ page.loading }}</span>
        </div>

        <!-- Resultado ------------------------------------------------------------------------------- -->
        <article v-else-if="state === 'result' && result" class="panel track-result" :aria-labelledby="`${uid}-resultado`">
          <p v-if="fromFragment" class="notice notice--mint track-result__note">
            <AppIcon name="lock" />
            <span>{{ page.fragmentRemoved }}</span>
          </p>

          <header class="track-result__head">
            <div>
              <p class="track-result__label">{{ page.result.protocol }}</p>
              <h2 :id="`${uid}-resultado`" ref="resultHeading" class="track-result__protocol" tabindex="-1">{{ result.protocol }}</h2>
            </div>
            <p v-if="statusInfo" class="track-status" :class="`track-status--${result.status}`">
              <AppIcon :name="result.status === 'closed' || result.status === 'answered' ? 'check-circle' : 'clock'" />
              <span>{{ statusInfo.label }}</span>
            </p>
          </header>
          <p v-if="statusInfo" class="track-result__status-text">{{ statusInfo.text }}</p>

          <dl class="track-result__meta">
            <div v-if="result.subjectLabel || result.subject">
              <dt>{{ page.result.subject }}</dt>
              <dd>{{ result.subjectLabel ?? result.subject }}</dd>
            </div>
            <div v-if="result.createdAt">
              <dt>{{ page.result.createdAt }}</dt>
              <dd>{{ formatDateTime(result.createdAt) }}</dd>
            </div>
            <div v-if="result.updatedAt">
              <dt>{{ page.result.updatedAt }}</dt>
              <dd>{{ formatDateTime(result.updatedAt) }}</dd>
            </div>
          </dl>

          <h3 class="track-result__timeline-title">{{ page.timeline.title }}</h3>
          <ol v-if="timeline.length" class="track-timeline">
            <li v-for="(item, i) in timeline" :key="`${item.at}-${i}`" class="track-timeline__item" :class="`track-timeline__item--${item.type}`">
              <span class="track-timeline__dot" aria-hidden="true" />
              <div>
                <p class="track-timeline__title">{{ eventTitle(item) }}</p>
                <p class="track-timeline__time small muted"><time :datetime="item.at">{{ formatDateTime(item.at) }}</time></p>
                <!-- Texto da equipe vem da API: exibido como texto puro, nunca como HTML. -->
                <p v-if="item.type === 'reply' && item.text" class="track-timeline__reply">{{ item.text }}</p>
              </div>
            </li>
          </ol>
          <p v-else class="muted">{{ page.timeline.empty }}</p>

          <div class="track-result__actions">
            <button type="button" class="btn btn--secondary btn--sm" :aria-disabled="refreshing ? 'true' : 'false'" @click="refresh">
              <span v-if="refreshing" class="spinner" aria-hidden="true" />
              {{ refreshing ? page.result.refreshing : page.result.refresh }}
            </button>
            <button type="button" class="btn btn--ghost" @click="another">{{ page.result.other }}</button>
          </div>
          <p class="small track-result__refreshed" role="status" aria-live="polite">{{ refreshed }}</p>
        </article>

        <!-- Link colado (ou erro) -------------------------------------------------------------------- -->
        <template v-else>
          <div v-if="state === 'error'" ref="errorEl" class="notice notice--error track-page__error" role="alert" tabindex="-1">
            <AppIcon name="alert" />
            <p>{{ errorText }}</p>
          </div>
          <form class="panel form track-form" novalidate :aria-labelledby="`${uid}-form`" @submit.prevent="submitLink">
            <h2 :id="`${uid}-form`" class="track-form__title">{{ page.form.title }}</h2>
            <div class="field">
              <label :for="`${uid}-link`" class="field__label">{{ page.form.label }}</label>
              <p :id="`${uid}-link-dica`" class="field__hint">{{ page.form.hint }}</p>
              <input
                :id="`${uid}-link`"
                ref="inputEl"
                v-model="input"
                class="input"
                type="text"
                inputmode="url"
                name="link"
                autocomplete="off"
                autocapitalize="off"
                spellcheck="false"
                maxlength="600"
                required
                :aria-invalid="inputError ? 'true' : 'false'"
                :aria-describedby="[`${uid}-link-dica`, inputError ? `${uid}-link-erro` : ''].filter(Boolean).join(' ')"
                @input="inputError = ''"
              />
              <p v-if="inputError" :id="`${uid}-link-erro`" class="field__error"><AppIcon name="alert" /><span>{{ inputError }}</span></p>
            </div>
            <div>
              <button type="submit" class="btn btn--primary">{{ page.form.submit }}</button>
            </div>
          </form>
        </template>

        <nav class="track-page__help" :aria-labelledby="`${uid}-ajuda`">
          <p :id="`${uid}-ajuda`" class="track-page__help-title panel-label">{{ page.help.title }}</p>
          <div class="cluster">
            <RouterLink :to="page.help.newRequest.to" class="link-arrow">{{ page.help.newRequest.label }} <AppIcon name="arrow-right" /></RouterLink>
            <RouterLink :to="page.help.helpCenter.to" class="link-arrow">{{ page.help.helpCenter.label }} <AppIcon name="arrow-right" /></RouterLink>
          </div>
        </nav>
      </div>
    </section>
  </div>
</template>

<style scoped>
.track-page__body {
  display: grid;
  gap: var(--mf-space-4);
}

.track-page__loading {
  display: flex;
  gap: 12px;
  align-items: center;
  color: var(--mf-muted);
}

/* Destinos de foco programático (fora da ordem de tabulação). O protocolo não ganha contorno. */
.track-page__error:focus,
.track-result__protocol:focus {
  outline: none;
}

.track-page__error:focus-visible {
  outline: 3px solid var(--mf-focus);
  outline-offset: 2px;
}

.track-form__title {
  font-size: 1.375rem;
  margin: 0;
}

/* Resultado -------------------------------------------------------------------------------------- */
.track-result {
  display: grid;
  gap: var(--mf-space-3);
}

.track-result__note {
  margin: 0 0 var(--mf-space-2);
  align-items: center;
}

.track-result__head {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 24px;
  align-items: flex-end;
  justify-content: space-between;
}

.track-result__label {
  margin: 0 0 2px;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--mf-muted);
}

.track-result__protocol {
  margin: 0;
  font-size: clamp(1.375rem, 1.4vw + 1rem, 2rem);
  letter-spacing: 0.03em;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

.track-status {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  margin: 0;
  padding: 6px 14px;
  border-radius: 999px;
  font-weight: 700;
  background: var(--mf-lilac);
  color: #2f2a45;
}

.track-status .icon {
  width: 18px;
  height: 18px;
}

.track-status--in_progress {
  background: #fff1d6;
  color: #5a3d00;
}

.track-status--answered,
.track-status--closed {
  background: var(--mf-mint);
  color: var(--mf-forest);
}

.track-result__status-text {
  margin: 0;
}

.track-result__meta {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px 24px;
  margin: 0;
  padding: var(--mf-space-3) 0;
  border-block: 1px solid var(--mf-border);
}

.track-result__meta dt {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--mf-muted);
}

.track-result__meta dd {
  margin: 0;
}

.track-result__timeline-title {
  margin: var(--mf-space-2) 0 0;
  font-size: 1.1875rem;
}

.track-timeline {
  list-style: none;
  margin: 0;
  padding: 0;
}

.track-timeline__item {
  position: relative;
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr);
  gap: 14px;
  margin: 0;
  padding-bottom: var(--mf-space-3);
}

.track-timeline__item:not(:last-child)::before {
  content: '';
  position: absolute;
  left: 9px;
  top: 22px;
  bottom: 0;
  width: 2px;
  background: var(--mf-border);
}

.track-timeline__dot {
  width: 20px;
  height: 20px;
  margin-top: 2px;
  border-radius: 50%;
  border: 3px solid var(--mf-forest);
  background: var(--mf-paper);
}

.track-timeline__item--reply .track-timeline__dot {
  background: var(--mf-forest);
}

.track-timeline__title {
  margin: 0;
  font-weight: 600;
}

.track-timeline__time {
  margin: 0;
}

.track-timeline__reply {
  margin: 8px 0 0;
  padding: 12px 16px;
  border-radius: 16px;
  background: var(--mf-mint);
  white-space: pre-line;
  overflow-wrap: anywhere;
}

.track-result__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  align-items: center;
}

.track-result__refreshed {
  margin: 0;
  color: var(--mf-forest);
  font-weight: 600;
}

.track-page__help {
  padding-top: var(--mf-space-4);
  border-top: 1px solid var(--mf-border);
}

.track-page__help-title {
  font-size: 1.125rem;
  margin-bottom: 4px;
}

.track-page__help .cluster {
  gap: 0 var(--mf-space-5);
}

/* Títulos de seção: faixa de 30–44 px da seção 3 (inclusive no celular). */
.track-form__title {
  font-size: clamp(30px, 1.2vw + 18px, 36px);
}
</style>
