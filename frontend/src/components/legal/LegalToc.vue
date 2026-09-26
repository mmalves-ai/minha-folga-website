<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import type { TocItem } from '@/components/legal/legal'

/**
 * Sumário navegável do documento legal. No desktop fica fixo ao lado do texto e marca a seção em leitura;
 * no celular começa recolhido para não empurrar o conteúdo (botão com aria-expanded).
 */
const props = defineProps<{ items: TocItem[]; contentId: string }>()

const open = ref(false)
const active = ref<string | null>(null)
let frame = 0
let mobile: MediaQueryList | null = null

function updateActive() {
  frame = 0
  const offset = 140
  let current: string | null = null
  for (const item of props.items) {
    const el = document.getElementById(item.id)
    if (el && el.getBoundingClientRect().top - offset <= 0) current = item.id
  }
  active.value = current ?? props.items[0]?.id ?? null
}

function onScroll() {
  if (!frame) frame = requestAnimationFrame(updateActive)
}

function onNavigate() {
  // No celular, o sumário se recolhe depois da escolha para mostrar o texto.
  if (mobile?.matches) open.value = false
}

onMounted(() => {
  mobile = window.matchMedia('(max-width: 1023px)')
  window.addEventListener('scroll', onScroll, { passive: true })
  updateActive()
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll)
  if (frame) cancelAnimationFrame(frame)
})
</script>

<template>
  <nav id="sumario" class="legal-toc" aria-labelledby="sumario-titulo">
    <div class="legal-toc__head">
      <!-- Rótulo da navegação (nomeia o nav), não um título de seção. -->
      <p id="sumario-titulo" class="legal-toc__title">Sumário</p>
      <button
        type="button"
        class="legal-toc__toggle"
        :aria-expanded="open ? 'true' : 'false'"
        :aria-controls="`${contentId}-sumario`"
        @click="open = !open"
      >
        <span>{{ open ? 'Ocultar' : 'Mostrar' }} {{ items.length }} seções</span>
        <AppIcon name="chevron-down" />
      </button>
    </div>
    <ol :id="`${contentId}-sumario`" class="legal-toc__list" :class="{ 'is-open': open }">
      <li v-for="(item, i) in items" :key="item.id">
        <a
          :href="`#${item.id}`"
          :aria-current="active === item.id ? 'location' : undefined"
          @click="onNavigate"
        >
          <span class="legal-toc__num" aria-hidden="true">{{ i + 1 }}</span>
          <span>{{ item.text }}</span>
        </a>
      </li>
    </ol>
  </nav>
</template>

<style scoped>
.legal-toc {
  border: 1px solid var(--mf-border);
  border-radius: 20px;
  background: var(--mf-cream);
  padding: 18px 16px 12px;
}

.legal-toc__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-inline: 8px;
}

.legal-toc__title {
  margin: 0;
  font-family: var(--mf-font-body);
  font-size: 0.875rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mf-muted);
}

.legal-toc__toggle {
  display: none;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  padding: 0 4px 0 12px;
  border: 0;
  border-radius: var(--mf-radius-control);
  background: transparent;
  color: var(--mf-forest);
  font-size: 0.9375rem;
  font-weight: 600;
}

.legal-toc__toggle .icon {
  width: 20px;
  height: 20px;
  transition: transform var(--mf-duration) var(--mf-ease);
}

.legal-toc__toggle[aria-expanded='true'] .icon {
  transform: rotate(180deg);
}

.legal-toc__list {
  list-style: none;
  margin: 12px 0 0;
  padding: 0;
}

.legal-toc__list li {
  margin: 0;
}

.legal-toc__list a {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: 6px;
  align-items: baseline;
  min-height: 44px;
  padding: 10px 8px;
  border-radius: 12px;
  color: var(--mf-ink);
  font-size: 0.9375rem;
  line-height: 1.4;
  text-decoration: none;
  transition: background-color var(--mf-duration) var(--mf-ease);
}

.legal-toc__list a:hover {
  background: var(--mf-paper);
  text-decoration: underline;
}

.legal-toc__list a[aria-current='location'] {
  background: var(--mf-mint);
  color: var(--mf-forest);
  font-weight: 600;
}

.legal-toc__num {
  font-family: var(--mf-font-heading);
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--mf-forest);
  font-variant-numeric: tabular-nums;
}

@media (min-width: 1024px) {
  .legal-toc {
    max-height: calc(100vh - var(--mf-header-height) - 48px);
    overflow-y: auto;
    overscroll-behavior: contain;
  }
}

@media (max-width: 1023px) {
  .legal-toc {
    padding: 8px 12px;
  }

  .legal-toc__toggle {
    display: inline-flex;
  }

  .legal-toc__list {
    display: none;
    margin-top: 4px;
    padding-bottom: 8px;
  }

  .legal-toc__list.is-open {
    display: block;
  }
}
</style>
