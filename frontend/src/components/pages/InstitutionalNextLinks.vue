<script setup lang="ts">
import AppIcon from '@/components/ui/AppIcon.vue'
import type { IconLink } from '@/components/pages/institutional'

/** Lista de destinos relacionados (fim de página ou bloco "saiba mais"). Um único link por item. */
withDefaults(defineProps<{ items: IconLink[]; label: string; headingLevel?: 3 | 4; layout?: 'row' | 'column' }>(), {
  headingLevel: 3,
  layout: 'row',
})
</script>

<template>
  <nav :aria-label="label">
    <ul class="next-links" :class="`next-links--${layout}`">
      <li v-for="item in items" :key="item.to" class="next-links__item">
        <span class="next-links__icon" aria-hidden="true"><AppIcon :name="item.icon" /></span>
        <div class="next-links__body">
          <component :is="`h${headingLevel}`" class="next-links__title">
            <RouterLink :to="item.to" class="card__cover-link">{{ item.label }}</RouterLink>
          </component>
          <p v-if="item.text" class="next-links__text">{{ item.text }}</p>
        </div>
        <AppIcon name="arrow-right" class="next-links__arrow" />
      </li>
    </ul>
  </nav>
</template>

<style scoped>
.next-links {
  display: grid;
  gap: var(--mf-space-3);
  list-style: none;
  margin: 0;
  padding: 0;
}

.next-links--row {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.next-links__item {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: var(--mf-space-3);
  margin: 0;
  padding: var(--mf-space-4);
  border: 1px solid var(--mf-border);
  border-radius: var(--mf-radius-card);
  background: var(--mf-paper);
  transition: border-color var(--mf-duration) var(--mf-ease);
}

.next-links__item:hover,
.next-links__item:focus-within {
  border-color: var(--mf-forest);
}

.next-links__icon {
  display: inline-grid;
  flex: none;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 14px;
  background: var(--mf-mint);
  color: var(--mf-forest);
}

.next-links__icon .icon {
  width: 22px;
  height: 22px;
}

.next-links__body {
  flex: 1;
  min-width: 0;
}

.next-links__title {
  margin: 0 0 4px;
  font-size: 1.125rem;
  line-height: 1.3;
}

.next-links__title a {
  color: var(--mf-ink);
  text-decoration: none;
}

.next-links__title a:hover {
  color: var(--mf-forest);
  text-decoration: underline;
}

/* O foco fica visível no cartão inteiro, já que o link o cobre. */
.next-links__title a:focus-visible {
  outline: none;
}

.next-links__item:has(a:focus-visible) {
  outline: 3px solid var(--mf-focus);
  outline-offset: 3px;
}

.next-links__text {
  margin: 0;
  font-size: 0.9375rem;
  color: var(--mf-muted);
}

.next-links__arrow {
  flex: none;
  width: 20px;
  height: 20px;
  margin-top: 12px;
  color: var(--mf-forest);
  transition: transform var(--mf-duration) var(--mf-ease);
}

.next-links__item:hover .next-links__arrow,
.next-links__item:focus-within .next-links__arrow {
  transform: translateX(3px);
}

@media (max-width: 1023px) {
  .next-links--row {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
