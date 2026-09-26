<script setup lang="ts">
import type { ChatMessage } from '@/types/content'

/**
 * Painel de demonstração da Bia. Sempre exibe o rótulo de exemplo e a nota educativa.
 * Não envia nada, não gera protocolo nem confirmação: é conteúdo estático.
 */
withDefaults(
  defineProps<{
    messages: ChatMessage[]
    label?: string
    title?: string
    note?: string
    /** 'label' (padrão): título do painel como rótulo; 2/3 só quando o painel for de fato uma seção. */
    headingLevel?: 2 | 3 | 'label'
  }>(),
  { label: 'Exemplo de conversa', note: 'Demonstração educativa. Não é uma proposta de crédito.', headingLevel: 'label' },
)
</script>

<template>
  <figure class="bia-demo panel" :aria-label="title ? `${title} — ${label}` : label">
    <div class="bia-demo__head">
      <component :is="headingLevel === 'label' ? 'p' : `h${headingLevel}`" v-if="title" class="bia-demo__title panel-label">{{ title }}</component>
      <span class="badge badge--outline bia-demo__label">{{ label }}</span>
    </div>
    <div class="bia-demo__identity" aria-hidden="true">
      <img src="/brand/minha-folga-simbolo.svg" alt="" width="36" height="32" />
      <div>
        <strong>Bia</strong>
        <span>Assistente de IA da Minha Folga</span>
      </div>
    </div>
    <ol class="chat" aria-label="Mensagens do exemplo">
      <li v-for="(m, i) in messages" :key="i" class="chat__row" :class="m.from === 'person' ? 'chat__row--person' : 'chat__row--bia'">
        <p class="bubble" :class="m.from === 'person' ? 'bubble--person' : 'bubble--bia'">
          <span class="bubble__author">{{ m.from === 'person' ? 'Pessoa' : 'Bia · IA' }}</span>
          {{ m.text }}
        </p>
      </li>
    </ol>
    <figcaption class="bia-demo__note">{{ note }}</figcaption>
  </figure>
</template>

<style scoped>
.bia-demo {
  margin: 0;
}

.bia-demo__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 16px;
  margin-bottom: 16px;
}

.bia-demo__title {
  margin: 0;
  font-size: 1.25rem;
  color: var(--mf-ink);
}

.bia-demo__identity {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  margin-bottom: 16px;
  border-radius: 16px;
  background: var(--mf-cream);
}

.bia-demo__identity img {
  width: 36px;
  height: auto;
}

.bia-demo__identity strong {
  display: block;
  font-family: var(--mf-font-heading);
  font-size: 1rem;
  color: var(--mf-ink);
}

.bia-demo__identity span {
  font-size: 0.875rem;
  color: var(--mf-muted);
}

.chat {
  list-style: none;
  margin: 0;
  padding: 0;
}

.chat__row {
  margin: 0;
}

.chat .bubble {
  margin: 0;
}

.bia-demo__note {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px dashed var(--mf-border);
  font-size: 0.875rem;
  color: var(--mf-muted);
}
</style>
