<script setup lang="ts">
import { computed, ref } from 'vue'
import BiaChatDemo from '@/components/bia/BiaChatDemo.vue'
import { trackOnce } from '@/services/analytics'
import { site } from '@/services/site'
import type { ChatMessage } from '@/types/content'

/** Três abas educativas (seção 6.4). Padrão ARIA de abas: setas, Home/End, ativação manual por foco. */
const props = withDefaults(defineProps<{ idPrefix?: string }>(), { idPrefix: 'bia-exemplo' })
const examples = site.biaExamples as { id: string; tab: string; messages: ChatMessage[] }[]
const active = ref(0)
const tabs = ref<HTMLButtonElement[]>([])
const current = computed(() => examples[active.value]!)

function select(i: number, focus = false) {
  const next = (i + examples.length) % examples.length
  // Medição agregada (só com consentimento): o id fixo do exemplo escolhido, nunca texto da conversa.
  if (next !== active.value) trackOnce('bia_demo_tab', examples[next]!.id)
  active.value = next
  if (focus) tabs.value[active.value]?.focus()
}

function onKeydown(e: KeyboardEvent, i: number) {
  const map: Record<string, number> = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: examples.length - 1 }
  if (e.key in map) {
    e.preventDefault()
    select(map[e.key]!, true)
  }
}
</script>

<template>
  <div class="tabs">
    <div class="tabs__list" role="tablist" aria-label="Exemplos de uso da Bia">
      <button
        v-for="(ex, i) in examples"
        :id="`${props.idPrefix}-tab-${ex.id}`"
        :key="ex.id"
        ref="tabs"
        type="button"
        role="tab"
        class="tabs__tab"
        :aria-selected="i === active ? 'true' : 'false'"
        :aria-controls="`${props.idPrefix}-painel`"
        :tabindex="i === active ? 0 : -1"
        @click="select(i)"
        @keydown="onKeydown($event, i)"
      >
        {{ ex.tab }}
      </button>
    </div>
    <div :id="`${props.idPrefix}-painel`" role="tabpanel" :aria-labelledby="`${props.idPrefix}-tab-${current.id}`" tabindex="0">
      <BiaChatDemo :key="current.id" :messages="current.messages" :note="site.biaExamplesNote" />
    </div>
  </div>
</template>
