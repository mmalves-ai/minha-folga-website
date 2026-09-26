<script setup lang="ts">
import articles from 'virtual:mf-articles'
import faq from '@content/faq.yaml'
import page from '@content/pages/home.yaml'
import ArticleCard from '@/components/content/ArticleCard.vue'
import FaqAccordion from '@/components/content/FaqAccordion.vue'
import AcquisitionSignup from '@/components/pages/AcquisitionSignup.vue'
import AcquisitionTrust from '@/components/pages/AcquisitionTrust.vue'
import BrowserNotifications from '@/components/site/BrowserNotifications.vue'
import HomeBia from '@/components/pages/HomeBia.vue'
import HomeHero from '@/components/pages/HomeHero.vue'
import HomeValue from '@/components/pages/HomeValue.vue'
import AcquisitionReason from '@/components/pages/AcquisitionReason.vue'
import InstitutionalCta from '@/components/pages/InstitutionalCta.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { organizationJsonLd, useSeo } from '@/composables/useSeo'
import type { FaqBase } from '@/types/content'

// Aquisição integrada ao site corporativo: fotografia, ajuda, Bia, etapas, confiança e cadastro.
// As páginas de produto e abertura continuam acessíveis pela navegação e pelos links internos.
const org = organizationJsonLd()
useSeo({ title: page.meta.title, description: page.meta.description, path: '/', jsonLd: org ? [org] : [] })

const faqItems = ['novo-emprestimo', 'reduzir-consignado-atual', 'por-que-cadastrar-agora', 'ja-libera-emprestimos'].flatMap((id) => (faq as FaqBase).items.filter((item) => item.id === id))
// Somente artigos reais do conteúdo versionado; sem artigos, a seção não é exibida.
const featured = articles.slice(0, 3)

</script>

<template>
  <HomeHero />
  <HomeValue />
  <HomeBia />
  <AcquisitionReason source="home" />

  <AcquisitionSignup source="home" />
  <AcquisitionTrust />
  <div class="container"><BrowserNotifications /></div>

  <section v-if="featured.length" class="section section--paper" aria-labelledby="home-conteudos-titulo">
    <div class="container">
      <div class="home-articles__head">
        <div class="section-head">
          <p class="eyebrow">{{ page.articles.eyebrow }}</p>
          <h2 id="home-conteudos-titulo">{{ page.articles.title }}</h2>
          <p>{{ page.articles.text }}</p>
        </div>
        <RouterLink :to="page.articles.link.to" class="btn btn--secondary">{{ page.articles.link.label }}</RouterLink>
      </div>
      <div class="grid home-articles__grid" :class="featured.length >= 3 ? 'grid--3' : 'grid--2'">
        <ArticleCard v-for="article in featured" :key="article.slug" :article="article" />
      </div>
    </div>
  </section>

  <section v-if="faqItems.length" class="section" :class="{ 'section--paper': !featured.length }" aria-labelledby="home-faq-titulo">
    <div class="container split split--top home-faq">
      <div>
        <p class="eyebrow">{{ page.faq.eyebrow }}</p>
        <h2 id="home-faq-titulo">{{ page.faq.title }}</h2>
        <p>{{ page.faq.text }}</p>
        <RouterLink :to="page.faq.link.to" class="link-arrow">{{ page.faq.link.label }} <AppIcon name="arrow-right" /></RouterLink>
      </div>
      <FaqAccordion :items="faqItems" id-prefix="home-faq" />
    </div>
  </section>

  <InstitutionalCta
    id="home-cta"
    :title="page.closing.title"
    :text="page.closing.text"
    :primary="page.closing.primary"
    :background="featured.length ? 'cream' : 'paper'"
    joined
    availability
  />
</template>

<style scoped>
.home-more {
  margin: var(--mf-space-4) 0 0;
}

.home-articles__head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--mf-space-3) var(--mf-space-5);
  margin-bottom: var(--mf-space-6);
}

.home-articles__head .section-head {
  margin-bottom: 0;
}

.home-faq {
  grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr);
}

/* Tablet: três cartões em duas colunas deixariam um órfão; o primeiro ocupa a linha inteira. */
@media (min-width: 768px) and (max-width: 1023px) {
  .home-articles__grid.grid--3 > :first-child {
    grid-column: 1 / -1;
  }
}

@media (max-width: 1023px) {
  .home-faq {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
