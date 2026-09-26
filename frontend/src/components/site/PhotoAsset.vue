<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  name: 'hero' | 'planning' | 'bia' | 'conversation' | 'aliviar-parcelas'
  alt: string
  priority?: boolean
  sizes?: string
}>(), {
  priority: false,
  sizes: '(max-width: 767px) calc(100vw - 40px), (max-width: 1199px) 50vw, 600px',
})

const base = computed(() => `/images/editorial/${props.name}`)
const srcset = (format: string) => [480, 800, 1200]
  .map((width) => `${base.value}-${width}.${format} ${width}w`).join(', ')
</script>

<template>
  <picture class="photo-asset" :class="`photo-asset--${name}`">
    <source type="image/avif" :srcset="srcset('avif')" :sizes="sizes" />
    <source type="image/webp" :srcset="srcset('webp')" :sizes="sizes" />
    <img
      :src="`${base}-800.jpg`"
      :srcset="srcset('jpg')"
      :sizes="sizes"
      :alt="alt"
      width="1200"
      height="800"
      :loading="priority ? 'eager' : 'lazy'"
      :fetchpriority="priority ? 'high' : 'auto'"
      decoding="async"
    />
  </picture>
</template>

<style scoped>
.photo-asset { display: block; width: 100%; overflow: hidden; }
.photo-asset img { display: block; width: 100%; height: 100%; object-fit: cover; }
.photo-asset--hero img { object-position: 64% center; }
</style>
