<script setup lang="ts">
import page from '@content/pages/como-funciona.yaml'
import InstitutionalCta from '@/components/pages/InstitutionalCta.vue'
import { byWaitlist } from '@/components/pages/institutional'
import PageHero from '@/components/site/PageHero.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { useSeo } from '@/composables/useSeo'
import { publicConfig, site } from '@/services/site'
import type { LinkItem } from '@/types/content'

useSeo({ title: page.meta.title, description: page.meta.description })
const collecting = publicConfig.collection.waitlistEnabled
const lead = byWaitlist(page.hero.lead as string, page.hero.leadWaitlistClosed as string)
const cta = byWaitlist(site.nav.cta as LinkItem, site.nav.closedCta as LinkItem)
type SimpleStep = { title: string; text: string; closedTitle?: string; closedText?: string }
const steps = (page.simple.steps as SimpleStep[]).map(step => ({
  title: !collecting && step.closedTitle ? step.closedTitle : step.title,
  text: !collecting && step.closedText ? step.closedText : step.text,
}))
</script>

<template>
  <PageHero :title="page.hero.title" :lead="lead" :eyebrow="page.hero.eyebrow" :breadcrumbs="[{ label: page.breadcrumb, to: '/como-funciona' }]">
    <RouterLink :to="cta.to" class="btn btn--primary hiw-cta">{{ cta.label }} <AppIcon name="arrow-right" /></RouterLink>
  </PageHero>
  <section class="section section--paper" aria-labelledby="hiw-etapas-titulo">
    <div class="container">
      <h2 id="hiw-etapas-titulo">{{ page.simple.title }}</h2>
      <ol class="hiw-simple-steps">
        <li v-for="(step, i) in steps" :id="`etapa-${i + 1}`" :key="step.title">
          <span class="hiw-simple-number" aria-hidden="true">{{ String(i + 1).padStart(2, '0') }}</span>
          <div><h3>{{ step.title }}</h3><p>{{ step.text }}</p></div>
        </li>
      </ol>
    </div>
  </section>
  <section class="section" aria-labelledby="hiw-compare-title">
    <div class="container hiw-compare">
      <div><p class="eyebrow">{{ page.understand.eyebrow }}</p><h2 id="hiw-compare-title">{{ page.simple.titleCompare }}</h2><p>{{ page.simple.textCompare }}</p></div>
      <a :href="page.simple.compareLink.to" class="btn btn--secondary" download="minha-folga-guia-de-comparacao.pdf"><AppIcon name="book" /> {{ page.simple.compareLink.label }}</a>
    </div>
  </section>
  <InstitutionalCta id="como-funciona-cta" :title="page.simple.closingTitle" :text="page.simple.closingText" :primary="site.nav.cta" joined />
</template>

<style scoped>
.hiw-cta { margin-top: var(--mf-space-4); }
.hiw-simple-steps { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 40px 64px; list-style: none; margin: 40px 0 0; padding: 0; }
.hiw-simple-steps li { display: grid; grid-template-columns: 56px minmax(0,1fr); gap: 20px; border-top: 1px solid var(--mf-border); padding-top: 28px; }
.hiw-simple-number { color: var(--mf-forest); font-family: var(--mf-font-heading); font-size: 2rem; line-height: 1.2; }
.hiw-simple-steps h3 { font-size: 1.375rem; margin-bottom: 10px; }
.hiw-simple-steps p { margin: 0; color: var(--mf-muted); }
.hiw-compare { display: flex; align-items: center; gap: 60px; justify-content: space-between; }
.hiw-compare > div { max-width: 60ch; }
.hiw-compare .btn { flex: none; }
@media(max-width: 767px) { .hiw-simple-steps { grid-template-columns: 1fr; gap: 24px; } .hiw-simple-steps li { grid-template-columns: 36px minmax(0,1fr); gap: 16px; } .hiw-compare { display: block; } .hiw-compare .btn { margin-top: 16px; } }
</style>
