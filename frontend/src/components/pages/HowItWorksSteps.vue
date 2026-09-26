<script setup lang="ts">
import page from '@content/pages/como-funciona.yaml'
import AppIcon from '@/components/ui/AppIcon.vue'
import { byWaitlist, journeyStepState, type JourneyState, type JourneyStep } from '@/components/pages/institutional'
import { site } from '@/services/site'
import type { LinkItem } from '@/types/content'

/**
 * As quatro etapas da seção 6.5 em blocos próprios: objetivo, informação necessária, resultado
 * esperado e o que ainda não acontece. Fase e título vêm da jornada compartilhada (site.yaml).
 */
interface Detail {
  goal: string
  info: string
  result: string
  notYet: string
  link?: LinkItem
}
const journey = site.journey as JourneyStep[]
const details = page.steps.items as Detail[]
const labels = page.steps.labels as Record<'goal' | 'info' | 'result' | 'notYet', string>
// Selo de situação de cada etapa: disponível, em preparação (cadastro fechado) ou depois da abertura.
const statusText: Record<JourneyState, string> = {
  current: page.steps.statusNow,
  preparing: page.steps.statusPreparing,
  later: page.steps.statusLater,
}
const steps = journey.map((step, i) => {
  const detail = details[i]
  const link = detail?.link?.to.split('#')[0] === '/avise-me'
    ? byWaitlist(detail.link, site.nav.closedCta as LinkItem)
    : detail?.link
  return { ...step, ...detail, link, state: journeyStepState(step) }
})
</script>

<template>
  <ol class="hiw-steps">
    <li
      v-for="(step, i) in steps"
      :id="`etapa-${i + 1}`"
      :key="step.title"
      class="hiw-step"
      :class="{ 'hiw-step--current': step.state === 'current' }"
    >
      <div class="hiw-step__rail" aria-hidden="true">
        <span class="hiw-step__number">{{ i + 1 }}</span>
      </div>
      <article class="hiw-step__body" :aria-labelledby="`etapa-${i + 1}-titulo`">
        <div class="hiw-step__head">
          <p class="hiw-step__stage">{{ page.steps.stepLabel }} {{ i + 1 }} · {{ step.stage }}</p>
          <p class="hiw-step__status">
            <AppIcon :name="step.state === 'current' ? 'check-circle' : 'clock'" />
            {{ statusText[step.state] }}
          </p>
        </div>
        <h3 :id="`etapa-${i + 1}-titulo`">{{ step.title }}</h3>
        <p class="hiw-step__summary">{{ step.text }}</p>
        <dl class="hiw-step__facts">
          <div>
            <dt>{{ labels.goal }}</dt>
            <dd>{{ step.goal }}</dd>
          </div>
          <div>
            <dt>{{ labels.info }}</dt>
            <dd>{{ step.info }}</dd>
          </div>
          <div>
            <dt>{{ labels.result }}</dt>
            <dd>{{ step.result }}</dd>
          </div>
          <div class="hiw-step__notyet">
            <dt><AppIcon name="info" /> {{ labels.notYet }}</dt>
            <dd>{{ step.notYet }}</dd>
          </div>
        </dl>
        <RouterLink v-if="step.link" :to="step.link.to" class="link-arrow">{{ step.link.label }} <AppIcon name="arrow-right" /></RouterLink>
      </article>
    </li>
  </ol>
</template>

<style scoped>
.hiw-steps {
  list-style: none;
  margin: 0;
  padding: 0;
}

.hiw-step {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  gap: var(--mf-space-4);
  margin: 0;
}

.hiw-step + .hiw-step {
  margin-top: 0;
}

.hiw-step__rail {
  position: relative;
  display: flex;
  justify-content: center;
}

/* Linha vertical entre as etapas. */
.hiw-step:not(:last-child) .hiw-step__rail::after {
  content: '';
  position: absolute;
  top: 60px;
  bottom: 0;
  width: 2px;
  background: var(--mf-border);
}

.hiw-step__number {
  display: inline-grid;
  place-items: center;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: 2px solid var(--mf-forest);
  background: var(--mf-paper);
  color: var(--mf-forest);
  font-family: var(--mf-font-heading);
  font-size: 1.375rem;
  font-weight: 600;
}

.hiw-step--current .hiw-step__number {
  background: var(--mf-forest);
  color: #fff;
}

.hiw-step__body {
  margin-bottom: var(--mf-space-5);
  padding: var(--mf-space-5);
  border-radius: var(--mf-radius-card);
  background: var(--mf-paper);
  border: 1px solid var(--mf-border);
}

.hiw-step--current .hiw-step__body {
  border-color: var(--mf-forest);
  box-shadow: inset 0 0 0 1px var(--mf-forest);
}

.hiw-step:last-child .hiw-step__body {
  margin-bottom: 0;
}

.hiw-step__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--mf-space-1) var(--mf-space-3);
  margin-bottom: var(--mf-space-2);
}

.hiw-step__stage {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mf-muted);
}

.hiw-step__status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 4px 12px;
  border-radius: 999px;
  background: var(--mf-lilac);
  color: #2f2a45;
  font-size: 0.875rem;
  font-weight: 600;
}

.hiw-step--current .hiw-step__status {
  background: var(--mf-mint);
  color: var(--mf-forest);
}

.hiw-step__status .icon {
  width: 16px;
  height: 16px;
}

.hiw-step__body h3 {
  margin-bottom: var(--mf-space-1);
}

.hiw-step__summary {
  margin-bottom: var(--mf-space-4);
  color: var(--mf-muted);
  font-size: 1.0625rem;
}

.hiw-step__facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--mf-space-3);
  margin: 0 0 var(--mf-space-2);
}

.hiw-step__facts > div {
  padding: var(--mf-space-3);
  border-radius: 16px;
  background: var(--mf-cream);
}

.hiw-step__facts dt {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
  font-size: 0.875rem;
  font-weight: 700;
  color: var(--mf-forest);
}

.hiw-step__facts dd {
  margin: 0;
  font-size: 0.9875rem;
}

.hiw-step__facts > .hiw-step__notyet {
  background: var(--mf-paper);
  border: 1px dashed var(--mf-control-border);
}

.hiw-step__notyet dt {
  color: var(--mf-ink);
}

.hiw-step__notyet .icon {
  width: 16px;
  height: 16px;
}

@media (max-width: 767px) {
  .hiw-step__facts {
    grid-template-columns: minmax(0, 1fr);
  }

  .hiw-step {
    grid-template-columns: minmax(0, 1fr);
    gap: 0;
  }

  .hiw-step__rail {
    display: none;
  }

  .hiw-step__body {
    padding: var(--mf-space-4);
    margin-bottom: var(--mf-space-4);
  }
}
</style>
