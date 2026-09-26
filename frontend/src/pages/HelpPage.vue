<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type ComponentPublicInstance } from 'vue'
import { useRoute } from 'vue-router'
import faq from '@content/faq.yaml'
import page from '@content/pages/ajuda.yaml'
import CtaBand from '@/components/content/CtaBand.vue'
import FaqAccordion from '@/components/content/FaqAccordion.vue'
import SearchField from '@/components/editorial/SearchField.vue'
import { buildSearchIndex, createSearchSettler, faqIdFromHash, matchesTerms, searchTerms } from '@/components/editorial/search'
import CreditStatusBadge from '@/components/site/CreditStatusBadge.vue'
import PageHero from '@/components/site/PageHero.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { useSeo } from '@/composables/useSeo'
import { track } from '@/services/analytics'
import type { FaqBase, FaqItem, LinkItem } from '@/types/content'

useSeo({ title: page.meta.title, description: page.meta.description })

type IconName = InstanceType<typeof AppIcon>['$props']['name']
interface Topic {
  id: string
  label: string
  icon: IconName
  intro: string
  links: LinkItem[]
  items: FaqItem[]
}

const route = useRoute()
const base = faq as FaqBase

// Temas na ordem de content/faq.yaml; somente os que têm perguntas.
const topics: Topic[] = base.categories
  .map((c) => ({
    ...c,
    icon: (page.topics[c.id]?.icon ?? 'info') as IconName,
    intro: page.topics[c.id]?.intro ?? '',
    links: (page.topics[c.id]?.links ?? []) as LinkItem[],
    items: base.items.filter((i) => i.category === c.id),
  }))
  .filter((t) => t.items.length > 0)
const itemIds = base.items.map((i) => i.id)
const topicOf = new Map(base.items.map((i) => [i.id, i.category]))

// Busca local sobre a base aprovada: pergunta, resposta e nome do tema.
const indexed = base.items.map((item) => ({
  item,
  index: buildSearchIndex([item.question, item.answer_md, topics.find((t) => t.id === item.category)?.label]),
}))
const query = ref('')
const terms = computed(() => searchTerms(query.value))
const searching = computed(() => terms.value.length > 0)
const results = computed(() =>
  topics
    .map((t) => ({ ...t, items: indexed.filter((x) => x.item.category === t.id && matchesTerms(x.index, terms.value)).map((x) => x.item) }))
    .filter((t) => t.items.length > 0),
)
const resultCount = computed(() => results.value.reduce((n, t) => n + t.items.length, 0))
const resultText = computed(() => {
  const n = resultCount.value
  if (n === 0) return page.search.empty
  return `${n} ${n === 1 ? 'resposta encontrada' : 'respostas encontradas'}`
})

// Anúncio da busca com pequena espera, para não interromper a digitação.
const announcement = ref('')
let timer: ReturnType<typeof setTimeout> | undefined
watch([resultText, searching], ([text, active]) => {
  clearTimeout(timer)
  timer = setTimeout(() => (announcement.value = active ? text : ''), 450)
})
onBeforeUnmount(() => clearTimeout(timer))

/**
 * Medição agregada da busca (só com ANALYTICS_ENABLED e consentimento; `track` confere): conta a busca
 * quando a pessoa para de digitar e, à parte, se ela não encontrou resposta. A busca é feita em todos os
 * temas, então não há dimensão; o texto digitado nunca é enviado.
 */
const SEARCH_SETTLE_MS = 1200
const searchSettler = createSearchSettler(SEARCH_SETTLE_MS, () => {
  track('help_search')
  if (resultCount.value === 0) track('help_search_empty')
})
watch(terms, (list) => searchSettler.update(list))
onBeforeUnmount(() => searchSettler.cancel())

const search = ref<InstanceType<typeof SearchField> | null>(null)
function clearSearch() {
  query.value = ''
  search.value?.focus()
}

// Acordeões por tema, para abrir uma pergunta a partir da âncora.
type Accordion = { openItem(id: string): void }
const accordions = new Map<string, Accordion>()
function setAccordion(topicId: string, el: Element | ComponentPublicInstance | null) {
  if (el) accordions.set(topicId, el as unknown as Accordion)
  else accordions.delete(topicId)
}

/**
 * Foco na pergunta aberta pela âncora. Vindo de outra página, o layout leva o foco ao <main> logo
 * depois da montagem; nesse caso o foco volta para a pergunta, que é o destino do link.
 */
let releaseFocus: (() => void) | undefined
function focusQuestion(button: HTMLElement) {
  releaseFocus?.()
  button.focus({ preventScroll: true })
  const main = document.getElementById('conteudo')
  if (!main) return
  const back = () => button.focus({ preventScroll: true })
  main.addEventListener('focus', back, { once: true })
  const timeout = setTimeout(() => releaseFocus?.(), 500)
  releaseFocus = () => {
    main.removeEventListener('focus', back)
    clearTimeout(timeout)
    releaseFocus = undefined
  }
}
onBeforeUnmount(() => releaseFocus?.())

/** /ajuda#<id da pergunta> (ou #faq-<id>) abre a resposta; #tema-<id> leva ao tema. */
async function followHash(hash: string) {
  if (!hash) return
  const id = faqIdFromHash(hash, itemIds)
  if (id) {
    if (query.value) query.value = ''
    await nextTick()
    accordions.get(topicOf.get(id) ?? '')?.openItem(id)
    await nextTick()
    const button = document.getElementById(`faq-${id}-botao`)
    if (!button) return
    button.scrollIntoView({ block: 'start' })
    focusQuestion(button)
    return
  }
  const topic = hash.replace(/^#tema-/, '')
  if (hash.startsWith('#tema-') && topics.some((t) => t.id === topic)) {
    await nextTick()
    document.getElementById(`tema-${topic}-titulo`)?.focus({ preventScroll: true })
  }
}

function goToTopic() {
  // Com a busca ativa os temas ficam ocultos; o link de tema volta à navegação completa.
  if (query.value) query.value = ''
}

onMounted(() => void followHash(route.hash))
watch(
  () => route.hash,
  (hash) => void followHash(hash),
)
</script>

<template>
  <div>
    <PageHero :title="page.hero.title" :lead="page.hero.lead" :breadcrumbs="[{ label: 'Ajuda', to: '/ajuda' }]">
      <div class="help-search">
        <SearchField
          id="busca-ajuda"
          ref="search"
          v-model="query"
          size="lg"
          :label="page.search.label"
          :hint="page.search.hint"
          controls="ajuda-conteudo"
        />
      </div>
    </PageHero>

    <section class="section section--paper help" aria-label="Perguntas frequentes">
      <div class="container help__layout">
        <nav class="help-nav" aria-labelledby="temas-titulo">
          <!-- Rótulo da navegação (nomeia o nav), não um título de seção. -->
          <p id="temas-titulo" class="help-nav__title">{{ page.topicsNav }}</p>
          <ul>
            <li v-for="t in topics" :key="t.id">
              <RouterLink :to="{ hash: `#tema-${t.id}` }" class="help-nav__link" @click="goToTopic">
                <AppIcon :name="t.icon" />
                <span>{{ t.label }}</span>
                <span class="help-nav__count"><span class="visually-hidden">, </span>{{ t.items.length }}<span class="visually-hidden"> perguntas</span></span>
              </RouterLink>
            </li>
          </ul>
        </nav>

        <div id="ajuda-conteudo" class="help__content">
          <p class="visually-hidden" aria-live="polite" aria-atomic="true">{{ announcement }}</p>

          <!-- Resultados da busca -->
          <div v-if="searching" class="help-results">
            <h2 class="help-results__title">{{ page.search.resultsHeading }}</h2>
            <p v-if="resultCount" class="help-results__count">{{ resultText }}</p>
            <template v-if="results.length">
              <div v-for="t in results" :key="t.id" class="help-results__group">
                <h3 class="help-results__topic"><AppIcon :name="t.icon" /> {{ t.label }}</h3>
                <FaqAccordion :items="t.items" :heading-level="4" id-prefix="busca" />
              </div>
            </template>
            <div v-else class="help-empty">
              <span class="help-empty__icon" aria-hidden="true"><AppIcon name="search" /></span>
              <p class="help-empty__text">{{ page.search.empty }}</p>
              <div class="cluster">
                <RouterLink :to="page.contact.primary.to" class="btn btn--primary">{{ page.contact.primary.label }}</RouterLink>
                <button type="button" class="btn btn--secondary" @click="clearSearch">{{ page.search.clear }}</button>
              </div>
            </div>
          </div>

          <!-- Temas -->
          <template v-else>
            <section
              v-for="t in topics"
              :id="`tema-${t.id}`"
              :key="t.id"
              class="help-topic"
              :aria-labelledby="`tema-${t.id}-titulo`"
            >
              <header class="help-topic__head">
                <span class="help-topic__icon" aria-hidden="true"><AppIcon :name="t.icon" /></span>
                <div class="help-topic__heading">
                  <div class="help-topic__title-row">
                    <h2 :id="`tema-${t.id}-titulo`" class="help-topic__title" tabindex="-1">{{ t.label }}</h2>
                    <CreditStatusBadge v-if="t.id === 'consignado'" />
                  </div>
                  <p class="muted">{{ t.intro }}</p>
                </div>
              </header>
              <FaqAccordion :ref="(el) => setAccordion(t.id, el)" :items="t.items" id-prefix="faq" anchor-ids />
              <ul v-if="t.links.length" class="help-topic__links" :aria-label="`Páginas relacionadas a ${t.label}`">
                <li v-for="l in t.links" :key="l.to">
                  <RouterLink :to="l.to" class="link-arrow">{{ l.label }} <AppIcon name="arrow-right" /></RouterLink>
                </li>
              </ul>
            </section>
          </template>
        </div>
      </div>
    </section>

    <CtaBand
      id="ajuda-contato"
      :title="page.contact.title"
      :text="page.contact.text"
      :primary="page.contact.primary"
      :secondary="page.contact.secondary"
    />
  </div>
</template>

<style scoped>
.help-search {
  max-width: 640px;
  margin-top: var(--mf-space-5);
}

.help__layout {
  display: grid;
  grid-template-columns: minmax(0, 280px) minmax(0, 1fr);
  gap: var(--mf-space-7);
  align-items: start;
}

/* Navegação por temas ----------------------------------------------------------------------- */
.help-nav {
  position: sticky;
  top: calc(var(--mf-header-height) + 24px);
}

.help-nav__title {
  margin: 0 0 var(--mf-space-2);
  font-family: var(--mf-font-body);
  font-size: 0.8125rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mf-muted);
}

.help-nav ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 4px;
}

.help-nav li {
  margin: 0;
}

.help-nav__link {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  min-height: 48px;
  padding: 8px 12px;
  border-radius: 12px;
  color: var(--mf-ink);
  font-weight: 600;
  text-decoration: none;
  transition: background-color var(--mf-duration) var(--mf-ease);
}

.help-nav__link:hover {
  background: var(--mf-cream);
  color: var(--mf-forest);
}

.help-nav__link .icon {
  width: 20px;
  height: 20px;
  color: var(--mf-forest);
}

.help-nav__count {
  min-width: 28px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--mf-mint);
  color: var(--mf-forest);
  font-size: 0.8125rem;
  text-align: center;
}

/* Temas --------------------------------------------------------------------------------------- */
.help__content {
  min-width: 0;
}

.help-topic + .help-topic {
  margin-top: var(--mf-space-7);
}

.help-topic {
  scroll-margin-top: calc(var(--mf-header-height) + 24px);
}

.help-topic__head {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr);
  gap: var(--mf-space-3);
  align-items: start;
  margin-bottom: var(--mf-space-3);
}

.help-topic__icon {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: 14px;
  background: var(--mf-mint);
  color: var(--mf-forest);
}

.help-topic__icon .icon {
  width: 24px;
  height: 24px;
}

.help-topic__title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
}

.help-topic__title {
  margin: 0;
  font-size: clamp(30px, 1vw + 22px, 36px);
}

.help-topic__title:focus {
  outline: none;
}

.help-topic__head p {
  margin: 6px 0 0;
}

.help-topic__links {
  display: flex;
  flex-wrap: wrap;
  gap: 0 var(--mf-space-4);
  list-style: none;
  margin: var(--mf-space-2) 0 0;
  padding: 0;
}

.help-topic__links li {
  margin: 0;
}

/* Busca ---------------------------------------------------------------------------------------- */
.help-results__title {
  margin-bottom: var(--mf-space-1);
}

.help-results__count {
  min-height: 1.55em;
  font-weight: 600;
  color: var(--mf-muted);
}

/* Sem contagem acima, o estado vazio precisa do próprio respiro. */
.help-results__title + .help-empty {
  margin-top: var(--mf-space-4);
}

.help-results__group + .help-results__group {
  margin-top: var(--mf-space-5);
}

.help-results__topic {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: var(--mf-space-2);
  font-size: 1.125rem;
}

.help-results__topic .icon {
  width: 20px;
  height: 20px;
  color: var(--mf-forest);
}

.help-empty {
  display: grid;
  justify-items: start;
  gap: var(--mf-space-3);
  padding: var(--mf-space-5);
  border: 1.5px dashed var(--mf-border);
  border-radius: var(--mf-radius-card);
}

.help-empty__icon {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: 14px;
  background: var(--mf-mint);
  color: var(--mf-forest);
}

.help-empty__icon .icon {
  width: 24px;
  height: 24px;
}

.help-empty__text {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 600;
  max-width: 48ch;
}

@media (max-width: 1023px) {
  .help__layout {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--mf-space-5);
  }

  .help-nav {
    position: static;
  }

  .help-nav ul {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .help-nav__link {
    background: var(--mf-cream);
  }
}

@media (max-width: 479px) {
  .help-nav ul {
    grid-template-columns: minmax(0, 1fr);
  }

  /* Ícone menor ao lado do título; a introdução ocupa a largura toda. */
  .help-topic__head {
    grid-template-columns: 40px minmax(0, 1fr);
    align-items: center;
  }

  .help-topic__heading {
    display: contents;
  }

  .help-topic__icon {
    width: 40px;
    height: 40px;
    border-radius: 12px;
  }

  .help-topic__icon .icon {
    width: 20px;
    height: 20px;
  }

  .help-topic__head p {
    grid-column: 1 / -1;
    margin-top: 0;
  }
}
</style>
