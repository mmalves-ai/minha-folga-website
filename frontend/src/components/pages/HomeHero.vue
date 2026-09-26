<script setup lang="ts">
import content from '@content/pages/aquisicao.yaml'
import type { AcquisitionContent } from '@/types/acquisition'
import PhotoAsset from '@/components/site/PhotoAsset.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { track } from '@/services/analytics'
import { publicConfig } from '@/services/site'
const t = (content as AcquisitionContent).hero
withDefaults(defineProps<{ acquisition?: boolean }>(), { acquisition: false })
const collecting = publicConfig.collection.waitlistEnabled
</script>
<template>
  <section class="home-hero" aria-labelledby="titulo-pagina">
    <div class="container home-hero__grid">
      <div class="home-hero__copy">
        <p class="eyebrow">{{ t.eyebrow }}</p>
        <h1 id="titulo-pagina" class="home-hero__acquisition-title">{{ t.acquisitionTitle }}<br /><span>{{ t.acquisitionTitleAccent }}</span></h1>
        <p v-if="acquisition" class="home-hero__lead">{{ t.acquisitionLead }}</p>
        <p v-else class="home-hero__lead">{{ t.lead }}</p>
        <div class="home-hero__actions">
          <a v-if="acquisition && collecting" href="#formulario" class="btn btn--primary" @click="track('waitlist_cta_click', 'avise-me')">{{ t.primaryCta }} <AppIcon name="arrow-right" /></a>
          <RouterLink v-else :to="collecting ? '/avise-me#formulario' : '/lancamento'" class="btn btn--primary" @click="collecting && track('waitlist_cta_click', 'home')">{{ collecting ? t.primaryCta : t.closedCta }} <AppIcon name="arrow-right" /></RouterLink>
          <a href="#ia-a-seu-favor" class="home-hero__bia"><AppIcon name="spark" /> {{ t.biaCta }} <AppIcon name="arrow-right" /></a>
        </div>
        <p v-if="collecting" class="home-hero__why-now"><AppIcon name="check-circle" />{{ t.whyNow }}</p>
        <p class="home-hero__note">{{ t.note }}</p>
      </div>
      <figure class="home-hero__visual">
        <PhotoAsset name="hero" :alt="t.photoAlt" priority sizes="(max-width: 767px) calc(100vw - 40px), (max-width: 1100px) 48vw, 580px" class="home-hero__photo" />
        <div class="home-hero__caption" aria-hidden="true"><span class="home-hero__caption-icon"><AppIcon name="chat" /></span><span>{{ t.caption }}<br /><strong>{{ t.captionAccent }}</strong></span></div>
        <figcaption>{{ t.photoCredit }}</figcaption>
      </figure>
    </div>
    <div class="container"><div class="home-hero__values" :aria-label="t.valuesLabel">
      <span v-for="item in t.values" :key="item.icon"><AppIcon :name="item.icon" /> {{ item.text }}</span>
    </div></div>
  </section>
</template>
<style scoped>
.home-hero { padding-top: 36px; }
.home-hero__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 64px; align-items: center; }
.home-hero__copy { padding-block: 12px 24px; }
.home-hero__copy .eyebrow { font-size: .8125rem; letter-spacing: .065em; text-transform: uppercase; }
.home-hero h1 { font-size: clamp(42px, 4.3vw, 62px); line-height: 1.13; letter-spacing: -.055em; margin-bottom: 24px; }
.home-hero h1.home-hero__acquisition-title { font-size: clamp(40px, 4.1vw, 58px); }
.home-hero h1 span { color: #48735c; }
.home-hero__lead { max-width: 47ch; color: var(--mf-muted); font-size: 1.0625rem; line-height: 1.65; margin-bottom: 26px; }
.home-hero__actions { display: flex; flex-wrap: wrap; gap: 12px 24px; align-items: center; }
.home-hero__actions .btn { padding: 17px 24px; border-radius: 999px; }
.home-hero__bia { display: inline-flex; align-items: center; gap: 9px; font-size: .9375rem; font-weight: 600; min-height: 44px; text-decoration: none; }
.home-hero__bia .icon { width: 18px; height: 18px; }
.home-hero__why-now { display: flex; gap: 8px; align-items: start; margin: 14px 0 0; font-size: .875rem; font-weight: 600; max-width: 46ch; }
.home-hero__why-now .icon { width: 18px; height: 18px; flex: none; margin-top: 2px; }
.home-hero__note { font-size: .875rem; color: var(--mf-muted); max-width: 48ch; margin: 16px 0 0; line-height: 1.6; }
.home-hero__visual { position: relative; margin: 0; min-width: 0; padding-bottom: 22px; }
.home-hero__photo { display: block; height: 500px; border-radius: 180px 24px 24px 24px; overflow: hidden; background: var(--mf-mint); }
.home-hero__photo :deep(img) { height: 100%; object-fit: cover; object-position: 66% center; }
.home-hero__caption { position: absolute; bottom: 56px; left: -24px; display: flex; align-items: center; gap: 14px; background: var(--mf-paper); padding: 18px 24px; border: 1px solid var(--mf-border); border-radius: 16px; box-shadow: var(--mf-shadow-soft); font-size: .9375rem; line-height: 1.5; }
.home-hero__caption-icon { display: grid; place-items: center; width: 42px; height: 42px; background: var(--mf-mint); color: var(--mf-forest); border-radius: 50%; }
.home-hero__caption-icon .icon { width: 21px; height: 21px; }
.home-hero__visual figcaption { position: absolute; right: 4px; bottom: 0; color: var(--mf-muted); font-size: .6875rem; }
.home-hero__values { display: flex; justify-content: space-between; gap: 20px; margin-top: 28px; padding-block: 20px; border-block: 1px solid var(--mf-border); }
.home-hero__values span { display: flex; align-items: center; gap: 12px; font-size: .9375rem; }
.home-hero__values .icon { width: 22px; height: 22px; color: var(--mf-forest); }
@media (min-width: 768px) and (max-width: 1100px) { .home-hero__grid { gap: 32px; } .home-hero__photo { height: 540px; border-top-left-radius: 120px; } .home-hero h1 { font-size: 44px; } }
@media (max-width: 767px) {
  .home-hero { padding-top: 24px; } .home-hero__grid { grid-template-columns: 1fr; gap: 24px; } .home-hero__copy { padding: 0; }
  .home-hero h1.home-hero__acquisition-title { font-size: clamp(36px, 9.4vw, 40px); }
  .home-hero h1 { font-size: clamp(36px, 9.4vw, 48px); margin-bottom: 18px; } .desktop-break { display: none; }
  .home-hero__copy .eyebrow { font-size: .6875rem; letter-spacing: .035em; } .home-hero__lead { font-size: 1rem; margin-bottom: 20px; }
  .home-hero__actions { gap: 2px; } .home-hero__actions .btn { width: 100%; } .home-hero__bia { justify-content: center; width: 100%; }
  .home-hero__note { font-size: .875rem; margin-top: 8px; } .home-hero__photo { height: 230px; border-radius: 100px 20px 20px 20px; }
  .home-hero__caption { left: 12px; bottom: 42px; padding: 12px 16px; font-size: .8125rem; }
  .home-hero__values { margin-top: 24px; padding-block: 16px; gap: 8px; } .home-hero__values span { flex: 1; font-size: .75rem; flex-direction: column; text-align: center; gap: 6px; }
}
</style>
