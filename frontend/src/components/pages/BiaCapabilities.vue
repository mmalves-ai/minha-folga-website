<script setup lang="ts">
import page from '@content/pages/bia.yaml'
import AppIcon from '@/components/ui/AppIcon.vue'
import { capabilityKind, PHASE_LABELS } from '@/components/pages/institutional'
import { creditPhase, publicConfig } from '@/services/site'

/**
 * Quadro de capacidades por fase (seção 7), com a fase vigente da configuração do servidor destacada
 * por texto ("Fase atual") além da cor. Telas estreitas recebem a mesma informação em lista.
 */
interface Row {
  capability: string
  preLaunch: string
  later: string
  /** `forward`: a Bia não executa, apenas encaminha para o fluxo formal. */
  laterKind?: 'forward'
}

const t = page.capabilities as {
  caption: string
  capabilityHeader: string
  preLaunchHeader: string
  laterHeader: string
  currentLabel: string
  phaseLabel: string
  operationsLabel: string
  operationsOn: string
  operationsOff: string
  rows: Row[]
}
const current: 'preLaunch' | 'later' = creditPhase === 'PRE_LAUNCH' ? 'preLaunch' : 'later'
const columns = [
  { key: 'preLaunch' as const, header: t.preLaunchHeader },
  { key: 'later' as const, header: t.laterHeader },
]
const operations = publicConfig.credit.operationsEnabled ? t.operationsOn : t.operationsOff

const ICONS = { yes: 'check', no: 'close', forward: 'arrow-right' } as const
const kind = (row: Row, key: 'preLaunch' | 'later') => capabilityKind(row[key], key === 'later' ? row.laterKind : undefined)
</script>

<template>
  <div class="bia-cap">
    <dl class="bia-cap__config">
      <div>
        <dt>{{ t.phaseLabel }}</dt>
        <dd>{{ PHASE_LABELS[creditPhase] }}</dd>
      </div>
      <div>
        <dt>{{ t.operationsLabel }}</dt>
        <dd>{{ operations }}</dd>
      </div>
    </dl>

    <!-- Tabela: tablets e telas maiores. -->
    <div class="table-wrap bia-cap__table">
      <table class="table">
        <caption class="visually-hidden">{{ t.caption }}. {{ t.currentLabel }}: {{ PHASE_LABELS[creditPhase] }}.</caption>
        <thead>
          <tr>
            <th scope="col">{{ t.capabilityHeader }}</th>
            <th v-for="col in columns" :key="col.key" scope="col" :class="{ 'is-current': col.key === current }">
              {{ col.header }}
              <span v-if="col.key === current" class="bia-cap__current">{{ t.currentLabel }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in t.rows" :key="row.capability">
            <th scope="row">{{ row.capability }}</th>
            <td v-for="col in columns" :key="col.key" :class="{ 'is-current': col.key === current }">
              <span class="bia-cap__value" :class="{ 'bia-cap__value--no': kind(row, col.key) === 'no' }">
                <AppIcon :name="ICONS[kind(row, col.key)]" />
                {{ row[col.key] }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Lista: celulares (mesmo conteúdo, sem rolagem horizontal). -->
    <ul class="bia-cap__cards" :aria-label="t.caption">
      <li v-for="row in t.rows" :key="row.capability" class="bia-cap__card">
        <h3 class="bia-cap__cardtitle">{{ row.capability }}</h3>
        <dl>
          <div v-for="col in columns" :key="col.key" :class="{ 'is-current': col.key === current }">
            <dt>
              {{ col.header }}
              <span v-if="col.key === current" class="bia-cap__current">{{ t.currentLabel }}</span>
            </dt>
            <dd class="bia-cap__value" :class="{ 'bia-cap__value--no': kind(row, col.key) === 'no' }">
              <AppIcon :name="ICONS[kind(row, col.key)]" />
              {{ row[col.key] }}
            </dd>
          </div>
        </dl>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.bia-cap__config {
  display: flex;
  flex-wrap: wrap;
  gap: var(--mf-space-1) var(--mf-space-5);
  margin: 0 0 var(--mf-space-4);
  padding: var(--mf-space-3) var(--mf-space-4);
  border-radius: 16px;
  background: var(--mf-cream);
  font-size: 0.9375rem;
}

.bia-cap__config > div {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.bia-cap__config dt {
  font-weight: 700;
}

.bia-cap__config dd {
  margin: 0;
}

.bia-cap__table .table {
  font-size: 0.9875rem;
}

.bia-cap__table th[scope='col'] {
  white-space: normal;
  vertical-align: bottom;
}

.bia-cap__table th[scope='row'] {
  font-weight: 600;
  background: transparent;
  white-space: normal;
  width: 32%;
}

/* O cabeçalho de linha também perde a borda na última linha (a moldura já fecha a tabela). */
.bia-cap__table tbody tr:last-child th {
  border-bottom: 0;
}

.bia-cap__table .is-current {
  background: #eef6f1;
}

.bia-cap__table thead .is-current {
  background: var(--mf-mint);
}

.bia-cap__current {
  display: inline-flex;
  margin-left: 6px;
  padding: 2px 10px;
  border-radius: 999px;
  background: var(--mf-forest);
  color: #fff;
  font-size: 0.8125rem;
  font-weight: 700;
  vertical-align: 1px;
  white-space: nowrap;
}

.bia-cap__value {
  display: inline-flex;
  gap: 8px;
  align-items: flex-start;
}

.bia-cap__value .icon {
  flex: none;
  width: 18px;
  height: 18px;
  margin-top: 2px;
  color: var(--mf-forest);
}

.bia-cap__value--no .icon {
  color: var(--mf-muted);
}

.bia-cap__cards {
  display: none;
  list-style: none;
  margin: 0;
  padding: 0;
}

.bia-cap__card {
  margin: 0;
  padding: var(--mf-space-3) var(--mf-space-3) var(--mf-space-2);
  border: 1px solid var(--mf-border);
  border-radius: 20px;
  background: var(--mf-paper);
}

.bia-cap__card + .bia-cap__card {
  margin-top: var(--mf-space-2);
}

.bia-cap__cardtitle {
  margin: 0 0 var(--mf-space-2);
  font-family: var(--mf-font-body);
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: 0;
}

.bia-cap__card dl {
  display: grid;
  gap: 6px;
  margin: 0;
}

.bia-cap__card dl > div {
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--mf-cream);
}

.bia-cap__card dl > div.is-current {
  background: var(--mf-mint);
}

.bia-cap__card dt {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  margin-bottom: 4px;
  font-size: 0.8125rem;
  font-weight: 700;
  color: var(--mf-muted);
}

.bia-cap__card .bia-cap__current {
  margin-left: 0;
}

.bia-cap__card dd {
  margin: 0;
  font-size: 0.9375rem;
}

@media (max-width: 767px) {
  .bia-cap__table {
    display: none;
  }

  .bia-cap__cards {
    display: block;
  }
}
</style>
