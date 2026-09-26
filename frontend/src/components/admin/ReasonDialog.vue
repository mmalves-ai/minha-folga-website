<script setup lang="ts">
/**
 * Pede a justificativa de um acesso sensível (revelar contato, exportar) e avisa que a ação
 * fica registrada na auditoria. Regras do contrato: 5 a 200 caracteres.
 */
import { computed, nextTick, ref, useId, watch } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AdminDialog from './AdminDialog.vue'

const REASON_MIN = 5
const REASON_MAX = 200

const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    confirmLabel: string
    busyLabel?: string
    busy?: boolean
    error?: string | null
    /** Alvo do foco ao fechar quando o botão que abriu o diálogo sumiu (ver AdminDialog). */
    returnFocus?: () => HTMLElement | null | undefined
  }>(),
  { busyLabel: 'Registrando…', busy: false, error: null, returnFocus: undefined },
)
const emit = defineEmits<{ (e: 'update:open', value: boolean): void; (e: 'submit', reason: string): void }>()

const uid = useId()
const reason = ref('')
const touched = ref(false)
const field = ref<HTMLTextAreaElement | null>(null)
const trimmed = computed(() => reason.value.trim())
const invalid = computed(() => trimmed.value.length < REASON_MIN)
const fieldError = computed(() => (touched.value && invalid.value ? `Escreva a justificativa com pelo menos ${REASON_MIN} caracteres.` : ''))

watch(
  () => props.open,
  (open) => {
    if (open) {
      reason.value = ''
      touched.value = false
    }
  },
)

// Não acusa erro em campo vazio só por perder o foco (sem punir digitação incompleta).
function onBlur() {
  if (trimmed.value.length > 0) touched.value = true
}

async function submit() {
  touched.value = true
  if (props.busy) return
  if (invalid.value) {
    await nextTick()
    field.value?.focus()
    return
  }
  emit('submit', trimmed.value)
}
</script>

<template>
  <AdminDialog
    :open="open"
    :title="title"
    eyebrow="Acesso auditado"
    :busy="busy"
    :error="error"
    :return-focus="returnFocus"
    @update:open="emit('update:open', $event)"
  >
    <slot />
    <div class="notice notice--pending">
      <AppIcon name="eye" />
      <p>Este acesso fica registrado na auditoria com seu usuário, o horário e a justificativa informada.</p>
    </div>
    <form :id="`${uid}-form`" class="form" novalidate @submit.prevent="submit">
      <div class="field">
        <label class="field__label" :for="`${uid}-motivo`">Justificativa</label>
        <p :id="`${uid}-dica`" class="field__hint">Explique por que o acesso é necessário. Não inclua dados pessoais.</p>
        <textarea
          :id="`${uid}-motivo`"
          ref="field"
          v-model="reason"
          class="textarea reason__text"
          :maxlength="REASON_MAX"
          :aria-invalid="fieldError ? 'true' : undefined"
          :aria-describedby="`${uid}-dica ${uid}-conta${fieldError ? ` ${uid}-erro` : ''}`"
          required
          data-autofocus
          @blur="onBlur"
        />
        <span :id="`${uid}-conta`" class="char-count">{{ reason.length }}/{{ REASON_MAX }}</span>
        <p v-if="fieldError" :id="`${uid}-erro`" class="field__error"><AppIcon name="alert" />{{ fieldError }}</p>
      </div>
    </form>
    <template #actions>
      <!-- aria-disabled (e não disabled) durante o envio: o foco continua no botão acionado. -->
      <button type="button" class="btn btn--secondary" :aria-disabled="busy ? 'true' : undefined" @click="!busy && emit('update:open', false)">
        Cancelar
      </button>
      <button type="submit" class="btn btn--primary" :form="`${uid}-form`" :aria-disabled="busy ? 'true' : undefined">
        <span v-if="busy" class="spinner" aria-hidden="true" />
        {{ busy ? busyLabel : confirmLabel }}
      </button>
    </template>
  </AdminDialog>
</template>

<style scoped>
.reason__text {
  min-height: 96px;
}
</style>
