<script setup lang="ts">
import PhotoAsset from '@/components/site/PhotoAsset.vue'
import { articlePhoto } from '@/components/editorial/article-photo'
import AppIcon from '@/components/ui/AppIcon.vue'
import { site } from '@/services/site'
import type { Article } from '@/types/content'

/** Cartão de artigo: título, resumo, categoria e tempo de leitura calculado do texto. */
const props = withDefaults(defineProps<{ article: Article; headingLevel?: 2 | 3 }>(), { headingLevel: 3 })
const category = (site.contentCategories as { id: string; label: string }[]).find((c) => c.id === props.article.category)
</script>

<template>
  <article class="card card--link article-card">
    <PhotoAsset :name="articlePhoto(article.slug)" alt="" class="article-card__photo" sizes="(max-width: 767px) calc(100vw - 40px), (max-width: 1023px) 45vw, 380px" />
    <div class="cluster article-card__meta">
      <span class="badge">{{ category?.label ?? article.category }}</span>
      <span class="muted small"><AppIcon name="clock" class="inline-icon" /> {{ article.readingMinutes }} min de leitura</span>
    </div>
    <component :is="`h${headingLevel}`" class="article-card__title">
      <RouterLink :to="`/conteudos/${article.slug}`" class="card__cover-link">{{ article.title }}</RouterLink>
    </component>
    <p class="muted">{{ article.summary }}</p>
    <div class="card__footer">
      <span class="link-arrow" aria-hidden="true">Ler artigo <AppIcon name="arrow-right" /></span>
    </div>
  </article>
</template>

<style scoped>
.article-card { overflow: hidden; padding: 0 24px 20px; border-radius: 20px; }
.article-card__photo { display: block; margin: 0 -24px 24px; aspect-ratio: 16 / 10; overflow: hidden; }
.article-card__photo :deep(img) { height: 100%; width: 100%; object-fit: cover; transition: transform 300ms; }
@media (prefers-reduced-motion: no-preference) { .article-card:hover .article-card__photo :deep(img) { transform: scale(1.035); } }

.article-card__meta {
  margin-bottom: 16px;
}

.article-card__meta .small {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.inline-icon {
  width: 16px;
  height: 16px;
}

.article-card__title {
  font-size: 1.3125rem;
  line-height: 1.25;
}

.article-card__title a {
  color: var(--mf-ink);
  text-decoration: none;
}

.article-card__title a:hover {
  color: var(--mf-forest);
  text-decoration: underline;
}
</style>
