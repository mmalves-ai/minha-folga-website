<script lang="ts">
import articles from 'virtual:mf-articles'
import { registerDimensionValues } from '@/services/analytics'

// Medição agregada: os artigos publicados são a lista de valores válidos para a visita (/conteudos/<slug>)
// e para a leitura (article_read). Registrados ao carregar o módulo, antes de o roteador concluir a
// navegação, para que a visita desta página já seja reconhecida.
registerDimensionValues(
  'article_slug',
  articles.map((a) => a.slug),
)
</script>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import ArticleDetail from '@/components/editorial/ArticleDetail.vue'
import ArticleNotFound from '@/components/editorial/ArticleNotFound.vue'

/**
 * /conteudos/:slug. O roteador reaproveita esta página entre artigos; o conteúdo é montado
 * com `key` por slug para recriar metadados, trilha e sumário a cada artigo.
 */
const route = useRoute()
const slug = computed(() => String(route.params.slug ?? ''))
const article = computed(() => articles.find((a) => a.slug === slug.value) ?? null)
</script>

<template>
  <ArticleDetail v-if="article" :key="article.slug" :article="article" />
  <ArticleNotFound v-else :key="`ausente-${slug}`" />
</template>
