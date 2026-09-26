<script setup lang="ts">
/**
 * Estados de tela: carregando (anunciado), erro (com nova tentativa) e vazio (com ação opcional).
 * Apenas um é exibido por vez, na ordem carregando → erro → vazio.
 */
import AppIcon from '@/components/ui/AppIcon.vue'

withDefaults(
  defineProps<{
    loading?: boolean
    error?: string | null
    empty?: boolean
    loadingText?: string
    emptyTitle?: string
    emptyText?: string
  }>(),
  {
    loading: false,
    error: null,
    empty: false,
    loadingText: 'Carregando…',
    emptyTitle: 'Nada por aqui',
    emptyText: undefined,
  },
)
const emit = defineEmits<{ (e: 'retry'): void }>()
</script>

<template>
  <div v-if="loading" class="admin-state admin-state--loading" role="status">
    <span class="spinner" aria-hidden="true" />
    <span>{{ loadingText }}</span>
  </div>
  <div v-else-if="error" class="notice notice--error admin-state-error" role="alert">
    <AppIcon name="alert" />
    <div>
      <p>{{ error }}</p>
      <button type="button" class="btn btn--secondary btn--sm admin-state-error__retry" @click="emit('retry')">Tentar novamente</button>
    </div>
  </div>
  <div v-else-if="empty" class="admin-state" role="status">
    <strong>{{ emptyTitle }}</strong>
    <p v-if="emptyText">{{ emptyText }}</p>
    <slot name="empty-action" />
  </div>
</template>

<style scoped>
.admin-state-error__retry {
  margin-top: 10px;
}
</style>
