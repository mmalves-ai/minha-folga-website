<script setup lang="ts">
/**
 * Série diária em pequenos múltiplos (recebidos e telefones validados pela Bia), mesma escala nos dois.
 * O gráfico é reforço visual (aria-hidden); os números completos ficam na tabela logo abaixo.
 */
import { computed, ref } from 'vue'
import { formatDate } from '@/lib/format'

const props = defineProps<{ days: { day: string; created: number; verified: number }[] }>()

const nf = new Intl.NumberFormat('pt-BR')
const showTable = ref(false)
const hover = ref<{ series: 'created' | 'verified'; index: number } | null>(null)

const max = computed(() => Math.max(1, ...props.days.flatMap((d) => [d.created, d.verified])))
const series = [
  { key: 'created', title: 'Cadastros recebidos por dia' },
  { key: 'verified', title: 'Telefones validados pela Bia por dia' },
] as const

function shortDay(day: string) {
  return formatDate(day).slice(0, 5)
}

function tooltip(key: 'created' | 'verified', index: number) {
  const d = props.days[index]
  if (!d) return ''
  return `${formatDate(d.day)}: ${nf.format(d[key])}`
}
</script>

<template>
  <div class="daily">
    <div class="daily__multiples" aria-hidden="true">
      <figure v-for="s in series" :key="s.key" class="daily__chart">
        <figcaption>
          {{ s.title }}
          <span class="daily__sum">{{ nf.format(days.reduce((sum, d) => sum + d[s.key], 0)) }} no período</span>
        </figcaption>
        <div class="daily__plot">
          <span class="daily__max">{{ nf.format(max) }}</span>
          <div class="daily__cols" @mouseleave="hover = null">
            <span
              v-for="(d, i) in days"
              :key="d.day"
              class="daily__col"
              @mouseenter="hover = { series: s.key, index: i }"
            >
              <span
                class="daily__bar"
                :class="{ 'daily__bar--active': hover?.series === s.key && hover.index === i }"
                :style="{ height: `${(d[s.key] / max) * 100}%` }"
              />
            </span>
            <span v-if="hover && hover.series === s.key" class="daily__tip" :style="{ left: `${((hover.index + 0.5) / days.length) * 100}%` }">
              {{ tooltip(s.key, hover.index) }}
            </span>
          </div>
        </div>
        <div v-if="days.length" class="daily__axis">
          <span>{{ shortDay(days[0]!.day) }}</span>
          <span>{{ shortDay(days[days.length - 1]!.day) }}</span>
        </div>
      </figure>
    </div>

    <button type="button" class="btn btn--ghost btn--sm daily__toggle" :aria-expanded="showTable ? 'true' : 'false'" aria-controls="serie-diaria" @click="showTable = !showTable">
      {{ showTable ? 'Ocultar tabela por dia' : 'Mostrar tabela por dia' }}
    </button>
    <div id="serie-diaria" :hidden="!showTable" class="admin-table-wrap daily__table" tabindex="0" role="region" aria-label="Série diária de cadastros">
      <table class="admin-table">
        <caption>Série diária de cadastros</caption>
        <thead>
          <tr>
            <th scope="col">Dia</th>
            <th scope="col" class="num">Recebidos</th>
            <th scope="col" class="num">Validados</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in days" :key="d.day">
            <th scope="row" class="nowrap">{{ formatDate(d.day) }}</th>
            <td class="num">{{ nf.format(d.created) }}</td>
            <td class="num">{{ nf.format(d.verified) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.daily__multiples {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--mf-space-4);
}

@media (max-width: 767px) {
  .daily__multiples {
    grid-template-columns: minmax(0, 1fr);
  }
}

.daily__chart {
  margin: 0;
  min-width: 0;
}

figcaption {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 2px 12px;
  margin-bottom: 10px;
  font-size: 0.9375rem;
  font-weight: 600;
}

.daily__sum {
  font-weight: 400;
  font-size: 0.875rem;
  color: var(--mf-muted);
}

.daily__plot {
  position: relative;
  padding-top: 18px;
}

.daily__max {
  position: absolute;
  top: 0;
  left: 0;
  font-size: 0.75rem;
  color: var(--mf-muted);
  font-variant-numeric: tabular-nums;
}

.daily__cols {
  position: relative;
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 120px;
  border-top: 1px solid #eef1ee;
  border-bottom: 1px solid var(--mf-control-border);
}

.daily__col {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  flex: 1 1 0;
  height: 100%;
}

.daily__bar {
  display: block;
  width: 100%;
  max-width: 24px;
  min-height: 1px;
  background: var(--mf-forest);
  border-radius: 4px 4px 0 0;
  transition: background-color var(--mf-duration) var(--mf-ease);
}

.daily__bar--active {
  background: var(--mf-coral);
}

.daily__tip {
  position: absolute;
  bottom: calc(100% + 6px);
  transform: translateX(-50%);
  padding: 4px 8px;
  border-radius: 8px;
  background: var(--mf-ink);
  color: #fff;
  font-size: 0.8125rem;
  white-space: nowrap;
  pointer-events: none;
}

.daily__axis {
  display: flex;
  justify-content: space-between;
  margin-top: 4px;
  font-size: 0.75rem;
  color: var(--mf-muted);
}

.daily__toggle {
  margin-top: var(--mf-space-2);
  padding-inline: 0;
}

.daily__table {
  margin-top: var(--mf-space-2);
  max-height: 360px;
  overflow-y: auto;
}
</style>
