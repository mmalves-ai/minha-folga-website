<script setup lang="ts">
/**
 * Distribuição em barras horizontais, construída como tabela (legenda, cabeçalhos e valores em
 * texto). A barra é só reforço visual: série única, sem legenda de cor.
 */
import { computed } from 'vue'

interface BarItem {
  key: string
  label: string
  count: number
}

const props = withDefaults(defineProps<{ caption: string; items: BarItem[]; itemHeader?: string; emptyText?: string }>(), {
  itemHeader: 'Categoria',
  emptyText: 'Sem registros no período.',
})

const nf = new Intl.NumberFormat('pt-BR')
const pf = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 })

const rows = computed(() => [...props.items].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'pt-BR')))
const total = computed(() => rows.value.reduce((sum, r) => sum + r.count, 0))
const max = computed(() => Math.max(1, ...rows.value.map((r) => r.count)))
</script>

<template>
  <table class="bars">
    <caption>
      {{ caption }}
      <span v-if="total > 0">· total {{ nf.format(total) }}</span>
    </caption>
    <thead class="visually-hidden">
      <tr>
        <th scope="col">{{ itemHeader }}</th>
        <th scope="col">Quantidade</th>
        <th scope="col">Participação</th>
      </tr>
    </thead>
    <tbody v-if="rows.length && total > 0">
      <tr v-for="row in rows" :key="row.key">
        <th scope="row" class="bars__label">{{ row.label }}</th>
        <td>
          <span class="bars__value">
            <span class="bars__track" aria-hidden="true">
              <span class="bars__fill" :style="{ width: `${(row.count / max) * 100}%` }" />
            </span>
            <span class="bars__count">{{ nf.format(row.count) }}</span>
          </span>
        </td>
        <td class="bars__pct">{{ pf.format(row.count / total) }}</td>
      </tr>
    </tbody>
    <tbody v-else>
      <tr>
        <td colspan="3" class="bars__empty">{{ emptyText }}</td>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
.bars {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9375rem;
}

caption {
  margin-bottom: 10px;
  text-align: left;
  font-family: var(--mf-font-heading);
  font-weight: 600;
  font-size: 1rem;
  color: var(--mf-ink);
}

caption span {
  font-family: var(--mf-font-body);
  font-weight: 400;
  font-size: 0.875rem;
  color: var(--mf-muted);
}

th,
td {
  padding: 6px 0;
  vertical-align: middle;
  border-bottom: 1px solid #eef1ee;
}

tr:last-child > * {
  border-bottom: 0;
}

.bars__label {
  width: 38%;
  padding-right: 12px;
  text-align: left;
  font-weight: 500;
  line-height: 1.3;
}

.bars__value {
  display: flex;
  align-items: center;
  gap: 8px;
}

.bars__track {
  flex: 1;
  height: 14px;
}

.bars__fill {
  display: block;
  height: 100%;
  min-width: 2px;
  background: var(--mf-forest);
  /* Extremidade de dado arredondada; base reta. */
  border-radius: 0 4px 4px 0;
}

.bars__count {
  min-width: 3ch;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.bars__pct {
  width: 64px;
  padding-left: 8px;
  text-align: right;
  font-size: 0.875rem;
  color: var(--mf-muted);
  font-variant-numeric: tabular-nums;
}

.bars__empty {
  color: var(--mf-muted);
}

@media (max-width: 420px) {
  .bars__label {
    width: 44%;
  }
  .bars__pct {
    width: 52px;
  }
}
</style>
