<script setup lang="ts">
import launch from '@content/launch.yaml'
import page from '@content/pages/home.yaml'
import AppIcon from '@/components/ui/AppIcon.vue'
import { currentMilestoneIndex, type MilestoneStatus } from '@/components/pages/institutional'
import { formatDateLong } from '@/lib/format'

/**
 * Resumo compacto da abertura financeira (seção 6.6). Mostra só o marco atual, lido de
 * content/launch.yaml (atualização manual com evidência); a linha completa fica em /lancamento.
 */
type Status = MilestoneStatus
interface Milestone {
  id: string
  title: string
  description: string
  status: Status
  updatedAt: string | null
}

const text = page.launch as {
  eyebrow: string
  title: string
  text: string
  currentLabel: string
  nextLabel: string
  updatedLabel: string
  note: string
  link: { label: string; to: string }
  status: Record<Status, string>
}
const milestones = launch.milestones as Milestone[]

const index = currentMilestoneIndex(milestones)
const current = milestones[index]
const next = milestones.slice(index + 1).filter((m) => m.status !== 'done')
</script>

<template>
  <section v-if="current" class="section section--tight" aria-labelledby="home-abertura-titulo">
    <div class="container home-launch">
      <div class="home-launch__intro">
        <p class="eyebrow">{{ text.eyebrow }}</p>
        <h2 id="home-abertura-titulo">{{ text.title }}</h2>
        <p>{{ text.text }}</p>
        <RouterLink :to="text.link.to" class="link-arrow">{{ text.link.label }} <AppIcon name="arrow-right" /></RouterLink>
      </div>

      <div class="home-launch__card">
        <p class="home-launch__label">
          {{ text.currentLabel }} · {{ index + 1 }} de {{ milestones.length }}
        </p>
        <h3 class="home-launch__title">{{ current.title }}</h3>
        <p class="home-launch__status" :class="`home-launch__status--${current.status}`">
          <AppIcon :name="current.status === 'done' ? 'check-circle' : 'clock'" />
          <span>
            {{ text.status[current.status] }}<template v-if="current.updatedAt"> · {{ text.updatedLabel }} {{ formatDateLong(current.updatedAt) }}</template>
          </span>
        </p>
        <p class="home-launch__desc">{{ current.description }}</p>
        <p v-if="next.length" class="home-launch__next">
          <strong>{{ text.nextLabel }}:</strong> {{ next.map((m) => m.title).join(' · ') }}
        </p>
        <p class="home-launch__note">{{ text.note }}</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.home-launch {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
  gap: var(--mf-space-6);
  align-items: center;
}

/* H2 de seção dentro da faixa da seção 3 (30–44 px), um pouco menor por ser uma seção compacta. */
.home-launch__intro h2 {
  font-size: clamp(30px, 1.6vw + 14px, 38px);
}

.home-launch__intro p {
  max-width: 46ch;
  margin-bottom: var(--mf-space-2);
}

.home-launch__card {
  padding: var(--mf-space-5);
  border-radius: var(--mf-radius-card);
  background: var(--mf-paper);
  border: 1px solid var(--mf-border);
  border-left: 6px solid var(--mf-forest);
}

.home-launch__label {
  margin: 0 0 var(--mf-space-1);
  font-size: 0.875rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mf-muted);
}

.home-launch__title {
  margin-bottom: var(--mf-space-1);
}

.home-launch__status {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: var(--mf-space-2);
  font-weight: 600;
  font-size: 0.9375rem;
  color: var(--mf-forest);
}

.home-launch__status .icon {
  flex: none;
  width: 18px;
  height: 18px;
  margin-top: 3px;
}

.home-launch__desc {
  margin-bottom: var(--mf-space-2);
  font-size: 0.9875rem;
}

.home-launch__next {
  margin-bottom: var(--mf-space-2);
  padding-top: var(--mf-space-2);
  border-top: 1px solid var(--mf-border);
  font-size: 0.9375rem;
}

.home-launch__note {
  margin: 0;
  font-size: 0.875rem;
  color: var(--mf-muted);
}

@media (max-width: 1023px) {
  .home-launch {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--mf-space-4);
  }
}

@media (max-width: 767px) {
  .home-launch__card {
    padding: var(--mf-space-4);
  }
}
</style>
