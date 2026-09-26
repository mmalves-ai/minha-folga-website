<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/ui/AppIcon.vue'
import { useAnnouncer } from '@/composables/useAnnouncer'
import { useCookieChoice } from '@/composables/useCookieChoice'
import { pageDimension, track } from '@/services/analytics'
import { publicConfig, site } from '@/services/site'
import {
  INLINE_CONTACT_ATTR,
  OPEN_CONTACT_EVENT,
  biaOnWhatsapp,
  webchat,
  whatsappContactUrl,
  type ContactTarget,
  type WebchatConfig,
} from './channels'
import WebchatLoader from './WebchatLoader.vue'

/**
 * Botão flutuante de conversa (decisão D1, docs/DECISOES.md). Canto inferior direito de todas as páginas
 * do DefaultLayout. Abre um painel pequeno, não modal, com:
 *   (a) "Conversar com a Bia no site" — chat da Hal-AI, canal PREFERENCIAL, só com `channels.webchat`
 *       válido. O clique mostra o aviso de tratamento; o script do widget só é carregado depois de
 *       "Abrir o chat" (WebchatLoader). PLACEHOLDER: widget da Hal-AI ainda não provisionado.
 *   (b) "WhatsApp" — ÚLTIMA alternativa, link `wa.me` para o número oficial hospedado na Hal-AI, com texto
 *       genérico, só com `channels.whatsappNumber` configurado.
 * Sem nenhum canal, nada é renderizado. Nada é renderizado na pré-renderização nem na hidratação (o
 * estado depende do navegador: aviso de cookies, foco em campos), então o setup não toca em `window`.
 *
 * Para não cobrir CTAs nem o aviso de cookies: sobe acima do aviso de cookies quando os dois se cruzam;
 * no celular some enquanto um campo de texto está em foco (teclado aberto); o rodapé ganha espaço no fim
 * da página. Painel e botão ficam abaixo do menu móvel (z-index 70) e do painel de cookies (80), que
 * deixam o restante de #app inerte.
 *
 * Canais já na página: enquanto um bloco marcado com `data-inline-contact` (INLINE_CONTACT_ATTR, channels.ts)
 * estiver na área visível — ex.: o cartão "Seu telefone ainda não está validado" de /cadastro-confirmado ou a
 * lista de canais de /atendimento —, o botão se recolhe (some, sem ocupar espaço e fora da ordem de tabulação)
 * e volta quando o bloco sai da tela. Nunca some de repente com o painel aberto ou com o foco nele. Os blocos
 * são procurados de novo a cada navegação e quando a página os mostra depois de montar (MutationObserver);
 * sem IntersectionObserver (pré-renderização, testes), o botão fica sempre visível.
 *
 * Outras telas abrem o painel com `openContactPanel()` (channels.ts), ex.: o CTA da página /bia.
 */
const props = withDefaults(
  defineProps<{
    /** Widget validado (channels.ts); sem a prop, vale o da configuração pública. `null` = sem chat. */
    webchatConfig?: WebchatConfig | null
    whatsappUrl?: string | null
    /** A Bia atende no WhatsApp oficial (muda o texto e conta o clique como canal da Bia). */
    whatsappIsBia?: boolean
    /** Cadastro aberto no servidor: oferecer "Fazer meu cadastro" quando o chat falhar. */
    waitlistOpen?: boolean
  }>(),
  {
    webchatConfig: undefined,
    whatsappUrl: whatsappContactUrl,
    whatsappIsBia: biaOnWhatsapp,
    waitlistOpen: publicConfig.collection.waitlistEnabled,
  },
)

type Step = 'menu' | 'notice' | 'webchat'

const t = site.floatingContact
const route = useRoute()
const router = useRouter()
const { needsDecision } = useCookieChoice()
// Região viva única e persistente (criada ao montar): "Conectando…" e "Chat carregado" saem por ela.
const { announce } = useAnnouncer()

const uid = 'contato-flutuante'
const widget = computed<WebchatConfig | null>(() => (props.webchatConfig === undefined ? webchat : props.webchatConfig))
const hasWebchat = computed(() => widget.value !== null)
const hasChannel = computed(() => hasWebchat.value || Boolean(props.whatsappUrl))
const whatsappText = computed(() => (props.whatsappIsBia ? t.whatsapp.textBia : t.whatsapp.text))

const mounted = ref(false)
const open = ref(false)
const step = ref<Step>('menu')
const typing = ref(false)
/** Distância extra (px) para ficar acima do aviso de cookies quando os dois se cruzam. */
const lift = ref(0)
/** Algum bloco da página com os canais de conversa está na área visível. */
const inlineVisible = ref(false)
/** O foco está no botão ou no painel (recolher agora o tiraria de baixo da pessoa). */
const focusWithin = ref(false)
const collapsed = computed(() => inlineVisible.value && !open.value && !focusWithin.value)

const root = ref<HTMLElement | null>(null)
const toggleButton = ref<HTMLButtonElement | null>(null)
const heading = ref<HTMLElement | null>(null)

let returnFocus: HTMLElement | null = null
let removeAfterEach: (() => void) | null = null
let bannerObserver: ResizeObserver | null = null
let inlineObserver: IntersectionObserver | null = null
let domObserver: MutationObserver | null = null

// Painel --------------------------------------------------------------------------------------------------
async function focusHeading() {
  await nextTick()
  heading.value?.focus()
}

function openPanel(target: Step = 'menu', origin: Element | null = null) {
  returnFocus = origin instanceof HTMLElement && origin !== document.body ? origin : toggleButton.value
  step.value = target
  open.value = true
  void focusHeading()
}

function closePanel(restoreFocus = true) {
  if (!open.value) return
  open.value = false
  step.value = 'menu'
  const target = returnFocus
  returnFocus = null
  if (!restoreFocus) return
  void nextTick(() => {
    // A origem pode ter sumido (ex.: navegação): o foco volta ao botão flutuante.
    if (target && target.isConnected && !target.closest('[inert]')) target.focus()
    else toggleButton.value?.focus()
  })
}

function toggle() {
  if (open.value) closePanel()
  else openPanel('menu', toggleButton.value)
}

function go(next: Step) {
  step.value = next
  void focusHeading()
}

function confirmWebchat() {
  track('bia_channel_click', pageDimension(route.path))
  go('webchat')
}

function onWhatsappClick() {
  if (props.whatsappIsBia) track('bia_channel_click', pageDimension(route.path))
}

function onWebchatLoading() {
  announce(t.loading)
}

function onWebchatReady() {
  // O widget abre a própria janela; o painel fecha para não ficar por cima dela.
  // PLACEHOLDER: com a API do widget da Hal-AI, levar o foco para a janela do chat.
  announce(t.ready)
  closePanel()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && open.value) {
    event.preventDefault()
    closePanel()
  }
}

function onPointerDown(event: PointerEvent) {
  if (!open.value || !root.value) return
  if (event.target instanceof Node && root.value.contains(event.target)) return
  // Clique fora: fecha sem puxar o foco de onde a pessoa clicou.
  closePanel(false)
}

function onOpenRequest(event: Event) {
  if (!hasChannel.value) return
  const detail = (event as CustomEvent<{ target?: ContactTarget } | undefined>).detail
  const target: Step = detail?.target === 'webchat' && hasWebchat.value ? 'notice' : 'menu'
  openPanel(target, document.activeElement)
}

// Campos de texto em foco (teclado do celular aberto) -----------------------------------------------------
const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image', 'hidden'])

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(target.type)
  return target.isContentEditable
}

function onFocusIn(event: FocusEvent) {
  const inside = event.target instanceof Node && root.value?.contains(event.target)
  typing.value = !inside && isTextEntry(event.target)
}

function onFocusOut() {
  typing.value = false
}

function onRootFocusOut(event: FocusEvent) {
  const next = event.relatedTarget
  focusWithin.value = next instanceof Node && Boolean(root.value?.contains(next))
}

// Canais já exibidos na página ----------------------------------------------------------------------------
const INLINE_SELECTOR = `[${INLINE_CONTACT_ATTR}]`
/** Blocos observados agora e, entre eles, os que estão na área visível. */
const inlineTargets = new Set<Element>()
const inlineOnScreen = new Set<Element>()

function onInlineIntersect(entries: IntersectionObserverEntry[]) {
  for (const entry of entries) {
    if (entry.isIntersecting && inlineTargets.has(entry.target)) inlineOnScreen.add(entry.target)
    else inlineOnScreen.delete(entry.target)
  }
  inlineVisible.value = inlineOnScreen.size > 0
}

/** Passa a observar os blocos marcados que estão na página e esquece os que saíram dela. */
function syncInlineTargets() {
  const observer = inlineObserver
  if (!observer) return
  const current = new Set(document.querySelectorAll(INLINE_SELECTOR))
  for (const el of inlineTargets) {
    if (current.has(el)) continue
    observer.unobserve(el)
    inlineTargets.delete(el)
    inlineOnScreen.delete(el)
  }
  for (const el of current) {
    if (inlineTargets.has(el) || root.value?.contains(el)) continue
    inlineTargets.add(el)
    observer.observe(el)
  }
  inlineVisible.value = inlineOnScreen.size > 0
}

function watchInlineContacts() {
  if (typeof IntersectionObserver === 'undefined') return
  inlineObserver = new IntersectionObserver(onInlineIntersect)
  // Blocos que a página mostra depois de montar (ex.: resposta da API em /preferencias).
  if (typeof MutationObserver !== 'undefined') {
    domObserver = new MutationObserver(() => syncInlineTargets())
    domObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: [INLINE_CONTACT_ATTR] })
  }
  syncInlineTargets()
}

function stopInlineContacts() {
  domObserver?.disconnect()
  inlineObserver?.disconnect()
  domObserver = null
  inlineObserver = null
  inlineTargets.clear()
  inlineOnScreen.clear()
  inlineVisible.value = false
}

// Aviso de cookies ----------------------------------------------------------------------------------------
const EDGE = 16
const GAP = 12

function measureBanner() {
  const banner = document.querySelector<HTMLElement>('.cookie-banner')
  const button = toggleButton.value
  if (!banner || !button) {
    lift.value = 0
    return
  }
  const b = banner.getBoundingClientRect()
  const buttonLeft = window.innerWidth - EDGE - button.offsetWidth
  const crosses = b.right + GAP > buttonLeft
  lift.value = crosses ? Math.max(0, Math.ceil(window.innerHeight - b.top) + GAP - EDGE) : 0
}

function watchBanner() {
  bannerObserver?.disconnect()
  bannerObserver = null
  const banner = document.querySelector<HTMLElement>('.cookie-banner')
  if (banner && typeof ResizeObserver !== 'undefined') {
    bannerObserver = new ResizeObserver(() => measureBanner())
    bannerObserver.observe(banner)
  }
  measureBanner()
}

watch(needsDecision, async () => {
  if (!mounted.value) return
  await nextTick()
  watchBanner()
})

// Oculto, o botão não tem largura: ao voltar, confere de novo o cruzamento com o aviso de cookies.
watch(collapsed, async (hidden) => {
  if (hidden || !mounted.value) return
  await nextTick()
  measureBanner()
})

// Ciclo de vida -------------------------------------------------------------------------------------------
onMounted(async () => {
  mounted.value = true
  window.addEventListener(OPEN_CONTACT_EVENT, onOpenRequest)
  if (!hasChannel.value) return
  document.documentElement.classList.add('mf-floating-contact')
  document.addEventListener('pointerdown', onPointerDown)
  document.addEventListener('focusin', onFocusIn)
  document.addEventListener('focusout', onFocusOut)
  window.addEventListener('resize', measureBanner)
  // Navegar para outra página (ex.: link do Aviso de Privacidade no painel) fecha o painel; os blocos com os
  // canais da página nova passam a ser observados depois que ela aparece.
  removeAfterEach = router.afterEach(() => {
    closePanel(false)
    void nextTick(syncInlineTargets)
  })
  await nextTick()
  watchBanner()
  watchInlineContacts()
})

onBeforeUnmount(() => {
  window.removeEventListener(OPEN_CONTACT_EVENT, onOpenRequest)
  document.removeEventListener('pointerdown', onPointerDown)
  document.removeEventListener('focusin', onFocusIn)
  document.removeEventListener('focusout', onFocusOut)
  window.removeEventListener('resize', measureBanner)
  document.documentElement.classList.remove('mf-floating-contact')
  bannerObserver?.disconnect()
  stopInlineContacts()
  removeAfterEach?.()
})
</script>

<template>
  <div
    v-if="mounted && hasChannel"
    ref="root"
    class="floating-contact"
    :class="{ 'is-open': open, 'is-typing': typing && !open, 'is-collapsed': collapsed }"
    :style="lift ? { '--mf-fc-lift': `${lift}px` } : undefined"
    @keydown="onKeydown"
    @focusin="focusWithin = true"
    @focusout="onRootFocusOut"
  >
    <button
      ref="toggleButton"
      type="button"
      class="floating-contact__toggle"
      :aria-label="t.toggleLabel"
      :aria-expanded="open ? 'true' : 'false'"
      :aria-controls="`${uid}-painel`"
      @click="toggle"
    >
      <AppIcon :name="open ? 'close' : 'chat'" />
      <span class="floating-contact__label" aria-hidden="true">{{ t.toggle }}</span>
    </button>

    <section
      v-show="open"
      :id="`${uid}-painel`"
      class="floating-contact__panel"
      :aria-labelledby="`${uid}-titulo`"
    >
      <!-- (1) Escolha do canal: chat do site primeiro (preferencial), WhatsApp por último. -->
      <template v-if="step === 'menu'">
        <h2 :id="`${uid}-titulo`" ref="heading" class="floating-contact__title" tabindex="-1">{{ t.title }}</h2>
        <p class="floating-contact__intro">{{ t.intro }}</p>
        <ul class="floating-contact__options">
          <li v-if="hasWebchat">
            <button type="button" class="fc-option fc-option--primary" @click="go('notice')">
              <span class="fc-option__icon" aria-hidden="true"><AppIcon name="chat" /></span>
              <span class="fc-option__body">
                <span class="fc-option__label">{{ t.webchat.label }}</span>
                <span class="fc-option__text">{{ t.webchat.text }}</span>
                <span class="fc-option__tag">{{ t.webchat.tag }}</span>
              </span>
              <AppIcon name="arrow-right" class="fc-option__arrow" />
            </button>
          </li>
          <li v-if="whatsappUrl">
            <a :href="whatsappUrl" class="fc-option" target="_blank" rel="noopener noreferrer" @click="onWhatsappClick">
              <span class="fc-option__icon fc-option__icon--plain" aria-hidden="true"><AppIcon name="phone" /></span>
              <span class="fc-option__body">
                <span class="fc-option__label">{{ t.whatsapp.label }}</span>
                <span class="fc-option__text">{{ whatsappText }}</span>
                <span class="visually-hidden">{{ t.whatsapp.hint }}</span>
              </span>
              <AppIcon name="external" class="fc-option__arrow" />
            </a>
          </li>
        </ul>
        <RouterLink :to="t.more.to" class="floating-contact__more">{{ t.more.label }} <AppIcon name="arrow-right" /></RouterLink>
      </template>

      <!-- (2) Aviso de tratamento: nada da Hal-AI é carregado antes de "Abrir o chat". -->
      <template v-else-if="step === 'notice'">
        <h2 :id="`${uid}-titulo`" ref="heading" class="floating-contact__title" tabindex="-1">{{ t.notice.title }}</h2>
        <p class="floating-contact__text">{{ t.notice.text }}</p>
        <p class="floating-contact__care"><AppIcon name="info" /> <span>{{ t.notice.care }}</span></p>
        <RouterLink :to="t.notice.privacy.to" class="floating-contact__link">{{ t.notice.privacy.label }}</RouterLink>
        <div class="floating-contact__actions">
          <button type="button" class="btn btn--primary btn--sm" @click="confirmWebchat">{{ t.notice.confirm }}</button>
          <button type="button" class="btn btn--secondary btn--sm" @click="go('menu')">{{ t.notice.back }}</button>
        </div>
      </template>

      <!-- (3) Carregamento do widget (placeholder), com saída sem chat se falhar. -->
      <template v-else-if="widget">
        <h2 :id="`${uid}-titulo`" ref="heading" class="floating-contact__title" tabindex="-1">{{ t.webchat.label }}</h2>
        <WebchatLoader
          :config="widget"
          :loading-text="t.loading"
          :ready-text="t.ready"
          :failed-text="t.failed"
          :retry-label="t.failedActions.retry"
          @loading="onWebchatLoading"
          @ready="onWebchatReady"
        >
          <template #failed>
            <ul class="floating-contact__fallback">
              <li v-if="waitlistOpen">
                <RouterLink :to="t.failedActions.waitlist.to">{{ t.failedActions.waitlist.label }}</RouterLink>
              </li>
              <li>
                <RouterLink :to="t.failedActions.support.to">{{ t.failedActions.support.label }}</RouterLink>
              </li>
              <li v-if="whatsappUrl">
                <a :href="whatsappUrl" target="_blank" rel="noopener noreferrer" @click="onWhatsappClick">
                  {{ t.whatsapp.label }} <AppIcon name="external" />
                  <span class="visually-hidden">{{ t.whatsapp.hint }}</span>
                </a>
              </li>
            </ul>
          </template>
        </WebchatLoader>
      </template>
    </section>
  </div>
</template>

<style scoped>
.floating-contact {
  --mf-fc-lift: 0px;
  position: fixed;
  z-index: 58;
  right: 16px;
  bottom: calc(16px + var(--mf-fc-lift) + env(safe-area-inset-bottom, 0px));
  display: flex;
  flex-direction: column-reverse;
  align-items: flex-end;
  gap: 12px;
  max-width: calc(100vw - 32px);
  pointer-events: none;
  transition: bottom var(--mf-duration) var(--mf-ease);
}

.floating-contact > * {
  pointer-events: auto;
}

/* Botão ------------------------------------------------------------------------------------------------ */
.floating-contact__toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-width: 56px;
  height: 56px;
  padding: 0 22px 0 18px;
  border: 2px solid var(--mf-paper);
  border-radius: 999px;
  background: var(--mf-forest);
  color: #fff;
  font-family: var(--mf-font-body);
  font-size: 1rem;
  font-weight: 600;
  line-height: 1;
  box-shadow: 0 10px 30px rgb(11 48 40 / 28%);
  cursor: pointer;
  transition:
    background-color var(--mf-duration) var(--mf-ease),
    transform var(--mf-duration) var(--mf-ease);
}

.floating-contact__toggle:hover {
  background: var(--mf-forest-hover);
}

/* Anel duplo (claro e escuro): visível sobre seções claras e sobre o verde do rodapé e das faixas. */
.floating-contact__toggle:focus-visible {
  outline: 3px solid var(--mf-paper);
  outline-offset: 2px;
  box-shadow:
    0 0 0 7px var(--mf-forest),
    0 10px 30px rgb(11 48 40 / 28%);
}

.floating-contact__toggle .icon {
  width: 24px;
  height: 24px;
  flex: none;
}

@media (prefers-reduced-motion: no-preference) {
  .floating-contact__toggle:hover {
    transform: translateY(-1px);
  }
}

/* Painel ------------------------------------------------------------------------------------------------ */
.floating-contact__panel {
  display: grid;
  gap: 12px;
  width: min(360px, calc(100vw - 32px));
  max-height: calc(100dvh - var(--mf-header-height) - 110px - var(--mf-fc-lift));
  padding: 20px;
  overflow-y: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--mf-border);
  border-radius: 20px;
  background: var(--mf-paper);
  color: var(--mf-ink);
  box-shadow: 0 18px 60px rgb(18 63 53 / 22%);
  font-size: 0.9375rem;
  line-height: 1.5;
}

.floating-contact__title {
  margin: 0;
  font-size: 1.125rem;
  line-height: 1.3;
}

/* O título recebe o foco ao abrir só para o leitor de tela anunciar o painel; não é um controle. */
.floating-contact__title:focus {
  outline: none;
}

.floating-contact__intro,
.floating-contact__text {
  margin: 0;
}

.floating-contact__intro {
  color: var(--mf-muted);
}

.floating-contact__options {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.floating-contact__options li {
  margin: 0;
}

.fc-option {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) 20px;
  gap: 12px;
  align-items: center;
  width: 100%;
  min-height: 64px;
  padding: 12px 14px;
  border: 1px solid var(--mf-control-border);
  border-radius: 14px;
  background: var(--mf-paper);
  color: var(--mf-ink);
  font: inherit;
  text-align: left;
  text-decoration: none;
  cursor: pointer;
}

.fc-option:hover {
  background: var(--mf-cream);
  text-decoration: none;
}

.fc-option--primary {
  border: 2px solid var(--mf-forest);
  background: var(--mf-mint);
}

.fc-option--primary:hover {
  background: var(--mf-mint-strong);
}

.fc-option__icon {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: var(--mf-forest);
  color: #fff;
}

.fc-option__icon--plain {
  background: var(--mf-mint);
  color: var(--mf-forest);
}

.fc-option__icon .icon {
  width: 22px;
  height: 22px;
}

.fc-option__body {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.fc-option__label {
  font-weight: 700;
  color: var(--mf-forest);
}

.fc-option__text {
  font-size: 0.875rem;
  color: var(--mf-muted);
}

.fc-option--primary .fc-option__text {
  color: var(--mf-ink);
}

.fc-option__tag {
  justify-self: start;
  margin-top: 4px;
  padding: 2px 10px;
  border-radius: 999px;
  background: var(--mf-forest);
  color: #fff;
  font-size: 0.8125rem;
  font-weight: 600;
}

.fc-option__arrow {
  width: 20px;
  height: 20px;
  color: var(--mf-forest);
}

.floating-contact__more,
.floating-contact__link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  justify-self: start;
  min-height: 44px;
  color: var(--mf-forest);
  font-weight: 600;
}

.floating-contact__more .icon {
  width: 18px;
  height: 18px;
}

.floating-contact__care {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr);
  gap: 8px;
  margin: 0;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--mf-cream);
}

.floating-contact__care .icon {
  width: 20px;
  height: 20px;
  margin-top: 1px;
  color: var(--mf-forest);
}

.floating-contact__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.floating-contact__fallback {
  display: grid;
  gap: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.floating-contact__fallback li {
  margin: 0;
}

.floating-contact__fallback a {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  color: var(--mf-forest);
  font-weight: 600;
}

.floating-contact__fallback .icon {
  width: 18px;
  height: 18px;
}

/* Celular ---------------------------------------------------------------------------------------------- */
@media (max-width: 639px) {
  .floating-contact__toggle {
    width: 56px;
    padding: 0;
  }

  .floating-contact__label {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
}

@media (max-width: 767px) {
  /* Teclado aberto: o botão não fica por cima do campo nem do botão de envio. */
  .floating-contact.is-typing {
    display: none;
  }
}

/* Canais de conversa já na área visível: o botão se recolhe (em qualquer largura) e volta quando saem. */
.floating-contact.is-collapsed {
  display: none;
}

@media print {
  .floating-contact {
    display: none;
  }
}
</style>

<style>
/*
 * Com o botão flutuante na página, o fim do rodapé não fica embaixo dele. O espaço continua reservado quando o
 * botão está recolhido (canais na tela, campo em foco): ele volta a qualquer momento, e tirar e pôr o espaço
 * mudaria a altura da página e a própria visibilidade dos canais (ida e volta sem fim).
 */
html.mf-floating-contact .site-footer {
  padding-bottom: calc(var(--mf-space-5) + 80px);
}
</style>
