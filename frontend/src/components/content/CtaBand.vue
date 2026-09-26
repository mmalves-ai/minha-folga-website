<script setup lang="ts">
import { computed } from 'vue'
import { publicConfig, site } from '@/services/site'
import AppIcon from '@/components/ui/AppIcon.vue'
import AvailabilityNotice from '@/components/site/AvailabilityNotice.vue'
import type { LinkItem } from '@/types/content'

/** Faixa de conversão/encerramento em fundo forest. `availability` exibe o aviso junto a CTAs de crédito. */
const props = withDefaults(
  defineProps<{
    title: string
    text?: string
    primary: LinkItem
    secondary?: LinkItem
    availability?: boolean
    id?: string
  }>(),
  { availability: false, id: 'cta-final' },
)
const waitlistClosed = computed(() => !publicConfig.collection.waitlistEnabled && props.primary.to.split('#')[0] === '/avise-me')
const primaryLink = computed(() => waitlistClosed.value ? site.nav.closedCta : props.primary)
const displayTitle = computed(() => waitlistClosed.value ? site.nav.closedCtaTitle : props.title)
const displayText = computed(() => waitlistClosed.value ? site.nav.closedCtaText : props.text)
</script>

<template>
  <section class="section section--forest cta-band" :aria-labelledby="`${id}-titulo`">
    <div class="container cta-band__inner">
      <div>
        <h2 :id="`${id}-titulo`">{{ displayTitle }}</h2>
        <p v-if="displayText" class="lead">{{ displayText }}</p>
      </div>
      <div class="cta-band__actions">
        <div class="cluster">
          <RouterLink :to="primaryLink.to" class="btn btn--light">{{ primaryLink.label }} <AppIcon name="arrow-right" /></RouterLink>
          <RouterLink v-if="secondary" :to="secondary.to" class="btn btn--outline-light">{{ secondary.label }}</RouterLink>
        </div>
        <AvailabilityNotice v-if="availability" tone="dark" microcopy />
      </div>
    </div>
  </section>
</template>

<style scoped>
.cta-band__inner {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
  gap: var(--mf-space-6);
  align-items: center;
}

.cta-band .lead {
  color: var(--mf-cream);
  margin-bottom: 0;
}

.cta-band__actions {
  display: grid;
  gap: var(--mf-space-4);
}

@media (max-width: 1023px) {
  .cta-band__inner {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--mf-space-5);
  }
}
</style>
