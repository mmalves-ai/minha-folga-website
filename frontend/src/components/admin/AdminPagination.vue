<script setup lang="ts">
/**
 * Paginação simples com contagem em texto. Emite a nova página; a tela decide como carregar.
 * Os botões usam aria-disabled (e não `disabled`) durante o carregamento e no limite da lista: o
 * foco continua no botão acionado em vez de cair no <body> (ex.: "Próxima" ao chegar à última página).
 */
import { computed } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'

const props = defineProps<{ page: number; pageSize: number; total: number; label: string; disabled?: boolean }>()
const emit = defineEmits<{ (e: 'change', page: number): void }>()

const pages = computed(() => Math.max(1, Math.ceil(props.total / Math.max(1, props.pageSize))))
const first = computed(() => (props.total === 0 ? 0 : (props.page - 1) * props.pageSize + 1))
const last = computed(() => Math.min(props.total, props.page * props.pageSize))
const nf = new Intl.NumberFormat('pt-BR')
const canPrev = computed(() => !props.disabled && props.page > 1)
const canNext = computed(() => !props.disabled && props.page < pages.value)

function go(target: number, allowed: boolean) {
  if (allowed) emit('change', target)
}
</script>

<template>
  <nav class="admin-pagination" :aria-label="`Paginação de ${label}`">
    <p class="admin-pagination__summary">
      {{ total === 0 ? 'Nenhum resultado' : `${nf.format(first)}–${nf.format(last)} de ${nf.format(total)}` }}
      <span v-if="pages > 1"> · página {{ page }} de {{ pages }}</span>
    </p>
    <div v-if="pages > 1" class="admin-pagination__buttons">
      <button type="button" class="btn btn--secondary btn--sm" :aria-disabled="canPrev ? undefined : 'true'" @click="go(page - 1, canPrev)">
        <AppIcon name="arrow-left" />
        Anterior
      </button>
      <button type="button" class="btn btn--secondary btn--sm" :aria-disabled="canNext ? undefined : 'true'" @click="go(page + 1, canNext)">
        Próxima
        <AppIcon name="arrow-right" />
      </button>
    </div>
  </nav>
</template>
