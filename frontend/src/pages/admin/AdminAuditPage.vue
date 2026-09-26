<script setup lang="ts">
/**
 * Trilha de auditoria (audit:read). Somente leitura. Os metadados nunca trazem contato ou
 * mensagem (regra do servidor); aqui são exibidos como texto, sem interpretação de HTML.
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/ui/AppIcon.vue'
import AdminPagination from '@/components/admin/AdminPagination.vue'
import AdminState from '@/components/admin/AdminState.vue'
import { ACTOR_TYPES, ROLES, label } from '@/components/admin/labels'
import type { AdminUser, AdminUserRef, AuditEntry, Page } from '@/components/admin/types'
import { formatDateTime } from '@/lib/format'
import { adminApi, useAdminSession } from '@/composables/useAdminSession'
import { queryValue, toQuery, useAdminLoader, useAdminTitle } from '@/composables/useAdminLoader'

useAdminTitle('Auditoria')

const KEYS = ['action', 'actorId', 'from', 'to'] as const
type Key = (typeof KEYS)[number]

const route = useRoute()
const router = useRouter()
const session = useAdminSession()

const applied = computed<Record<Key, string>>(() => {
  const out = {} as Record<Key, string>
  for (const k of KEYS) out[k] = queryValue(route.query[k])
  return out
})
const page = computed(() => Math.max(1, Number(queryValue(route.query.page)) || 1))
const hasFilters = computed(() => KEYS.some((k) => applied.value[k]))
const form = reactive<Record<Key, string>>({ action: '', actorId: '', from: '', to: '' })
const formError = ref('')

const loader = useAdminLoader(() => adminApi<Page<AuditEntry>>(`/admin/audit${toQuery({ ...applied.value, page: page.value })}`))
const result = computed(() => loader.data.value)

// Pessoas para o filtro: usuários (users:manage) ou equipe; sem essas permissões, o filtro some.
const people = ref<AdminUserRef[]>([])
async function loadPeople() {
  try {
    if (session.can('users:manage')) {
      const res = await adminApi<{ items: AdminUser[] }>('/admin/users')
      people.value = (res.items ?? []).map((u) => ({ id: u.id, displayName: u.displayName, role: u.role }))
    } else if (session.can('team:read')) {
      const res = await adminApi<{ items: AdminUserRef[] }>('/admin/team')
      people.value = res.items ?? []
    }
  } catch {
    people.value = []
  }
}

// Sugestões de ação a partir do que já apareceu na trilha (o campo aceita qualquer código).
const seenActions = ref<Set<string>>(new Set())
watch(result, (r) => {
  if (!r) return
  const next = new Set(seenActions.value)
  for (const e of r.items) next.add(e.action)
  seenActions.value = next
})

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
  for (const k of KEYS) if (form[k].trim()) query[k] = form[k].trim()
  void router.push({ query })
}

function clearFilters() {
  for (const k of KEYS) form[k] = ''
  void router.push({ query: {} })
}

function goToPage(p: number) {
  void router.push({ query: { ...route.query, page: String(p) } })
}

function actor(e: AuditEntry): string {
  return e.actor ? e.actor.displayName : label(ACTOR_TYPES, e.actorType)
}

// Atalho para o recurso quando ele tem tela no painel (a tela confere a permissão).
function resourceLink(e: AuditEntry) {
  if (!e.resourceId) return null
  if (e.resourceType === 'lead' || e.resourceType === 'leads') return { name: 'admin-lead', params: { id: e.resourceId } }
  if (e.resourceType === 'support_request' || e.resourceType === 'support') return { name: 'admin-atendimento', params: { id: e.resourceId } }
  return null
}

function metaEntries(meta: Record<string, unknown> | null | undefined): [string, string][] {
  return Object.entries(meta ?? {}).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])
}

const nf = new Intl.NumberFormat('pt-BR')

watch(
  () => route.query,
  () => {
    if (route.name !== 'admin-auditoria') return
    syncForm()
    void loader.load()
  },
)

onMounted(() => {
  syncForm()
  void loader.load()
  void loadPeople()
})
</script>

<template>
  <div>
    <header class="admin-page-head">
      <div class="admin-page-head__text">
        <h1>Auditoria</h1>
        <p>Registro das ações administrativas e de sistema: acessos a contato, exportações, mudanças de atendimento, privacidade e usuários.</p>
      </div>
    </header>

    <form class="admin-filters" novalidate @submit.prevent="applyFilters">
      <p class="admin-filters__legend"><AppIcon name="filter" /> Filtros</p>
      <div class="admin-filters__grid">
        <div class="field">
          <label class="field__label" for="auditoria-acao">Ação</label>
          <input id="auditoria-acao" v-model="form.action" class="input admin-mono" type="text" list="auditoria-acoes" maxlength="80" spellcheck="false" autocomplete="off" aria-describedby="auditoria-acao-dica" />
          <datalist id="auditoria-acoes">
            <option v-for="a in [...seenActions].sort()" :key="a" :value="a" />
          </datalist>
          <p id="auditoria-acao-dica" class="field__hint">Código da ação, como aparece na tabela.</p>
        </div>
        <div v-if="people.length" class="field">
          <label class="field__label" for="auditoria-pessoa">Pessoa</label>
          <select id="auditoria-pessoa" v-model="form.actorId" class="select">
            <option value="">Qualquer</option>
            <option v-for="p in people" :key="p.id" :value="p.id">{{ p.displayName }} · {{ ROLES[p.role] ?? p.role }}</option>
          </select>
        </div>
        <div class="field">
          <label class="field__label" for="auditoria-de">De</label>
          <input id="auditoria-de" v-model="form.from" class="input" type="date" />
        </div>
        <div class="field">
          <label class="field__label" for="auditoria-ate">Até</label>
          <input id="auditoria-ate" v-model="form.to" class="input" type="date" />
        </div>
      </div>
      <p v-if="formError" class="field__error audit__error" role="alert"><AppIcon name="alert" />{{ formError }}</p>
      <div class="admin-filters__actions">
        <button type="submit" class="btn btn--primary">Aplicar filtros</button>
        <button v-if="hasFilters" type="button" class="btn btn--ghost" @click="clearFilters">Limpar filtros</button>
      </div>
    </form>

    <AdminState
      :loading="loader.loading.value && !result"
      :error="loader.error.value"
      :empty="!!result && result.items.length === 0 && !loader.error.value"
      loading-text="Carregando a trilha de auditoria…"
      :empty-title="hasFilters ? 'Nenhum registro com esses filtros' : 'Nenhum registro de auditoria'"
      :empty-text="hasFilters ? 'Ajuste ou limpe os filtros.' : undefined"
      @retry="loader.load"
    >
      <template v-if="hasFilters" #empty-action>
        <button type="button" class="btn btn--secondary btn--sm" @click="clearFilters">Limpar filtros</button>
      </template>
    </AdminState>

    <template v-if="result && result.items.length && !loader.error.value">
      <div class="admin-table-wrap" tabindex="0" role="region" aria-labelledby="auditoria-caption" :aria-busy="loader.loading.value ? 'true' : undefined">
        <table class="admin-table">
          <caption id="auditoria-caption">
            Trilha de auditoria
            <span>· {{ nf.format(result.total) }} {{ result.total === 1 ? 'registro' : 'registros' }}, mais recentes primeiro</span>
          </caption>
          <thead>
            <tr>
              <th scope="col">Data e hora</th>
              <th scope="col">Quem</th>
              <th scope="col">Ação</th>
              <th scope="col">Recurso</th>
              <th scope="col">Detalhes</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="e in result.items" :key="e.id">
              <th scope="row" class="nowrap"><time :datetime="e.at">{{ formatDateTime(e.at) }}</time></th>
              <td>
                {{ actor(e) }}
                <span v-if="e.actor" class="muted audit__role">{{ ROLES[e.actor.role] ?? e.actor.role }}</span>
              </td>
              <td><code class="admin-mono audit__action">{{ e.action }}</code></td>
              <td>
                <template v-if="e.resourceType">
                  {{ e.resourceType }}
                  <template v-if="e.resourceId">
                    <RouterLink v-if="resourceLink(e)" :to="resourceLink(e)!" class="admin-mono audit__id">{{ e.resourceId.slice(0, 8) }}<span class="visually-hidden">{{ e.resourceId.slice(8) }}</span></RouterLink>
                    <code v-else class="admin-mono audit__id">{{ e.resourceId.slice(0, 8) }}<span class="visually-hidden">{{ e.resourceId.slice(8) }}</span></code>
                  </template>
                </template>
                <span v-else class="muted">—</span>
              </td>
              <td>
                <dl v-if="metaEntries(e.metadata).length" class="audit__meta">
                  <div v-for="[k, v] in metaEntries(e.metadata)" :key="k">
                    <dt>{{ k }}</dt>
                    <dd>{{ v }}</dd>
                  </div>
                </dl>
                <span v-else class="muted">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <AdminPagination :page="result.page" :page-size="result.pageSize" :total="result.total" label="auditoria" :disabled="loader.loading.value" @change="goToPage" />
    </template>
  </div>
</template>

<style scoped>
.audit__error {
  margin-top: var(--mf-space-3);
}

.audit__role {
  display: block;
}

.audit__action {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 6px;
  background: var(--mf-cream);
  white-space: nowrap;
}

.audit__id {
  display: block;
  color: var(--mf-muted);
}

.audit__meta {
  display: grid;
  gap: 2px;
  margin: 0;
  font-size: 0.8125rem;
  min-width: 200px;
}

.audit__meta div {
  display: flex;
  gap: 6px;
}

.audit__meta dt {
  color: var(--mf-muted);
}

.audit__meta dt::after {
  content: ':';
}

.audit__meta dd {
  margin: 0;
  overflow-wrap: anywhere;
}
</style>
