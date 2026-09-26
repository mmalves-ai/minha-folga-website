<script setup lang="ts">
import { ref } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'

/**
 * Campo de busca local (sem envio ao servidor): rótulo visível, dica associada e botão para limpar.
 * Esc limpa o campo. O resultado é anunciado pela página que usa o componente (aria-live).
 */
const props = withDefaults(defineProps<{ id: string; label: string; hint?: string; size?: 'md' | 'lg'; controls?: string }>(), {
  size: 'md',
})
const model = defineModel<string>({ required: true })
const input = ref<HTMLInputElement | null>(null)

function clear() {
  model.value = ''
  input.value?.focus()
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && model.value) {
    e.preventDefault()
    clear()
  }
}

defineExpose({ focus: () => input.value?.focus() })
</script>

<template>
  <div class="field search-field" :class="`search-field--${props.size}`">
    <label :for="props.id" class="field__label">{{ props.label }}</label>
    <p v-if="props.hint" :id="`${props.id}-dica`" class="field__hint">{{ props.hint }}</p>
    <div class="search-field__control">
      <AppIcon name="search" class="search-field__icon" />
      <input
        :id="props.id"
        ref="input"
        v-model="model"
        type="search"
        class="input search-field__input"
        autocomplete="off"
        spellcheck="false"
        enterkeyhint="search"
        :aria-describedby="props.hint ? `${props.id}-dica` : undefined"
        :aria-controls="props.controls"
        @keydown="onKeydown"
      />
      <button v-if="model" type="button" class="search-field__clear" @click="clear">
        <AppIcon name="close" />
        <span class="visually-hidden">Limpar busca</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.search-field__control {
  position: relative;
}

.search-field__icon {
  position: absolute;
  left: 14px;
  top: 50%;
  width: 20px;
  height: 20px;
  transform: translateY(-50%);
  color: var(--mf-forest);
  pointer-events: none;
}

.search-field__input {
  padding-left: 46px;
  padding-right: 52px;
}

.search-field--lg .search-field__input {
  min-height: 56px;
  font-size: 1.0625rem;
}

/* O botão próprio substitui o "x" nativo, que não tem rótulo acessível. */
.search-field__input::-webkit-search-cancel-button {
  appearance: none;
}

.search-field__clear {
  position: absolute;
  right: 4px;
  top: 50%;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  transform: translateY(-50%);
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--mf-muted);
}

.search-field__clear:hover {
  color: var(--mf-forest);
  background: var(--mf-mint);
}

.search-field__clear .icon {
  width: 20px;
  height: 20px;
}
</style>
