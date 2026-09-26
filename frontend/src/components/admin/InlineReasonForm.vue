<script setup lang="ts">
/**
 * Justificativa obrigatória na própria tela (sem diálogo modal) para ações auditadas: aplicar ou descartar
 * uma submissão em revisão, pausar ou reabrir o formulário de cadastro do site. Regras do contrato: 5 a
 * 200 caracteres.
 * Foco: ao aparecer, vai para o campo; ao cancelar ou concluir, quem usa devolve o foco ao botão de origem
 * (ou ao título da seção, quando o botão sumiu). Durante o envio os botões ficam com aria-disabled (e não
 * `disabled`), para o foco não cair no <body>. Esc cancela quando nada está em envio.
 * `error`: mensagem do servidor, logo acima dos botões (role="alert"). `fieldError`: erro do servidor para a
 * justificativa (validation_error com fields.reason), mostrado no campo, que recebe o foco.
 */
import { computed, nextTick, onMounted, ref, useId, watch } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'

const REASON_MIN = 5
const REASON_MAX = 200

const props = withDefaults(
  defineProps<{
    title: string
    confirmLabel: string
    busyLabel?: string
    busy?: boolean
    error?: string | null
    fieldError?: string | null
    hint?: string
    /** Botão de confirmação no tom de alerta (ações que interrompem algo). */
    danger?: boolean
  }>(),
  {
    busyLabel: 'Registrando…',
    busy: false,
    error: null,
    fieldError: null,
    hint: 'Explique o motivo. Fica na auditoria com seu usuário e o horário. Não inclua dados pessoais.',
    danger: false,
  },
)
const emit = defineEmits<{ (e: 'submit', reason: string): void; (e: 'cancel'): void }>()

const uid = useId()
const reason = ref('')
const touched = ref(false)
const serverFieldError = ref<string | null>(props.fieldError)
const field = ref<HTMLTextAreaElement | null>(null)
const trimmed = computed(() => reason.value.trim())
const invalid = computed(() => trimmed.value.length < REASON_MIN)
const fieldMessage = computed(
  () => (touched.value && invalid.value ? `Escreva a justificativa com pelo menos ${REASON_MIN} caracteres.` : '') || serverFieldError.value || '',
)

function focus() {
  field.value?.focus()
}

// Não acusa erro em campo vazio só por perder o foco (sem punir digitação incompleta).
function onBlur() {
  if (trimmed.value.length > 0) touched.value = true
}

async function submit() {
  touched.value = true
  if (props.busy) return
  if (invalid.value) {
    await nextTick()
    focus()
    return
  }
  emit('submit', trimmed.value)
}

function cancel() {
  if (!props.busy) emit('cancel')
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  event.preventDefault()
  cancel()
}

watch(
  () => props.fieldError,
  async (message) => {
    serverFieldError.value = message
    if (!message) return
    await nextTick()
    focus()
  },
)

onMounted(focus)
defineExpose({ focus })
</script>

<template>
  <form class="inline-reason" :aria-labelledby="`${uid}-titulo`" novalidate @submit.prevent="submit" @keydown="onKeydown">
    <p :id="`${uid}-titulo`" class="inline-reason__title">{{ title }}</p>
    <slot />
    <div class="field">
      <label class="field__label" :for="`${uid}-motivo`">Justificativa</label>
      <p :id="`${uid}-dica`" class="field__hint">{{ hint }}</p>
      <textarea
        :id="`${uid}-motivo`"
        ref="field"
        v-model="reason"
        class="textarea inline-reason__text"
        :maxlength="REASON_MAX"
        :aria-invalid="fieldMessage ? 'true' : undefined"
        :aria-describedby="`${uid}-dica ${uid}-conta${fieldMessage ? ` ${uid}-erro` : ''}`"
        required
        @blur="onBlur"
        @input="serverFieldError = null"
      />
      <span :id="`${uid}-conta`" class="char-count">{{ reason.length }}/{{ REASON_MAX }}</span>
      <p v-if="fieldMessage" :id="`${uid}-erro`" class="field__error"><AppIcon name="alert" />{{ fieldMessage }}</p>
    </div>
    <div v-if="error" class="notice notice--error" role="alert">
      <AppIcon name="alert" />
      <p>{{ error }}</p>
    </div>
    <div class="cluster">
      <!-- aria-disabled (e não disabled) durante o envio: o foco continua no botão acionado. -->
      <button type="submit" class="btn btn--sm" :class="danger ? 'btn--danger' : 'btn--primary'" :aria-disabled="busy ? 'true' : undefined">
        <span v-if="busy" class="spinner" aria-hidden="true" />
        {{ busy ? busyLabel : confirmLabel }}
      </button>
      <button type="button" class="btn btn--secondary btn--sm" :aria-disabled="busy ? 'true' : undefined" @click="cancel">Cancelar</button>
    </div>
  </form>
</template>

<style scoped>
.inline-reason {
  display: grid;
  gap: var(--mf-space-3);
  margin-top: var(--mf-space-3);
  padding: var(--mf-space-3);
  border: 1px solid var(--mf-border);
  border-radius: 12px;
  background: var(--mf-cream);
}

.inline-reason :deep(p) {
  margin: 0;
}

.inline-reason__title {
  font-weight: 700;
}

.admin-app .inline-reason__text {
  min-height: 88px;
}
</style>
