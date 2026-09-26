<script setup lang="ts">
/**
 * Pedidos de titulares (privacy:manage): registro de pedidos recebidos por outros canais,
 * acompanhamento de status/resolução e ações sobre o cadastro vinculado com confirmação explícita.
 * A anonimização é irreversível: exige marcar a confirmação e envia `confirm: true`.
 * Acessibilidade: botões com aria-disabled durante o envio; confirmações anunciadas pela região viva
 * persistente (useAnnouncer); quando o formulário fecha, o foco vai para o pedido registrado ou
 * de volta a "Registrar pedido".
 */
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/ui/AppIcon.vue'
import AdminPagination from '@/components/admin/AdminPagination.vue'
import AdminState from '@/components/admin/AdminState.vue'
import AdminStatus from '@/components/admin/AdminStatus.vue'
import ConfirmDialog from '@/components/admin/ConfirmDialog.vue'
import { PRIVACY_ACTIONS, PRIVACY_STATUSES, PRIVACY_TYPES, label, statusMeta } from '@/components/admin/labels'
import type { Page, PrivacyAction, PrivacyRequest, PrivacyRequestType, PrivacyStatus } from '@/components/admin/types'
import { focusIfLost } from '@/components/forms/form-helpers'
import { formatDateTime } from '@/lib/format'
import { useAnnouncer } from '@/composables/useAnnouncer'
import { adminApi, errorMessage } from '@/composables/useAdminSession'
import { queryValue, toQuery, useAdminLoader, useAdminTitle } from '@/composables/useAdminLoader'

useAdminTitle('Privacidade')

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const route = useRoute()
const router = useRouter()
const { announce } = useAnnouncer()

const statusFilter = computed(() => queryValue(route.query.status))
const page = computed(() => Math.max(1, Number(queryValue(route.query.page)) || 1))
const selectedId = computed(() => queryValue(route.query.pedido))

const loader = useAdminLoader(() =>
  adminApi<Page<PrivacyRequest>>(`/admin/privacy-requests${toQuery({ status: statusFilter.value, page: page.value })}`),
)
const result = computed(() => loader.data.value)
// Pedido recém-registrado fica acessível mesmo quando a data de recebimento o põe fora da página carregada.
const lastCreated = ref<PrivacyRequest | null>(null)
const selected = computed(
  () =>
    result.value?.items.find((r) => r.id === selectedId.value) ??
    (lastCreated.value?.id === selectedId.value ? lastCreated.value : null),
)

const nf = new Intl.NumberFormat('pt-BR')
const typeOptions = Object.entries(PRIVACY_TYPES).map(([value, text]) => ({ value: value as PrivacyRequestType, label: text }))
const statusOptions = Object.entries(PRIVACY_STATUSES).map(([value, meta]) => ({ value: value as PrivacyStatus, label: meta.label }))

function setQuery(patch: Record<string, string | null>): Promise<unknown> {
  const query: Record<string, string> = {}
  for (const [k, v] of Object.entries({ ...route.query })) if (typeof v === 'string') query[k] = v
  for (const [k, v] of Object.entries(patch)) {
    if (v) query[k] = v
    else delete query[k]
  }
  return router.push({ query }).catch(() => undefined)
}

const detailHeading = ref<HTMLElement | null>(null)
async function openRequest(id: string) {
  feedback.value = ''
  await setQuery({ pedido: id })
  await nextTick()
  detailHeading.value?.focus()
}

/** "Fechar pedido": o detalhe sai da tela; o foco volta para o botão "Abrir" do mesmo pedido. */
async function closeRequest() {
  const id = selectedId.value
  await setQuery({ pedido: null })
  await nextTick()
  const row = id ? document.querySelector<HTMLElement>(`[data-request="${CSS.escape(id)}"]`) : null
  focusIfLost(row ?? document.getElementById('conteudo-admin'))
}

// Registro de pedido --------------------------------------------------------------------------------
const formOpen = ref(false)
const creating = ref(false)
const createError = ref('')
const createFields = ref<Record<string, string>>({})
const feedback = ref('')
const openFormButton = ref<HTMLButtonElement | null>(null)

function setFeedback(message: string) {
  feedback.value = message
  announce(message)
}

const newForm = reactive({ requestType: '' as PrivacyRequestType | '', channel: '', receivedAt: '', summary: '', leadId: '', supportRequestId: '' })
const formHeading = ref<HTMLElement | null>(null)

function localNow(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function openForm(leadId = '') {
  newForm.requestType = ''
  newForm.channel = ''
  newForm.receivedAt = localNow()
  newForm.summary = ''
  newForm.leadId = leadId
  newForm.supportRequestId = ''
  createError.value = ''
  createFields.value = {}
  formOpen.value = true
  await nextTick()
  formHeading.value?.focus()
}

async function closeForm() {
  if (creating.value) return
  formOpen.value = false
  if (route.query.novo) await setQuery({ novo: null, leadId: null })
  await nextTick()
  // "Cancelar" saiu da tela com o formulário: o foco volta para quem o abriu.
  focusIfLost(openFormButton.value)
}

async function createRequest() {
  if (creating.value) return
  const fields: Record<string, string> = {}
  if (!newForm.requestType) fields.requestType = 'Escolha o tipo do pedido.'
  if (!newForm.channel.trim()) fields.channel = 'Informe por onde o pedido chegou.'
  if (!newForm.receivedAt || Number.isNaN(new Date(newForm.receivedAt).getTime())) fields.receivedAt = 'Informe a data e a hora do recebimento.'
  if (newForm.summary.trim().length < 5) fields.summary = 'Descreva o pedido com pelo menos 5 caracteres.'
  if (newForm.leadId.trim() && !UUID.test(newForm.leadId.trim())) fields.leadId = 'Confira o identificador do cadastro.'
  if (newForm.supportRequestId.trim() && !UUID.test(newForm.supportRequestId.trim())) fields.supportRequestId = 'Confira o identificador do atendimento.'
  createFields.value = fields
  createError.value = ''
  const first = Object.keys(fields)[0]
  if (first) {
    await nextTick()
    document.getElementById(`pedido-${first}`)?.focus()
    return
  }
  creating.value = true
  try {
    const created = await adminApi<PrivacyRequest>('/admin/privacy-requests', {
      body: {
        requestType: newForm.requestType,
        channel: newForm.channel.trim(),
        summary: newForm.summary.trim(),
        receivedAt: new Date(newForm.receivedAt).toISOString(),
        leadId: newForm.leadId.trim() || null,
        supportRequestId: newForm.supportRequestId.trim() || null,
      },
    })
    lastCreated.value = created
    formOpen.value = false
    setFeedback('Pedido registrado. Acompanhe e registre a resolução abaixo.')
    await setQuery({ novo: null, leadId: null, status: null, page: null, pedido: created.id })
    await nextTick()
    // O formulário fechou: o foco vai para o pedido recém-registrado.
    focusIfLost(detailHeading.value ?? openFormButton.value)
  } catch (e) {
    createError.value = errorMessage(e)
    if (e && typeof e === 'object' && 'fields' in e) createFields.value = { ...(e as { fields: Record<string, string> }).fields }
  } finally {
    creating.value = false
  }
}

// Atualização de status e resolução ------------------------------------------------------------------
const edit = reactive({ status: '' as PrivacyStatus | '', resolution: '' })
const saving = ref(false)
const saveError = ref('')
const resolutionError = ref('')

watch(
  selected,
  (req) => {
    edit.status = req?.status ?? ''
    edit.resolution = req?.resolution ?? ''
    saveError.value = ''
    resolutionError.value = ''
  },
  { immediate: true },
)

function replace(updated: PrivacyRequest) {
  if (lastCreated.value?.id === updated.id) lastCreated.value = updated
  const data = loader.data.value
  if (!data) return
  loader.data.value = { ...data, items: data.items.map((r) => (r.id === updated.id ? updated : r)) }
}

async function saveStatus() {
  if (!selected.value || saving.value || !edit.status) return
  resolutionError.value = ''
  const finishing = edit.status === 'fulfilled' || edit.status === 'rejected'
  if (finishing && !edit.resolution.trim()) {
    resolutionError.value = 'Registre o que foi feito (ou o motivo da recusa) antes de concluir.'
    document.getElementById('pedido-resolucao')?.focus()
    return
  }
  saving.value = true
  saveError.value = ''
  feedback.value = ''
  try {
    const updated = await adminApi<PrivacyRequest>(`/admin/privacy-requests/${encodeURIComponent(selected.value.id)}`, {
      method: 'PATCH',
      body: { status: edit.status, resolution: edit.resolution.trim() },
    })
    replace(updated)
    setFeedback(`Pedido atualizado: ${statusMeta(PRIVACY_STATUSES, updated.status).label}.`)
  } catch (e) {
    saveError.value = errorMessage(e)
  } finally {
    saving.value = false
  }
}

// Ações sobre o cadastro ---------------------------------------------------------------------------
const pendingAction = ref<PrivacyAction | null>(null)
const actionOpen = computed({
  get: () => pendingAction.value !== null,
  set: (v: boolean) => {
    if (!v && !actionBusy.value) pendingAction.value = null
  },
})
const actionBusy = ref(false)
const actionError = ref<string | null>(null)
const ACTION_ORDER: PrivacyAction[] = ['revoke_all', 'suppress_contact', 'anonymize_lead']
// Revogar e suprimir exigem cadastro; anonimizar também vale para um atendimento vinculado sozinho.
const availableActions = computed<PrivacyAction[]>(() => {
  const req = selected.value
  if (!req) return []
  if (req.leadId) return ACTION_ORDER
  return req.supportRequestId ? ['anonymize_lead'] : []
})

function askAction(action: PrivacyAction) {
  actionError.value = null
  pendingAction.value = action
}

async function runAction() {
  const action = pendingAction.value
  if (!selected.value || !action || actionBusy.value) return
  actionBusy.value = true
  actionError.value = null
  try {
    const updated = await adminApi<PrivacyRequest>(`/admin/privacy-requests/${encodeURIComponent(selected.value.id)}`, {
      method: 'PATCH',
      body: action === 'anonymize_lead' ? { action, confirm: true } : { action },
    })
    replace(updated)
    actionBusy.value = false
    pendingAction.value = null
    setFeedback(`Ação concluída e registrada na auditoria: ${PRIVACY_ACTIONS[action].label.toLowerCase()}.`)
  } catch (e) {
    actionError.value = errorMessage(e)
  } finally {
    actionBusy.value = false
  }
}

watch(
  () => [route.query.status, route.query.page],
  () => {
    if (route.name !== 'admin-privacidade') return
    void loader.load()
  },
)

watch(
  () => route.query.pedido,
  (id) => {
    // Pedido recém-criado ou vindo de link: garante que está na página carregada.
    if (route.name === 'admin-privacidade' && id && result.value && !selected.value) void loader.load()
  },
)

onMounted(() => {
  void loader.load()
  if (route.query.novo) void openForm(UUID.test(queryValue(route.query.leadId)) ? queryValue(route.query.leadId) : '')
})
</script>

<template>
  <div>
    <header class="admin-page-head">
      <div class="admin-page-head__text">
        <h1>Privacidade</h1>
        <p>Pedidos de titulares: registro, cumprimento e supressão. Preferências do titular prevalecem sobre ações de comunicação.</p>
      </div>
      <div class="admin-page-head__actions">
        <button v-if="!formOpen" ref="openFormButton" type="button" class="btn btn--primary" @click="openForm()">Registrar pedido</button>
      </div>
    </header>

    <!-- Sem role="status": a confirmação é anunciada pela região viva persistente (useAnnouncer). -->
    <p v-if="feedback" class="notice notice--success priv__feedback">
      <AppIcon name="check-circle" />
      <span>{{ feedback }}</span>
    </p>

    <!-- Registro -->
    <section v-if="formOpen" class="admin-panel priv__form" aria-labelledby="novo-pedido-titulo">
      <div class="admin-panel__head">
        <h2 id="novo-pedido-titulo" ref="formHeading" tabindex="-1">Registrar pedido recebido por outro canal</h2>
        <p>Campos com * são obrigatórios</p>
      </div>
      <form class="form" novalidate @submit.prevent="createRequest">
        <div class="admin-grid admin-grid--2">
          <div class="field">
            <label class="field__label" for="pedido-requestType">Tipo do pedido *</label>
            <select id="pedido-requestType" v-model="newForm.requestType" class="select" :aria-invalid="createFields.requestType ? 'true' : undefined" :aria-describedby="createFields.requestType ? 'pedido-requestType-erro' : undefined">
              <option value="" disabled>Escolha</option>
              <option v-for="o in typeOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
            <p v-if="createFields.requestType" id="pedido-requestType-erro" class="field__error"><AppIcon name="alert" />{{ createFields.requestType }}</p>
          </div>
          <div class="field">
            <label class="field__label" for="pedido-channel">Canal de recebimento *</label>
            <input id="pedido-channel" v-model="newForm.channel" class="input" type="text" maxlength="60" list="pedido-canais" :aria-invalid="createFields.channel ? 'true' : undefined" :aria-describedby="createFields.channel ? 'pedido-channel-erro' : 'pedido-channel-dica'" />
            <datalist id="pedido-canais">
              <option value="E-mail" />
              <option value="WhatsApp" />
              <option value="Formulário de atendimento" />
              <option value="Telefone" />
              <option value="Correspondência" />
            </datalist>
            <p v-if="createFields.channel" id="pedido-channel-erro" class="field__error"><AppIcon name="alert" />{{ createFields.channel }}</p>
            <p v-else id="pedido-channel-dica" class="field__hint">Ex.: e-mail, WhatsApp, formulário de atendimento.</p>
          </div>
          <div class="field">
            <label class="field__label" for="pedido-receivedAt">Recebido em *</label>
            <input id="pedido-receivedAt" v-model="newForm.receivedAt" class="input" type="datetime-local" :aria-invalid="createFields.receivedAt ? 'true' : undefined" :aria-describedby="createFields.receivedAt ? 'pedido-receivedAt-erro' : undefined" />
            <p v-if="createFields.receivedAt" id="pedido-receivedAt-erro" class="field__error"><AppIcon name="alert" />{{ createFields.receivedAt }}</p>
          </div>
          <div class="field">
            <label class="field__label" for="pedido-leadId">Identificador do cadastro</label>
            <input id="pedido-leadId" v-model="newForm.leadId" class="input admin-mono" type="text" maxlength="36" spellcheck="false" autocomplete="off" :aria-invalid="createFields.leadId ? 'true' : undefined" :aria-describedby="createFields.leadId ? 'pedido-leadId-erro' : 'pedido-leadId-dica'" />
            <p v-if="createFields.leadId" id="pedido-leadId-erro" class="field__error"><AppIcon name="alert" />{{ createFields.leadId }}</p>
            <p v-else id="pedido-leadId-dica" class="field__hint">Opcional. Necessário para revogar, suprimir ou anonimizar.</p>
          </div>
          <div class="field">
            <label class="field__label" for="pedido-supportRequestId">Identificador do atendimento</label>
            <input id="pedido-supportRequestId" v-model="newForm.supportRequestId" class="input admin-mono" type="text" maxlength="36" spellcheck="false" autocomplete="off" :aria-invalid="createFields.supportRequestId ? 'true' : undefined" :aria-describedby="createFields.supportRequestId ? 'pedido-supportRequestId-erro' : 'pedido-supportRequestId-dica'" />
            <p v-if="createFields.supportRequestId" id="pedido-supportRequestId-erro" class="field__error"><AppIcon name="alert" />{{ createFields.supportRequestId }}</p>
            <p v-else id="pedido-supportRequestId-dica" class="field__hint">Opcional, quando o pedido chegou pelo atendimento.</p>
          </div>
        </div>
        <div class="field">
          <label class="field__label" for="pedido-summary">Resumo do pedido *</label>
          <textarea id="pedido-summary" v-model="newForm.summary" class="textarea" maxlength="1000" :aria-invalid="createFields.summary ? 'true' : undefined" :aria-describedby="`pedido-summary-dica pedido-summary-conta${createFields.summary ? ' pedido-summary-erro' : ''}`" />
          <span id="pedido-summary-conta" class="char-count">{{ newForm.summary.length }}/1000</span>
          <p id="pedido-summary-dica" class="field__hint">Descreva o que o titular pediu. Não copie documentos nem dados desnecessários.</p>
          <p v-if="createFields.summary" id="pedido-summary-erro" class="field__error"><AppIcon name="alert" />{{ createFields.summary }}</p>
        </div>
        <div v-if="createError" class="notice notice--error" role="alert">
          <AppIcon name="alert" />
          <p>{{ createError }}</p>
        </div>
        <div class="cluster">
          <button type="submit" class="btn btn--primary" :aria-disabled="creating ? 'true' : undefined">
            <span v-if="creating" class="spinner" aria-hidden="true" />
            {{ creating ? 'Registrando…' : 'Registrar pedido' }}
          </button>
          <button type="button" class="btn btn--ghost" :aria-disabled="creating ? 'true' : undefined" @click="closeForm">Cancelar</button>
        </div>
      </form>
    </section>

    <!-- Pedido selecionado -->
    <section v-if="selected" class="admin-panel priv__detail" aria-labelledby="pedido-titulo">
      <div class="priv__detail-head">
        <div>
          <h2 id="pedido-titulo" ref="detailHeading" tabindex="-1">{{ label(PRIVACY_TYPES, selected.requestType) }}</h2>
          <p class="priv__detail-sub">
            <AdminStatus v-bind="statusMeta(PRIVACY_STATUSES, selected.status)" />
            <span>Recebido em {{ formatDateTime(selected.receivedAt) }} · {{ selected.channel }}</span>
          </p>
        </div>
        <button type="button" class="btn btn--ghost btn--sm" @click="closeRequest">
          <AppIcon name="close" />
          Fechar pedido
        </button>
      </div>

      <div class="admin-grid admin-grid--detail priv__detail-grid">
        <div>
          <h3>Resumo</h3>
          <p class="priv__text">{{ selected.summary }}</p>
          <dl class="admin-dl">
            <dt>Cadastro vinculado</dt>
            <dd>
              <RouterLink v-if="selected.leadId" :to="{ name: 'admin-lead', params: { id: selected.leadId } }" class="admin-mono">{{ selected.leadId }}</RouterLink>
              <span v-else>Nenhum</span>
            </dd>
            <dt>Atendimento vinculado</dt>
            <dd>
              <RouterLink v-if="selected.supportRequestId" :to="{ name: 'admin-atendimento', params: { id: selected.supportRequestId } }" class="admin-mono">{{ selected.supportRequestId }}</RouterLink>
              <span v-else>Nenhum</span>
            </dd>
            <dt>Responsável</dt>
            <dd>{{ selected.handledBy?.displayName ?? 'Ainda não atribuído' }}</dd>
            <dt>Concluído em</dt>
            <dd>{{ selected.fulfilledAt ? formatDateTime(selected.fulfilledAt) : '—' }}</dd>
          </dl>

          <h3 class="priv__subhead">Ações sobre os dados</h3>
          <template v-if="availableActions.length">
            <p v-if="!selected.leadId" class="muted priv__no-lead">
              Sem cadastro vinculado: só a anonimização da solicitação de atendimento está disponível.
            </p>
            <ul class="priv__actions">
              <li v-for="a in availableActions" :key="a" :class="{ 'priv__action--danger': a === 'anonymize_lead' }">
                <div>
                  <strong>{{ PRIVACY_ACTIONS[a].label }}</strong>
                  <p>{{ PRIVACY_ACTIONS[a].description }}</p>
                </div>
                <button type="button" class="btn btn--sm" :class="a === 'anonymize_lead' ? 'btn--danger' : 'btn--secondary'" @click="askAction(a)">
                  {{ a === 'anonymize_lead' ? 'Anonimizar…' : a === 'revoke_all' ? 'Revogar…' : 'Suprimir…' }}
                </button>
              </li>
            </ul>
          </template>
          <p v-else class="muted priv__no-lead">
            Este pedido não tem cadastro nem atendimento vinculado, então as ações sobre dados ficam indisponíveis. Se o titular tiver cadastro, registre um novo pedido com o identificador dele.
          </p>
        </div>

        <form class="form priv__edit" novalidate @submit.prevent="saveStatus">
          <h3>Andamento</h3>
          <div class="field">
            <label class="field__label" for="pedido-status">Status</label>
            <select id="pedido-status" v-model="edit.status" class="select">
              <option v-for="o in statusOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
          </div>
          <div class="field">
            <label class="field__label" for="pedido-resolucao">Resolução</label>
            <textarea
              id="pedido-resolucao"
              v-model="edit.resolution"
              class="textarea"
              maxlength="1000"
              :aria-invalid="resolutionError ? 'true' : undefined"
              :aria-describedby="`pedido-resolucao-dica${resolutionError ? ' pedido-resolucao-erro' : ''}`"
            />
            <p id="pedido-resolucao-dica" class="field__hint">O que foi feito, quando e como o titular foi informado. Obrigatória para concluir ou recusar.</p>
            <p v-if="resolutionError" id="pedido-resolucao-erro" class="field__error"><AppIcon name="alert" />{{ resolutionError }}</p>
          </div>
          <div v-if="saveError" class="notice notice--error" role="alert">
            <AppIcon name="alert" />
            <p>{{ saveError }}</p>
          </div>
          <div>
            <button type="submit" class="btn btn--primary btn--sm" :aria-disabled="saving ? 'true' : undefined">
              <span v-if="saving" class="spinner" aria-hidden="true" />
              {{ saving ? 'Salvando…' : 'Salvar andamento' }}
            </button>
          </div>
        </form>
      </div>
    </section>

    <!-- Lista -->
    <div class="priv__bar">
      <div class="field priv__filter">
        <label class="field__label" for="pedidos-status">Status</label>
        <select id="pedidos-status" class="select" :value="statusFilter" @change="setQuery({ status: ($event.target as HTMLSelectElement).value || null, page: null })">
          <option value="">Todos</option>
          <option v-for="o in statusOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
      </div>
    </div>

    <AdminState
      :loading="loader.loading.value && !result"
      :error="loader.error.value"
      :empty="!!result && result.items.length === 0 && !loader.error.value"
      loading-text="Carregando pedidos…"
      :empty-title="statusFilter ? 'Nenhum pedido com esse status' : 'Nenhum pedido registrado'"
      empty-text="Pedidos recebidos por e-mail, WhatsApp ou atendimento podem ser registrados aqui."
      @retry="loader.load"
    />

    <template v-if="result && result.items.length && !loader.error.value">
      <div class="admin-table-wrap" tabindex="0" role="region" aria-labelledby="pedidos-caption">
        <table class="admin-table">
          <caption id="pedidos-caption">
            Pedidos de titulares
            <span>· {{ nf.format(result.total) }} {{ result.total === 1 ? 'pedido' : 'pedidos' }}</span>
          </caption>
          <thead>
            <tr>
              <th scope="col">Tipo</th>
              <th scope="col">Status</th>
              <th scope="col">Recebido em</th>
              <th scope="col">Canal</th>
              <th scope="col">Resumo</th>
              <th scope="col">Responsável</th>
              <th scope="col"><span class="visually-hidden">Ações</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in result.items" :key="r.id" :class="{ 'priv__row--selected': r.id === selectedId }">
              <th scope="row">{{ label(PRIVACY_TYPES, r.requestType) }}</th>
              <td><AdminStatus v-bind="statusMeta(PRIVACY_STATUSES, r.status)" /></td>
              <td class="nowrap">{{ formatDateTime(r.receivedAt) }}</td>
              <td>{{ r.channel }}</td>
              <td class="priv__summary">{{ r.summary }}</td>
              <td>{{ r.handledBy?.displayName ?? '—' }}</td>
              <td class="nowrap">
                <button
                  type="button"
                  class="btn btn--secondary btn--sm"
                  :aria-current="r.id === selectedId ? 'true' : undefined"
                  :data-request="r.id"
                  @click="openRequest(r.id)"
                >
                  {{ r.id === selectedId ? 'Em exibição' : 'Abrir' }}<span class="visually-hidden"> pedido de {{ label(PRIVACY_TYPES, r.requestType) }} recebido em {{ formatDateTime(r.receivedAt) }}</span>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <AdminPagination :page="result.page" :page-size="result.pageSize" :total="result.total" label="pedidos" :disabled="loader.loading.value" @change="(p) => setQuery({ page: String(p) })" />
    </template>

    <ConfirmDialog
      v-model:open="actionOpen"
      :title="pendingAction ? `${PRIVACY_ACTIONS[pendingAction].label}?` : ''"
      :confirm-label="pendingAction === 'anonymize_lead' ? 'Anonimizar definitivamente' : pendingAction === 'revoke_all' ? 'Revogar finalidades' : 'Suprimir contato'"
      busy-label="Aplicando…"
      :danger="pendingAction === 'anonymize_lead'"
      :acknowledge="pendingAction === 'anonymize_lead' ? 'Entendo que a anonimização é irreversível: os dados pessoais anonimizados não poderão ser recuperados.' : undefined"
      :busy="actionBusy"
      :error="actionError"
      :return-focus="() => detailHeading"
      @confirm="runAction"
    >
      <p v-if="pendingAction">{{ PRIVACY_ACTIONS[pendingAction].description }}</p>
      <p v-if="selected?.leadId">
        Cadastro: <code class="admin-mono">{{ selected.leadId }}</code>
      </p>
      <p v-if="selected?.supportRequestId && pendingAction === 'anonymize_lead'">
        Atendimento: <code class="admin-mono">{{ selected.supportRequestId }}</code>
      </p>
      <p class="field__hint">A ação é registrada na auditoria com seu usuário e o horário.</p>
    </ConfirmDialog>
  </div>
</template>

<style scoped>
.priv__feedback {
  margin-bottom: var(--mf-space-4);
  align-items: center;
}

.priv__form,
.priv__detail {
  margin-bottom: var(--mf-space-4);
}

.priv__form h2:focus,
.priv__detail h2:focus {
  outline: none;
}

.priv__detail {
  border: 2px solid var(--mf-forest);
}

.priv__detail-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px 16px;
  margin-bottom: var(--mf-space-3);
  padding-bottom: var(--mf-space-3);
  border-bottom: 1px solid var(--mf-border);
}

.priv__detail-head h2 {
  margin-bottom: 6px;
}

.priv__detail-sub {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 12px;
  margin: 0;
  font-size: 0.9375rem;
  color: var(--mf-muted);
}

.priv__detail-grid {
  gap: var(--mf-space-5);
}

.priv__text {
  margin: 0 0 var(--mf-space-3);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.priv__subhead {
  margin-top: var(--mf-space-4);
}

.priv__actions {
  display: grid;
  gap: 10px;
  list-style: none;
  margin: 0;
  padding: 0;
}

.priv__actions li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 16px;
  margin: 0;
  padding: 12px 14px;
  border: 1px solid var(--mf-border);
  border-radius: 12px;
}

.priv__actions li > div {
  flex: 1 1 260px;
}

.priv__actions strong {
  font-size: 0.9375rem;
}

.priv__actions p {
  margin: 2px 0 0;
  font-size: 0.875rem;
  color: var(--mf-muted);
}

.priv__action--danger {
  border-color: #e8c3bd !important;
  background: #fdf6f5;
}

.priv__no-lead {
  font-size: 0.9375rem;
}

.priv__edit {
  gap: var(--mf-space-3);
  padding: var(--mf-space-3);
  border-radius: 12px;
  background: var(--mf-cream);
  align-content: start;
}

.priv__edit h3 {
  margin: 0;
}

.priv__bar {
  display: flex;
  justify-content: flex-start;
  margin-bottom: var(--mf-space-3);
}

.priv__filter {
  width: min(260px, 100%);
}

.priv__summary {
  min-width: 220px;
  max-width: 380px;
}

.priv__row--selected > * {
  background: #f1f7f3 !important;
}
</style>
