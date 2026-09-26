<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import articles from 'virtual:mf-articles'
import page from '@content/pages/conteudos.yaml'
import PhotoAsset from '@/components/site/PhotoAsset.vue'
import { articlePhoto } from '@/components/editorial/article-photo'
import ArticleCard from '@/components/content/ArticleCard.vue'
import RichText from '@/components/content/RichText.vue'
import ReviewStatus from '@/components/editorial/ReviewStatus.vue'
import SourceList from '@/components/editorial/SourceList.vue'
import Breadcrumbs from '@/components/site/Breadcrumbs.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { absoluteUrl, useSeo } from '@/composables/useSeo'
import { formatDateLong } from '@/lib/format'
import { track } from '@/services/analytics'
import { publicConfig, site, SITE_URL } from '@/services/site'
import type { Article, LinkItem } from '@/types/content'

/**
 * Modelo de artigo da central editorial. Montado com `key` por slug (ArticlePage), para que
 * metadados e trilha sejam recriados ao navegar entre artigos.
 */
const props = defineProps<{ article: Article }>()
const a = props.article
const t = page.article

const path = `/conteudos/${a.slug}`
const category = (site.contentCategories as { id: string; label: string }[]).find((c) => c.id === a.category)
const related = a.related.map((slug) => articles.find((x) => x.slug === slug)).filter((x): x is Article => Boolean(x)).slice(0, 2)
const approved = a.review.status === 'approved' && Boolean(a.review.reviewedAt && a.review.reviewer)
const cta = t.cta[a.cta] ?? t.cta.ajuda
const crumbs: LinkItem[] = [
  { label: 'Conteúdos', to: '/conteudos' },
  { label: a.title, to: path },
]

// Datas reais do conteúdo versionado; nunca a data do acesso.
useSeo({
  title: a.seo?.title ?? a.title,
  description: a.seo?.description ?? a.summary,
  path,
  type: 'article',
  publishedTime: a.publishedAt,
  modifiedTime: approved ? a.review.reviewedAt : null,
  jsonLd: [
    {
      '@type': 'Article',
      headline: a.title,
      description: a.summary,
      inLanguage: 'pt-BR',
      mainEntityOfPage: absoluteUrl(path),
      dateCreated: a.draftedAt,
      ...(a.publishedAt ? { datePublished: a.publishedAt } : {}),
      ...(approved ? { dateModified: a.review.reviewedAt } : {}),
      author: { '@type': 'Organization', name: 'Minha Folga', url: SITE_URL },
      publisher: { '@type': 'Organization', name: 'Minha Folga', url: SITE_URL },
      citation: a.sources.map((s) => s.url),
    },
  ],
})

/**
 * Medição agregada (só com ANALYTICS_ENABLED e consentimento; `track` confere): a leitura conta uma vez por
 * abertura do artigo, quando o fim do texto (o aviso logo depois dele) aparece na tela. Só vai o slug.
 */
const readEnd = ref<HTMLElement | null>(null)
let readObserver: IntersectionObserver | undefined
onMounted(() => {
  if (!publicConfig.analyticsEnabled || !readEnd.value || typeof IntersectionObserver === 'undefined') return
  readObserver = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return
    readObserver?.disconnect()
    readObserver = undefined
    track('article_read', a.slug)
  })
  readObserver.observe(readEnd.value)
})
onBeforeUnmount(() => readObserver?.disconnect())

/** Sumário: leva o foco ao título da seção (a rolagem fica com o roteador). */
function focusSection(id: string) {
  requestAnimationFrame(() => {
    const el = document.getElementById(id)
    if (!el) return
    el.setAttribute('tabindex', '-1')
    el.focus({ preventScroll: true })
  })
}
</script>

<template>
  <div class="article-page">
    <Breadcrumbs :items="crumbs" />

    <article class="article" aria-labelledby="titulo-artigo">
      <header class="container article-header">
        <div class="article-header__inner">
          <div class="cluster article-header__tags">
            <RouterLink :to="{ path: '/conteudos', query: { categoria: a.category } }" class="article-header__category">
              <span class="badge">{{ category?.label ?? a.category }}</span>
              <span class="visually-hidden">: ver conteúdos deste tema</span>
            </RouterLink>
            <span class="muted small article-header__reading">
              <AppIcon name="clock" /> {{ a.readingMinutes }} {{ t.meta.reading }}
            </span>
          </div>
          <h1 id="titulo-artigo">{{ a.title }}</h1>
          <p class="lead">{{ a.summary }}</p>

          <dl class="article-meta">
            <div>
              <dt>{{ t.meta.author }}</dt>
              <dd>{{ a.author }}</dd>
            </div>
            <div>
              <dt>{{ t.meta.drafted }}</dt>
              <dd><time :datetime="a.draftedAt">{{ formatDateLong(a.draftedAt) }}</time></dd>
            </div>
            <div v-if="a.publishedAt">
              <dt>{{ t.meta.published }}</dt>
              <dd><time :datetime="a.publishedAt">{{ formatDateLong(a.publishedAt) }}</time></dd>
            </div>
            <div>
              <dt>{{ t.meta.review }}</dt>
              <dd><ReviewStatus :review="a.review" /></dd>
            </div>
          </dl>
        </div>
      </header>

      <div class="container article-layout">
        <nav v-if="a.headings.length" class="article-toc" aria-labelledby="sumario-titulo">
          <!-- Rótulo da navegação (nomeia o nav), não um título de seção. -->
          <p id="sumario-titulo" class="article-toc__title">{{ t.toc }}</p>
          <ol>
            <li v-for="h in a.headings" :key="h.id">
              <RouterLink :to="{ hash: `#${h.id}` }" @click="focusSection(h.id)">{{ h.text }}</RouterLink>
            </li>
          </ol>
        </nav>

        <div class="article-body">
          <figure class="article-illustration"><PhotoAsset :name="articlePhoto(a.slug)" alt="Cena cotidiana de organização e conversa sobre finanças, ilustrativa e gerada por IA." sizes="(max-width: 767px) calc(100vw - 40px), 780px" /><figcaption>Imagem ilustrativa gerada por IA.</figcaption></figure>
          <RichText :html="a.html" class="prose article-prose" />

          <div ref="readEnd" class="notice notice--mint article-disclaimer" role="note">
            <AppIcon name="info" />
            <p>{{ t.disclaimer }}</p>
          </div>

          <SourceList :sources="a.sources" :texts="t.sources" />

          <section class="article-cta" aria-labelledby="artigo-cta-titulo">
            <div class="article-cta__icon" aria-hidden="true">
              <AppIcon :name="a.cta === 'bia' ? 'chat' : 'compass'" />
            </div>
            <div>
              <h2 id="artigo-cta-titulo">{{ cta.title }}</h2>
              <p>{{ cta.text }}</p>
              <div class="cluster">
                <RouterLink :to="cta.primary.to" class="btn btn--primary">
                  {{ cta.primary.label }} <AppIcon name="arrow-right" />
                </RouterLink>
                <RouterLink :to="cta.secondary.to" class="btn btn--secondary">{{ cta.secondary.label }}</RouterLink>
              </div>
            </div>
          </section>
        </div>
      </div>
    </article>

    <section v-if="related.length" class="section section--paper section--tight" aria-labelledby="relacionados-titulo">
      <div class="container">
        <h2 id="relacionados-titulo" class="related-title">{{ t.related }}</h2>
        <ul class="grid grid--2 related-list">
          <li v-for="r in related" :key="r.slug">
            <ArticleCard :article="r" />
          </li>
        </ul>
      </div>
    </section>
  </div>
</template>

<style scoped>
.article-illustration { margin: 0 0 32px; }
.article-illustration :deep(picture) { display: block; overflow: hidden; border-radius: 20px; }
.article-illustration figcaption { font-size: .75rem; color: var(--mf-muted); margin-top: 8px; }

.article-header {
  padding-block: var(--mf-space-5) var(--mf-space-6);
}

.article-header__inner {
  max-width: 860px;
}

/*
 * O link inteiro tem 44 px de altura (área de toque da seção 12); o selo visível continua compacto dentro
 * dele. A margem negativa devolve a sobra, para o selo não empurrar o título para baixo.
 */
.article-header__category {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  margin-block: -6px;
  border-radius: 999px;
  text-decoration: none;
}

.article-header__category:hover .badge {
  text-decoration: underline;
}

.article-header__reading {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.article-header__reading .icon {
  width: 16px;
  height: 16px;
}

.article-header h1 {
  margin-top: var(--mf-space-3);
  font-size: clamp(38px, 3.6vw, 56px);
}

.article-header .lead {
  margin-bottom: var(--mf-space-5);
}

.article-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--mf-space-3) var(--mf-space-5);
  margin: 0;
  padding-top: var(--mf-space-4);
  border-top: 1px solid var(--mf-border);
}

.article-meta dt {
  font-size: 0.8125rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--mf-muted);
}

.article-meta dd {
  margin: 2px 0 0;
  font-size: 0.9375rem;
}

.article-layout {
  display: grid;
  grid-template-columns: minmax(0, 250px) minmax(0, 1fr);
  gap: var(--mf-space-7);
  align-items: start;
  padding-bottom: var(--mf-space-8);
}

.article-toc {
  position: sticky;
  top: calc(var(--mf-header-height) + 24px);
  padding-left: var(--mf-space-3);
  border-left: 2px solid var(--mf-mint-strong);
}

.article-toc__title {
  margin: 0 0 var(--mf-space-2);
  font-family: var(--mf-font-body);
  font-size: 0.8125rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mf-muted);
}

.article-toc ol {
  list-style: none;
  margin: 0;
  padding: 0;
}

.article-toc li + li {
  margin-top: 2px;
}

.article-toc a {
  display: flex;
  align-items: center;
  min-height: 44px;
  padding-block: 6px;
  font-size: 0.9375rem;
  line-height: 1.35;
  color: var(--mf-ink);
  text-decoration: none;
}

.article-toc a:hover {
  color: var(--mf-forest);
  text-decoration: underline;
}

.article-body {
  min-width: 0;
  max-width: 72ch;
}

.article-prose :deep(h2) {
  scroll-margin-top: calc(var(--mf-header-height) + 24px);
}

.article-prose :deep(h2:first-child) {
  margin-top: 0;
}

.article-prose :deep(h2:focus) {
  outline: none;
}

.article-prose :deep(li) {
  padding-left: 4px;
}

.article-prose :deep(a.external)::after {
  content: ' ↗';
}

.article-disclaimer {
  margin-top: var(--mf-space-6);
}

.article-cta {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--mf-space-4);
  margin-top: var(--mf-space-6);
  padding: var(--mf-space-5);
  border-radius: var(--mf-radius-card);
  background: var(--mf-mint);
}

.article-cta h2 {
  font-size: clamp(30px, 0.4vw + 26px, 32px);
  margin-bottom: var(--mf-space-2);
}

.article-cta p {
  max-width: 56ch;
}

.article-cta__icon {
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  border-radius: 16px;
  background: var(--mf-paper);
  color: var(--mf-forest);
}

.article-cta__icon .icon {
  width: 26px;
  height: 26px;
}

.related-title {
  margin-bottom: var(--mf-space-5);
}

.related-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.related-list li {
  margin: 0;
}

@media (max-width: 1023px) {
  .article-layout {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--mf-space-5);
  }

  .article-toc {
    position: static;
    padding: var(--mf-space-3) var(--mf-space-4);
    border-left: 0;
    border-radius: 16px;
    background: var(--mf-paper);
    border: 1px solid var(--mf-border);
  }

  .article-body {
    max-width: none;
  }
}

@media (max-width: 767px) {
  .article-header {
    padding-block: var(--mf-space-4) var(--mf-space-5);
  }

  .article-layout {
    padding-bottom: var(--mf-space-7);
  }

  .article-cta {
    grid-template-columns: minmax(0, 1fr);
    padding: var(--mf-space-4);
  }
}
</style>
