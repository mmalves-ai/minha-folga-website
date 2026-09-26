<script setup lang="ts">
import { useId } from 'vue'
import copy from '@content/pages/formularios.yaml'

/**
 * Campo-armadilha (decisão D1): fora da tela, escondido de leitores de tela, fora da ordem de
 * tabulação e sem autopreenchimento. Pessoas nunca o veem; robôs que preenchem tudo, sim.
 */
const model = defineModel<string>({ required: true })
defineProps<{ name: string }>()
const uid = useId()
</script>

<template>
  <div class="antibot-trap" aria-hidden="true">
    <label :for="`${uid}-trap`">{{ copy.trap.label }}</label>
    <input :id="`${uid}-trap`" v-model="model" type="text" :name="name" tabindex="-1" autocomplete="off" />
  </div>
</template>

<style scoped>
.antibot-trap {
  position: absolute;
  left: -10000px;
  top: auto;
  width: 1px;
  height: 1px;
  overflow: hidden;
}
</style>
