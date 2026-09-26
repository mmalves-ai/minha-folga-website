<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import CookieConsent from '@/components/site/CookieConsent.vue'
import FloatingContact from '@/components/site/FloatingContact.vue'
import MobileSignupCta from '@/components/site/MobileSignupCta.vue'
import SiteFooter from '@/components/site/SiteFooter.vue'
import SiteHeader from '@/components/site/SiteHeader.vue'

const route = useRoute()
const main = ref<HTMLElement | null>(null)
const announcement = ref('')

// Navegação no cliente: leva o foco ao conteúdo e anuncia o título da nova página.
watch(
  () => route.path,
  async (to, from) => {
    if (!from || to === from) return
    await nextTick()
    setTimeout(() => {
      // Com âncora (#id), a própria página cuida do foco do alvo; aqui só anunciamos o título.
      if (!route.hash) main.value?.focus({ preventScroll: true })
      announcement.value = document.title
    }, 60)
  },
)
</script>

<template>
  <a class="skip-link" href="#conteudo">Pular para o conteúdo</a>
  <SiteHeader />
  <main id="conteudo" ref="main" class="page-main" tabindex="-1">
    <slot />
  </main>
  <SiteFooter :class="{ 'acquisition-mobile-footer-space': route.path === '/' || route.path === '/avise-me' }" />
  <!-- Chat do site (Hal-AI, preferencial) e WhatsApp oficial (última alternativa); some sem canal configurado. -->
  <FloatingContact />
  <MobileSignupCta />
  <CookieConsent />
  <p class="visually-hidden" aria-live="polite" aria-atomic="true">{{ announcement }}</p>
</template>
