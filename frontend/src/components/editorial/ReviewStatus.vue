<script setup lang="ts">
import page from '@content/pages/conteudos.yaml'
import AppIcon from '@/components/ui/AppIcon.vue'
import { formatDateLong } from '@/lib/format'
import type { Article } from '@/types/content'

/**
 * Situação da revisão financeira de um artigo, a partir do frontmatter versionado.
 * "Revisado em … por …" só aparece com status aprovado, data e responsável registrados;
 * nunca é preenchido com a data do build ou do acesso.
 */
const props = defineProps<{ review: Article['review'] }>()
const t = page.article.meta
const approved = props.review.status === 'approved' && Boolean(props.review.reviewedAt && props.review.reviewer)
</script>

<template>
  <span v-if="approved" class="review review--approved">
    <AppIcon name="check-circle" />
    <span>
      {{ t.reviewedPrefix }} <time :datetime="props.review.reviewedAt!">{{ formatDateLong(props.review.reviewedAt!) }}</time>
      {{ t.reviewedBy }} {{ props.review.reviewer }}
    </span>
  </span>
  <span v-else class="review review--pending">
    <AppIcon name="clock" />
    <span>{{ t.reviewPending }}</span>
  </span>
</template>

<style scoped>
.review {
  display: inline-flex;
  align-items: flex-start;
  gap: 6px;
  font-weight: 600;
}

.review .icon {
  flex: none;
  width: 18px;
  height: 18px;
  margin-top: 2px;
}

.review--approved {
  color: var(--mf-forest);
}

.review--pending {
  color: #5c4700;
}
</style>
