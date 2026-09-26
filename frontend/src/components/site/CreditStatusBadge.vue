<script setup lang="ts">
import AppIcon from '@/components/ui/AppIcon.vue'
import { availability } from '@/services/site'

/** Identificação "Crédito em estruturação" para áreas relacionadas à contratação (texto + ícone, não só cor). */
withDefaults(defineProps<{ tone?: 'light' | 'dark' }>(), { tone: 'light' })
</script>

<template>
  <span class="badge" :class="tone === 'dark' ? 'badge--on-dark' : 'badge--lilac'">
    <AppIcon name="clock" />
    {{ availability.badge }}
  </span>
</template>
