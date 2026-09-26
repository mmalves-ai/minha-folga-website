<script setup lang="ts">
/** Logo horizontal oficial (lettering vetorial). Largura mínima 140 px; versão reversa em fundo escuro. */
withDefaults(defineProps<{ variant?: 'default' | 'reverse'; width?: number }>(), { variant: 'default', width: 168 })
</script>

<template>
  <img
    :src="variant === 'reverse' ? '/brand/minha-folga-logo-reverso.svg' : '/brand/minha-folga-logo.svg'"
    alt="Minha Folga"
    :width="width"
    :height="Math.round((width * 76) / 338)"
    class="brand-logo"
    decoding="async"
  />
</template>

<style scoped>
.brand-logo {
  min-width: 140px;
  height: auto;
}
</style>
