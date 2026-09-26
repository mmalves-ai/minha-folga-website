<script setup lang="ts">
import content from '@content/pages/aquisicao.yaml'
import type { AcquisitionContent } from '@/types/acquisition'
import AppIcon from '@/components/ui/AppIcon.vue'
import { publicConfig } from '@/services/site'
const t = (content as AcquisitionContent).steps
</script>
<template>
  <section class="section section--paper acquisition-steps" aria-labelledby="aviso-passos-titulo">
    <div class="container">
      <div class="acquisition-steps__head"><div><p class="eyebrow">{{ t.eyebrow }}</p><h2 id="aviso-passos-titulo">{{ publicConfig.collection.waitlistEnabled ? t.title : t.titleClosed }}</h2></div><RouterLink to="/como-funciona" class="link-arrow">{{ t.link }} <AppIcon name="arrow-right" /></RouterLink></div>
      <ol class="acquisition-steps__list">
        <li><span class="acquisition-steps__number" aria-hidden="true">01</span><p class="acquisition-steps__tag">{{ publicConfig.collection.waitlistEnabled ? t.first.tag : t.first.tagClosed }}</p><h3>{{ t.first.title }}</h3><p>{{ publicConfig.collection.waitlistEnabled ? t.first.text : t.first.textClosed }}</p></li>
        <li><span class="acquisition-steps__number" aria-hidden="true">02</span><p class="acquisition-steps__tag">{{ t.second.tag }}</p><h3>{{ t.second.title }}</h3><p>{{ t.second.text }}</p></li>
        <li><span class="acquisition-steps__number" aria-hidden="true">03</span><p class="acquisition-steps__tag">{{ t.third.tag }}</p><h3>{{ t.third.title }}</h3><p>{{ t.third.text }}</p></li>
      </ol>
      <p class="acquisition-steps__note"><AppIcon name="info" /> {{ t.note }}</p>
    </div>
  </section>
</template>
<style scoped>
.acquisition-steps__head { display: flex; justify-content: space-between; align-items: end; gap: 24px; margin-bottom: 40px; }
.acquisition-steps__head h2 { margin-bottom: 0; font-size: clamp(30px, 3vw, 40px); }
.acquisition-steps__list { display: grid; grid-template-columns: repeat(3, 1fr); gap: 40px; list-style: none; padding: 0; margin: 0; }
.acquisition-steps__list li { margin: 0; border-top: 1px solid var(--mf-border); padding-top: 24px; }
.acquisition-steps__number { display: block; color: #48735c; font-family: var(--mf-font-heading); font-size: 2.25rem; letter-spacing: -.06em; margin-bottom: 22px; }
.acquisition-steps__tag { font-size: .75rem; color: var(--mf-muted); margin-bottom: 8px; }
.acquisition-steps h3 { font-size: 1.25rem; }
.acquisition-steps__list li > p:last-child { color: var(--mf-muted); font-size: .9375rem; margin: 0; max-width: 34ch; }
.acquisition-steps__note { display: flex; gap: 10px; align-items: start; margin: 32px 0 0; padding-top: 24px; border-top: 1px solid var(--mf-border); font-size: .875rem; }
.acquisition-steps__note .icon { width: 19px; height: 19px; flex: none; }
@media (max-width: 767px) { .acquisition-steps__head { display: block; margin-bottom: 24px; } .acquisition-steps__list { grid-template-columns: 1fr; gap: 24px; } .acquisition-steps__number { float: left; margin-right: 24px; margin-bottom: 60px; } .acquisition-steps__list li { padding-top: 20px; } }
</style>
