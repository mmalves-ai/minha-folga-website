<script setup lang="ts">
/**
 * Senha temporária exibida uma única vez (criação ou redefinição de usuário). Não é guardada em
 * lugar nenhum do navegador: some ao fechar. Botão de copiar com retorno anunciado.
 */
import { ref } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'

const props = defineProps<{ password: string; displayName: string }>()
const emit = defineEmits<{ (e: 'done'): void }>()

const copied = ref<'idle' | 'ok' | 'fail'>('idle')
const code = ref<HTMLElement | null>(null)

async function copy() {
  try {
    await navigator.clipboard.writeText(props.password)
    copied.value = 'ok'
  } catch {
    // Sem permissão de área de transferência: seleciona o texto para cópia manual.
    const range = document.createRange()
    if (code.value) {
      range.selectNodeContents(code.value)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    }
    copied.value = 'fail'
  }
}
</script>

<template>
  <section class="temp" aria-labelledby="senha-temporaria-titulo">
    <h3 id="senha-temporaria-titulo">Senha temporária de {{ displayName }}</h3>
    <div class="temp__row">
      <code ref="code" class="temp__code admin-mono">{{ password }}</code>
      <button type="button" class="btn btn--secondary btn--sm" @click="copy">
        <AppIcon v-if="copied === 'ok'" name="check" />
        {{ copied === 'ok' ? 'Copiada' : 'Copiar senha' }}
      </button>
    </div>
    <p class="visually-hidden" aria-live="polite">
      {{ copied === 'ok' ? 'Senha copiada para a área de transferência.' : copied === 'fail' ? 'Não foi possível copiar automaticamente. A senha foi selecionada para cópia manual.' : '' }}
    </p>
    <p v-if="copied === 'fail'" class="field__hint">Não foi possível copiar automaticamente. A senha está selecionada: use Ctrl+C ou o menu de cópia.</p>
    <div class="notice notice--pending">
      <AppIcon name="alert" />
      <div>
        <p><strong>Ela aparece somente agora.</strong> Depois de fechar este aviso, não será possível vê-la de novo — só gerar outra.</p>
        <p>Entregue a senha por um canal seguro e separado do e-mail de acesso. No primeiro acesso, a pessoa troca a senha e cadastra o autenticador.</p>
      </div>
    </div>
    <div>
      <button type="button" class="btn btn--primary btn--sm" @click="emit('done')">Já entreguei, fechar aviso</button>
    </div>
  </section>
</template>

<style scoped>
.temp {
  display: grid;
  gap: var(--mf-space-3);
  padding: var(--mf-space-4);
  border: 2px solid var(--mf-forest);
  border-radius: var(--admin-radius, 16px);
  background: var(--mf-paper);
}

.temp h3 {
  margin: 0;
}

.temp__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}

.temp__code {
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--mf-cream);
  border: 1px solid var(--mf-border);
  font-size: 1.125rem;
  font-weight: 600;
  user-select: all;
}

.temp p {
  margin: 0;
}
</style>
