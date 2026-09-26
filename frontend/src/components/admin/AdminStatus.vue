<script setup lang="ts">
/** Selo de estado: texto sempre visível + marcador com forma própria por tom (não depende de cor). */
import type { StatusTone } from './labels'

defineProps<{ label: string; tone: StatusTone }>()
</script>

<template>
  <span class="admin-status" :class="`admin-status--${tone}`">
    <span class="admin-status__mark" aria-hidden="true" />
    {{ label }}
  </span>
</template>
