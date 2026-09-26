<script setup lang="ts">
import copy from '@content/pages/formularios.yaml'
import AppIcon from '@/components/ui/AppIcon.vue'
import { officialWhatsappLink, openWebchat, webchatAvailable } from '@/composables/useBiaChannels'

/**
 * Ações para falar com a Bia, na ordem da decisão D1: chat do site (preferencial) e WhatsApp oficial
 * (última alternativa). Só aparece o que está configurado; sem nenhum canal, leva à página da Bia.
 * `whatsappOnly`: quando só o WhatsApp resolve (validar o telefone, pedir o link de preferências).
 * Com algum canal, o contêiner leva `data-inline-contact` (channels.ts): enquanto está na tela, o botão
 * flutuante se recolhe. Em `bare` (sem caixa própria), quem usa marca o próprio grupo de ações.
 */
const props = withDefaults(
  defineProps<{
    tone?: 'default' | 'light'
    whatsappOnly?: boolean
    whatsappText?: string
    showFallback?: boolean
    /** Sem contêiner próprio: os botões entram no grupo de ações de quem usa. */
    bare?: boolean
  }>(),
  { tone: 'default', whatsappOnly: false, whatsappText: undefined, showFallback: true, bare: false },
)

const t = copy.bia
const webchat = webchatAvailable && !props.whatsappOnly
const whatsapp = officialWhatsappLink(props.whatsappText ?? t.whatsappText)
const primary = props.tone === 'light' ? 'btn btn--light' : 'btn btn--primary'
const secondary = props.tone === 'light' ? 'btn btn--outline-light' : 'btn btn--secondary'

</script>

<template>
  <div
    v-if="webchat || whatsapp || showFallback"
    :class="bare ? 'bia-actions--bare' : 'cluster bia-actions'"
    :data-inline-contact="!bare && (webchat || whatsapp) ? '' : undefined"
  >
    <button v-if="webchat" type="button" :class="primary" @click="openWebchat">
      <AppIcon name="chat" />
      {{ t.webchat }}
    </button>
    <a v-if="whatsapp" :href="whatsapp" :class="webchat ? secondary : primary" target="_blank" rel="noopener">
      {{ t.whatsapp }}<span class="visually-hidden"> {{ t.newTab }}</span>
      <AppIcon name="external" />
    </a>
    <RouterLink v-if="!webchat && !whatsapp && showFallback" to="/bia" :class="secondary">
      {{ t.fallback }} <AppIcon name="arrow-right" />
    </RouterLink>
  </div>
</template>

<style scoped>
.bia-actions--bare {
  display: contents;
}
</style>
