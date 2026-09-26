<script setup lang="ts">
import { useHead } from '@unhead/vue'
import { breadcrumbJsonLd } from '@/composables/useSeo'
import type { LinkItem } from '@/types/content'

/** Trilha de navegação das páginas internas. O último item é a página atual. Inclui BreadcrumbList. */
const props = defineProps<{ items: LinkItem[] }>()
const trail: LinkItem[] = [{ label: 'Início', to: '/' }, ...props.items]

useHead({
  script: [{ type: 'application/ld+json', innerHTML: JSON.stringify({ '@context': 'https://schema.org', ...breadcrumbJsonLd(trail) }) }],
})
</script>

<template>
  <nav class="breadcrumbs container" aria-label="Você está em">
    <ol>
      <li v-for="(item, i) in trail" :key="item.to">
        <RouterLink v-if="i < trail.length - 1" :to="item.to">{{ item.label }}</RouterLink>
        <span v-else aria-current="page">{{ item.label }}</span>
      </li>
    </ol>
  </nav>
</template>
