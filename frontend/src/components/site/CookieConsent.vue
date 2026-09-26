<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import texts from '@content/legal/cookie-consent.yaml'
import AppIcon from '@/components/ui/AppIcon.vue'
import { activeTechnologies, type CookieTechnology } from '@/components/legal/legal'
import { webchatAvailable } from '@/components/site/channels'
import { COOKIE_CHOICE_KEY, OPEN_COOKIE_SETTINGS_EVENT, useCookieChoice } from '@/composables/useCookieChoice'
import { pageDimension, track } from '@/services/analytics'

/**
 * Aviso e painel de escolha de cookies (seção 9).
 *
 * - Banner não bloqueante só quando há tecnologia opcional (ANALYTICS_ENABLED) e nenhuma escolha válida.
 *   "Aceitar opcionais", "Recusar opcionais" e "Configurar" têm o mesmo destaque.
 * - Painel acessível: role dialog, aria-modal, foco preso, Esc fecha e o foco volta ao elemento de origem.
 *   Abre pelo evento `mf:open-cookie-settings` (rodapé e página /cookies).
 * - Sem tecnologia opcional: nenhum banner; o painel apenas explica o que o site usa.
 * - Não renderiza nada na pré-renderização nem na hidratação (evita divergência de HTML).
 * - Com medição permitida, registra a visita a cada página pública pelo CAMINHO da rota (lista fixa do
 *   manifesto ou artigo publicado; contracts/validation.json → events, tipo `route`).
 */
const { choice, needsDecision, hasOptional, load, save } = useCookieChoice()
const route = useRoute()
const router = useRouter()

const mounted = ref(false)
const dialogOpen = ref(false)
const measurementDraft = ref(false)
const announcement = ref('')
const dialogRef = ref<HTMLElement | null>(null)
const titleRef = ref<HTMLElement | null>(null)

const essentials = activeTechnologies(texts.technologies as CookieTechnology[], hasOptional).filter(
  (t) => t.category === 'essential',
)

let returnFocus: HTMLElement | null = null
let removeAfterEach: (() => void) | null = null
let removeRouteWatch: (() => void) | null = null
let lastTrackedPath: string | null = null

// Medição de visita por seção -------------------------------------------------------------------------
function trackView(path: string) {
  if (path === lastTrackedPath) return
  const dimension = pageDimension(path)
  if (!dimension || !hasOptional || !choice.value?.measurement) return
  lastTrackedPath = path
  track('page_section_view', dimension)
}

// Painel -----------------------------------------------------------------------------------------------
function setBackgroundInert(inert: boolean) {
  const app = document.getElementById('app')
  if (!app) return
  if (inert) app.setAttribute('inert', '')
  else app.removeAttribute('inert')
  document.documentElement.classList.toggle('cookie-dialog-open', inert)
}

async function openDialog() {
  if (dialogOpen.value) return
  const active = document.activeElement
  returnFocus = active instanceof HTMLElement && active !== document.body ? active : null
  measurementDraft.value = choice.value?.measurement ?? false
  dialogOpen.value = true
  await nextTick()
  setBackgroundInert(true)
  titleRef.value?.focus()
}

async function closeDialog(restoreFocus = true) {
  if (!dialogOpen.value) return
  dialogOpen.value = false
  setBackgroundInert(false)
  const target = returnFocus
  returnFocus = null
  if (!restoreFocus) return
  await nextTick()
  // O botão de origem pode ter sumido (o banner fecha ao salvar): o foco vai para o conteúdo.
  if (target && target.isConnected) target.focus()
  else document.getElementById('conteudo')?.focus({ preventScroll: true })
}

function decide(measurement: boolean) {
  save(measurement)
  announcement.value = measurement
    ? 'Escolha salva: medição agregada de uso permitida.'
    : 'Escolha salva: medição agregada de uso recusada.'
  if (measurement) trackView(route.path)
}

function saveFromDialog() {
  decide(measurementDraft.value)
  void closeDialog()
}

function focusables(): HTMLElement[] {
  if (!dialogRef.value) return []
  return [...dialogRef.value.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled])')]
}

function onKeydown(event: KeyboardEvent) {
  if (!dialogOpen.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    void closeDialog()
    return
  }
  if (event.key !== 'Tab') return
  const items = focusables()
  if (!items.length) return
  const first = items[0]!
  const last = items[items.length - 1]!
  const current = document.activeElement as HTMLElement | null
  const inside = current ? items.includes(current) : false
  if (event.shiftKey && (current === first || !inside)) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (current === last || !inside)) {
    event.preventDefault()
    first.focus()
  }
}

function onOpenRequest() {
  void openDialog()
}

function onStorage(event: StorageEvent) {
  // Escolha feita em outra aba do mesmo navegador.
  if (event.key === COOKIE_CHOICE_KEY || event.key === null) load(true)
}

onMounted(() => {
  load()
  mounted.value = true
  window.addEventListener(OPEN_COOKIE_SETTINGS_EVENT, onOpenRequest)
  window.addEventListener('storage', onStorage)
  document.addEventListener('keydown', onKeydown)
  if (hasOptional) {
    trackView(route.path)
    removeAfterEach = router.afterEach((to, _from, failure) => {
      if (!failure) trackView(to.path)
    })
  }
  // Navegar para outra página (ex.: link do painel para /cookies) fecha o painel.
  removeRouteWatch = router.afterEach(() => {
    if (dialogOpen.value) void closeDialog(false)
  })
})

onBeforeUnmount(() => {
  window.removeEventListener(OPEN_COOKIE_SETTINGS_EVENT, onOpenRequest)
  window.removeEventListener('storage', onStorage)
  document.removeEventListener('keydown', onKeydown)
  removeAfterEach?.()
  removeRouteWatch?.()
  if (dialogOpen.value) setBackgroundInert(false)
})
</script>

<template>
  <template v-if="mounted">
    <section
      v-if="needsDecision"
      class="cookie-banner"
      aria-labelledby="cookie-banner-titulo"
      aria-describedby="cookie-banner-texto"
    >
      <p id="cookie-banner-titulo" class="cookie-banner__title">{{ texts.banner.title }}</p>
      <p id="cookie-banner-texto" class="cookie-banner__text">
        {{ texts.banner.text }}
        <RouterLink to="/cookies">{{ texts.banner.policyLink }}</RouterLink>.
      </p>
      <div class="cookie-banner__actions">
        <button type="button" class="btn btn--secondary btn--sm" @click="decide(true)">{{ texts.banner.accept }}</button>
        <button type="button" class="btn btn--secondary btn--sm" @click="decide(false)">{{ texts.banner.reject }}</button>
        <button type="button" class="btn btn--secondary btn--sm" @click="openDialog">{{ texts.banner.configure }}</button>
      </div>
    </section>

    <p class="visually-hidden" aria-live="polite" aria-atomic="true">{{ announcement }}</p>

    <Teleport to="body">
      <div v-if="dialogOpen" class="cookie-dialog-backdrop">
        <div
          ref="dialogRef"
          class="cookie-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cookie-dialog-titulo"
          aria-describedby="cookie-dialog-intro"
        >
          <div class="cookie-dialog__head">
            <h2 id="cookie-dialog-titulo" ref="titleRef" tabindex="-1">{{ texts.dialog.title }}</h2>
            <button type="button" class="cookie-dialog__close" :aria-label="texts.dialog.close" @click="closeDialog()">
              <AppIcon name="close" />
            </button>
          </div>

          <div class="cookie-dialog__body">
            <p id="cookie-dialog-intro">{{ hasOptional ? texts.dialog.intro : texts.dialog.introWithoutOptional }}</p>

            <section class="cookie-cat" aria-labelledby="cookie-cat-essenciais">
              <div class="cookie-cat__head">
                <h3 id="cookie-cat-essenciais">{{ texts.dialog.essential.title }}</h3>
                <span class="badge">{{ texts.dialog.essential.status }}</span>
              </div>
              <p>{{ hasOptional ? texts.dialog.essential.text : texts.dialog.essential.textWithoutOptional }}</p>
              <ul class="cookie-cat__items" :aria-label="texts.dialog.essential.itemsLabel">
                <li v-for="item in essentials" :key="item.id">
                  <code>{{ item.name }}</code>
                </li>
              </ul>
            </section>

            <section v-if="hasOptional" class="cookie-cat" aria-labelledby="cookie-cat-medicao">
              <div class="cookie-cat__head">
                <h3 id="cookie-cat-medicao">{{ texts.dialog.measurement.title }}</h3>
                <span class="badge badge--lilac">{{ texts.dialog.measurement.status }}</span>
              </div>
              <p id="cookie-cat-medicao-texto">{{ texts.dialog.measurement.text }}</p>
              <label class="choice cookie-cat__toggle">
                <input v-model="measurementDraft" type="checkbox" aria-describedby="cookie-cat-medicao-texto" />
                <span>{{ texts.dialog.measurement.label }}</span>
              </label>
            </section>

            <div class="notice notice--mint cookie-dialog__note" role="note">
              <AppIcon name="info" />
              <p>{{ texts.dialog.messagesNote }}</p>
            </div>
            <!-- Chat do site da Hal-AI: carregado só por ação da pessoa, fora destas escolhas. -->
            <div v-if="webchatAvailable" class="notice notice--mint cookie-dialog__note" role="note">
              <AppIcon name="chat" />
              <p>{{ texts.dialog.webchatNote }}</p>
            </div>
          </div>

          <div class="cookie-dialog__foot">
            <div class="cookie-dialog__buttons">
              <template v-if="hasOptional">
                <button type="button" class="btn btn--primary" @click="saveFromDialog">{{ texts.dialog.save }}</button>
                <button type="button" class="btn btn--secondary" @click="closeDialog()">{{ texts.dialog.cancel }}</button>
              </template>
              <button v-else type="button" class="btn btn--primary" @click="closeDialog()">{{ texts.dialog.ok }}</button>
            </div>
            <div class="cookie-dialog__links">
              <RouterLink v-if="route.path !== '/cookies'" to="/cookies">{{ texts.dialog.policyLink }}</RouterLink>
              <RouterLink to="/preferencias">{{ texts.dialog.preferencesLink }}</RouterLink>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </template>
</template>

<style scoped>
/* Banner ------------------------------------------------------------------------------------------ */
.cookie-banner {
  position: fixed;
  z-index: 60;
  left: 16px;
  bottom: 16px;
  width: min(600px, calc(100vw - 32px));
  padding: 20px 22px;
  border: 1px solid var(--mf-border);
  border-radius: 20px;
  background: var(--mf-paper);
  color: var(--mf-ink);
  box-shadow: 0 18px 60px rgb(18 63 53 / 18%);
}

.cookie-banner__title {
  margin: 0 0 6px;
  font-family: var(--mf-font-heading);
  font-size: 1.0625rem;
  font-weight: 600;
}

.cookie-banner__text {
  margin: 0 0 16px;
  font-size: 0.9375rem;
  line-height: 1.5;
}

.cookie-banner__actions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.cookie-banner__actions .btn {
  padding-inline: 10px;
}

@media (min-width: 1200px) {
  .cookie-banner {
    left: 50%;
    bottom: 20px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    column-gap: 32px;
    width: min(1200px, calc(100vw - 48px));
    padding: 20px 24px;
    transform: translateX(-50%);
  }

  .cookie-banner__title,
  .cookie-banner__text {
    grid-column: 1;
  }

  .cookie-banner__text {
    margin: 0;
  }

  .cookie-banner__actions {
    grid-column: 2;
    grid-row: 1 / span 2;
    grid-template-columns: repeat(3, 1fr);
  }

  .cookie-banner__actions .btn {
    padding-inline: 18px;
    white-space: nowrap;
  }
}

@media (max-width: 479px) {
  .cookie-banner {
    left: 8px;
    bottom: 8px;
    width: calc(100vw - 16px);
    padding: 16px;
  }

  .cookie-banner__actions {
    grid-template-columns: minmax(0, 1fr);
  }
}

/* Painel ------------------------------------------------------------------------------------------ */
.cookie-dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgb(11 48 40 / 55%);
}

.cookie-dialog {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  width: min(600px, 100%);
  max-height: min(820px, calc(100dvh - 32px));
  border-radius: 24px;
  background: var(--mf-paper);
  color: var(--mf-ink);
  box-shadow: 0 24px 80px rgb(11 48 40 / 30%);
  overflow: hidden;
}

.cookie-dialog__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 24px 24px 8px;
}

.cookie-dialog__head h2 {
  margin: 0;
  font-size: clamp(1.375rem, 1vw + 1rem, 1.625rem);
}

/* Título recebe o foco ao abrir só para leitores de tela anunciarem o painel; não é um controle. */
.cookie-dialog__head h2:focus {
  outline: none;
}

.cookie-dialog__close {
  display: grid;
  place-items: center;
  flex: none;
  width: 44px;
  height: 44px;
  margin: -6px -8px 0 0;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: var(--mf-forest);
}

.cookie-dialog__close:hover {
  background: var(--mf-mint);
}

.cookie-dialog__close .icon {
  width: 22px;
  height: 22px;
}

.cookie-dialog__body {
  display: grid;
  gap: 16px;
  align-content: start;
  padding: 8px 24px 20px;
  overflow-y: auto;
  overscroll-behavior: contain;
  font-size: 0.9375rem;
  line-height: 1.55;
}

.cookie-dialog__body p {
  margin: 0;
}

.cookie-cat {
  display: grid;
  gap: 10px;
  padding: 16px 18px;
  border: 1px solid var(--mf-border);
  border-radius: 16px;
  background: var(--mf-cream);
}

.cookie-cat__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 6px 12px;
}

.cookie-cat__head h3 {
  margin: 0;
  font-size: 1.0625rem;
}

.cookie-cat__items {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  list-style: none;
  margin: 0;
  padding: 0;
}

.cookie-cat__items li {
  margin: 0;
}

.cookie-cat__items code {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 8px;
  background: var(--mf-mint);
  color: var(--mf-forest);
  font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
  font-size: 0.875rem;
  font-weight: 600;
}

.cookie-cat__toggle {
  font-weight: 600;
}

.cookie-dialog__note {
  font-size: 0.875rem;
}

.cookie-dialog__foot {
  display: grid;
  gap: 4px;
  padding: 16px 24px 12px;
  border-top: 1px solid var(--mf-border);
  background: var(--mf-paper);
}

.cookie-dialog__buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.cookie-dialog__links {
  display: flex;
  flex-wrap: wrap;
  gap: 0 20px;
  font-size: 0.9375rem;
}

.cookie-dialog__links a {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
}

@media (max-width: 479px) {
  .cookie-dialog-backdrop {
    padding: 8px;
    align-items: end;
  }

  .cookie-dialog {
    max-height: calc(100dvh - 16px);
    border-radius: 20px;
  }

  .cookie-dialog__head {
    padding: 20px 16px 6px;
  }

  .cookie-dialog__body {
    padding: 6px 16px 16px;
  }

  .cookie-dialog__foot {
    padding: 14px 16px 16px;
  }

  .cookie-dialog__buttons .btn {
    flex: 1 1 0;
    padding-inline: 12px;
  }

  .cookie-dialog__links {
    gap: 0 16px;
  }
}
</style>

<style>
/* Rolagem da página travada enquanto o painel de cookies está aberto. */
html.cookie-dialog-open {
  overflow: hidden;
}
</style>
