<script setup lang="ts">
import CtaBand from '@/components/content/CtaBand.vue'
import type { LinkItem } from '@/types/content'

/**
 * Faixa de encerramento das páginas institucionais: a CtaBand compartilhada recortada como painel,
 * para não se fundir com o rodapé (também forest). `anchorId` permite chegar à faixa por âncora.
 */
withDefaults(
  defineProps<{
    title: string
    text?: string
    primary: LinkItem
    secondary?: LinkItem
    availability?: boolean
    id?: string
    anchorId?: string
    background?: 'cream' | 'paper'
    /** A seção anterior tem o mesmo fundo: dispensa o respiro superior. */
    joined?: boolean
  }>(),
  { availability: false, id: 'cta-final', background: 'cream', joined: false },
)
</script>

<template>
  <div :id="anchorId" class="inst-cta" :class="[`inst-cta--${background}`, { 'inst-cta--joined': joined }]">
    <CtaBand
      :id="id"
      class="inst-cta__band"
      :title="title"
      :text="text"
      :primary="primary"
      :secondary="secondary"
      :availability="availability"
    />
  </div>
</template>

<style scoped>
.inst-cta {
  padding: var(--mf-space-7) var(--mf-gutter);
  background: var(--mf-cream);
}

.inst-cta--joined {
  padding-top: 0;
}

.inst-cta--paper {
  background: var(--mf-paper);
}

.inst-cta__band {
  max-width: var(--mf-container);
  margin-inline: auto;
  border-radius: var(--mf-radius-panel);
  padding-block: var(--mf-space-7);
}

@media (max-width: 767px) {
  .inst-cta {
    padding: var(--mf-space-5) 12px;
  }

  .inst-cta--joined {
    padding-top: 0;
  }

  .inst-cta__band {
    border-radius: 28px;
    padding-block: var(--mf-space-6);
  }
}
</style>
