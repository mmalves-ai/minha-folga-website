<script setup lang="ts">
import content from '@content/pages/aquisicao.yaml'
import type { AcquisitionContent } from '@/types/acquisition'
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import WaitlistForm from '@/components/forms/WaitlistForm.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { publicConfig } from '@/services/site'
const t = (content as AcquisitionContent).signup
const collecting = publicConfig.collection.waitlistEnabled
withDefaults(defineProps<{ source?: string }>(), { source: 'home' })
const route = useRoute()
const router = useRouter()
const formRef = ref<InstanceType<typeof WaitlistForm> | null>(null)
function revealForm() {
  const target = formRef.value?.focusFirst()
  if (!target) return
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  target.scrollIntoView({ block: 'center', behavior: reduced ? 'instant' : 'smooth' })
}
function followAnchor(event: MouseEvent) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  const anchor = (event.target as Element | null)?.closest('a')
  if (!anchor) return
  const destination = new URL(anchor.href, window.location.href)
  if (destination.origin !== window.location.origin || destination.pathname !== window.location.pathname || destination.hash !== '#formulario') return
  event.preventDefault()
  revealForm()
}
onMounted(async () => {
  document.addEventListener('click', followAnchor)
  // Na hidratação SSG, a rota inicial pode ainda não conter o fragmento da URL.
  await router.isReady()
  await nextTick()
  if (route.hash === '#formulario') requestAnimationFrame(revealForm)
})
onBeforeUnmount(() => document.removeEventListener('click', followAnchor))
</script>
<template>
  <section id="formulario" class="section acquisition-signup" aria-labelledby="cadastro-titulo">
    <div class="container acquisition-signup__grid">
      <div class="acquisition-signup__intro">
        <p class="eyebrow">{{ t.eyebrow }}</p>
        <h2 id="cadastro-titulo">{{ collecting ? t.title : t.titleClosed }}<br /><span>{{ collecting ? t.titleAccent : t.titleAccentClosed }}</span></h2>
        <p class="lead">{{ collecting ? t.lead : t.leadClosed }}</p>
        <ul v-if="collecting" class="acquisition-signup__reasons" aria-label="Sobre o cadastro"><li v-for="reason in t.reasons" :key="reason"><AppIcon name="check" /> {{ reason }}</li></ul>
        <div v-if="collecting" class="acquisition-signup__privacy"><AppIcon name="lock" /><p>{{ t.privacy }} <RouterLink to="/privacidade">{{ t.privacyLink }}</RouterLink></p></div>
        <p v-if="collecting" class="acquisition-signup__note">{{ t.note }}</p>
      </div>
      <div class="acquisition-signup__form"><WaitlistForm ref="formRef" :source="source" /></div>
    </div>
  </section>
</template>
<style scoped>
.acquisition-signup { padding-block: 64px; background: #e7eee7; scroll-margin-top: calc(var(--mf-header-height) + 24px); }
.acquisition-signup__grid { display: grid; grid-template-columns: .9fr 1.1fr; gap: 80px; align-items: start; }
.acquisition-signup__intro { padding-block: 0; }
.acquisition-signup h2 { font-size: clamp(30px, 3.1vw, 43px); line-height: 1.2; letter-spacing: -.04em; }
.acquisition-signup h2 span { color: #48735c; }
.acquisition-signup .lead { font-size: 1.0625rem; margin-top: 16px; max-width: 42ch; }
.acquisition-signup__reasons { list-style: none; padding: 0; margin: 20px 0; display: flex; flex-wrap: wrap; gap: 10px 16px; }
.acquisition-signup__reasons li { display: flex; gap: 10px; align-items: start; font-size: .8125rem; margin: 0; }
.acquisition-signup .icon { width: 20px; height: 20px; flex: none; color: var(--mf-forest); }
.acquisition-signup__privacy { display: flex; align-items: start; gap: 12px; padding-top: 16px; border-top: 1px solid #b5c8b9; }
.acquisition-signup__privacy p { font-size: .875rem; color: var(--mf-muted); line-height: 1.7; }
.acquisition-signup__privacy a { display: inline-block; padding-block: 6px; }
.acquisition-signup__note { font-size: .875rem; max-width: 45ch; }
.acquisition-signup__form { background: white; border-radius: 24px; padding: 32px; border: 1px solid var(--mf-border); box-shadow: var(--mf-shadow-soft); min-width: 0; }
@media (max-width: 1023px) { .acquisition-signup__grid { gap: 32px; } }
@media (max-width: 767px) { .acquisition-signup { padding-block: 36px; } .acquisition-signup__grid { grid-template-columns: 1fr; gap: 16px; } .acquisition-signup__form { padding: 24px 20px; } .acquisition-signup__intro { padding: 0; } }
</style>
