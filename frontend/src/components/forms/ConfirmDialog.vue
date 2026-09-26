<script setup lang="ts">
import { ref, useId } from 'vue'

/**
 * Diálogo de confirmação acessível sobre o <dialog> nativo (showModal): foco preso no diálogo,
 * fundo inerte, Esc cancela e o foco volta ao elemento que abriu. O foco inicial fica em "Cancelar"
 * porque a ação confirmada não tem volta pelo site.
 */
const props = defineProps<{ title: string; text: string; confirmLabel: string; cancelLabel: string; busy?: boolean; busyLabel?: string }>()
const emit = defineEmits<{ confirm: [] }>()

const uid = useId()
const dialog = ref<HTMLDialogElement | null>(null)
const cancelButton = ref<HTMLButtonElement | null>(null)
let opener: HTMLElement | null = null

function open() {
  const el = dialog.value
  if (!el || el.open) return
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
  el.showModal()
  cancelButton.value?.focus()
}

function close() {
  dialog.value?.close()
}

function onClose() {
  const back = opener
  opener = null
  // A tela já levou o foco a outro ponto (ex.: a confirmação da ação, quando o botão de origem some):
  // respeita. Senão, devolve o foco ao ponto de origem, se ele ainda existir na página.
  const active = document.activeElement
  if (active && active !== document.body && active.isConnected && !dialog.value?.contains(active)) return
  if (back?.isConnected) back.focus()
}

function onCancel(event: Event) {
  if (props.busy) event.preventDefault()
}

function onConfirm() {
  if (!props.busy) emit('confirm')
}

defineExpose({ open, close })
</script>

<template>
  <dialog
    ref="dialog"
    class="confirm-dialog"
    :aria-labelledby="`${uid}-titulo`"
    :aria-describedby="`${uid}-texto`"
    @close="onClose"
    @cancel="onCancel"
  >
    <h2 :id="`${uid}-titulo`" class="confirm-dialog__title">{{ title }}</h2>
    <p :id="`${uid}-texto`">{{ text }}</p>
    <slot />
    <div class="confirm-dialog__actions">
      <button ref="cancelButton" type="button" class="btn btn--secondary" :aria-disabled="busy ? 'true' : 'false'" @click="!busy && close()">
        {{ cancelLabel }}
      </button>
      <button type="button" class="btn btn--primary confirm-dialog__confirm" :aria-disabled="busy ? 'true' : 'false'" @click="onConfirm">
        <span v-if="busy" class="spinner" aria-hidden="true" />
        {{ busy && busyLabel ? busyLabel : confirmLabel }}
      </button>
    </div>
  </dialog>
</template>

<style scoped>
.confirm-dialog {
  width: min(520px, calc(100vw - 32px));
  max-height: calc(100vh - 32px);
  padding: var(--mf-space-5);
  border: 0;
  border-radius: var(--mf-radius-card);
  background: var(--mf-paper);
  color: var(--mf-ink);
  box-shadow: 0 24px 80px rgb(18 63 53 / 28%);
}

.confirm-dialog::backdrop {
  background: rgb(23 46 40 / 55%);
}

.confirm-dialog__title {
  font-size: clamp(1.375rem, 1vw + 1rem, 1.75rem);
  margin-bottom: var(--mf-space-2);
}

.confirm-dialog__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 12px;
  margin-top: var(--mf-space-4);
}

.confirm-dialog__confirm {
  background: var(--mf-error);
}

.confirm-dialog__confirm:hover {
  background: #7f241d;
}

@media (max-width: 479px) {
  .confirm-dialog {
    padding: var(--mf-space-4);
  }
  .confirm-dialog__actions .btn {
    width: 100%;
  }
}

@media (prefers-reduced-motion: no-preference) {
  .confirm-dialog[open] {
    animation: mf-dialog-in var(--mf-duration) var(--mf-ease);
  }
}

@keyframes mf-dialog-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}
</style>
