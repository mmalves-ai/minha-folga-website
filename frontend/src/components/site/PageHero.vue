<script setup lang="ts">
import Breadcrumbs from '@/components/site/Breadcrumbs.vue'
import type { LinkItem } from '@/types/content'

/** Abertura padrão das páginas internas: breadcrumb, eyebrow opcional, H1 e texto de abertura. */
defineProps<{
  title: string
  lead?: string
  eyebrow?: string
  breadcrumbs: LinkItem[]
}>()
</script>

<template>
  <div class="page-hero-wrap">
    <Breadcrumbs :items="breadcrumbs" />
    <section class="page-hero container" aria-labelledby="titulo-pagina">
      <div :class="$slots.aside ? 'split split--top' : ''">
        <div class="page-hero__inner">
          <slot name="badge" />
          <p v-if="eyebrow" class="eyebrow">{{ eyebrow }}</p>
          <h1 id="titulo-pagina">{{ title }}</h1>
          <p v-if="lead" class="lead">{{ lead }}</p>
          <slot />
          <div v-if="$slots.actions" class="page-hero__actions cluster">
            <slot name="actions" />
          </div>
        </div>
        <div v-if="$slots.aside">
          <slot name="aside" />
        </div>
      </div>
    </section>
  </div>
</template>
