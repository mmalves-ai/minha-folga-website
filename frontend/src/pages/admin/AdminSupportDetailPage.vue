<script setup lang="ts">
/**
 * Detalhe do atendimento (support:read; acesso auditado no servidor). Mudança de status só pelas
 * transições permitidas, atribuição à equipe e notas internas ou visíveis ao titular
 * (support:update). A mensagem é exibida como texto puro, nunca como HTML.
 * Acessibilidade: botões ficam com aria-disabled durante o envio (o foco não cai no <body>); cada
 * confirmação é anunciada pela região viva persistente (useAnnouncer); quando o botão acionado some
 * (ex.: a transição feita), o foco vai para o controle equivalente do mesmo painel.
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/ui/AppIcon.vue'
import AdminState from '@/components/admin/AdminState.vue'
import AdminStatus from '@/components/admin/AdminStatus.vue'
import ConfirmDialog from '@/components/admin/ConfirmDialog.vue'
import {
  ACTOR_TYPES,
  CONTACT_METHODS,
  SUPPORT_EVENTS,
  SUPPORT_STATES,
  SUPPORT_SUBJECTS,
  SUPPORT_TRANSITIONS,
  label,
  sourceLabel,
  statusMeta,
  transitionLabel,
} from '@/components/admin/labels'
import type { AdminSupportDetail, AdminSupportEvent, AdminUserRef, SupportState } from '@/components/admin/types'
import { focusIfLost } from '@/components/forms/form-helpers'
import { formatDateTime } from '@/lib/format'
import { useAnnouncer } from '@/composables/useAnnouncer'
import { adminApi, errorMessage, useAdminSession } from '@/composables/useAdminSession'
import { useAdminLoader, useAdminTitle } from '@/composables/useAdminLoader'

const NOTE_MAX = 2000

const route = useRoute()
const router = useRouter()
const session = useAdminSession()
const { announce } = useAnnouncer()
const id = computed(() => String(route.params.id ?? ''))
const base = computed(() => `/admin/support/${encodeURIComponent(id.value)}`)

const loader = useAdminLoader(() => adminApi<AdminSupportDetail>(base.value))
const ticket = computed(() => loader.data.value)
const canUpdate = computed(() => session.can('support:update'))
const me = computed(() => session.state.user?.id ?? '')

useAdminTitle(() => (ticket.value ? `Atendimento ${ticket.value.protocol}` : 'Atendimento'))

const backTo = computed(() => {
  const back = router.options.history.state.back
  return typeof back === 'string' && back.startsWith('/admin/atendimentos') ? back : { name: 'admin-atendimentos' }
})

const events = computed(() => [...(ticket.value?.events ?? [])].sort((a, b) => b.at.localeCompare(a.at)))
const transitions = computed<SupportState[]>(() => (ticket.value ? SUPPORT_TRANSITIONS[ticket.value.status] ?? [] : []))

function eventTitle(e: AdminSupportEvent): string {
  if (e.type === 'status_changed' && e.toStatus) {
    return `${e.fromStatus ? statusMeta(SUPPORT_STATES, e.fromStatus).label : 'Início'} → ${statusMeta(SUPPORT_STATES, e.toStatus).label}`
  }
  if (e.type === 'assigned' && e.assignee !== undefined) {
    return e.assignee ? `Responsável: ${e.assignee.displayName}` : 'Responsável removido'
  }
  return label(SUPPORT_EVENTS, e.type)
}

function actorName(e: AdminSupportEvent): string {
  return e.actor ? e.actor.displayName : label(ACTOR_TYPES, e.actorType)
}

const feedback = ref('')
const actionError = ref('')

function apply(updated: AdminSupportDetail, message: string) {
  loader.data.value = updated
  feedback.value = message
  actionError.value = ''
  announce(message)
}

// Status -----------------------------------------------------------------------------------------
const statusBusy = ref<SupportState | null>(null)
const closeConfirm = ref(false)
const transitionsEl = ref<HTMLElement | null>(null)
const statusHeading = ref<HTMLElement | null>(null)

/**
 * Onde o foco fica depois de mudar o status: o botão da mesma transição, se continuar na tela; senão
 * o primeiro botão de transição (a próxima etapa do fluxo); sem botões, o título do painel de status.
 */
function statusFocusTarget(preferred?: SupportState): HTMLElement | null {
  const buttons = [...(transitionsEl.value?.querySelectorAll<HTMLButtonElement>('button[data-to]') ?? [])]
  return buttons.find((b) => b.dataset.to === preferred) ?? buttons[0] ?? statusHeading.value
}

async function changeStatus(to: SupportState) {
  if (statusBusy.value) return
  statusBusy.value = to
  feedback.value = ''
  actionError.value = ''
  try {
    const updated = await adminApi<AdminSupportDetail>(base.value, { method: 'PATCH', body: { status: to } })
    apply(updated, `Status alterado para “${statusMeta(SUPPORT_STATES, updated.status).label}”.`)
    closeConfirm.value = false
    statusBusy.value = null
    await nextTick()
    // O botão acionado dá lugar às transições do novo status.
    focusIfLost(statusFocusTarget(to))
  } catch (e) {
    actionError.value = errorMessage(e)
    if (closeConfirm.value) closeConfirm.value = false
  } finally {
    statusBusy.value = null
  }
}

function onTransition(to: SupportState) {
  if (statusBusy.value) return
  if (to === 'closed') closeConfirm.value = true
  else void changeStatus(to)
}

// Responsável -----------------------------------------------------------------------------------
const team = ref<AdminUserRef[]>([])
const teamError = ref('')
const assignee = ref('')
const assignBusy = ref(false)
const assignSelect = ref<HTMLSelectElement | null>(null)
const assigneeUnchanged = computed(() => assignee.value === (ticket.value?.assignee?.id ?? ''))

async function loadTeam() {
  if (!canUpdate.value || !session.can('team:read')) return
  try {
    const res = await adminApi<{ items: AdminUserRef[] }>('/admin/team')
    team.value = res.items ?? []
  } catch (e) {
    teamError.value = errorMessage(e)
  }
}

const teamOptions = computed(() => {
  const list = [...team.value]
  const current = ticket.value?.assignee
  if (current && !list.some((p) => p.id === current.id)) list.unshift(current)
  return list
})

function submitAssignee() {
  if (assigneeUnchanged.value) return
  void saveAssignee(assignee.value || null)
}

async function saveAssignee(value: string | null) {
  if (assignBusy.value) return
  assignBusy.value = true
  feedback.value = ''
  actionError.value = ''
  try {
    const updated = await adminApi<AdminSupportDetail>(base.value, { method: 'PATCH', body: { assigneeId: value } })
    apply(updated, updated.assignee ? `Responsável: ${updated.assignee.displayName}.` : 'Atendimento sem responsável.')
    assignee.value = updated.assignee?.id ?? ''
    assignBusy.value = false
    await nextTick()
    // "Assumir" some quando o atendimento passa a ser seu: o foco vai para a escolha do responsável.
    focusIfLost(assignSelect.value)
  } catch (e) {
    actionError.value = errorMessage(e)
  } finally {
    assignBusy.value = false
  }
}

// Notas -------------------------------------------------------------------------------------------
const note = ref('')
const noteVisible = ref(false)
const noteBusy = ref(false)
const noteError = ref('')
const noteField = ref<HTMLTextAreaElement | null>(null)

async function addNote() {
  if (noteBusy.value) return
  noteError.value = ''
  const text = note.value.trim()
  if (!text) {
    noteError.value = 'Escreva a nota antes de registrar.'
    noteField.value?.focus()
    return
  }
  noteBusy.value = true
  feedback.value = ''
  try {
    const updated = await adminApi<AdminSupportDetail>(`${base.value}/notes`, { body: { note: text, visibleToRequester: noteVisible.value } })
    apply(updated, noteVisible.value ? 'Resposta registrada e visível ao titular no acompanhamento.' : 'Nota interna registrada.')
    note.value = ''
    noteVisible.value = false
  } catch (e) {
    noteError.value = errorMessage(e)
  } finally {
    noteBusy.value = false
  }
}

watch(
  () => ticket.value?.assignee?.id,
  (v) => (assignee.value = v ?? ''),
)

watch(id, () => {
  if (route.name !== 'admin-atendimento') return
  feedback.value = ''
  void loader.load()
})

onMounted(() => {
  void loader.load()
  void loadTeam()
})
</script>

<template>
  <div>
    <RouterLink :to="backTo" class="admin-back"><AppIcon name="arrow-left" /> Atendimentos</RouterLink>

    <AdminState :loading="loader.loading.value && !ticket" :error="loader.error.value" loading-text="Carregando atendimento…" @retry="loader.load" />

    <template v-if="ticket && !loader.error.value">
      <header class="admin-page-head">
        <div class="admin-page-head__text">
          <p class="ticket__protocol-label">Protocolo</p>
          <h1 class="admin-mono ticket__protocol">{{ ticket.protocol }}</h1>
          <p class="ticket__sub">
            <AdminStatus v-bind="statusMeta(SUPPORT_STATES, ticket.status)" />
            <span>{{ label(SUPPORT_SUBJECTS, ticket.subject) }}</span>
          </p>
        </div>
      </header>

      <p class="ticket__audit">
        <AppIcon name="eye" />
        Mensagem e contato foram abertos para esta consulta e o acesso ficou registrado na auditoria.
      </p>

      <!-- Sem role="status": a confirmação é anunciada pela região viva persistente (useAnnouncer). -->
      <p v-if="feedback" class="notice notice--success ticket__feedback">
        <AppIcon name="check-circle" />
        <span>{{ feedback }}</span>
      </p>
      <div v-if="actionError" class="notice notice--error ticket__feedback" role="alert">
        <AppIcon name="alert" />
        <p>{{ actionError }}</p>
      </div>

      <div class="admin-grid admin-grid--detail">
        <div>
          <section class="admin-panel" aria-labelledby="solicitacao-titulo">
            <h2 id="solicitacao-titulo">Solicitação</h2>
            <dl class="admin-dl">
              <dt>Nome</dt>
              <dd>{{ ticket.requesterName }}</dd>
              <dt>Retorno por</dt>
              <dd>{{ label(CONTACT_METHODS, ticket.contactMethod) }}</dd>
              <dt>Contato</dt>
              <dd><span class="admin-mono">{{ ticket.contact }}</span></dd>
              <dt>Origem</dt>
              <dd>{{ sourceLabel(ticket.source) }}</dd>
              <dt>Recebido em</dt>
              <dd>{{ formatDateTime(ticket.createdAt) }}</dd>
              <dt>Primeiro atendimento</dt>
              <dd>{{ ticket.firstResponseAt ? formatDateTime(ticket.firstResponseAt) : 'Ainda não' }}</dd>
              <dt>Encerrado em</dt>
              <dd>{{ ticket.closedAt ? formatDateTime(ticket.closedAt) : '—' }}</dd>
            </dl>
          </section>

          <section class="admin-panel" aria-labelledby="mensagem-titulo">
            <h2 id="mensagem-titulo">Mensagem</h2>
            <p class="ticket__message">{{ ticket.message }}</p>
          </section>

          <section class="admin-panel" aria-labelledby="linha-titulo">
            <div class="admin-panel__head">
              <h2 id="linha-titulo">Linha do tempo</h2>
              <p>Mais recentes primeiro</p>
            </div>
            <ol v-if="events.length" class="admin-timeline">
              <li v-for="(e, i) in events" :key="`${e.at}-${i}`">
                <span class="admin-timeline__title">
                  {{ eventTitle(e) }}
                  <span v-if="e.note" class="badge" :class="e.visibleToRequester ? '' : 'badge--outline'">
                    <AppIcon :name="e.visibleToRequester ? 'eye' : 'lock'" />
                    {{ e.visibleToRequester ? 'Visível ao titular' : 'Interna' }}
                  </span>
                </span>
                <span class="admin-timeline__meta"><time :datetime="e.at">{{ formatDateTime(e.at) }}</time> · {{ actorName(e) }}</span>
                <p v-if="e.note" class="admin-timeline__note" :class="{ 'admin-timeline__note--visible': e.visibleToRequester }">{{ e.note }}</p>
              </li>
            </ol>
            <p v-else class="muted">Nenhum evento registrado.</p>
          </section>
        </div>

        <div>
          <template v-if="canUpdate">
            <section class="admin-panel" aria-labelledby="status-titulo">
              <h2 id="status-titulo" ref="statusHeading" tabindex="-1">Status</h2>
              <p class="ticket__current">Agora: <AdminStatus v-bind="statusMeta(SUPPORT_STATES, ticket.status)" /></p>
              <div ref="transitionsEl" class="ticket__transitions">
                <button
                  v-for="to in transitions"
                  :key="to"
                  type="button"
                  class="btn btn--sm"
                  :class="to === 'in_progress' && ticket.status !== 'received' ? 'btn--secondary' : 'btn--primary'"
                  :data-to="to"
                  :aria-disabled="statusBusy ? 'true' : undefined"
                  @click="onTransition(to)"
                >
                  <span v-if="statusBusy === to" class="spinner" aria-hidden="true" />
                  {{ transitionLabel(ticket.status, to) }}
                </button>
              </div>
              <p class="field__hint ticket__flow">Fluxo: Recebido → Em andamento → Respondido → Encerrado. Respondido ou encerrado podem voltar para em andamento.</p>
            </section>

            <section class="admin-panel" aria-labelledby="responsavel-titulo">
              <h2 id="responsavel-titulo">Responsável</h2>
              <form class="form ticket__assign" novalidate @submit.prevent="submitAssignee">
                <div class="field">
                  <label class="field__label" for="atendimento-responsavel">Pessoa da equipe</label>
                  <select id="atendimento-responsavel" ref="assignSelect" v-model="assignee" class="select" :disabled="assignBusy">
                    <option value="">Sem responsável</option>
                    <option v-for="p in teamOptions" :key="p.id" :value="p.id">{{ p.displayName }}{{ p.id === me ? ' (você)' : '' }}</option>
                  </select>
                  <p v-if="teamError" class="field__hint">Não foi possível carregar a equipe: {{ teamError }}</p>
                </div>
                <div class="cluster">
                  <button type="submit" class="btn btn--primary btn--sm" :aria-disabled="assignBusy || assigneeUnchanged ? 'true' : undefined">
                    <span v-if="assignBusy" class="spinner" aria-hidden="true" />
                    {{ assignBusy ? 'Salvando…' : 'Salvar responsável' }}
                  </button>
                  <button
                    v-if="ticket.assignee?.id !== me"
                    type="button"
                    class="btn btn--ghost btn--sm"
                    :aria-disabled="assignBusy ? 'true' : undefined"
                    @click="saveAssignee(me)"
                  >
                    Assumir
                  </button>
                </div>
              </form>
            </section>

            <section class="admin-panel" aria-labelledby="nota-titulo">
              <h2 id="nota-titulo">Registrar nota</h2>
              <form class="form" novalidate @submit.prevent="addNote">
                <div class="field">
                  <label class="field__label" for="atendimento-nota">Texto</label>
                  <textarea
                    id="atendimento-nota"
                    ref="noteField"
                    v-model="note"
                    class="textarea"
                    :maxlength="NOTE_MAX"
                    aria-describedby="atendimento-nota-conta atendimento-nota-dica"
                    :aria-invalid="noteError ? 'true' : undefined"
                  />
                  <span id="atendimento-nota-conta" class="char-count">{{ note.length }}/{{ NOTE_MAX }}</span>
                  <p id="atendimento-nota-dica" class="field__hint">Não inclua CPF, senhas, dados bancários ou informações de terceiros.</p>
                </div>
                <label class="choice" for="atendimento-nota-visivel">
                  <input id="atendimento-nota-visivel" v-model="noteVisible" type="checkbox" aria-describedby="atendimento-nota-visivel-dica" />
                  <span>
                    Mostrar ao titular no acompanhamento
                    <span id="atendimento-nota-visivel-dica" class="field__hint ticket__choice-hint">
                      {{ noteVisible ? 'O titular verá este texto no link seguro de acompanhamento.' : 'Sem marcar, a nota é interna: só a equipe vê.' }}
                    </span>
                  </span>
                </label>
                <p v-if="noteError" class="field__error" role="alert"><AppIcon name="alert" />{{ noteError }}</p>
                <div>
                  <button type="submit" class="btn btn--primary btn--sm" :aria-disabled="noteBusy ? 'true' : undefined">
                    <span v-if="noteBusy" class="spinner" aria-hidden="true" />
                    {{ noteBusy ? 'Registrando…' : noteVisible ? 'Registrar resposta visível' : 'Registrar nota interna' }}
                  </button>
                </div>
              </form>
            </section>
          </template>
          <section v-else class="admin-panel" aria-labelledby="somente-leitura">
            <h2 id="somente-leitura">Somente consulta</h2>
            <p class="muted">Seu perfil pode consultar este atendimento, mas não alterar status, responsável ou notas.</p>
          </section>
        </div>
      </div>

      <ConfirmDialog
        v-model:open="closeConfirm"
        title="Encerrar este atendimento?"
        confirm-label="Encerrar atendimento"
        busy-label="Encerrando…"
        :busy="statusBusy === 'closed'"
        :error="null"
        :return-focus="() => statusFocusTarget('closed')"
        @confirm="changeStatus('closed')"
      >
        <p>
          Confirme que a resposta ao titular foi dada. O atendimento sai da fila ativa, mas pode ser reaberto depois se
          houver retorno.
        </p>
      </ConfirmDialog>
    </template>
  </div>
</template>

<style scoped>
.ticket__protocol-label {
  margin: 0 !important;
  font-size: 0.8125rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.ticket__protocol {
  font-size: clamp(22px, 1vw + 16px, 28px) !important;
  font-weight: 600;
  letter-spacing: 0.02em !important;
}

.ticket__sub {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  color: var(--mf-ink) !important;
  font-weight: 500;
}

.ticket__audit {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: calc(-1 * var(--mf-space-2)) 0 var(--mf-space-4);
  font-size: 0.875rem;
  color: var(--mf-muted);
}

.ticket__audit .icon {
  flex: none;
  width: 18px;
  height: 18px;
  margin-top: 1px;
}

.ticket__feedback {
  margin-bottom: var(--mf-space-4);
  align-items: center;
}

.ticket__message {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 1rem;
  line-height: 1.6;
}

#status-titulo:focus {
  outline: none;
}

#status-titulo:focus-visible {
  outline: 3px solid var(--mf-focus);
  outline-offset: 2px;
}

.ticket__current {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: var(--mf-space-3);
  font-size: 0.9375rem;
}

.ticket__transitions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.ticket__flow {
  margin-top: var(--mf-space-3);
}

.ticket__assign {
  gap: var(--mf-space-3);
}

.ticket__choice-hint {
  display: block;
  margin-top: 2px;
}

.badge {
  font-size: 0.75rem;
  padding: 1px 8px;
}

.badge .icon {
  width: 14px;
  height: 14px;
}
</style>
