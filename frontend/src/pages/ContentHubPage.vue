<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import articles from 'virtual:mf-articles'
import page from '@content/pages/conteudos.yaml'
import ArticleCard from '@/components/content/ArticleCard.vue'
import SearchField from '@/components/editorial/SearchField.vue'
import { buildSearchIndex, matchesTerms, searchTerms } from '@/components/editorial/search'
import PageHero from '@/components/site/PageHero.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { useSeo } from '@/composables/useSeo'
import { site } from '@/services/site'

useSeo({ title: page.meta.title, description: page.meta.description })

type IconName = InstanceType<typeof AppIcon>['$props']['name']

const route = useRoute()
const router = useRouter()

// Somente categorias que têm conteúdo.
const categories = (site.contentCategories as { id: string; label: string }[])
  .map((c) => ({ ...c, count: articles.filter((a) => a.category === c.id).length }))
  .filter((c) => c.count > 0)
const categoryIds = categories.map((c) => c.id)

// Busca em título, resumo e texto completo.
const indexed = articles.map((article) => ({ article, index: buildSearchIndex([article.title, article.summary, article.html]) }))

const query = ref('')
const category = ref<string | null>(null)
const search = ref<InstanceType<typeof SearchField> | null>(null)

const terms = computed(() => searchTerms(query.value))
const filtering = computed(() => category.value !== null || terms.value.length > 0)
const results = computed(() =>
  indexed
    .filter((x) => (category.value === null || x.article.category === category.value) && matchesTerms(x.index, terms.value))
    .map((x) => x.article),
)

const countText = computed(() => {
  const n = results.value.length
  if (!filtering.value) return `${n} ${n === 1 ? 'conteúdo' : 'conteúdos'} na central`
  if (n === 0) return page.filters.empty.title
  return `${n} ${n === 1 ? 'conteúdo encontrado' : 'conteúdos encontrados'}`
})

function selectCategory(id: string | null) {
  category.value = id
}

function clearFilters() {
  query.value = ''
  category.value = null
  search.value?.focus()
}

// Contagem anunciada com pequena espera, para não interromper a digitação a cada tecla.
const announcement = ref('')
let timer: ReturnType<typeof setTimeout> | undefined
watch(countText, (text) => {
  clearTimeout(timer)
  timer = setTimeout(() => (announcement.value = text), 450)
})

// Tema na URL (?categoria=…): lido só após a hidratação, para o HTML inicial ser o mesmo do servidor.
// A busca digitada nunca vai para a URL.
const mounted = ref(false)
function fromQuery(value: unknown) {
  const id = typeof value === 'string' && categoryIds.includes(value) ? value : null
  if (id !== category.value) category.value = id
}
onMounted(() => {
  fromQuery(route.query.categoria)
  mounted.value = true
})
watch(
  () => route.query.categoria,
  (value) => mounted.value && fromQuery(value),
)
watch(category, (id) => {
  if (!mounted.value || (route.query.categoria ?? null) === id) return
  const { categoria: _old, ...rest } = route.query
  void router.replace({ query: id ? { ...rest, categoria: id } : rest, hash: route.hash })
})
onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <div>
    <PageHero
      :eyebrow="page.hero.eyebrow"
      :title="page.hero.title"
      :lead="page.hero.lead"
      :breadcrumbs="[{ label: 'Conteúdos', to: '/conteudos' }]"
    >
      <template #aside>
        <aside class="editorial-panel" aria-labelledby="compromisso-editorial">
          <!-- Título do painel (não é seção): nomeia o aside sem entrar na hierarquia de H2 de 30–44 px. -->
          <p id="compromisso-editorial" class="editorial-panel__title">{{ page.editorial.title }}</p>
          <ul class="editorial-panel__list">
            <li v-for="item in page.editorial.items" :key="item.title">
              <span class="editorial-panel__icon" aria-hidden="true"><AppIcon :name="item.icon as IconName" /></span>
              <div>
                <strong>{{ item.title }}</strong>
                <p>{{ item.text }}</p>
              </div>
            </li>
          </ul>
        </aside>
      </template>
    </PageHero>

    <section class="section section--paper hub" aria-labelledby="artigos-titulo">
      <div class="container">
        <div class="hub__toolbar">
          <h2 id="artigos-titulo" class="hub__heading">{{ page.filters.heading }}</h2>
          <div class="hub__controls">
            <SearchField
              id="busca-conteudos"
              ref="search"
              v-model="query"
              :label="page.filters.searchLabel"
              :hint="page.filters.searchHint"
              controls="lista-conteudos"
            />
            <div class="hub__filter">
              <p id="filtro-temas" class="field__label">{{ page.filters.categoryLegend }}</p>
              <div class="hub__chips" role="group" aria-labelledby="filtro-temas">
                <button
                  type="button"
                  class="hub-chip"
                  :aria-pressed="category === null ? 'true' : 'false'"
                  aria-controls="lista-conteudos"
                  @click="selectCategory(null)"
                >
                  <AppIcon v-if="category === null" name="check" />
                  {{ page.filters.all }} <span class="hub-chip__count">{{ articles.length }}</span>
                </button>
                <button
                  v-for="c in categories"
                  :key="c.id"
                  type="button"
                  class="hub-chip"
                  :aria-pressed="category === c.id ? 'true' : 'false'"
                  aria-controls="lista-conteudos"
                  @click="selectCategory(c.id)"
                >
                  <AppIcon v-if="category === c.id" name="check" />
                  {{ c.label }} <span class="hub-chip__count">{{ c.count }}</span>
                </button>
              </div>
            </div>
          </div>
          <!-- Sem resultados, o título do estado vazio já informa; o anúncio continua abaixo. -->
          <p v-if="results.length" class="hub__count">{{ countText }}</p>
          <p class="visually-hidden" aria-live="polite" aria-atomic="true">{{ announcement }}</p>
        </div>

        <div id="lista-conteudos">
          <ul v-if="results.length" class="grid grid--2 hub__grid">
            <li v-for="a in results" :key="a.slug">
              <ArticleCard :article="a" />
            </li>
          </ul>
          <div v-else class="hub__empty">
            <span class="hub__empty-icon" aria-hidden="true"><AppIcon name="search" /></span>
            <h3>{{ page.filters.empty.title }}</h3>
            <p>{{ page.filters.empty.text }}</p>
            <button type="button" class="btn btn--secondary" @click="clearFilters">{{ page.filters.empty.clear }}</button>
          </div>
        </div>
      </div>
    </section>

    <section class="section hub-next" aria-labelledby="proximos-titulo">
      <div class="container split split--top">
        <div>
          <h2 id="proximos-titulo">{{ page.next.title }}</h2>
          <p class="lead">{{ page.next.text }}</p>
        </div>
        <ul class="hub-next__list">
          <li v-for="link in page.next.links" :key="link.to">
            <RouterLink :to="link.to" class="hub-next__link">
              <span class="hub-next__label">{{ link.label }}</span>
              <span class="hub-next__text">{{ link.text }}</span>
              <AppIcon name="arrow-right" />
            </RouterLink>
          </li>
        </ul>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* Painel de compromisso editorial (abertura) ---------------------------------------------------- */
.editorial-panel {
  padding: var(--mf-space-5);
  border-radius: var(--mf-radius-card);
  background: var(--mf-paper);
  box-shadow: var(--mf-shadow-soft);
}

.editorial-panel__title {
  margin: 0 0 var(--mf-space-4);
  font-family: var(--mf-font-heading);
  font-weight: 600;
  line-height: 1.12;
  letter-spacing: -0.02em;
  font-size: 1.1875rem;
}

.editorial-panel__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--mf-space-4);
}

.editorial-panel__list li {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr);
  gap: var(--mf-space-3);
  margin: 0;
}

.editorial-panel__icon {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: var(--mf-mint);
  color: var(--mf-forest);
}

.editorial-panel__icon .icon {
  width: 20px;
  height: 20px;
}

.editorial-panel strong {
  display: block;
  margin-bottom: 2px;
}

.editorial-panel p {
  margin: 0;
  font-size: 0.9375rem;
  color: var(--mf-muted);
}

/* Filtros e resultados ------------------------------------------------------------------------ */
.hub__toolbar {
  display: grid;
  gap: var(--mf-space-4);
  margin-bottom: var(--mf-space-5);
}

.hub__heading {
  margin: 0;
}

.hub__controls {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);
  gap: var(--mf-space-5);
  align-items: start;
  padding: var(--mf-space-4);
  border-radius: var(--mf-radius-card);
  background: var(--mf-cream);
}

.hub__filter {
  display: grid;
  gap: 8px;
}

.hub__filter .field__label {
  margin: 0;
}

.hub__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.hub-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  padding: 8px 16px;
  border: 1.5px solid var(--mf-control-border);
  border-radius: 999px;
  background: var(--mf-paper);
  color: var(--mf-ink);
  font-size: 0.9375rem;
  font-weight: 600;
  transition:
    background-color var(--mf-duration) var(--mf-ease),
    border-color var(--mf-duration) var(--mf-ease);
}

.hub-chip:hover {
  border-color: var(--mf-forest);
}

.hub-chip[aria-pressed='true'] {
  background: var(--mf-forest);
  border-color: var(--mf-forest);
  color: #fff;
}

.hub-chip .icon {
  width: 16px;
  height: 16px;
}

.hub-chip__count {
  display: inline-grid;
  place-items: center;
  min-width: 24px;
  height: 24px;
  padding-inline: 6px;
  border-radius: 999px;
  background: var(--mf-mint);
  color: var(--mf-forest);
  font-size: 0.8125rem;
}

.hub-chip[aria-pressed='true'] .hub-chip__count {
  background: rgb(255 255 255 / 18%);
  color: #fff;
}

.hub__count {
  margin: 0;
  font-weight: 600;
  color: var(--mf-muted);
}

.hub__grid {
  list-style: none;
  margin: 0;
  padding: 0;
}

.hub__grid li {
  margin: 0;
}

.hub__empty {
  display: grid;
  justify-items: start;
  gap: var(--mf-space-2);
  padding: var(--mf-space-6) var(--mf-space-5);
  border: 1.5px dashed var(--mf-border);
  border-radius: var(--mf-radius-card);
}

.hub__empty h3 {
  margin: 0;
}

.hub__empty p {
  margin: 0 0 var(--mf-space-2);
  color: var(--mf-muted);
  max-width: 56ch;
}

.hub__empty-icon {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: 14px;
  background: var(--mf-mint);
  color: var(--mf-forest);
}

.hub__empty-icon .icon {
  width: 24px;
  height: 24px;
}

/* Próximos caminhos -------------------------------------------------------------------------- */
.hub-next__list {
  list-style: none;
  margin: 0;
  padding: 0;
  border-top: 1px solid var(--mf-border);
}

.hub-next__list li {
  margin: 0;
  border-bottom: 1px solid var(--mf-border);
}

.hub-next__link {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 2px var(--mf-space-3);
  align-items: center;
  padding: var(--mf-space-3) 4px;
  min-height: 72px;
  color: var(--mf-ink);
  text-decoration: none;
}

.hub-next__label {
  font-family: var(--mf-font-heading);
  font-size: 1.1875rem;
  font-weight: 600;
  color: var(--mf-forest);
}

.hub-next__text {
  grid-column: 1;
  color: var(--mf-muted);
  font-size: 0.9375rem;
}

.hub-next__link .icon {
  grid-column: 2;
  grid-row: 1 / span 2;
  width: 22px;
  height: 22px;
  color: var(--mf-forest);
  transition: transform var(--mf-duration) var(--mf-ease);
}

.hub-next__link:hover .hub-next__label {
  text-decoration: underline;
}

.hub-next__link:hover .icon,
.hub-next__link:focus-visible .icon {
  transform: translateX(3px);
}

@media (max-width: 1023px) {
  .hub__controls {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--mf-space-4);
  }
}
</style>
