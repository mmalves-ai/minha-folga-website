<script setup lang="ts">
import page from '@content/pages/home.yaml'
import CreditStatusBadge from '@/components/site/CreditStatusBadge.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { onlyAvailable, type Requirement } from '@/components/pages/institutional'
import type { LinkItem } from '@/types/content'

/** Solução de consignado e seu estado real: o que já existe e o que depende da abertura da operação. */
const solution = page.solution as {
  eyebrow: string
  title: string
  text: string
  link: LinkItem
  nowTitle: string
  now: { text: string; requires?: Requirement }[]
  laterTitle: string
  later: string[]
  supportTitle: string
  supportText: string
  support: LinkItem[]
}
const now = onlyAvailable(solution.now)
</script>

<template>
  <section class="section" aria-labelledby="home-solucao-titulo">
    <div class="container">
      <div class="home-solution panel">
        <div class="home-solution__intro">
          <CreditStatusBadge />
          <p class="eyebrow home-solution__eyebrow">{{ solution.eyebrow }}</p>
          <h2 id="home-solucao-titulo">{{ solution.title }}</h2>
          <p>{{ solution.text }}</p>
          <RouterLink :to="solution.link.to" class="btn btn--primary">{{ solution.link.label }} <AppIcon name="arrow-right" /></RouterLink>
        </div>

        <div class="home-solution__status">
          <div class="home-solution__col home-solution__col--now">
            <h3 class="home-solution__coltitle"><AppIcon name="check-circle" /> {{ solution.nowTitle }}</h3>
            <ul>
              <li v-for="item in now" :key="item.text">{{ item.text }}</li>
            </ul>
          </div>
          <div class="home-solution__col home-solution__col--later">
            <h3 class="home-solution__coltitle"><AppIcon name="clock" /> {{ solution.laterTitle }}</h3>
            <ul>
              <li v-for="item in solution.later" :key="item">{{ item }}</li>
            </ul>
          </div>
        </div>
      </div>

      <div class="home-support">
        <div>
          <h3 class="home-support__title">{{ solution.supportTitle }}</h3>
          <p class="muted">{{ solution.supportText }}</p>
        </div>
        <ul class="home-support__links">
          <li v-for="link in solution.support" :key="link.to">
            <RouterLink :to="link.to" class="link-arrow">{{ link.label }} <AppIcon name="arrow-right" /></RouterLink>
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>

<style scoped>
.home-solution {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--mf-space-6);
  padding: var(--mf-space-6);
}

.home-solution__eyebrow {
  display: flex;
  margin-top: var(--mf-space-4);
}

.home-solution__intro h2 {
  margin-bottom: var(--mf-space-3);
}

.home-solution__intro p:not(.eyebrow) {
  margin-bottom: var(--mf-space-4);
  max-width: 52ch;
}

.home-solution__status {
  display: grid;
  gap: var(--mf-space-3);
  align-content: start;
}

.home-solution__col {
  padding: var(--mf-space-4);
  border-radius: 20px;
}

.home-solution__col--now {
  background: var(--mf-mint);
}

.home-solution__col--later {
  background: var(--mf-cream);
  border: 1px dashed var(--mf-control-border);
}

.home-solution__coltitle {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: var(--mf-space-2);
  font-family: var(--mf-font-body);
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: 0;
  color: var(--mf-forest);
}

.home-solution__coltitle .icon {
  width: 20px;
  height: 20px;
  flex: none;
}

.home-solution__col ul {
  margin: 0;
  padding-left: 1.1em;
}

.home-solution__col li {
  font-size: 0.9875rem;
}

.home-support {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--mf-space-2) var(--mf-space-5);
  align-items: center;
  margin-top: var(--mf-space-5);
  padding-inline: var(--mf-space-6);
}

.home-support__title {
  margin-bottom: 4px;
  font-size: 1.125rem;
}

.home-support p {
  margin: 0;
  max-width: 60ch;
}

.home-support__links {
  display: flex;
  flex-wrap: wrap;
  gap: 0 var(--mf-space-5);
  list-style: none;
  margin: 0;
  padding: 0;
}

.home-support__links li {
  margin: 0;
}

@media (max-width: 1023px) {
  .home-solution {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--mf-space-5);
    padding: var(--mf-space-5);
  }

  .home-support {
    grid-template-columns: minmax(0, 1fr);
    padding-inline: var(--mf-space-5);
  }
}

@media (max-width: 767px) {
  .home-solution {
    padding: var(--mf-space-4) 20px;
  }

  .home-solution__col {
    padding: 18px;
  }

  .home-solution__intro .btn {
    width: 100%;
  }

  .home-support {
    padding-inline: 0;
  }
}
</style>
