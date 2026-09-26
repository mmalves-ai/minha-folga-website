<script setup lang="ts">
import { journeyStepState, type JourneyStep } from '@/components/pages/institutional'
import { site } from '@/services/site'

/**
 * Jornada em quatro etapas (seção 6.5). A etapa atual fica destacada com texto, não só com cor, e só
 * aparece como disponível quando a configuração pública confirma o recurso (ex.: cadastro aberto).
 */
withDefaults(defineProps<{ layout?: 'row' | 'column'; headingLevel?: 3 | 4 }>(), { layout: 'row', headingLevel: 3 })
const labels = site.journeyStatus as { current: string; preparing: string }
const steps = (site.journey as JourneyStep[]).map((step) => ({ ...step, state: journeyStepState(step) }))
</script>

<template>
  <ol class="steps" :class="{ 'steps--row': layout === 'row' }">
    <li v-for="(step, i) in steps" :key="step.title" class="step" :class="{ 'step--current': step.state === 'current' }">
      <span class="step__number" aria-hidden="true">{{ i + 1 }}</span>
      <span class="step__stage">{{ step.stage }}<span v-if="step.state !== 'later'"> · {{ labels[step.state] }}</span></span>
      <component :is="`h${headingLevel}`">{{ step.title }}</component>
      <p>{{ step.text }}</p>
    </li>
  </ol>
</template>
