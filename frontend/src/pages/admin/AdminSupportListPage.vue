<script setup lang="ts">
/**
 * Fila de atendimento (support:read): atalhos por status, filtros por responsável e período,
 * contato sempre mascarado na lista. O detalhe (com mensagem e contato) tem acesso auditado.
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/ui/AppIcon.vue'
import AdminPagination from '@/components/admin/AdminPagination.vue'
import AdminState from '@/components/admin/AdminState.vue'
import AdminStatus from '@/components/admin/AdminStatus.vue'
import { CONTACT_METHODS, SUPPORT_STATES, SUPPORT_SUBJECTS, label, sourceLabel, statusMeta } from '@/components/admin/labels'
import type { AdminSupportItem, AdminUserRef, Page, SupportState } from '@/components/admin/types'
import { formatDateTime } from '@/lib/format'
import { adminApi, useAdminSession } from '@/composables/useAdminSession'
import { queryValue, toQuery, useAdminLoader, useAdminTitle } from '@/composables/useAdminLoader'

useAdminTitle('Atendimentos')

const PAGE_SIZE = 25
const route = useRoute()
const router = useRouter()
const session = useAdminSession()

const status = computed(() => queryValue(route.query.status))
const applied = computed(() => ({
  status: status.value,
  assignee: queryValue(route.query.assignee),
  from: queryValue(route.query.from),
  to: queryValue(route.query.to),
}))
const page = computed(() => Math.max(1, Number(queryValue(route.query.page)) || 1))
const hasFilters = computed(() => Boolean(applied.value.status || applied.value.assignee || applied.value.from || applied.value.to))

const form = reactive({ assignee: '', from: '', to: '' })
const formError = ref('')

const loader = useAdminLoader(() =>
  adminApi<Page<AdminSupportItem>>(`/admin/support${toQuery({ ...applied.value, page: page.value, pageSize: PAGE_SIZE })}`),
)
const result = computed(() => loader.data.value)

// Equipe para o filtro de responsável (opcional: sem permissão, ficam "comigo" e "sem responsável").
const team = ref<AdminUserRef[]>([])
async function loadTeam() {
  if (!session.can('team:read')) return
  try {
    const res = await adminApi<{ items: AdminUserRef[] }>('/admin/team')
    team.value = res.items ?? []
  } catch {
    team.value = []
  }
}

const statusTabs: { value: '' | SupportState; label: string }[] = [
  { value: '', label: 'Todos' },
  ...(Object.keys(SUPPORT_STATES) as SupportState[]).map((value) => ({ value, label: SUPPORT_STATES[value].label })),
]

function statusLink(value: string) {
  const query = { ...route.query }
  delete query.page
  if (value) query.status = value
  else delete query.status
  return { query }
}

function syncForm() {
  form.assignee = applied.value.assignee
  form.from = applied.value.from
  form.to = applied.value.to
}

function applyFilters() {
  formError.value = ''
  if (form.from && form.to && form.from > form.to) {
    formError.value = 'A data inicial precisa ser anterior ou igual à final.'
    return
  }
  const query: Record<string, string> = {}
  if (status.value) query.status = status.value
  if (form.assignee) query.assignee = form.assignee
  if (form.from) query.from = form.from
  if (form.to) query.to = form.to
  void router.push({ query })
}

function clearFilters() {
  form.assignee = ''
  form.from = ''
  form.to = ''
  void router.push({ query: {} })
}

function goToPage(p: number) {
  void router.push({ query: { ...route.query, page: String(p) } })
}

const nf = new Intl.NumberFormat('pt-BR')
const me = computed(() => session.state.user?.id)

watch(
  () => route.query,
  () => {
    if (route.name !== 'admin-atendimentos') return
    syncForm()
    void loader.load()
  },
)

onMounted(() => {
  syncForm()
  void loader.load()
  void loadTeam()
})
</script>

<template>
  <div>
    <header class="admin-page-head">
      <div class="admin-page-head__text">
        <h1>Atendimentos</h1>
        <p>Solicitações recebidas pelo formulário do site e encaminhadas pela Bia. Toda alteração registra responsável e horário.</p>
      </div>
    </header>

    <nav class="queue__tabs" aria-label="Filtrar por status">
      <RouterLink
        v-for="tab in statusTabs"
        :key="tab.value"
        :to="statusLink(tab.value)"
        class="queue__tab"
        :aria-current="status === tab.value ? 'true' : undefined"
      >
        {{ tab.label }}
      </RouterLink>
    </nav>

    <form class="admin-filters queue__filters" novalidate @submit.prevent="applyFilters">
      <p class="admin-filters__legend"><AppIcon name="filter" /> Filtros</p>
      <div class="admin-filters__grid">
        <div class="field">
          <label class="field__label" for="fila-responsavel">Responsável</label>
          <select id="fila-responsavel" v-model="form.assignee" class="select">
            <option value="">Qualquer</option>
            <option value="me">Comigo</option>
            <option value="none">Sem responsável</option>
            <optgroup v-if="team.length" label="Equipe">
              <option v-for="p in team" :key="p.id" :value="p.id">{{ p.displayName }}{{ p.id === me ? ' (você)' : '' }}</option>
            </optgroup>
          </select>
        </div>
        <div class="field">
          <label class="field__label" for="fila-de">Recebido de</label>
          <input id="fila-de" v-model="form.from" class="input" type="date" />
        </div>
        <div class="field">
          <label class="field__label" for="fila-ate">Recebido até</label>
          <input id="fila-ate" v-model="form.to" class="input" type="date" />
        </div>
      </div>
      <p v-if="formError" class="field__error queue__error" role="alert"><AppIcon name="alert" />{{ formError }}</p>
      <div class="admin-filters__actions">
        <button type="submit" class="btn btn--primary">Aplicar filtros</button>
        <button v-if="hasFilters" type="button" class="btn btn--ghost" @click="clearFilters">Limpar filtros</button>
      </div>
    </form>

    <AdminState
      :loading="loader.loading.value && !result"
      :error="loader.error.value"
      :empty="!!result && result.items.length === 0 && !loader.error.value"
      loading-text="Carregando atendimentos…"
      :empty-title="hasFilters ? 'Nenhum atendimento com esses filtros' : 'Nenhuma solicitação de atendimento'"
      :empty-text="hasFilters ? 'Ajuste ou limpe os filtros para ver outras solicitações.' : 'As solicitações do formulário de atendimento aparecerão aqui.'"
      @retry="loader.load"
    >
      <template v-if="hasFilters" #empty-action>
        <button type="button" class="btn btn--secondary btn--sm" @click="clearFilters">Limpar filtros</button>
      </template>
    </AdminState>

    <template v-if="result && result.items.length && !loader.error.value">
      <div class="admin-table-wrap" tabindex="0" role="region" aria-labelledby="fila-caption" :aria-busy="loader.loading.value ? 'true' : undefined">
        <table class="admin-table">
          <caption id="fila-caption">
            Fila de atendimento
            <span>· {{ nf.format(result.total) }} {{ result.total === 1 ? 'solicitação' : 'solicitações' }}{{ loader.loading.value ? ' · atualizando…' : '' }}</span>
          </caption>
          <thead>
            <tr>
              <th scope="col">Protocolo</th>
              <th scope="col">Assunto</th>
              <th scope="col">Status</th>
              <th scope="col">Responsável</th>
              <th scope="col">Retorno por</th>
              <th scope="col">Origem</th>
              <th scope="col">Recebido em</th>
              <th scope="col">Atualizado em</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in result.items" :key="item.id">
              <th scope="row" class="nowrap">
                <RouterLink :to="{ name: 'admin-atendimento', params: { id: item.id } }" class="admin-mono">{{ item.protocol }}</RouterLink>
              </th>
              <td>{{ label(SUPPORT_SUBJECTS, item.subject) }}</td>
              <td><AdminStatus v-bind="statusMeta(SUPPORT_STATES, item.status)" /></td>
              <td>
                <template v-if="item.assignee">{{ item.assignee.displayName }}{{ item.assignee.id === me ? ' (você)' : '' }}</template>
                <span v-else class="muted">Sem responsável</span>
              </td>
              <td class="nowrap">
                {{ label(CONTACT_METHODS, item.contactMethod) }}
                <span class="muted queue__hint admin-mono">{{ item.contactHint }}</span>
              </td>
              <td>{{ sourceLabel(item.source) }}</td>
              <td class="nowrap">{{ formatDateTime(item.createdAt) }}</td>
              <td class="nowrap">{{ formatDateTime(item.updatedAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <AdminPagination :page="result.page" :page-size="result.pageSize" :total="result.total" label="atendimentos" :disabled="loader.loading.value" @change="goToPage" />
    </template>
  </div>
</template>

<style scoped>
.queue__tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: var(--mf-space-3);
}

.queue__tab {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: 8px 16px;
  border: 1.5px solid var(--mf-control-border);
  border-radius: 999px;
  background: var(--mf-paper);
  color: var(--mf-ink);
  font-size: 0.9375rem;
  font-weight: 600;
  text-decoration: none;
}

.queue__tab:hover {
  background: var(--mf-mint);
  color: var(--mf-forest);
}

.queue__tab[aria-current='true'] {
  background: var(--mf-forest);
  border-color: var(--mf-forest);
  color: #fff;
}

.queue__error {
  margin-top: var(--mf-space-3);
}

.queue__hint {
  display: block;
}
</style>
