<script setup lang="ts">
import { computed, onMounted } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { useCookieChoice } from '@/composables/useCookieChoice'
import { formatDate } from '@/lib/format'

/**
 * Situação da escolha neste navegador e botão para reabrir o painel de cookies.
 * A escolha só é lida no navegador (onMounted); o HTML pré-renderizado mostra o texto neutro.
 */
const { choice, loaded, hasOptional, load, openSettings } = useCookieChoice()

onMounted(() => load())

const status = computed(() => {
  if (!hasOptional) return 'Nesta versão não há tecnologias opcionais, então não há escolha a fazer. Os cookies essenciais funcionam só quando você usa as funções que dependem deles.'
  if (!loaded.value) return 'Sua escolha fica salva apenas neste navegador.'
  if (!choice.value) return 'Você ainda não escolheu. Enquanto isso, a medição agregada fica desligada.'
  const when = choice.value.savedAt ? ` em ${formatDate(choice.value.savedAt)}` : ''
  return choice.value.measurement
    ? `Você permitiu a medição agregada de uso${when}.`
    : `Você recusou a medição agregada de uso${when}. Ela fica desligada.`
})
</script>

<template>
  <div class="choices">
    <div class="choices__status">
      <AppIcon name="check-circle" />
      <p aria-live="polite">{{ status }}</p>
    </div>
    <button type="button" class="btn btn--secondary" @click="openSettings">
      {{ hasOptional ? 'Rever minhas escolhas' : 'Abrir o painel de cookies' }}
    </button>
  </div>
</template>

<style scoped>
.choices {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--mf-space-3) var(--mf-space-4);
  padding: var(--mf-space-4);
  border-radius: 20px;
  background: var(--mf-mint);
}

.choices__status {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  gap: 10px;
  flex: 1 1 320px;
}

.choices__status .icon {
  width: 22px;
  height: 22px;
  margin-top: 3px;
  color: var(--mf-forest);
}

.choices__status p {
  margin: 0;
  font-size: 1rem;
  line-height: 1.55;
}

@media (max-width: 767px) {
  .choices .btn {
    width: 100%;
  }
}
</style>
