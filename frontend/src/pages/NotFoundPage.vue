<script setup lang="ts">
import page from '@content/pages/404.yaml'
import RichText from '@/components/content/RichText.vue'
import PageHero from '@/components/site/PageHero.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { useSeo } from '@/composables/useSeo'

/**
 * Página 404 (rota /404 pré-renderizada e rotas inexistentes no cliente). Sempre noindex.
 * O status HTTP 404 é definido pelo servidor web, que serve 404.html para URLs desconhecidas.
 */
useSeo({ title: page.meta.title, description: page.meta.description, noindex: true, path: '/404' })

type IconName = 'home' | 'layers' | 'book' | 'compass' | 'chat'
const links = page.links as { to: string; label: string; text: string; icon: IconName }[]
</script>

<template>
  <div class="not-found">
    <PageHero :title="page.hero.title" :lead="page.hero.lead" :eyebrow="page.hero.eyebrow" :breadcrumbs="[{ label: page.hero.breadcrumb, to: '/404' }]" />

    <section class="section section--flush-top" aria-labelledby="caminhos-titulo">
      <div class="container">
        <h2 id="caminhos-titulo" class="not-found__title">{{ page.linksTitle }}</h2>
        <ul class="not-found__links">
          <li v-for="link in links" :key="link.to">
            <RouterLink :to="link.to" class="not-found__link">
              <span class="card__icon" aria-hidden="true"><AppIcon :name="link.icon" /></span>
              <span class="not-found__label">{{ link.label }}</span>
              <span class="not-found__text muted">{{ link.text }}</span>
              <AppIcon name="arrow-right" class="not-found__arrow" />
            </RouterLink>
          </li>
        </ul>
        <RichText :html="page.report_mdi" tag="p" class="not-found__report muted" />
      </div>
    </section>
  </div>
</template>

<style scoped>
.not-found__title {
  font-size: clamp(22px, 1vw + 16px, 28px);
  margin-bottom: var(--mf-space-4);
}

.not-found__links {
  list-style: none;
  margin: 0 0 var(--mf-space-5);
  padding: 0;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: var(--mf-space-3);
}

.not-found__links li {
  margin: 0;
}

.not-found__link {
  position: relative;
  display: grid;
  grid-template-rows: auto auto 1fr;
  height: 100%;
  padding: var(--mf-space-4);
  border: 1px solid var(--mf-border);
  border-radius: var(--mf-radius-card);
  background: var(--mf-paper);
  color: var(--mf-ink);
  text-decoration: none;
  transition: border-color var(--mf-duration) var(--mf-ease);
}

.not-found__link:hover {
  border-color: var(--mf-forest);
}

.not-found__label {
  font-family: var(--mf-font-heading);
  font-size: 1.1875rem;
  font-weight: 600;
  color: var(--mf-forest);
}

.not-found__link:hover .not-found__label {
  text-decoration: underline;
}

.not-found__text {
  margin-top: 4px;
  font-size: 0.9375rem;
}

.not-found__arrow {
  position: absolute;
  top: var(--mf-space-4);
  right: var(--mf-space-4);
  width: 20px;
  height: 20px;
  color: var(--mf-forest);
  transition: transform var(--mf-duration) var(--mf-ease);
}

.not-found__link:hover .not-found__arrow,
.not-found__link:focus-visible .not-found__arrow {
  transform: translateX(3px);
}

.not-found__report {
  margin: 0;
}

@media (max-width: 1100px) {
  .not-found__links {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 767px) {
  .not-found__links {
    grid-template-columns: minmax(0, 1fr);
    gap: 0;
    border-top: 1px solid var(--mf-border);
  }
  .not-found__link {
    grid-template-columns: 48px minmax(0, 1fr) 20px;
    grid-template-rows: auto auto;
    column-gap: var(--mf-space-3);
    align-items: center;
    padding: var(--mf-space-3) 4px;
    border: 0;
    border-bottom: 1px solid var(--mf-border);
    border-radius: 0;
    background: transparent;
  }
  .not-found__link .card__icon {
    grid-row: span 2;
    margin: 0;
  }
  .not-found__text {
    grid-column: 2;
    margin-top: 0;
  }
  .not-found__arrow {
    position: static;
    grid-column: 3;
    grid-row: 1 / span 2;
  }
}

/* Títulos de seção: faixa de 30–44 px da seção 3 (inclusive no celular). */
.not-found__title {
  font-size: clamp(30px, 1.2vw + 18px, 36px);
}
</style>
