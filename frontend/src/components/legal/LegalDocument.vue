<script setup lang="ts">
import { computed } from 'vue'
import RichText from '@/components/content/RichText.vue'
import LegalToc from '@/components/legal/LegalToc.vue'
import Breadcrumbs from '@/components/site/Breadcrumbs.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import {
  extractToc,
  isNoticeApproved,
  LEGAL_DOCS,
  noticeVersionLabel,
  splitLegalBlocks,
  type NoticeKey,
} from '@/components/legal/legal'
import { publicConfig } from '@/services/site'

/**
 * Layout de documento das páginas legais: cabeçalho com versão real (contracts/consents.json),
 * seletor entre os três documentos, sumário navegável, seções numeradas e links cruzados.
 * Parágrafos `[[nome]]` no Markdown viram slots com o mesmo nome (conteúdo dinâmico da página).
 */
const props = defineProps<{
  doc: { meta: Record<string, any>; html: string }
  notice: NoticeKey
}>()

const meta = computed(() => props.doc.meta as { title: string; summary: string; highlights?: string[] })
const current = computed(() => LEGAL_DOCS.find((d) => d.notice === props.notice)!)
const others = computed(() => LEGAL_DOCS.filter((d) => d.notice !== props.notice))
const noticeMeta = computed(() => publicConfig.notices[props.notice])
const versionLabel = computed(() => noticeVersionLabel(noticeMeta.value))
const approved = computed(() => isNoticeApproved(noticeMeta.value))
const toc = computed(() => extractToc(props.doc.html))
const blocks = computed(() => splitLegalBlocks(props.doc.html))
const contentId = computed(() => `doc-${props.notice}`)
</script>

<template>
  <div class="legal">
    <Breadcrumbs :items="[{ label: current.label, to: current.to }]" />

    <header class="legal-head container">
      <div class="legal-head__main">
        <p class="eyebrow">Informações legais</p>
        <h1 id="titulo-pagina">{{ meta.title }}</h1>
        <p class="lead">{{ meta.summary }}</p>
        <p class="legal-head__version" :class="{ 'legal-head__version--draft': !approved }">
          <AppIcon :name="approved ? 'check-circle' : 'clock'" />
          <span>{{ versionLabel }}</span>
        </p>
      </div>

      <nav class="legal-docs" aria-label="Documentos legais">
        <ul>
          <li v-for="item in LEGAL_DOCS" :key="item.to">
            <RouterLink
              :to="item.to"
              class="legal-docs__link"
              :aria-current="item.notice === notice ? 'page' : undefined"
            >
              <strong class="legal-docs__label">{{ item.label }}</strong>
              <strong class="legal-docs__short" aria-hidden="true">{{ item.short }}</strong>
              <span class="legal-docs__hint">{{ item.hint }}</span>
            </RouterLink>
          </li>
        </ul>
      </nav>
    </header>

    <div class="legal-body">
      <div class="container legal-layout">
        <aside class="legal-layout__aside">
          <LegalToc :items="toc" :content-id="contentId" />
        </aside>

        <article :id="contentId" class="legal-article" aria-labelledby="titulo-pagina">
          <div v-if="!approved" class="notice notice--pending legal-article__draft" role="note">
            <AppIcon name="info" />
            <p>
              <strong>Texto em revisão.</strong> Este documento descreve o funcionamento atual do site e ainda passará
              por revisão jurídica. Trechos marcados como pendentes dependem de dados ou decisões da empresa e impedem a
              publicação até serem preenchidos.
            </p>
          </div>

          <section v-if="meta.highlights?.length" class="legal-summary" aria-labelledby="resumo-titulo">
            <h2 id="resumo-titulo" class="legal-summary__title">Em resumo</h2>
            <ul>
              <li v-for="(text, i) in meta.highlights" :key="i">
                <AppIcon name="check" />
                <span>{{ text }}</span>
              </li>
            </ul>
          </section>

          <div class="prose legal-prose">
            <template v-for="(block, i) in blocks" :key="i">
              <RichText v-if="block.type === 'html'" :html="block.html" />
              <div v-else class="legal-slot">
                <slot :name="block.name" />
              </div>
            </template>
          </div>

          <footer class="legal-end" aria-labelledby="relacionados-titulo">
            <h2 id="relacionados-titulo" class="legal-end__title">Documentos relacionados</h2>
            <ul class="legal-end__links">
              <li v-for="item in others" :key="item.to">
                <RouterLink :to="item.to" class="link-arrow">
                  {{ item.label }} <AppIcon name="arrow-right" />
                </RouterLink>
              </li>
              <li>
                <RouterLink to="/atendimento" class="link-arrow">Falar com o atendimento <AppIcon name="arrow-right" /></RouterLink>
              </li>
            </ul>
            <a href="#sumario" class="legal-end__top">Voltar ao sumário</a>
          </footer>
        </article>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Cabeçalho --------------------------------------------------------------------------------------- */
.legal-head {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(0, 0.65fr);
  gap: var(--mf-space-6);
  align-items: end;
  padding-block: var(--mf-space-6) var(--mf-space-6);
}

.legal-head h1 {
  margin-top: var(--mf-space-2);
  font-size: clamp(38px, 3.6vw, 56px);
}

.legal-head .lead {
  margin-bottom: var(--mf-space-4);
}

.legal-head__version {
  display: inline-flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0;
  padding: 8px 14px;
  border-radius: 999px;
  background: var(--mf-mint);
  color: var(--mf-forest);
  font-size: 0.9375rem;
  font-weight: 600;
  line-height: 1.4;
}

.legal-head__version--draft {
  background: #fff8e6;
  color: #4d3a00;
  box-shadow: inset 0 0 0 1px #e9d9a8;
}

.legal-head__version .icon {
  flex: none;
  width: 18px;
  height: 18px;
  margin-top: 1px;
}

.legal-docs ul {
  display: grid;
  gap: 8px;
  list-style: none;
  margin: 0;
  padding: 0;
}

.legal-docs li {
  margin: 0;
}

.legal-docs__link {
  display: grid;
  gap: 2px;
  min-height: 44px;
  padding: 12px 16px 12px 18px;
  border: 1px solid var(--mf-border);
  border-radius: 16px;
  background: var(--mf-paper);
  color: var(--mf-ink);
  text-decoration: none;
  transition:
    border-color var(--mf-duration) var(--mf-ease),
    background-color var(--mf-duration) var(--mf-ease);
}

.legal-docs__link strong {
  color: var(--mf-forest);
  font-size: 1rem;
}

.legal-docs__short {
  display: none;
}

.legal-docs__hint {
  font-size: 0.875rem;
  color: var(--mf-muted);
  line-height: 1.4;
}

.legal-docs__link:hover {
  border-color: var(--mf-control-border);
}

.legal-docs__link:hover strong {
  text-decoration: underline;
}

.legal-docs__link[aria-current='page'] {
  border-color: var(--mf-forest);
  box-shadow: inset 4px 0 0 var(--mf-forest);
  background: #f3f8f5;
}

/* Corpo ------------------------------------------------------------------------------------------- */
.legal-body {
  background: var(--mf-paper);
  border-top: 1px solid var(--mf-border);
  padding-block: var(--mf-space-7) var(--mf-space-8);
}

.legal-layout {
  display: grid;
  grid-template-columns: minmax(240px, 300px) minmax(0, 1fr);
  gap: var(--mf-space-7);
  align-items: start;
}

.legal-layout__aside {
  position: sticky;
  top: calc(var(--mf-header-height) + 24px);
}

.legal-article {
  min-width: 0;
  max-width: 760px;
}

.legal-article__draft {
  margin-bottom: var(--mf-space-5);
}

.legal-summary {
  margin-bottom: var(--mf-space-6);
  padding: var(--mf-space-4) var(--mf-space-5);
  border-radius: var(--mf-radius-card);
  background: var(--mf-cream);
  border: 1px solid var(--mf-border);
}

/* H2 da página: dentro da faixa de 30–44 px (seção 3), no menor tamanho por estar num painel. */
.legal-summary__title {
  margin: 0 0 var(--mf-space-3);
  font-size: 30px;
}

.legal-summary ul {
  display: grid;
  gap: 10px;
  list-style: none;
  margin: 0;
  padding: 0;
}

.legal-summary li {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  gap: 10px;
  margin: 0;
  line-height: 1.5;
}

.legal-summary li .icon {
  width: 20px;
  height: 20px;
  margin-top: 3px;
  color: var(--mf-forest);
}

/* Texto do documento: seções numeradas por contador (os ids das âncoras não dependem da numeração). */
.legal-prose {
  max-width: none;
  counter-reset: legal-h2 legal-h3;
}

.legal-prose :deep(.rich-text h2) {
  counter-increment: legal-h2;
  counter-set: legal-h3 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 14px;
  align-items: baseline;
  margin-top: var(--mf-space-7);
  padding-top: var(--mf-space-5);
  border-top: 1px solid var(--mf-border);
}

.legal-prose :deep(.rich-text:first-child h2:first-child) {
  margin-top: 0;
  padding-top: 0;
  border-top: 0;
}

.legal-prose :deep(.rich-text h2)::before {
  content: counter(legal-h2);
  display: inline-grid;
  place-items: center;
  min-width: 40px;
  height: 40px;
  padding-inline: 6px;
  border-radius: 12px;
  background: var(--mf-forest);
  color: #fff;
  font-size: 1.0625rem;
  font-weight: 600;
  letter-spacing: 0;
  transform: translateY(-4px);
}

.legal-prose :deep(.rich-text h3) {
  counter-increment: legal-h3;
  margin-top: var(--mf-space-6);
}

.legal-prose :deep(.rich-text h3)::before {
  content: counter(legal-h2) '.' counter(legal-h3) '\00a0\00a0';
  color: var(--mf-forest);
  font-variant-numeric: tabular-nums;
}

.legal-prose :deep(.rich-text h2),
.legal-prose :deep(.rich-text h3) {
  scroll-margin-top: calc(var(--mf-header-height) + 20px);
}

.legal-prose :deep(.rich-text ul > li),
.legal-prose :deep(.rich-text ol > li) {
  padding-left: 4px;
}

.legal-prose :deep(.rich-text li + li) {
  margin-top: 0.6em;
}

.legal-prose :deep(.rich-text table) {
  display: table;
  table-layout: fixed;
  font-size: 0.9375rem;
}

.legal-prose :deep(.rich-text th:first-child),
.legal-prose :deep(.rich-text td:first-child) {
  width: 34%;
  font-weight: 600;
}

.legal-prose :deep(.rich-text td) {
  overflow-wrap: anywhere;
}

.legal-slot {
  margin: var(--mf-space-4) 0 var(--mf-space-4);
}

/* Final do documento ------------------------------------------------------------------------------ */
.legal-end {
  margin-top: var(--mf-space-7);
  padding: var(--mf-space-5);
  border-radius: var(--mf-radius-card);
  background: var(--mf-mint);
}

.legal-end__title {
  margin: 0 0 var(--mf-space-3);
  font-size: 30px;
}

.legal-end__links {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 28px;
  list-style: none;
  margin: 0;
  padding: 0;
}

.legal-end__links li {
  margin: 0;
}

.legal-end__top {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  margin-top: var(--mf-space-2);
  font-size: 0.9375rem;
}

@media (max-width: 1023px) {
  .legal-head {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--mf-space-5);
    align-items: start;
  }

  .legal-docs ul {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .legal-layout {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--mf-space-5);
  }

  .legal-layout__aside {
    position: static;
  }

  .legal-article {
    max-width: none;
  }

  .legal-body {
    padding-block: var(--mf-space-5) var(--mf-space-7);
  }
}

@media (max-width: 767px) {
  .legal-head {
    padding-block: var(--mf-space-4) var(--mf-space-5);
  }

  .legal-head__version {
    border-radius: 14px;
  }

  .legal-docs ul {
    gap: 6px;
  }

  .legal-docs__link {
    place-items: center;
    padding: 10px 4px;
    border-radius: 12px;
    text-align: center;
  }

  .legal-docs__link[aria-current='page'] {
    box-shadow: inset 0 -3px 0 var(--mf-forest);
  }

  /* No celular o rótulo visível é o curto; o nome completo segue para leitores de tela. */
  .legal-docs__label {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
  }

  .legal-docs__short {
    display: block;
    font-size: 0.9375rem;
  }

  .legal-docs__hint {
    display: none;
  }

  .legal-summary {
    padding: var(--mf-space-4);
  }

  .legal-prose :deep(.rich-text h2) {
    gap: 12px;
    margin-top: var(--mf-space-6);
  }

  .legal-prose :deep(.rich-text h2)::before {
    min-width: 34px;
    height: 34px;
    font-size: 1rem;
    border-radius: 10px;
    transform: translateY(-2px);
  }

  .legal-prose :deep(.rich-text table) {
    font-size: 0.875rem;
  }

  .legal-prose :deep(.rich-text th),
  .legal-prose :deep(.rich-text td) {
    padding: 8px 10px;
  }

  .legal-end {
    padding: var(--mf-space-4);
  }
}
</style>
