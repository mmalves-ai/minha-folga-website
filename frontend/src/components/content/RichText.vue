<script setup lang="ts">
import { ref } from 'vue'
import { useInternalLinks } from '@/composables/useInternalLinks'

/**
 * Exibe HTML gerado no build a partir de Markdown versionado (markdown-it com HTML bruto desabilitado,
 * portanto já escapado). Nunca usar com conteúdo vindo de usuários ou da API.
 * Elementos estáticos por tag: v-html em <component :is> não é renderizado no SSR do Vue.
 */
withDefaults(defineProps<{ html: string; tag?: 'div' | 'p' | 'section' | 'span' | 'li' }>(), { tag: 'div' })
const root = ref<HTMLElement | null>(null)
useInternalLinks(root)
</script>

<template>
  <p v-if="tag === 'p'" ref="root" class="rich-text" v-html="html" />
  <section v-else-if="tag === 'section'" ref="root" class="rich-text" v-html="html" />
  <span v-else-if="tag === 'span'" ref="root" class="rich-text" v-html="html" />
  <li v-else-if="tag === 'li'" ref="root" class="rich-text" v-html="html" />
  <div v-else ref="root" class="rich-text" v-html="html" />
</template>

<style scoped>
.rich-text :deep(p:last-child) {
  margin-bottom: 0;
}
</style>
