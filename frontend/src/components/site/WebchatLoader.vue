<script setup lang="ts">
import { onMounted, ref } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import type { WebchatConfig } from './channels'
import { loadWebchatScript } from './webchat-loader'

/**
 * Carregador do chat do site (widget da Hal-AI). PLACEHOLDER: widget da Hal-AI ainda não provisionado —
 * ver webchat-loader.ts. Só é montado depois que a pessoa clicou em "Conversar com a Bia no site" e
 * confirmou o aviso de tratamento; montar = inserir o script. Sem chave no navegador.
 *
 * Falha ou demora mostram o texto da seção 7 ("Não consegui conectar agora…") com caminhos sem chat
 * (slot `failed`) e a opção de tentar de novo, sem reenviar nada.
 */
const props = defineProps<{
  config: WebchatConfig
  loadingText: string
  readyText: string
  failedText: string
  retryLabel: string
}>()

const emit = defineEmits<{ loading: []; ready: []; failed: [] }>()

const state = ref<'loading' | 'ready' | 'failed'>('loading')
const retryButton = ref<HTMLButtonElement | null>(null)

function start() {
  state.value = 'loading'
  emit('loading')
  loadWebchatScript(props.config).then(
    () => {
      state.value = 'ready'
      emit('ready')
    },
    () => {
      state.value = 'failed'
      emit('failed')
    },
  )
}

onMounted(start)
defineExpose({ retry: start, retryButton })
</script>

<template>
  <div class="webchat-loader">
    <p v-if="state === 'loading'" class="webchat-loader__status">
      <span class="webchat-loader__spinner" aria-hidden="true" />
      <span>{{ loadingText }}</span>
    </p>
    <p v-else-if="state === 'ready'" class="webchat-loader__status">
      <AppIcon name="check-circle" />
      <span>{{ readyText }}</span>
    </p>
    <div v-else class="webchat-loader__failed">
      <p role="alert" class="webchat-loader__error">
        <AppIcon name="alert" />
        <span>{{ failedText }}</span>
      </p>
      <slot name="failed" />
      <button ref="retryButton" type="button" class="webchat-loader__retry" @click="start">{{ retryLabel }}</button>
    </div>
  </div>
</template>

<style scoped>
.webchat-loader__status,
.webchat-loader__error {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
  margin: 0;
  line-height: 1.5;
}

.webchat-loader__status .icon,
.webchat-loader__error .icon {
  width: 22px;
  height: 22px;
  color: var(--mf-forest);
}

.webchat-loader__error {
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--mf-error-bg);
  color: var(--mf-ink);
}

.webchat-loader__error .icon {
  color: var(--mf-error);
}

.webchat-loader__failed {
  display: grid;
  gap: 10px;
}

.webchat-loader__spinner {
  width: 20px;
  height: 20px;
  margin-top: 1px;
  border: 3px solid var(--mf-mint-strong);
  border-top-color: var(--mf-forest);
  border-radius: 50%;
}

@media (prefers-reduced-motion: no-preference) {
  .webchat-loader__spinner {
    animation: webchat-spin 0.9s linear infinite;
  }
}

@keyframes webchat-spin {
  to {
    transform: rotate(360deg);
  }
}

.webchat-loader__retry {
  justify-self: start;
  min-height: 44px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--mf-forest);
  font: inherit;
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}
</style>
