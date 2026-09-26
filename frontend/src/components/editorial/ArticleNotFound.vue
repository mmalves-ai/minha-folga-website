<script setup lang="ts">
import articles from 'virtual:mf-articles'
import page from '@content/pages/conteudos.yaml'
import AppIcon from '@/components/ui/AppIcon.vue'
import { useSeo } from '@/composables/useSeo'

/**
 * Slug de artigo inexistente acessado pela navegação no cliente. O servidor web já responde 404
 * para URLs não pré-renderizadas; aqui garantimos conteúdo útil e noindex.
 */
const t = page.article.notFound
useSeo({ title: t.metaTitle, description: t.metaDescription, noindex: true })
</script>

<template>
  <section class="container section article-missing" aria-labelledby="titulo-pagina">
    <p class="eyebrow">Conteúdos</p>
    <h1 id="titulo-pagina">{{ t.title }}</h1>
    <p class="lead">{{ t.text }}</p>
    <ul class="article-missing__list">
      <li v-for="a in articles" :key="a.slug">
        <RouterLink :to="`/conteudos/${a.slug}`" class="link-arrow">{{ a.title }} <AppIcon name="arrow-right" /></RouterLink>
      </li>
    </ul>
    <RouterLink to="/conteudos" class="btn btn--primary">{{ t.back }}</RouterLink>
  </section>
</template>

<style scoped>
.article-missing {
  max-width: calc(820px + 2 * var(--mf-gutter));
}

.article-missing__list {
  list-style: none;
  margin: var(--mf-space-5) 0 var(--mf-space-5);
  padding: 0;
  border-top: 1px solid var(--mf-border);
}

.article-missing__list li {
  margin: 0;
  border-bottom: 1px solid var(--mf-border);
}

.article-missing__list .link-arrow {
  padding-block: 10px;
}
</style>
