<script setup lang="ts">
import content from '@content/pages/aquisicao.yaml'
import type { AcquisitionContent } from '@/types/acquisition'
import page from '@content/pages/avise-me.yaml'
import faq from '@content/faq.yaml'
import HomeHero from '@/components/pages/HomeHero.vue'
import HomeValue from '@/components/pages/HomeValue.vue'
import AcquisitionReason from '@/components/pages/AcquisitionReason.vue'
import HomeBia from '@/components/pages/HomeBia.vue'
import AcquisitionSignup from '@/components/pages/AcquisitionSignup.vue'
import AcquisitionTrust from '@/components/pages/AcquisitionTrust.vue'
import BrowserNotifications from '@/components/site/BrowserNotifications.vue'
import FaqAccordion from '@/components/content/FaqAccordion.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { track } from '@/services/analytics'
import { publicConfig } from '@/services/site'
import { useSeo } from '@/composables/useSeo'
import { useUtm } from '@/composables/useUtm'
import type { FaqBase, FaqItem } from '@/types/content'
const t = (content as AcquisitionContent).landing
useSeo({ title: page.meta.title, description: page.meta.description })
useUtm()
const faqItems = (page.faq.ids as string[]).map((id) => (faq as FaqBase).items.find((item) => item.id === id)).filter((item): item is FaqItem => Boolean(item))
</script>
<template>
  <div class="acquisition-landing">
    <HomeHero acquisition />
    <HomeValue />
    <HomeBia />
    <AcquisitionReason source="avise-me" />
    <AcquisitionSignup source="avise-me" />
  <AcquisitionTrust />
  <div class="container"><BrowserNotifications /></div>
    <section class="section section--paper" aria-labelledby="duvidas-titulo">
      <div class="container landing-faq">
        <div><p class="eyebrow">{{ t.faq.eyebrow }}</p><h2 id="duvidas-titulo">{{ t.faq.title }}<br />{{ t.faq.titleEnd }}</h2><p>{{ t.faq.text }}</p><RouterLink to="/ajuda" class="link-arrow">{{ t.faq.link }} <AppIcon name="arrow-right" /></RouterLink></div>
        <FaqAccordion :items="faqItems" id-prefix="avise-faq" :heading-level="3" />
      </div>
      <div class="container landing-faq__closing"><a v-if="publicConfig.collection.waitlistEnabled" href="#formulario" class="btn btn--primary" @click="track('waitlist_cta_click', 'avise-me')">{{ t.closing.primaryCta }} <AppIcon name="arrow-right" /></a><RouterLink v-else to="/lancamento" class="btn btn--primary">{{ t.closing.closedCta }} <AppIcon name="arrow-right" /></RouterLink><p>{{ t.closing.note }}</p></div>
    </section>
  </div>
</template>
<style scoped>
.landing-faq { display: grid; grid-template-columns: .85fr 1.15fr; gap: 80px; }
.landing-faq h2 { font-size: clamp(30px, 3vw, 40px); letter-spacing: -.035em; }
.landing-faq p { color: var(--mf-muted); }
.landing-faq__closing { text-align: center; margin-top: 48px; }
.landing-faq__closing .btn { border-radius: 999px; }
.landing-faq__closing p { font-size: .8125rem; color: var(--mf-muted); margin: 14px auto 0; max-width: 55ch; }
@media (max-width: 767px) { .landing-faq { grid-template-columns: 1fr; gap: 24px; } .landing-faq__closing .btn { width: 100%; } }
</style>
