<script setup lang="ts">
import { computed } from 'vue'
import { useHead } from '@unhead/vue'
import { useRoute } from 'vue-router'
import AdminLayout from '@/layouts/AdminLayout.vue'
import DefaultLayout from '@/layouts/DefaultLayout.vue'

const route = useRoute()
const layout = computed(() => (route.meta.layout === 'admin' ? AdminLayout : DefaultLayout))

useHead({
  htmlAttrs: { lang: 'pt-BR' },
  titleTemplate: (title?: string) => title ?? 'Minha Folga | Mais clareza para suas escolhas',
})
</script>

<template>
  <component :is="layout">
    <RouterView />
  </component>
</template>
