<script setup lang="ts">
import content from '@content/pages/aquisicao.yaml'
import type { AcquisitionContent } from '@/types/acquisition'
import AppIcon from '@/components/ui/AppIcon.vue'
import { publicConfig } from '@/services/site'
import { track } from '@/services/analytics'
withDefaults(defineProps<{ source?: 'home' | 'avise-me' }>(), { source: 'home' })
const t = (content as AcquisitionContent).reason
</script>
<template>
  <section v-if="publicConfig.collection.waitlistEnabled" class="acquisition-reason" aria-labelledby="fila-titulo">
    <div class="container acquisition-reason__grid">
      <div>
        <p class="eyebrow"><AppIcon name="clock" /> {{ t.eyebrow }}</p>
        <h2 id="fila-titulo">{{ t.title }}</h2>
        <p>{{ t.text }}</p>
      </div>
      <div class="acquisition-reason__action">
        <p><strong>{{ t.question }}</strong> {{ t.answer }}</p>
        <a href="#formulario" class="btn btn--primary" @click="track('waitlist_cta_click', source)">{{ t.cta }} <AppIcon name="arrow-right" /></a>
        <span>{{ t.note }}</span>
      </div>
    </div>
  </section>
</template>
<style scoped>
.acquisition-reason { background: #f4ecd9; border-block: 1px solid #e1d5b9; padding-block: 44px; }
.acquisition-reason__grid { display: grid; grid-template-columns: 1fr 1fr; align-items: center; gap: 80px; }
.acquisition-reason .eyebrow { color: #645022; margin-bottom: 12px; }
.acquisition-reason .eyebrow .icon { width: 18px; height: 18px; }
.acquisition-reason h2 { font-size: clamp(28px, 3vw, 40px); letter-spacing: -.04em; }
.acquisition-reason p { max-width: 48ch; }
.acquisition-reason__grid > div > p:last-child { color: var(--mf-muted); margin-bottom: 0; }
.acquisition-reason__action > p { font-size: .9375rem; }
.acquisition-reason .btn { border-radius: 999px; }
.acquisition-reason__action > span { display: block; font-size: .8125rem; margin-top: 10px; }
@media (max-width: 767px) {
 .acquisition-reason { padding-block: 36px; }
 .acquisition-reason__grid { grid-template-columns: 1fr; gap: 16px; }
 .acquisition-reason .btn { width: 100%; }
 .acquisition-reason__action > p { display: none; }
}
</style>
