<script setup lang="ts">
import { ref, useId } from 'vue'
import copy from '@content/pages/formularios.yaml'
import AppIcon from '@/components/ui/AppIcon.vue'
import type { LinkItem } from '@/types/content'

/**
 * Aviso verdadeiro exibido NO LUGAR do formulário quando o cadastro não está recebendo dados
 * (configuração ou 503 `collection_unavailable`). Nunca mostra um formulário fictício.
 */
withDefaults(defineProps<{ headingLevel?: 2 | 3 | 4 }>(), { headingLevel: 3 })
const t = copy.waitlist.unavailable
const links = t.links as (LinkItem & { text: string })[]
const uid = useId()
const heading = ref<HTMLElement | null>(null)

defineExpose({
  /** Foco no título do aviso, sem rolar a página; devolve o elemento para quem chamou revelá-lo. */
  focus: (): HTMLElement | null => {
    heading.value?.focus({ preventScroll: true })
    return heading.value
  },
})
</script>

<template>
  <section class="waitlist-closed" :aria-labelledby="`${uid}-titulo`">
    <div class="waitlist-closed__icon" aria-hidden="true"><AppIcon name="clock" /></div>
    <component :is="`h${headingLevel}`" :id="`${uid}-titulo`" ref="heading" class="waitlist-closed__title" tabindex="-1">
      {{ t.title }}
    </component>
    <p>{{ t.text }}</p>
    <p class="waitlist-closed__meanwhile">{{ t.meanwhile }}</p>
    <ul class="waitlist-closed__links">
      <li v-for="link in links" :key="link.to">
        <RouterLink :to="link.to" class="waitlist-closed__link">
          <span>
            <strong>{{ link.label }}</strong>
            <span class="muted small">{{ link.text }}</span>
          </span>
          <AppIcon name="arrow-right" />
        </RouterLink>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.waitlist-closed__icon {
  display: inline-grid;
  place-items: center;
  width: 48px;
  height: 48px;
  margin-bottom: var(--mf-space-3);
  border-radius: 14px;
  background: var(--mf-lilac);
  color: var(--mf-forest);
}

.waitlist-closed__icon .icon {
  width: 24px;
  height: 24px;
}

.waitlist-closed__title {
  font-size: clamp(1.375rem, 1vw + 1rem, 1.75rem);
}

.waitlist-closed__title:focus {
  outline: none;
}

.waitlist-closed__title:focus-visible {
  outline: 3px solid var(--mf-focus);
}

.waitlist-closed__meanwhile {
  margin-bottom: var(--mf-space-2);
  font-weight: 600;
}

.waitlist-closed__links {
  list-style: none;
  margin: 0;
  padding: 0;
  border-top: 1px solid var(--mf-border);
}

.waitlist-closed__links li {
  margin: 0;
  border-bottom: 1px solid var(--mf-border);
}

.waitlist-closed__link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 56px;
  padding: 12px 4px;
  color: var(--mf-ink);
  text-decoration: none;
}

.waitlist-closed__link > span {
  display: grid;
  gap: 2px;
}

.waitlist-closed__link strong {
  color: var(--mf-forest);
}

.waitlist-closed__link:hover strong {
  text-decoration: underline;
}

.waitlist-closed__link .icon {
  flex: none;
  width: 20px;
  height: 20px;
  color: var(--mf-forest);
}
</style>
