<script setup lang="ts">
import { ref } from 'vue'
import { useRoute } from 'vue-router'
import AppIcon from '@/components/ui/AppIcon.vue'
import RichText from '@/components/content/RichText.vue'
import type { FaqItem, LinkItem } from '@/types/content'

/**
 * Acordeão acessível: botão com aria-expanded/aria-controls dentro de um título.
 * O conteúdo fica no HTML pré-renderizado (oculto com `hidden`), então funciona para leitura e busca.
 */
const props = withDefaults(defineProps<{ items: FaqItem[]; headingLevel?: 2 | 3 | 4; idPrefix?: string; showRelated?: boolean; anchorIds?: boolean }>(), {
  headingLevel: 3,
  idPrefix: 'faq',
  showRelated: true,
})
const open = ref<Set<string>>(new Set())
const route = useRoute()

/**
 * Links relacionados que levariam ao topo da própria página (ex.: "Consignado privado" dentro de
 * /consignado-privado) são omitidos. Âncora para uma seção da mesma página vira link nativo
 * (`#secao`), como o sumário da página, para o navegador levar a leitura e o foco até a seção.
 */
function relatedLinks(item: FaqItem): (LinkItem & { anchor?: string })[] {
  const normalize = (path: string) => path.replace(/\/$/, '') || '/'
  const here = normalize(route.path)
  return (item.related ?? []).flatMap((link) => {
    const [path = '', hash] = link.to.split('#')
    if (normalize(path) !== here) return [link]
    return hash ? [{ ...link, anchor: `#${hash}` }] : []
  })
}

function toggle(id: string) {
  const next = new Set(open.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  open.value = next
}

defineExpose({
  openItem(id: string) {
    open.value = new Set([...open.value, id])
  },
})
</script>

<template>
  <div class="accordion">
    <div v-for="item in props.items" :id="props.anchorIds ? item.id : undefined" :key="item.id" class="accordion__item">
      <component :is="`h${props.headingLevel}`" class="accordion__heading">
        <button
          :id="`${props.idPrefix}-${item.id}-botao`"
          type="button"
          class="accordion__trigger"
          :aria-expanded="open.has(item.id) ? 'true' : 'false'"
          :aria-controls="`${props.idPrefix}-${item.id}`"
          @click="toggle(item.id)"
        >
          <span>{{ item.question }}</span>
          <AppIcon name="chevron-down" />
        </button>
      </component>
      <div
        :id="`${props.idPrefix}-${item.id}`"
        class="accordion__panel"
        role="region"
        :aria-labelledby="`${props.idPrefix}-${item.id}-botao`"
        :hidden="!open.has(item.id)"
      >
        <RichText :html="item.answer_md" />
        <ul v-if="props.showRelated && relatedLinks(item).length" class="faq-related">
          <li v-for="link in relatedLinks(item)" :key="link.to">
            <a v-if="link.anchor" :href="link.anchor" class="link-arrow">{{ link.label }} <AppIcon name="arrow-right" /></a>
            <RouterLink v-else :to="link.to" class="link-arrow">{{ link.label }} <AppIcon name="arrow-right" /></RouterLink>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<style scoped>
.faq-related {
  display: flex;
  flex-wrap: wrap;
  gap: 0 20px;
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
}

.faq-related li {
  margin: 0;
}
</style>
