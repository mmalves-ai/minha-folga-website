<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { formatDate } from '@/lib/format'
import type { ArticleSource } from '@/types/content'

/** Fontes utilizadas por um artigo: título, publicador e data real de consulta, com link externo identificado. */
const props = defineProps<{
  sources: ArticleSource[]
  texts: { title: string; intro: string; accessed: string; external: string }
}>()

/** Separa a última palavra do título, que fica presa ao ícone de link externo (o ícone nunca quebra sozinho). */
function splitTitle(title: string): { head: string; tail: string } {
  const t = title.trim()
  const i = t.lastIndexOf(' ')
  return i < 0 ? { head: '', tail: t } : { head: t.slice(0, i + 1), tail: t.slice(i + 1) }
}
const items = computed(() => props.sources.map((s) => ({ ...s, ...splitTitle(s.title) })))
</script>

<template>
  <section class="sources" aria-labelledby="fontes-titulo">
    <h2 id="fontes-titulo" class="sources__title">{{ props.texts.title }}</h2>
    <p class="muted small">{{ props.texts.intro }}</p>
    <ol class="sources__list">
      <li v-for="s in items" :key="s.url + s.title" class="sources__item">
        <a :href="s.url" class="sources__link" rel="noopener noreferrer">
          <span>{{ s.head }}</span><span class="sources__tail">{{ s.tail }}<AppIcon name="external" /></span>
          <span class="visually-hidden">({{ props.texts.external }})</span>
        </a>
        <span class="sources__meta">
          {{ s.publisher }} · {{ props.texts.accessed }} <time :datetime="s.accessedAt">{{ formatDate(s.accessedAt) }}</time>
        </span>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.sources {
  margin-top: var(--mf-space-6);
  padding-top: var(--mf-space-5);
  border-top: 1px solid var(--mf-border);
}

.sources__title {
  font-size: clamp(30px, 0.8vw + 24px, 36px);
  margin-bottom: var(--mf-space-1);
}

.sources__list {
  list-style: none;
  counter-reset: fonte;
  margin: var(--mf-space-4) 0 0;
  padding: 0;
}

.sources__item {
  counter-increment: fonte;
  position: relative;
  margin: 0;
  padding: 12px 0 12px 40px;
  border-bottom: 1px solid var(--mf-border);
}

.sources__item::before {
  content: counter(fonte);
  position: absolute;
  left: 0;
  top: 14px;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--mf-mint);
  color: var(--mf-forest);
  font-size: 0.8125rem;
  font-weight: 700;
}

.sources__link {
  display: inline;
  font-weight: 600;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.sources__tail {
  white-space: nowrap;
}

.sources__link .icon {
  display: inline-block;
  width: 16px;
  height: 16px;
  margin-left: 4px;
  vertical-align: -2px;
}

.sources__meta {
  display: block;
  margin-top: 4px;
  font-size: 0.875rem;
  color: var(--mf-muted);
}
</style>
