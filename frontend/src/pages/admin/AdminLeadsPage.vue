<script setup lang="ts">
/**
 * Cadastros (leads:read), decisão D1: filtros na URL (somente datas e códigos do contrato, nunca
 * dados pessoais) — estado, origem, UF, vínculo, faixa de salário, tempo de emprego, telefone
 * validado pela Bia e finalidade —, tabela paginada com telefone sempre mascarado e exportação CSV
 * auditada (leads:export).
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/ui/AppIcon.vue'
import AdminPagination from '@/components/admin/AdminPagination.vue'
import AdminState from '@/components/admin/AdminState.vue'
import AdminStatus from '@/components/admin/AdminStatus.vue'
import ReasonDialog from '@/components/admin/ReasonDialog.vue'
import {
  CURRENT_LEAD_STATES,
  EMPLOYMENT_TYPES,
  INCOME_RANGES,
  JOB_TENURES,
  LEAD_SOURCES,
  LEAD_STATES,
  PURPOSES,
  UFS,
  label,
  sourceLabel,
  statusMeta,
} from '@/components/admin/labels'
import type { AdminLead, Page } from '@/components/admin/types'
import { formatDate } from '@/lib/format'
import { useAnnouncer } from '@/composables/useAnnouncer'
import { adminApi, adminDownload, errorMessage, useAdminSession } from '@/composables/useAdminSession'
import { isoDay, queryValue, toQuery, useAdminLoader, useAdminTitle } from '@/composables/useAdminLoader'

useAdminTitle('Cadastros')

const PAGE_SIZE = 25
const KEYS = ['from', 'to', 'state', 'source', 'uf', 'employmentType', 'jobTenure', 'incomeRange', 'phoneVerified', 'purpose', 'granted'] as const
type FilterKey = (typeof KEYS)[number]

const route = useRoute()
const router = useRouter()
const session = useAdminSession()
const { announce } = useAnnouncer()

const form = reactive<Record<FilterKey, string>>(Object.fromEntries(KEYS.map((k) => [k, ''])) as Record<FilterKey, string>)
const applied = computed<Record<FilterKey, string>>(() => {
  const out = {} as Record<FilterKey, string>
  for (const k of KEYS) out[k] = queryValue(route.query[k])
  return out
})
const page = computed(() => Math.max(1, Number(queryValue(route.query.page)) || 1))
const hasFilters = computed(() => KEYS.some((k) => applied.value[k]))
const formError = ref('')

const loader = useAdminLoader(() =>
  adminApi<Page<AdminLead>>(`/admin/leads${toQuery({ ...applied.value, page: page.value, pageSize: PAGE_SIZE })}`),
)
const result = computed(() => loader.data.value)

function syncForm() {
  for (const k of KEYS) form[k] = applied.value[k]
}

function applyFilters() {
  formError.value = ''
  if (form.from && form.to && form.from > form.to) {
    formError.value = 'A data inicial precisa ser anterior ou igual à final.'
    return
  }
  const query: Record<string, string> = {}
  for (const k of KEYS) if (form[k]) query[k] = form[k]
  // "Concedida" só faz sentido com uma finalidade escolhida.
  if (!query.purpose) delete query.granted
  void router.push({ query })
}

function clearFilters() {
  for (const k of KEYS) form[k] = ''
  formError.value = ''
  void router.push({ query: {} })
}

function goToPage(p: number) {
  void router.push({ query: { ...route.query, page: String(p) } })
}

const nf = new Intl.NumberFormat('pt-BR')
// Data e hora em linhas separadas: a tabela cabe inteira em telas largas.
const timeFmt = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
const formatTime = (v: string) => timeFmt.format(new Date(v))
const stateOptions = CURRENT_LEAD_STATES.map((value) => ({ value, label: LEAD_STATES[value].label }))
const toOptions = (map: Record<string, string>) => Object.entries(map).map(([value, text]) => ({ value, label: text }))
const employmentOptions = toOptions(EMPLOYMENT_TYPES)
const tenureOptions = toOptions(JOB_TENURES)
const incomeOptions = toOptions(INCOME_RANGES)
const leadName = (lead: AdminLead) => lead.fullName || lead.preferredName || 'Sem nome'
const sourceOptions = LEAD_SOURCES.map((value) => ({ value, label: sourceLabel(value) }))

// Exportação CSV --------------------------------------------------------------------------------
const exportOpen = ref(false)
const exportBusy = ref(false)
const exportError = ref<string | null>(null)
const exportDone = ref('')

async function runExport(reason: string) {
  if (exportBusy.value) return
  exportBusy.value = true
  exportError.value = null
  exportDone.value = ''
  try {
    const filters: Record<string, string> = {}
    for (const k of KEYS) if (applied.value[k]) filters[k] = applied.value[k]
    const blob = await adminDownload('/admin/leads/export', { reason, filters })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `cadastros-minha-folga-${isoDay(0)}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    exportOpen.value = false
    exportDone.value = 'Exportação gerada e registrada na auditoria. O arquivo mantém telefone e CPF mascarados; guarde-o apenas pelo tempo necessário.'
    // O foco volta ao botão "Exportar CSV" (fecha o diálogo); a confirmação é anunciada.
    announce(exportDone.value)
  } catch (e) {
    exportError.value = errorMessage(e)
  } finally {
    exportBusy.value = false
  }
}

watch(
  () => route.query,
  () => {
    if (route.name !== 'admin-leads') return
    syncForm()
    void loader.load()
  },
)

onMounted(() => {
  syncForm()
  void loader.load()
})
</script>

<template>
  <div>
    <header class="admin-page-head">
      <div class="admin-page-head__text">
        <h1>Cadastros</h1>
        <p>
          Interesses registrados na lista de aviso. Telefone e CPF aparecem mascarados; revelar exige permissão e justificativa.
          O telefone só conta como validado depois que a própria pessoa conversa com a Bia no WhatsApp.
        </p>
      </div>
      <div v-if="session.can('leads:export')" class="admin-page-head__actions">
        <button type="button" class="btn btn--secondary" @click="exportOpen = true">
          <AppIcon name="arrow-right" class="leads__export-icon" />
          Exportar CSV
        </button>
      </div>
    </header>

    <!-- Sem role="status": a confirmação é anunciada pela região viva persistente (useAnnouncer). -->
    <p v-if="exportDone" class="notice notice--success leads__done">
      <AppIcon name="check-circle" />
      <span>{{ exportDone }}</span>
    </p>

    <form class="admin-filters" novalidate @submit.prevent="applyFilters">
      <p class="admin-filters__legend"><AppIcon name="filter" /> Filtros</p>
      <div class="admin-filters__grid">
        <div class="field">
          <label class="field__label" for="leads-de">Recebido de</label>
          <input id="leads-de" v-model="form.from" class="input" type="date" />
        </div>
        <div class="field">
          <label class="field__label" for="leads-ate">Recebido até</label>
          <input id="leads-ate" v-model="form.to" class="input" type="date" />
        </div>
        <div class="field">
          <label class="field__label" for="leads-estado">Estado</label>
          <select id="leads-estado" v-model="form.state" class="select">
            <option value="">Todos</option>
            <option v-for="o in stateOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </div>
        <div class="field">
          <label class="field__label" for="leads-origem">Origem</label>
          <select id="leads-origem" v-model="form.source" class="select">
            <option value="">Todas</option>
            <option v-for="o in sourceOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </div>
        <div class="field">
          <label class="field__label" for="leads-uf">UF</label>
          <select id="leads-uf" v-model="form.uf" class="select">
            <option value="">Todas</option>
            <option v-for="uf in UFS" :key="uf" :value="uf">{{ uf }}</option>
          </select>
        </div>
        <div class="field">
          <label class="field__label" for="leads-vinculo">Vínculo declarado</label>
          <select id="leads-vinculo" v-model="form.employmentType" class="select">
            <option value="">Todos</option>
            <option v-for="o in employmentOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </div>
        <div class="field">
          <label class="field__label" for="leads-tempo">Tempo no emprego</label>
          <select id="leads-tempo" v-model="form.jobTenure" class="select">
            <option value="">Qualquer</option>
            <option v-for="o in tenureOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </div>
        <div class="field">
          <label class="field__label" for="leads-renda">Faixa de salário líquido</label>
          <select id="leads-renda" v-model="form.incomeRange" class="select">
            <option value="">Qualquer</option>
            <option v-for="o in incomeOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </div>
        <div class="field">
          <label class="field__label" for="leads-validado">Telefone</label>
          <select id="leads-validado" v-model="form.phoneVerified" class="select">
            <option value="">Validado ou não</option>
            <option value="true">Validado pela Bia</option>
            <option value="false">Não validado</option>
          </select>
        </div>
        <div class="field">
          <label class="field__label" for="leads-finalidade">Finalidade</label>
          <select id="leads-finalidade" v-model="form.purpose" class="select">
            <option value="">Qualquer</option>
            <option value="launch_notice">{{ PURPOSES.launch_notice }}</option>
            <option value="marketing">{{ PURPOSES.marketing }}</option>
          </select>
        </div>
        <div class="field">
          <label class="field__label" for="leads-concedida">Situação da finalidade</label>
          <select id="leads-concedida" v-model="form.granted" class="select" :disabled="!form.purpose" aria-describedby="leads-concedida-dica">
            <option value="">Qualquer</option>
            <option value="true">Autorizada</option>
            <option value="false">Não autorizada ou revogada</option>
          </select>
          <p id="leads-concedida-dica" class="field__hint" :class="{ 'visually-hidden': form.purpose }">Escolha antes a finalidade.</p>
        </div>
      </div>
      <p v-if="formError" class="field__error leads__form-error" role="alert"><AppIcon name="alert" />{{ formError }}</p>
      <div class="admin-filters__actions">
        <button type="submit" class="btn btn--primary">Aplicar filtros</button>
        <button v-if="hasFilters" type="button" class="btn btn--ghost" @click="clearFilters">Limpar filtros</button>
      </div>
    </form>

    <AdminState
      :loading="loader.loading.value && !result"
      :error="loader.error.value"
      :empty="!!result && result.items.length === 0 && !loader.error.value"
      loading-text="Carregando cadastros…"
      :empty-title="hasFilters ? 'Nenhum cadastro com esses filtros' : 'Nenhum cadastro ainda'"
      :empty-text="hasFilters ? 'Ajuste ou limpe os filtros para ver outros cadastros.' : 'Os cadastros feitos no site aparecerão aqui.'"
      @retry="loader.load"
    >
      <template v-if="hasFilters" #empty-action>
        <button type="button" class="btn btn--secondary btn--sm" @click="clearFilters">Limpar filtros</button>
      </template>
    </AdminState>

    <template v-if="result && result.items.length && !loader.error.value">
      <div class="admin-table-wrap" tabindex="0" role="region" aria-labelledby="leads-caption" :aria-busy="loader.loading.value ? 'true' : undefined">
        <table class="admin-table">
          <caption id="leads-caption">
            Cadastros
            <span>· {{ nf.format(result.total) }} {{ result.total === 1 ? 'resultado' : 'resultados' }}{{ loader.loading.value ? ' · atualizando…' : '' }}</span>
          </caption>
          <thead>
            <tr>
              <th scope="col">Nome</th>
              <th scope="col">Telefone</th>
              <th scope="col">UF</th>
              <th scope="col">Perfil declarado</th>
              <th scope="col">Estado</th>
              <th scope="col">Finalidades</th>
              <th scope="col">Origem</th>
              <th scope="col">Recebido em</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="lead in result.items" :key="lead.id">
              <th scope="row" class="admin-table__primary">
                <RouterLink :to="{ name: 'admin-lead', params: { id: lead.id } }">{{ leadName(lead) }}</RouterLink>
                <span v-if="lead.employerName" class="muted leads__sub">{{ lead.employerName }}</span>
                <span v-if="lead.pendingReview" class="leads__review">
                  <AppIcon name="clock" />
                  {{ lead.pendingReview === 1 ? '1 submissão em revisão' : `${nf.format(lead.pendingReview)} submissões em revisão` }}
                </span>
              </th>
              <td class="nowrap">
                <span class="admin-mono">{{ lead.phoneHint }}</span>
                <span v-if="lead.contactVerifiedAt || lead.phoneVerified" class="leads__verified">
                  <AppIcon name="check-circle" />
                  <span>
                    Validado pela Bia
                    <time v-if="lead.contactVerifiedAt" :datetime="lead.contactVerifiedAt" class="leads__time">
                      {{ formatDate(lead.contactVerifiedAt) }}, {{ formatTime(lead.contactVerifiedAt) }}
                    </time>
                  </span>
                </span>
                <span v-else class="leads__unverified">Não validado</span>
              </td>
              <td class="nowrap">
                {{ lead.uf || '—' }}
                <span v-if="lead.city" class="muted leads__sub">{{ lead.city }}</span>
              </td>
              <td>
                <ul class="leads__profile">
                  <li>{{ label(EMPLOYMENT_TYPES, lead.employmentType) }}</li>
                  <li v-if="lead.jobTenure !== undefined"><span class="visually-hidden">Tempo no emprego: </span>{{ label(JOB_TENURES, lead.jobTenure) }}</li>
                  <li v-if="lead.incomeRange !== undefined"><span class="visually-hidden">Faixa de salário: </span>{{ label(INCOME_RANGES, lead.incomeRange) }}</li>
                </ul>
              </td>
              <td><AdminStatus v-bind="statusMeta(LEAD_STATES, lead.state)" /></td>
              <td class="nowrap">
                <ul class="leads__purposes">
                  <li>
                    <AppIcon :name="lead.purposes.launch_notice ? 'check' : 'close'" />
                    Aviso: {{ lead.purposes.launch_notice ? 'sim' : 'não' }}
                  </li>
                  <li>
                    <AppIcon :name="lead.purposes.marketing ? 'check' : 'close'" />
                    Novidades: {{ lead.purposes.marketing ? 'sim' : 'não' }}
                  </li>
                </ul>
              </td>
              <td>
                {{ sourceLabel(lead.source) }}
                <span v-if="lead.utmSource || lead.utmCampaign" class="muted leads__utm">
                  {{ [lead.utmSource, lead.utmCampaign].filter(Boolean).join(' · ') }}
                </span>
              </td>
              <td class="nowrap">
                <time :datetime="lead.createdAt">{{ formatDate(lead.createdAt) }}<span class="leads__time">{{ formatTime(lead.createdAt) }}</span></time>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <AdminPagination :page="result.page" :page-size="result.pageSize" :total="result.total" label="cadastros" :disabled="loader.loading.value" @change="goToPage" />
    </template>

    <ReasonDialog
      v-model:open="exportOpen"
      title="Exportar cadastros em CSV"
      confirm-label="Exportar CSV"
      busy-label="Gerando arquivo…"
      :busy="exportBusy"
      :error="exportError"
      @submit="runExport"
    >
      <p>
        O arquivo usa os filtros aplicados agora{{ hasFilters ? '' : ' (nenhum: todos os cadastros)' }} e mantém telefone e CPF mascarados.
        Use a exportação só quando a análise não puder ser feita no painel.
      </p>
    </ReasonDialog>
  </div>
</template>

<style scoped>
.leads__time {
  display: block;
  font-size: 0.875rem;
  color: var(--mf-muted);
}

.leads__done {
  margin-bottom: var(--mf-space-4);
  align-items: center;
}

.leads__export-icon {
  transform: rotate(90deg);
}

.leads__form-error {
  margin-top: var(--mf-space-3);
}

.leads__purposes {
  list-style: none;
  margin: 0;
  padding: 0;
  font-size: 0.875rem;
}

.leads__purposes li {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 0;
}

.leads__purposes .icon {
  width: 16px;
  height: 16px;
  color: var(--mf-muted);
}

.leads__utm,
.leads__sub {
  display: block;
  font-size: 0.875rem;
}

.leads__profile {
  list-style: none;
  margin: 0;
  padding: 0;
  font-size: 0.875rem;
  line-height: 1.4;
}

.leads__profile li {
  margin: 0;
}

.leads__profile li:first-child {
  font-size: 0.9375rem;
  font-weight: 600;
}

.leads__verified,
.leads__unverified {
  display: flex;
  gap: 4px;
  margin-top: 4px;
  font-family: var(--mf-font-body);
  font-size: 0.8125rem;
  white-space: normal;
}

.leads__verified {
  font-weight: 600;
  color: var(--mf-forest);
}

.leads__verified .icon {
  flex: none;
  width: 14px;
  height: 14px;
  margin-top: 2px;
}

.leads__verified .leads__time {
  font-weight: 400;
  font-size: 0.8125rem;
}

.leads__unverified {
  color: var(--mf-muted);
}

.leads__review {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
  font-size: 0.8125rem;
  font-weight: 600;
  color: #7a5200;
}

.leads__review .icon {
  width: 14px;
  height: 14px;
}
</style>
