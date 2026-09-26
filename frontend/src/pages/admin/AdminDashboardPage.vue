<script setup lang="ts">
/**
 * Painel de métricas agregadas (metrics:read). Sem conversas, sem contatos: só contagens.
 * Métrica principal antes da abertura financeira (decisão D1): cadastros com telefone validado pela
 * Bia no WhatsApp e vínculo compatível autodeclarado — nunca "clientes aprovados".
 * No início, só com collection:manage: o interruptor do formulário de cadastro do site (WaitlistFormCard).
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/ui/AppIcon.vue'
import AdminBarList from '@/components/admin/AdminBarList.vue'
import AdminDailyChart from '@/components/admin/AdminDailyChart.vue'
import AdminState from '@/components/admin/AdminState.vue'
import WaitlistFormCard from '@/components/admin/WaitlistFormCard.vue'
import {
  EMPLOYMENT_TYPES,
  INCOME_RANGES,
  JOB_TENURES,
  LEAD_STATES,
  METRIC_COUNTERS,
  METRIC_EVENTS,
  SUPPORT_STATES,
  label,
  sourceLabel,
  statusMeta,
} from '@/components/admin/labels'
import type { AdminMetrics } from '@/components/admin/types'
import { formatDate } from '@/lib/format'
import { adminApi } from '@/composables/useAdminSession'
import { isoDay, queryValue, toQuery, useAdminLoader, useAdminTitle } from '@/composables/useAdminLoader'

useAdminTitle('Painel')

const route = useRoute()
const router = useRouter()
const DAY = /^\d{4}-\d{2}-\d{2}$/
const MAX_DAYS = 366

const from = ref('')
const to = ref('')
const periodError = ref('')

const loader = useAdminLoader(() =>
  adminApi<AdminMetrics>(`/admin/metrics${toQuery({ from: from.value, to: to.value })}`),
)
const m = computed(() => loader.data.value)

const nf = new Intl.NumberFormat('pt-BR')
const pf = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 })
const hf = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 })

function readQuery() {
  const qFrom = queryValue(route.query.from)
  const qTo = queryValue(route.query.to)
  from.value = DAY.test(qFrom) ? qFrom : isoDay(-29)
  to.value = DAY.test(qTo) ? qTo : isoDay(0)
}

function apply() {
  if (loader.loading.value) return
  periodError.value = ''
  if (!DAY.test(from.value) || !DAY.test(to.value)) {
    periodError.value = 'Informe as duas datas do período.'
    return
  }
  if (from.value > to.value) {
    periodError.value = 'A data inicial precisa ser anterior ou igual à final.'
    return
  }
  // Mesmo limite do servidor (366 dias).
  if ((Date.parse(`${to.value}T00:00:00Z`) - Date.parse(`${from.value}T00:00:00Z`)) / 86_400_000 + 1 > MAX_DAYS) {
    periodError.value = `Escolha um período de até ${MAX_DAYS} dias.`
    return
  }
  const same = queryValue(route.query.from) === from.value && queryValue(route.query.to) === to.value
  if (same) void loader.load()
  else void router.push({ query: { from: from.value, to: to.value } })
}

function preset(days: number) {
  from.value = isoDay(-(days - 1))
  to.value = isoDay(0)
  apply()
}

const activePreset = computed(() => {
  if (to.value !== isoDay(0)) return null
  return [7, 30, 90].find((d) => from.value === isoDay(-(d - 1))) ?? null
})

function share(part: number, whole: number): string {
  return whole > 0 ? pf.format(part / whole) : '—'
}

const toBars = (record: Record<string, number> | undefined, name: (code: string) => string) =>
  Object.entries(record ?? {}).map(([key, count]) => ({ key, label: name(key), count }))

const byState = computed(() => toBars(m.value?.leads.byState, (c) => statusMeta(LEAD_STATES, c).label))
const byEmployment = computed(() => toBars(m.value?.leads.byEmploymentType, (c) => label(EMPLOYMENT_TYPES, c)))
const bySource = computed(() => toBars(m.value?.leads.bySource, (c) => sourceLabel(c)))
// `sem_registro`: cadastros anteriores à decisão D1, sem a informação.
const NO_RECORD: Record<string, string> = { sem_registro: 'Sem registro (cadastro antigo)' }
const byUf = computed(() => toBars(m.value?.leads.byUf, (c) => label(NO_RECORD, c)))
const byIncome = computed(() => toBars(m.value?.leads.byIncomeRange, (c) => label({ ...INCOME_RANGES, ...NO_RECORD }, c)))
const byTenure = computed(() => toBars(m.value?.leads.byJobTenure, (c) => label({ ...JOB_TENURES, ...NO_RECORD }, c)))
const hasProfile = computed(() => Boolean(m.value?.leads.byUf || m.value?.leads.byIncomeRange || m.value?.leads.byJobTenure))
const bySupportStatus = computed(() => toBars(m.value?.support.byStatus, (c) => statusMeta(SUPPORT_STATES, c).label))
const events = computed(() => [...(m.value?.events ?? [])].sort((a, b) => b.count - a.count))
const counters = computed(() => [...(m.value?.counters ?? [])].sort((a, b) => a.name.localeCompare(b.name) || b.count - a.count))
const omitted = computed(() => [...(m.value?.eventsOmitted ?? []), ...(m.value?.countersOmitted ?? [])])

const median = computed(() => {
  const h = m.value?.support.medianFirstResponseHours
  if (h === null || h === undefined) return null
  return h < 1 ? `${nf.format(Math.round(h * 60))} min` : `${hf.format(h)} h`
})

watch(
  () => [route.query.from, route.query.to],
  () => {
    if (route.name !== 'admin-painel') return
    readQuery()
    void loader.load()
  },
)

onMounted(() => {
  readQuery()
  void loader.load()
})
</script>

<template>
  <div class="dash">
    <header class="admin-page-head">
      <div class="admin-page-head__text">
        <h1>Painel</h1>
        <p>Métricas agregadas de cadastro, preferências e atendimento. Nenhum conteúdo de conversa ou dado de contato aparece aqui.</p>
      </div>
    </header>

    <!-- Some sozinho sem a permissão collection:manage (nem consulta a API). -->
    <WaitlistFormCard class="dash__switch" />

    <form class="admin-filters dash__period" novalidate @submit.prevent="apply">
      <fieldset class="dash__fieldset">
        <legend class="admin-filters__legend"><AppIcon name="calendar" /> Período</legend>
        <div class="dash__period-row">
          <div class="field">
            <label class="field__label" for="metricas-de">De</label>
            <input id="metricas-de" v-model="from" class="input" type="date" :max="to || undefined" :aria-invalid="periodError ? 'true' : undefined" aria-describedby="metricas-periodo-erro" />
          </div>
          <div class="field">
            <label class="field__label" for="metricas-ate">Até</label>
            <input id="metricas-ate" v-model="to" class="input" type="date" :min="from || undefined" :aria-invalid="periodError ? 'true' : undefined" aria-describedby="metricas-periodo-erro" />
          </div>
          <!-- aria-disabled (e não disabled) durante o carregamento: o foco continua no botão. -->
          <button type="submit" class="btn btn--primary" :aria-disabled="loader.loading.value ? 'true' : undefined">Atualizar</button>
          <div class="dash__presets" role="group" aria-label="Atalhos de período">
            <button
              v-for="d in [7, 30, 90]"
              :key="d"
              type="button"
              class="btn btn--sm"
              :class="activePreset === d ? 'btn--primary' : 'btn--secondary'"
              :aria-pressed="activePreset === d ? 'true' : 'false'"
              @click="preset(d)"
            >
              {{ d }} dias
            </button>
          </div>
        </div>
        <p id="metricas-periodo-erro" class="field__error" :hidden="!periodError">
          <AppIcon name="alert" />{{ periodError }}
        </p>
      </fieldset>
    </form>

    <AdminState
      :loading="loader.loading.value && !m"
      :error="loader.error.value"
      loading-text="Carregando métricas…"
      @retry="loader.load"
    />

    <div v-if="m && !loader.error.value" class="dash__content" :aria-busy="loader.loading.value ? 'true' : undefined">
      <p class="dash__period-label" role="status">
        <span v-if="loader.loading.value">Atualizando… </span>
        Período de {{ formatDate(m.period.from) }} a {{ formatDate(m.period.to) }}
      </p>

      <section class="dash__hero" aria-labelledby="metrica-principal">
        <div>
          <h2 id="metrica-principal">Cadastros com telefone validado e vínculo compatível</h2>
          <p class="dash__hero-value">{{ nf.format(m.leads.verifiedWithEligibleIntent) }}</p>
        </div>
        <div class="dash__hero-text">
          <p>
            Telefone validado pela Bia no WhatsApp e vínculo autodeclarado CLT, empregado doméstico ou trabalhador rural registrado.
            <strong>É interesse autodeclarado:</strong> não indica elegibilidade, análise ou aprovação de crédito.
          </p>
          <p class="dash__hero-share">
            {{ share(m.leads.verifiedWithEligibleIntent, m.leads.verified) }} dos telefones validados
            ({{ nf.format(m.leads.verifiedWithEligibleIntent) }} de {{ nf.format(m.leads.verified) }}).
          </p>
        </div>
      </section>

      <dl class="admin-kpis dash__kpis">
        <div class="admin-kpi">
          <dt>Cadastros recebidos</dt>
          <dd>{{ nf.format(m.leads.created) }}</dd>
        </div>
        <div class="admin-kpi">
          <dt>Telefones validados pela Bia</dt>
          <dd>{{ nf.format(m.leads.verified) }}</dd>
          <dd class="admin-kpi__note">{{ share(m.leads.verified, m.leads.created) }} dos recebidos ({{ nf.format(m.leads.verified) }} de {{ nf.format(m.leads.created) }})</dd>
        </div>
        <div v-if="m.leads.pendingReview !== undefined" class="admin-kpi">
          <dt>Submissões em revisão</dt>
          <dd>{{ nf.format(m.leads.pendingReview) }}</dd>
          <dd class="admin-kpi__note">Envios do site ou da Bia para CPF ou telefone já cadastrado, no período</dd>
        </div>
        <div class="admin-kpi">
          <dt>Aviso de abertura autorizado</dt>
          <dd>{{ nf.format(m.preferences.launchNoticeGranted) }}</dd>
        </div>
        <div class="admin-kpi">
          <dt>Conteúdos e novidades autorizados</dt>
          <dd>{{ nf.format(m.preferences.marketingGranted) }}</dd>
        </div>
        <div class="admin-kpi">
          <dt>Descadastros</dt>
          <dd>{{ nf.format(m.leads.unsubscribed) }}</dd>
        </div>
        <div class="admin-kpi">
          <dt>Atendimentos recebidos</dt>
          <dd>{{ nf.format(m.support.created) }}</dd>
        </div>
        <div class="admin-kpi dash__kpi-wide">
          <dt>Mediana até o primeiro atendimento</dt>
          <dd>{{ median ?? '—' }}</dd>
          <dd class="admin-kpi__note">
            {{ median ? 'Entre o recebimento e o primeiro atendimento registrado pela equipe.' : 'Nenhum primeiro atendimento registrado no período.' }}
          </dd>
        </div>
      </dl>

      <section class="admin-panel" aria-labelledby="serie-titulo">
        <div class="admin-panel__head">
          <h2 id="serie-titulo">Cadastros por dia</h2>
          <p>Mesma escala nos dois gráficos.</p>
        </div>
        <AdminDailyChart v-if="m.leads.byDay.length" :days="m.leads.byDay" />
        <p v-else class="muted">Sem cadastros no período.</p>
      </section>

      <section class="admin-panel" aria-labelledby="distribuicao-titulo">
        <div class="admin-panel__head">
          <h2 id="distribuicao-titulo">Distribuição dos cadastros</h2>
          <p>Contagens do período, com participação no total.</p>
        </div>
        <div class="admin-grid admin-grid--3">
          <AdminBarList caption="Por estado" item-header="Estado" :items="byState" />
          <AdminBarList caption="Por vínculo declarado" item-header="Vínculo" :items="byEmployment" />
          <AdminBarList caption="Por origem" item-header="Origem" :items="bySource" />
        </div>
      </section>

      <section v-if="hasProfile" class="admin-panel" aria-labelledby="perfil-titulo">
        <div class="admin-panel__head">
          <h2 id="perfil-titulo">Perfil declarado</h2>
          <p>Faixas autodeclaradas no cadastro. Não indicam elegibilidade.</p>
        </div>
        <div class="admin-grid admin-grid--3">
          <AdminBarList caption="Por UF" item-header="UF" :items="byUf" />
          <AdminBarList caption="Por faixa de salário líquido" item-header="Faixa" :items="byIncome" />
          <AdminBarList caption="Por tempo no emprego" item-header="Tempo" :items="byTenure" />
        </div>
      </section>

      <div class="admin-grid admin-grid--2 dash__pair">
        <section class="admin-panel" aria-labelledby="atendimento-titulo">
          <div class="admin-panel__head">
            <h2 id="atendimento-titulo">Atendimento</h2>
            <p>{{ nf.format(m.support.created) }} recebidos no período</p>
          </div>
          <AdminBarList caption="Por status atual" item-header="Status" :items="bySupportStatus" />
        </section>

        <section class="admin-panel" aria-labelledby="eventos-titulo">
          <div class="admin-panel__head">
            <h2 id="eventos-titulo">Eventos de produto</h2>
            <p>Contagens agregadas, sem identificação</p>
          </div>
          <div v-if="events.length" class="admin-table-wrap dash__events" tabindex="0" role="region" aria-label="Eventos de produto">
            <table class="admin-table">
              <caption class="visually-hidden">Eventos de produto no período</caption>
              <thead>
                <tr>
                  <th scope="col">Evento e onde ocorreu</th>
                  <th scope="col" class="num">Quantidade</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="e in events" :key="`${e.name}:${e.dimension}`">
                  <th scope="row">
                    {{ label(METRIC_EVENTS, e.name) }}
                    <code v-if="e.dimension" class="admin-mono dash__event-dim">{{ e.dimension }}</code>
                  </th>
                  <td class="num">{{ nf.format(e.count) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="muted">Nenhum evento registrado no período.</p>
          <p v-for="o in omitted" :key="`omitido:${o.name}`" class="muted small">
            {{ label({ ...METRIC_EVENTS, ...METRIC_COUNTERS }, o.name) }}: mais {{ nf.format(o.dimensions) }} locais com
            {{ nf.format(o.count) }} ocorrências no total (fora das {{ m?.dimensionsPerName ?? 25 }} mais frequentes).
          </p>
        </section>

        <section v-if="counters.length" class="admin-panel" aria-labelledby="contadores-titulo">
          <div class="admin-panel__head">
            <h2 id="contadores-titulo">Contadores operacionais</h2>
            <p>Cadastro, proteção anti-robô, Bia e atendimento, sem identificação</p>
          </div>
          <div class="admin-table-wrap dash__events" tabindex="0" role="region" aria-label="Contadores operacionais">
            <table class="admin-table">
              <caption class="visually-hidden">Contadores operacionais no período</caption>
              <thead>
                <tr>
                  <th scope="col">Contador e detalhe</th>
                  <th scope="col" class="num">Quantidade</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="c in counters" :key="`${c.name}:${c.dimension}`">
                  <th scope="row">
                    {{ label(METRIC_COUNTERS, c.name) }}
                    <code v-if="c.dimension" class="admin-mono dash__event-dim">{{ c.dimension }}</code>
                  </th>
                  <td class="num">{{ nf.format(c.count) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Interruptor do formulário do site: distância até o filtro de período. */
.dash__switch {
  margin-bottom: var(--mf-space-4);
}

.dash__fieldset {
  margin: 0;
  padding: 0;
  border: 0;
  min-width: 0;
}

.dash__period-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--mf-space-3);
}

.dash__period-row .field {
  flex: 0 1 180px;
}

.dash__presets {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-left: auto;
}

@media (max-width: 767px) {
  .dash__period-row .field {
    flex: 1 1 140px;
  }
  .dash__presets {
    margin-left: 0;
  }
}

.dash__period .field__error {
  margin-top: 10px;
}

.dash__content > * + * {
  margin-top: var(--mf-space-4);
}

.dash__period-label {
  margin: 0 0 -8px;
  font-size: 0.875rem;
  color: var(--mf-muted);
}

.dash__hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);
  gap: var(--mf-space-4) var(--mf-space-6);
  align-items: end;
  padding: var(--mf-space-5);
  border-radius: 20px;
  background: var(--mf-forest);
  color: var(--mf-cream);
}

.dash__hero h2 {
  max-width: 24ch;
  margin: 0 0 var(--mf-space-2);
  font-size: 1.125rem;
  line-height: 1.35;
  color: var(--mf-cream);
}

.dash__hero-value {
  margin: 0;
  font-family: var(--mf-font-heading);
  font-size: clamp(48px, 4vw + 24px, 72px);
  font-weight: 600;
  line-height: 1;
  letter-spacing: -0.03em;
}

.dash__hero-text p {
  margin: 0;
  font-size: 0.9375rem;
  color: var(--mf-cream-on-dark-muted);
}

.dash__hero-text strong {
  color: var(--mf-cream);
}

.dash__hero-text p + p {
  margin-top: 10px;
}

.dash__hero-share {
  color: var(--mf-cream) !important;
  font-weight: 600;
}

@media (max-width: 900px) {
  .dash__hero {
    grid-template-columns: minmax(0, 1fr);
    padding: var(--mf-space-4);
  }
}

/* Só zera as laterais e a base: o espaço acima vem de .dash__content > * + *. */
.dash__kpis {
  margin-inline: 0;
  margin-bottom: 0;
}

.dash__kpi-wide {
  grid-column: span 2;
}

@media (max-width: 420px) {
  .dash__kpi-wide {
    grid-column: auto;
  }
}

.dash__pair {
  align-items: start;
}

.dash__pair .admin-panel + .admin-panel {
  margin-top: 0;
}

.dash__events {
  max-height: 360px;
  overflow-y: auto;
}

/* Onde ocorreu: segunda linha do evento, para a quantidade ficar sempre visível no celular. */
.dash__event-dim {
  display: block;
  margin-top: 2px;
  font-weight: 400;
  color: var(--mf-muted);
}
</style>
