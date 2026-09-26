<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import content from '@content/pages/aquisicao.yaml'
import type { AcquisitionContent } from '@/types/acquisition'
import AppIcon from '@/components/ui/AppIcon.vue'
import { publicConfig } from '@/services/site'
import { track } from '@/services/analytics'
import { useCookieChoice } from '@/composables/useCookieChoice'
import { fetchCollectionStatus } from '@/composables/useCollectionStatus'
const t = (content as AcquisitionContent).mobileCta
const route = useRoute()
const { needsDecision, load } = useCookieChoice()
const mounted = ref(false)
const small = ref(false)
const collecting = ref(publicConfig.collection.waitlistEnabled)
const heroVisible = ref(true)
const formVisible = ref(false)
const typing = ref(false)
const hasFocus = ref(false)
const onAcquisition = computed(() => route.path === '/' || route.path === '/avise-me')
const visible = computed(() => mounted.value && small.value && collecting.value && onAcquisition.value && !needsDecision.value && !typing.value && !formVisible.value && (!heroVisible.value || hasFocus.value))
let observer: IntersectionObserver | null = null
let media: MediaQueryList | null = null
function syncSize() { small.value = media?.matches ?? false }
function syncFocus() {
  const el = document.activeElement
  typing.value = el instanceof HTMLElement && Boolean(el.closest('input, textarea, select, [contenteditable="true"]'))
}
async function observePage() {
  observer?.disconnect()
  heroVisible.value = true
  formVisible.value = false
  if (!onAcquisition.value) return
  await nextTick()
  const status = await fetchCollectionStatus()
  if (status) collecting.value = status.waitlistEnabled
  if (!mounted.value || !onAcquisition.value) return
  const hero = document.querySelector('.home-hero__actions')
  const form = document.querySelector('.acquisition-signup__form')
  if (typeof IntersectionObserver === 'undefined') return
  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.target === hero) heroVisible.value = entry.isIntersecting
      if (entry.target === form) formVisible.value = entry.isIntersecting
    }
  }, { rootMargin: '0px 0px -90px 0px' })
  if (hero) observer.observe(hero)
  if (form) observer.observe(form)
}
watch(() => route.path, () => { if (mounted.value) void observePage() })
watch(visible, (show) => {
  if (typeof document !== 'undefined') document.documentElement.classList.toggle('mf-signup-cta-visible', show)
})
onMounted(() => {
  mounted.value = true
  load()
  media = window.matchMedia('(max-width: 767px)')
  syncSize()
  media.addEventListener('change', syncSize)
  document.addEventListener('focusin', syncFocus)
  document.addEventListener('focusout', syncFocus)
  window.visualViewport?.addEventListener('resize', syncFocus)
  void observePage()
})
onBeforeUnmount(() => {
  mounted.value = false
  observer?.disconnect()
  media?.removeEventListener('change', syncSize)
  document.removeEventListener('focusin', syncFocus)
  document.removeEventListener('focusout', syncFocus)
  window.visualViewport?.removeEventListener('resize', syncFocus)
  document.documentElement.classList.remove('mf-signup-cta-visible')
})
</script>
<template>
  <aside v-if="visible" class="mobile-signup" aria-label="Entrar na fila da Minha Folga">
    <span>{{ t.text }} <small>{{ t.note }}</small></span>
    <a href="#formulario" class="btn btn--primary" @focus="hasFocus = true" @blur="hasFocus = false" @click="track('waitlist_cta_click', route.path === '/' ? 'home' : 'avise-me')">{{ t.label }} <AppIcon name="arrow-right" /></a>
  </aside>
</template>
<style>
.mobile-signup { position: fixed; z-index: 55; left: 0; right: 0; bottom: 0; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px calc(12px + env(safe-area-inset-bottom, 0px)); border-top: 1px solid var(--mf-border); background: var(--mf-cream); box-shadow: 0 -6px 24px rgb(18 63 53 / 9%); }
.mobile-signup > span { font-size: .75rem; line-height: 1.4; font-weight: 600; max-width: 15ch; }
.mobile-signup small { display: block; font-size: .6875rem; color: var(--mf-muted); font-weight: 400; }
.mobile-signup .btn { border-radius: 999px; font-size: .875rem; padding: 13px 16px; min-height: 48px; white-space: nowrap; flex: none; }
.mobile-signup .icon { width: 18px; height: 18px; }
body.menu-open .mobile-signup, html.cookie-dialog-open .mobile-signup, .floating-contact.is-open ~ .mobile-signup { display: none; }
@media (max-width: 767px) {
 html.mf-signup-cta-visible .floating-contact:not(.is-open) { bottom: calc(94px + env(safe-area-inset-bottom, 0px)); }
 .site-footer.acquisition-mobile-footer-space { padding-bottom: 110px; }
}
@media print { .mobile-signup { display: none; } }
</style>
