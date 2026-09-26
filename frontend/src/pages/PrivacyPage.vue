<script setup lang="ts">
import doc from '@content/legal/privacidade.md'
import LegalDocument from '@/components/legal/LegalDocument.vue'
import MeasurementStatus from '@/components/legal/MeasurementStatus.vue'
import PrivacyContactCard from '@/components/legal/PrivacyContactCard.vue'
import WebchatStatus from '@/components/legal/WebchatStatus.vue'
import { useSeo } from '@/composables/useSeo'

// Aviso de Privacidade (seção 9): texto em content/legal/privacidade.md; versão em contracts/consents.json.
useSeo({ title: doc.meta.title, description: doc.meta.description })
</script>

<template>
  <LegalDocument :doc="doc" notice="privacy">
    <template #medicao><MeasurementStatus /></template>
    <template #webchat><WebchatStatus /></template>
    <template #contato><PrivacyContactCard /></template>
  </LegalDocument>
</template>
