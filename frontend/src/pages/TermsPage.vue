<script setup lang="ts">
import doc from '@content/legal/termos.md'
import LegalDocument from '@/components/legal/LegalDocument.vue'
import { useSeo } from '@/composables/useSeo'

// Termos de uso (seção 6.16): texto em content/legal/termos.md; versão em contracts/consents.json.
useSeo({ title: doc.meta.title, description: doc.meta.description })
</script>

<template>
  <LegalDocument :doc="doc" notice="terms" />
</template>
