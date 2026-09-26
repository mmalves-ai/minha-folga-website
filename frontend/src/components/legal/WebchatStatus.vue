<script setup lang="ts">
import texts from '@content/legal/cookie-consent.yaml'
import RichText from '@/components/content/RichText.vue'
import { webchatAvailable } from '@/components/site/channels'
import AppIcon from '@/components/ui/AppIcon.vue'

/**
 * Situação real do chat do site (widget da Hal-AI, decisão D1) nesta versão, lida da configuração pública
 * do build — o texto legal nunca afirma um estado que não é o do site publicado.
 *
 * PLACEHOLDER: widget da Hal-AI ainda não provisionado. Habilitado, mostra o marcador de pendência do que o
 * widget grava no navegador: a release estrita (scripts/postbuild.mjs) recusa HTML com "[pendente: …]", então
 * o chat não vai ao ar sem esse inventário revisado. Desligado, não há pendência.
 */
const status = texts.webchatStatus as { enabled_md: string; disabled_md: string; pendingLabel: string }
const enabled = webchatAvailable
const html: string = enabled ? status.enabled_md : status.disabled_md
</script>

<template>
  <div class="webchat-status" :class="enabled ? 'webchat-status--on' : 'webchat-status--off'">
    <AppIcon :name="enabled ? 'chat' : 'check-circle'" />
    <div class="webchat-status__body">
      <RichText :html="html" />
      <p v-if="enabled" class="webchat-status__pending">
        <span class="pending-data">[pendente: {{ status.pendingLabel }}]</span>
      </p>
    </div>
  </div>
</template>

<style scoped>
.webchat-status {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  gap: 12px;
  padding: 18px 20px;
  border-radius: 16px;
  border: 1px solid var(--mf-border);
  border-left: 4px solid var(--mf-forest);
  background: var(--mf-cream);
  font-size: 1rem;
  line-height: 1.6;
}

.webchat-status .icon {
  width: 22px;
  height: 22px;
  margin-top: 3px;
  color: var(--mf-forest);
}

.webchat-status__body {
  min-width: 0;
}

.webchat-status :deep(p) {
  margin: 0;
}

.webchat-status .webchat-status__pending {
  margin-top: var(--mf-space-2);
}
</style>
