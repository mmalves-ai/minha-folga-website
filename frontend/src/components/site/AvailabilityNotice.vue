<script setup lang="ts">
import AppIcon from '@/components/ui/AppIcon.vue'
import { availability } from '@/services/site'

/**
 * Aviso de disponibilidade financeira, exibido junto aos CTAs relacionados ao crédito.
 * O texto vem de content/site.yaml conforme a fase vigente (build).
 */
withDefaults(defineProps<{ tone?: 'light' | 'dark' | 'mint'; microcopy?: boolean }>(), { tone: 'light', microcopy: false })
</script>

<template>
  <div class="notice" :class="{ 'notice--on-dark': tone === 'dark', 'notice--mint': tone === 'mint' }" role="note">
    <AppIcon name="info" />
    <div>
      <p>{{ availability.short }}</p>
      <p v-if="microcopy"><strong>{{ availability.microcopy }}</strong></p>
    </div>
  </div>
</template>
