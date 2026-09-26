<script setup lang="ts">
/**
 * Interruptor do formulário de cadastro do site (collection:manage, só o papel admin), no início do Painel.
 * Mostra o estado (aberto, pausado pelo painel ou fechado pela configuração do servidor, com os motivos), quem
 * mudou por último e quando, e pausa ou reabre com justificativa auditada (InlineReasonForm, na própria tela).
 * Fechado pelo servidor (`WAITLIST_FORM_ENABLED=false`), o painel não reabre: não há botão de reabrir.
 * Sem a permissão, não renderiza nada nem consulta a API.
 * Foco: cancelar devolve o foco ao botão; concluir anuncia o resultado pela região viva persistente e leva o
 * foco ao título do cartão (o botão trocou de ação).
 */
import { computed, nextTick, onMounted, ref } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AdminState from './AdminState.vue'
import AdminStatus from './AdminStatus.vue'
import InlineReasonForm from './InlineReasonForm.vue'
import { COLLECTION_REASONS, label, type StatusTone } from './labels'
import type { AdminCollection, WaitlistFormSwitch } from './types'
import { focusIfLost } from '@/components/forms/form-helpers'
import { formatDateTime } from '@/lib/format'
import { ApiError } from '@/services/api'
import { useAnnouncer } from '@/composables/useAnnouncer'
import { adminApi, errorMessage, useAdminSession } from '@/composables/useAdminSession'
import { useAdminLoader } from '@/composables/useAdminLoader'

type Action = 'pause' | 'resume'

const session = useAdminSession()
const { announce } = useAnnouncer()
const allowed = computed(() => session.can('collection:manage'))

const loader = useAdminLoader(() => adminApi<AdminCollection>('/admin/collection'))
const form = computed<WaitlistFormSwitch | null>(() => loader.data.value?.waitlistForm ?? null)

/** Fechado por configuração do servidor (variável de ambiente ou outro motivo), independente do painel. */
const closedByServer = computed(() => Boolean(form.value && !form.value.open && (form.value.lockedByEnvironment || form.value.reasons.length)))

const status = computed<{ label: string; tone: StatusTone } | null>(() => {
  const f = form.value
  if (!f) return null
  if (f.open) return { label: 'Aberto', tone: 'success' }
  if (closedByServer.value) return { label: 'Fechado pela configuração do servidor', tone: 'danger' }
  if (f.paused) return { label: 'Pausado pelo painel', tone: 'pending' }
  return { label: 'Fechado', tone: 'muted' }
})

const serverReasons = computed(() => {
  const f = form.value
  if (!f) return []
  const list: string[] = []
  if (f.lockedByEnvironment) list.push('Formulário do site desligado no servidor (WAITLIST_FORM_ENABLED=false).')
  for (const r of f.reasons) list.push(label(COLLECTION_REASONS, r))
  return list
})

const summary = computed(() => {
  const f = form.value
  if (!f) return ''
  if (f.open) return 'O formulário do site está aceitando cadastros.'
  if (closedByServer.value) {
    const also = f.paused ? ' Ele também está pausado pelo painel.' : ''
    return f.lockedByEnvironment
      ? `O formulário foi fechado na configuração do servidor e o painel não consegue reabri-lo: a mudança é feita no servidor, com reinício da API.${also}`
      : `O cadastro está fechado por configuração do servidor.${also}`
  }
  if (f.paused) return 'O formulário está pausado pelo painel: o site mostra a mensagem de cadastro indisponível.'
  return 'O formulário do site não está aceitando cadastros.'
})

const changed = computed(() => {
  const f = form.value
  if (!f?.changedAt) return 'Nenhuma mudança registrada pelo painel.'
  return `Última mudança pelo painel em ${formatDateTime(f.changedAt)}${f.changedBy ? `, por ${f.changedBy}` : ''}.`
})

/** Próxima ação possível: pausar (se não está pausado) ou reabrir (se o servidor não trava o formulário). */
const action = computed<Action | null>(() => {
  const f = form.value
  if (!f) return null
  if (!f.paused) return 'pause'
  return f.lockedByEnvironment ? null : 'resume'
})

const COPY: Record<Action, { button: string; title: string; confirm: string; busy: string; text: string }> = {
  pause: {
    button: 'Pausar formulário',
    title: 'Pausar o formulário de cadastro do site',
    confirm: 'Confirmar pausa',
    busy: 'Pausando…',
    text: 'Novos cadastros pelo formulário do site serão recusados até alguém reabrir. A Bia e o pedido de saída continuam funcionando.',
  },
  resume: {
    button: 'Reabrir formulário',
    title: 'Reabrir o formulário de cadastro do site',
    confirm: 'Confirmar reabertura',
    busy: 'Reabrindo…',
    text: 'O formulário do site volta a aceitar cadastros em até 30 segundos.',
  },
}

const confirming = ref(false)
const busy = ref(false)
const error = ref<string | null>(null)
const fieldError = ref<string | null>(null)
const feedback = ref('')
const heading = ref<HTMLElement | null>(null)
const actionButton = ref<HTMLButtonElement | null>(null)

function open() {
  if (busy.value) return
  confirming.value = true
  error.value = null
  fieldError.value = null
  feedback.value = ''
}

async function cancel() {
  if (busy.value) return
  confirming.value = false
  await nextTick()
  ;(actionButton.value ?? heading.value)?.focus()
}

function resultMessage(paused: boolean, result: WaitlistFormSwitch): string {
  if (paused) return 'Formulário de cadastro pausado. O site passa a mostrar a mensagem de cadastro indisponível em até 30 segundos.'
  if (result.open) return 'Formulário de cadastro reaberto. O site volta a aceitar cadastros em até 30 segundos.'
  return 'Pausa do painel removida, mas o formulário continua fechado pela configuração do servidor.'
}

async function save(reason: string) {
  const current = action.value
  if (!current || busy.value) return
  const paused = current === 'pause'
  busy.value = true
  error.value = null
  fieldError.value = null
  try {
    const result = await adminApi<AdminCollection>('/admin/collection/waitlist-form', { method: 'PUT', body: { paused, reason } })
    loader.data.value = result
    confirming.value = false
    const message = resultMessage(paused, result.waitlistForm)
    feedback.value = message
    announce(message)
    busy.value = false
    await nextTick()
    // O botão de origem deu lugar ao da ação oposta: o foco vai para o título do cartão.
    focusIfLost(heading.value)
  } catch (e) {
    if (e instanceof ApiError && e.code === 'validation_error' && e.fields.reason) fieldError.value = e.fields.reason
    else error.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}

onMounted(() => {
  if (allowed.value) void loader.load()
})
</script>

<template>
  <section v-if="allowed" class="admin-panel wf-card" aria-labelledby="formulario-site-titulo">
    <div class="admin-panel__head">
      <h2 id="formulario-site-titulo" ref="heading" tabindex="-1">Formulário de cadastro do site</h2>
      <AdminStatus v-if="status && !loader.error.value" v-bind="status" />
    </div>

    <AdminState :loading="loader.loading.value && !form" :error="loader.error.value" loading-text="Consultando o formulário…" @retry="loader.load" />

    <template v-if="form && !loader.error.value">
      <p class="wf-card__summary">{{ summary }}</p>
      <ul v-if="!form.open && serverReasons.length" class="wf-card__reasons">
        <li v-for="r in serverReasons" :key="r"><AppIcon name="alert" /> <span>{{ r }}</span></li>
      </ul>
      <p class="wf-card__changed">{{ changed }}</p>
      <p class="field__hint wf-card__help">
        Use em caso de ataque de robôs ou volume anormal. A Bia continua cadastrando pelo WhatsApp (telefone validado) e o pedido de
        saída continua disponível. O site passa a mostrar a mensagem de cadastro indisponível em até 30 segundos.
      </p>

      <!-- Sem role="status": a confirmação é anunciada pela região viva persistente (useAnnouncer). -->
      <p v-if="feedback" class="notice notice--success wf-card__feedback">
        <AppIcon name="check-circle" />
        <span>{{ feedback }}</span>
      </p>

      <InlineReasonForm
        v-if="confirming && action"
        :key="action"
        :title="COPY[action].title"
        :confirm-label="COPY[action].confirm"
        :busy-label="COPY[action].busy"
        :busy="busy"
        :error="error"
        :field-error="fieldError"
        :danger="action === 'pause'"
        @submit="save"
        @cancel="cancel"
      >
        <p>{{ COPY[action].text }}</p>
        <p v-if="action === 'resume' && form.reasons.length">
          Mesmo reaberto pelo painel, o cadastro continua fechado enquanto houver os motivos de configuração acima.
        </p>
      </InlineReasonForm>
      <div v-else-if="action" class="cluster">
        <button
          ref="actionButton"
          type="button"
          class="btn btn--sm"
          :class="action === 'pause' ? 'btn--secondary' : 'btn--primary'"
          :data-action="action"
          @click="open"
        >
          <AppIcon :name="action === 'pause' ? 'lock' : 'check-circle'" />
          {{ COPY[action].button }}
        </button>
      </div>
      <p v-else class="field__hint wf-card__locked">
        <AppIcon name="lock" />
        <span>Reabrir não é possível pelo painel enquanto o servidor mantiver o formulário fechado.</span>
      </p>
    </template>
  </section>
</template>

<style scoped>
.wf-card > p,
.wf-card__reasons {
  margin: 0;
}

.wf-card > * + * {
  margin-top: 10px;
}

.wf-card > .admin-panel__head {
  margin-bottom: 0;
}

.wf-card__summary {
  font-size: 1rem;
  font-weight: 600;
}

.wf-card__reasons {
  display: grid;
  gap: 6px;
  padding: 0;
  list-style: none;
  font-size: 0.9375rem;
}

.wf-card__reasons li {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  margin: 0;
}

.wf-card__reasons .icon,
.wf-card__locked .icon {
  flex: none;
  width: 18px;
  height: 18px;
  margin-top: 2px;
}

.wf-card__reasons .icon {
  color: var(--mf-error);
}

.wf-card__changed {
  font-size: 0.875rem;
  color: var(--mf-muted);
}

.wf-card__feedback {
  align-items: center;
}

.wf-card__locked {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

#formulario-site-titulo:focus {
  outline: none;
}

#formulario-site-titulo:focus-visible {
  outline: 3px solid var(--mf-focus);
  outline-offset: 2px;
}
</style>
