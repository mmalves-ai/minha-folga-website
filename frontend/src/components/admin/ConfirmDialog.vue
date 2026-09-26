<script setup lang="ts">
/**
 * Confirmação explícita de ação sensível. Com `acknowledge`, o botão só habilita depois de a
 * pessoa marcar a caixa (ex.: anonimização irreversível). Erros do servidor aparecem no diálogo.
 */
import { ref, useId, watch } from 'vue'
import AdminDialog from './AdminDialog.vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    confirmLabel: string
    busyLabel?: string
    danger?: boolean
    acknowledge?: string
    busy?: boolean
    error?: string | null
    /** Alvo do foco ao fechar quando o botão que abriu o diálogo sumiu (ver AdminDialog). */
    returnFocus?: () => HTMLElement | null | undefined
  }>(),
  { busyLabel: 'Salvando…', danger: false, acknowledge: undefined, busy: false, error: null, returnFocus: undefined },
)
const emit = defineEmits<{ (e: 'update:open', value: boolean): void; (e: 'confirm'): void }>()

const uid = useId()
const checked = ref(false)

watch(
  () => props.open,
  (open) => {
    if (open) checked.value = false
  },
)

function confirm() {
  if (props.busy) return
  if (props.acknowledge && !checked.value) return
  emit('confirm')
}
</script>

<template>
  <AdminDialog :open="open" :title="title" :busy="busy" :error="error" :return-focus="returnFocus" @update:open="emit('update:open', $event)">
    <slot />
    <label v-if="acknowledge" class="choice" :for="`${uid}-ack`">
      <input :id="`${uid}-ack`" v-model="checked" type="checkbox" data-autofocus />
      <span>{{ acknowledge }}</span>
    </label>
    <template #actions>
      <!-- aria-disabled (e não disabled) durante o envio: o foco continua no botão acionado. -->
      <button type="button" class="btn btn--secondary" :aria-disabled="busy ? 'true' : undefined" @click="!busy && emit('update:open', false)">
        Cancelar
      </button>
      <button
        type="button"
        class="btn"
        :class="danger ? 'btn--danger' : 'btn--primary'"
        :disabled="!busy && Boolean(acknowledge) && !checked"
        :aria-disabled="busy ? 'true' : undefined"
        :aria-describedby="acknowledge && !checked ? `${uid}-need` : undefined"
        @click="confirm"
      >
        <span v-if="busy" class="spinner" aria-hidden="true" />
        {{ busy ? busyLabel : confirmLabel }}
      </button>
      <span v-if="acknowledge && !checked" :id="`${uid}-need`" class="visually-hidden">Marque a confirmação para habilitar.</span>
    </template>
  </AdminDialog>
</template>
