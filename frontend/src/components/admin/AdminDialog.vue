<script setup lang="ts">
/**
 * Diálogo modal acessível sobre <dialog> nativo (showModal): fundo inerte, Esc para fechar,
 * foco levado ao primeiro campo (ou [data-autofocus]) e devolvido ao elemento de origem.
 * Enquanto `busy`, não fecha (evita perder uma ação em andamento); os botões de quem usa o diálogo
 * ficam com aria-disabled (e não `disabled`) para o foco não cair no <body> durante o envio.
 * `error`: mensagem do servidor, mostrada no fim do diálogo e focada ao aparecer (o foco continua
 * dentro do diálogo). `returnFocus`: alvo do foco ao fechar quando o elemento de origem saiu da
 * página ou ficou desabilitado (ex.: o botão acionado deu lugar ao resultado da ação); sem ele, o
 * foco vai para o conteúdo principal do painel. Se a tela já levou o foco a outro ponto, respeita.
 */
import { nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { focusIsLost } from '@/components/forms/form-helpers'

const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    eyebrow?: string
    busy?: boolean
    wide?: boolean
    error?: string | null
    returnFocus?: () => HTMLElement | null | undefined
  }>(),
  {
    eyebrow: undefined,
    busy: false,
    wide: false,
    error: null,
    returnFocus: undefined,
  },
)
const emit = defineEmits<{ (e: 'update:open', value: boolean): void; (e: 'closed'): void }>()

const el = ref<HTMLDialogElement | null>(null)
const body = ref<HTMLElement | null>(null)
const errorEl = ref<HTMLElement | null>(null)
const uid = useId()
const titleId = `${uid}-titulo`
let opener: HTMLElement | null = null

const FOCUSABLE = 'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href]'

async function show() {
  const dialog = el.value
  if (!dialog || dialog.open) return
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
  dialog.showModal()
  await nextTick()
  const target =
    body.value?.querySelector<HTMLElement>('[data-autofocus]') ?? body.value?.querySelector<HTMLElement>(FOCUSABLE)
  target?.focus()
}

function hide() {
  const dialog = el.value
  if (dialog?.open) dialog.close()
}

function requestClose() {
  if (props.busy) return
  emit('update:open', false)
}

function onCancel(event: Event) {
  // Esc: fecha pelo estado do componente (e não sozinho), respeitando `busy`.
  event.preventDefault()
  requestClose()
}

/** Elemento que ainda pode receber o foco: na página, visível e não desabilitado. */
function usable(target: HTMLElement | null | undefined): target is HTMLElement {
  return Boolean(target && target.isConnected && !target.matches(':disabled') && target.getClientRects().length > 0)
}

function onClose() {
  emit('closed')
  if (props.open) emit('update:open', false)
  const back = opener
  opener = null
  // A tela já levou o foco ao resultado da ação: respeita.
  if (!focusIsLost() && !el.value?.contains(document.activeElement)) return
  const fallback = props.returnFocus?.()
  const target = usable(back) ? back : usable(fallback) ? fallback : document.getElementById('conteudo-admin')
  target?.focus()
}

watch(
  () => props.open,
  (open) => (open ? void show() : hide()),
  { flush: 'post' },
)

// Erro do servidor com o diálogo aberto: o foco vai para a mensagem (continua dentro do diálogo).
watch(
  () => props.error,
  async (error) => {
    if (!error || !el.value?.open) return
    await nextTick()
    errorEl.value?.focus()
  },
)

onMounted(() => {
  if (props.open) void show()
})
onBeforeUnmount(() => hide())
</script>

<template>
  <dialog
    ref="el"
    class="admin-dialog"
    :class="{ 'admin-dialog--wide': wide }"
    :aria-labelledby="titleId"
    @cancel="onCancel"
    @close="onClose"
  >
    <div class="admin-dialog__inner">
      <div class="admin-dialog__head">
        <div>
          <p v-if="eyebrow" class="eyebrow">{{ eyebrow }}</p>
          <h2 :id="titleId">{{ title }}</h2>
        </div>
        <button type="button" class="admin-dialog__close" :aria-disabled="busy ? 'true' : undefined" @click="requestClose">
          <AppIcon name="close" />
          <span class="visually-hidden">Fechar</span>
        </button>
      </div>
      <div ref="body" class="admin-dialog__body">
        <slot />
        <div v-if="error" ref="errorEl" class="notice notice--error admin-dialog__error" role="alert" tabindex="-1">
          <AppIcon name="alert" />
          <p>{{ error }}</p>
        </div>
      </div>
      <div v-if="$slots.actions" class="admin-dialog__actions">
        <slot name="actions" />
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.admin-dialog--wide {
  width: min(680px, calc(100vw - 32px));
}

.admin-dialog__body {
  display: grid;
  gap: var(--mf-space-3);
}

.admin-dialog__body :deep(p) {
  margin: 0;
}

.eyebrow {
  margin: 0;
  font-size: 0.8125rem;
}

.admin-dialog__error:focus {
  outline: 3px solid var(--mf-focus);
  outline-offset: 2px;
}

.admin-dialog__close[aria-disabled='true'] {
  cursor: not-allowed;
  opacity: 0.6;
}
</style>
