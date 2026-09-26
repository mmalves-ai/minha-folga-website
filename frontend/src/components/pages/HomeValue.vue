<script setup lang="ts">
import content from '@content/pages/aquisicao.yaml'
import type { AcquisitionContent } from '@/types/acquisition'
import PhotoAsset from '@/components/site/PhotoAsset.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { publicConfig } from '@/services/site'
import { track } from '@/services/analytics'
import { useRoute } from 'vue-router'
const t = (content as AcquisitionContent).value
const route = useRoute()
const source = () => route.path === '/' ? 'home' : 'avise-me'
</script>
<template>
  <section class="section home-value" aria-labelledby="home-proposta-titulo">
    <div class="container">
      <div class="home-value__head">
        <p class="eyebrow">{{ t.eyebrow }}</p>
        <h2 id="home-proposta-titulo">{{ t.title }}<br /><span>{{ t.titleEnd }}</span></h2>
        <p>{{ t.intro }}</p>
      </div>
      <div class="home-value__grid">
        <article v-for="item in t.opportunities" :id="item.id" :key="item.id" class="opportunity">
          <div class="opportunity__photo">
            <PhotoAsset :name="item.photo" :alt="item.alt" sizes="(max-width: 767px) calc(100vw - 40px), (max-width: 1199px) 46vw, 580px" />
            <span class="opportunity__tag"><AppIcon :name="item.icon" /> {{ item.tag }}</span>
          </div>
          <div class="opportunity__body">
            <h3>{{ item.title }}</h3>
            <p>{{ item.text }}</p>
            <a v-if="publicConfig.collection.waitlistEnabled" href="#formulario" class="link-arrow" @click="track('waitlist_cta_click', source())">{{ item.link }} <AppIcon name="arrow-right" /></a>
            <RouterLink v-else to="/lancamento" class="link-arrow">{{ t.closedCta }} <AppIcon name="arrow-right" /></RouterLink>
          </div>
        </article>
      </div>
      <p class="home-value__note">{{ t.note }} <span>{{ t.photoCredit }}</span></p>
    </div>
  </section>
</template>
<style scoped>
.home-value { padding-block: 72px; }
.home-value__head { max-width: 740px; margin-bottom: 32px; }
.home-value h2 { font-size: clamp(29px, 3vw, 40px); letter-spacing: -.035em; }
.home-value h2 span { color: #48735c; }
.home-value__head > p:last-child { color: var(--mf-muted); margin: 0; }
.home-value__grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 28px; }
.opportunity { border-radius: 24px; overflow: hidden; background: var(--mf-paper); border: 1px solid var(--mf-border); scroll-margin-top: calc(var(--mf-header-height) + 16px); }
.opportunity__photo { position: relative; }
.opportunity__photo :deep(picture) { aspect-ratio: 2 / 1; }
.opportunity__tag { position: absolute; left: 18px; bottom: 16px; display: inline-flex; align-items: center; gap: 8px; border-radius: 999px; background: var(--mf-cream); padding: 9px 14px; font-size: .8125rem; font-weight: 600; }
.opportunity__tag .icon { width: 18px; height: 18px; }
.opportunity__body { padding: 26px 28px 24px; }
.opportunity h3 { font-size: clamp(1.25rem, 2vw, 1.625rem); letter-spacing: -.035em; margin-bottom: 12px; }
.opportunity p { color: var(--mf-muted); max-width: 48ch; margin-bottom: 8px; }
.opportunity .link-arrow { margin-top: 4px; font-size: .9375rem; }
.home-value__note { margin: 20px 0 0; font-size: .875rem; color: var(--mf-muted); max-width: 90ch; }
.home-value__note span { display: block; font-size: .6875rem; margin-top: 4px; }
@media (max-width: 767px) {
 .home-value { padding-block: 44px; }
 .home-value__head { margin-bottom: 24px; }
 .home-value__grid { grid-template-columns: 1fr; gap: 20px; }
 .opportunity__body { padding: 20px; }
 .opportunity__photo :deep(picture) { aspect-ratio: 1.85 / 1; }
 .opportunity__tag { left: 12px; bottom: 12px; padding: 7px 11px; font-size: .75rem; }
 .opportunity p { font-size: .9375rem; }
}
</style>
