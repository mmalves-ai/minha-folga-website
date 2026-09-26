<script setup lang="ts">
import content from '@content/pages/aquisicao.yaml'
import type { AcquisitionContent } from '@/types/acquisition'
import AppIcon from '@/components/ui/AppIcon.vue'
const t = (content as AcquisitionContent).bia
</script>
<template>
  <section id="ia-a-seu-favor" class="section section--forest home-bia" aria-labelledby="home-bia-titulo">
    <div class="container home-bia__grid">
      <div class="home-bia__copy">
        <p class="eyebrow"><AppIcon name="spark" /> {{ t.eyebrow }}</p>
        <h2 id="home-bia-titulo">{{ t.title }}<br /><span>{{ t.titleAccent }}</span></h2>
        <p class="home-bia__lead">{{ t.lead }}</p>
        <p class="home-bia__support">{{ t.support }}</p>
        <RouterLink to="/bia" class="link-arrow">{{ t.fallbackCta }} <AppIcon name="arrow-right" /></RouterLink>
        <div class="home-bia__technology"><img src="/brand/hal-ai-logo.png" :alt="t.technology.name" width="28" height="28" loading="lazy" /><span>{{ t.technology.label }} <strong>{{ t.technology.name }}</strong></span></div>
      </div>
      <div class="ai-path" role="group" :aria-label="t.flowTitle">
        <p class="ai-path__label">{{ t.pending }}</p>
        <ol class="ai-path__steps">
          <li v-for="(item, index) in t.flow" :key="item.title" :class="{ 'ai-path__intelligence': index === 1 }">
            <span class="ai-path__icon" aria-hidden="true"><AppIcon :name="item.icon" /></span>
            <div><h3>{{ item.title }}</h3><p>{{ item.text }}</p></div>
            <span class="ai-path__number" aria-hidden="true">0{{ index + 1 }}</span>
          </li>
        </ol>
      </div>
    </div>
  </section>
</template>
<style scoped>
.home-bia { padding-block: 72px; scroll-margin-top: var(--mf-header-height); }
.home-bia__grid { display: grid; grid-template-columns: 1fr 1fr; align-items: center; gap: 80px; }
.home-bia .eyebrow::before { display: none; }
.home-bia .eyebrow .icon { width: 20px; height: 20px; }
.home-bia h2 { font-size: clamp(32px, 3.3vw, 46px); line-height: 1.18; letter-spacing: -.04em; }
.home-bia h2 span { color: #b8d5c1; }
.home-bia__lead { font-size: 1.125rem; max-width: 38ch; margin-top: 24px; }
.home-bia__support { color: var(--mf-cream-on-dark-muted); max-width: 42ch; margin-bottom: 12px; }
.home-bia__technology { display: flex; align-items: center; gap: 8px; font-size: .75rem; margin-top: 22px; color: var(--mf-cream-on-dark-muted); }
.home-bia__technology img { border-radius: 50%; }
.ai-path { color: var(--mf-ink); background: #e8efe7; border-radius: 28px; padding: 28px; }
.ai-path__label { font-size: .8125rem; margin: 0 0 24px; color: var(--mf-muted); }
.ai-path__steps { padding: 0; margin: 0; list-style: none; }
.ai-path__steps li { display: grid; grid-template-columns: 44px 1fr 26px; gap: 16px; align-items: center; position: relative; margin: 0; }
.ai-path__steps li + li { margin-top: 24px; }
.ai-path__steps li:not(:last-child)::after { content: ''; position: absolute; left: 21px; top: 47px; height: 19px; border-left: 2px dotted #7c9685; }
.ai-path__icon { width: 44px; height: 44px; display: grid; place-items: center; border-radius: 50%; border: 1px solid #aac2b0; background: var(--mf-paper); }
.ai-path__icon .icon { width: 22px; height: 22px; }
.ai-path__intelligence .ai-path__icon { background: var(--mf-forest); color: white; border-color: var(--mf-forest); box-shadow: 0 0 0 5px #c4d9c7; }
.ai-path h3 { font-size: 1.0625rem; margin: 0 0 3px; }
.ai-path p { font-size: .875rem; }
.ai-path__steps p { margin: 0; color: var(--mf-muted); }
.ai-path__number { color: #526a5a; font-size: .75rem; }
@media (max-width: 1023px) { .home-bia__grid { gap: 32px; } }
@media (max-width: 767px) {
 .home-bia { padding-block: 44px; }
 .home-bia__grid { grid-template-columns: 1fr; gap: 28px; }
 .home-bia__lead { margin-top: 16px; font-size: 1rem; }
 .home-bia__support { font-size: .9375rem; }
 .ai-path { padding: 22px 18px; border-radius: 22px; }
 .ai-path__steps li { gap: 12px; }
 .ai-path__steps li + li { margin-top: 22px; }
}
</style>
