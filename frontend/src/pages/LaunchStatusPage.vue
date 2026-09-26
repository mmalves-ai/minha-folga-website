<script setup lang="ts">
import page from '@content/pages/lancamento.yaml'
import InstitutionalCta from '@/components/pages/InstitutionalCta.vue'
import { byWaitlist } from '@/components/pages/institutional'
import PageHero from '@/components/site/PageHero.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { useSeo } from '@/composables/useSeo'
import { publicConfig, site } from '@/services/site'
import type { LinkItem } from '@/types/content'

useSeo({ title: page.meta.title, description: page.meta.description })
const collecting = publicConfig.collection.waitlistEnabled
const primary = byWaitlist(page.hero.cta as LinkItem, site.nav.closedCta as LinkItem)
const benefits = page.benefits.items as { icon: 'layers' | 'list' | 'chat'; title: string; text: string }[]
const steps = page.queue.steps as { title: string; text: string }[]
</script>

<template>
  <PageHero :eyebrow="page.hero.eyebrow" :title="page.hero.title" :lead="page.hero.lead" :breadcrumbs="[{ label: page.hero.eyebrow, to: '/lancamento' }]">
    <div class="cluster launch-actions">
      <RouterLink :to="collecting ? primary.to : page.hero.secondary.to" class="btn btn--primary">{{ collecting ? primary.label : page.hero.secondary.label }} <AppIcon name="arrow-right" /></RouterLink>
      <RouterLink v-if="collecting" :to="page.hero.secondary.to" class="btn btn--secondary">{{ page.hero.secondary.label }}</RouterLink>
    </div>
    <template #aside>
      <aside class="launch-benefits" aria-labelledby="launch-benefits-title">
        <h2 id="launch-benefits-title">{{ page.benefits.title }}</h2>
        <ul>
          <li v-for="item in benefits" :key="item.title"><AppIcon :name="item.icon" /><div><h3>{{ item.title }}</h3><p>{{ item.text }}</p></div></li>
        </ul>
      </aside>
    </template>
  </PageHero>

  <section class="section section--paper" aria-labelledby="launch-queue-title">
    <div class="container">
      <div class="section-head"><h2 id="launch-queue-title">{{ collecting ? page.queue.title : page.queue.titleClosed }}</h2><p>{{ collecting ? page.queue.text : page.queue.textClosed }}</p></div>
      <ol v-if="collecting" class="launch-steps">
        <li v-for="(step, i) in steps" :key="step.title"><span aria-hidden="true">{{ i + 1 }}</span><h3>{{ step.title }}</h3><p>{{ step.text }}</p></li>
      </ol>
      <p class="small muted">{{ page.queue.note }}</p>
    </div>
  </section>

  <InstitutionalCta id="lancamento-cta" :title="page.notify.title" :text="page.notify.text" :primary="page.notify.cta" :secondary="page.notify.preferences" joined />
</template>

<style scoped>
.launch-actions { margin-top: var(--mf-space-4); }
.launch-benefits { background: var(--mf-mint); border-radius: 28px; padding: var(--mf-space-5); }
.launch-benefits h2 { font-size: clamp(30px, 2.5vw, 36px); }
.launch-benefits ul { list-style: none; padding: 0; margin: var(--mf-space-4) 0 0; }
.launch-benefits li { display: grid; grid-template-columns: 28px minmax(0,1fr); gap: 16px; margin-top: 24px; }
.launch-benefits li > .icon { width: 26px; height: 26px; margin-top: 2px; color: var(--mf-forest); }
.launch-benefits h3 { font-size: 1.25rem; margin-bottom: 6px; }
.launch-benefits p { margin: 0; }
.launch-steps { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 40px; list-style: none; padding: 0; margin: 40px 0; }
.launch-steps li > span { display: grid; place-items: center; width: 48px; height: 48px; border-radius: 50%; background: var(--mf-mint); color: var(--mf-forest); font-weight: 700; margin-bottom: 20px; }
.launch-steps h3 { font-size: 1.375rem; }
.launch-steps p { color: var(--mf-muted); }
@media(max-width: 767px) { .launch-benefits { padding: 24px; } .launch-steps { grid-template-columns: 1fr; gap: 20px; } .launch-steps li { border-top: 1px solid var(--mf-border); padding-top: 24px; } }
</style>
