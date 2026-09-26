<script setup lang="ts">
import doc from '@content/legal/cookies.md'
import CookieChoicesPanel from '@/components/legal/CookieChoicesPanel.vue'
import CookieInventory from '@/components/legal/CookieInventory.vue'
import LegalDocument from '@/components/legal/LegalDocument.vue'
import MeasurementStatus from '@/components/legal/MeasurementStatus.vue'
import WebchatStatus from '@/components/legal/WebchatStatus.vue'
import { useSeo } from '@/composables/useSeo'

// Política de cookies (seções 6.16 e 9): lista só o que o código usa (content/legal/cookie-consent.yaml).
useSeo({ title: doc.meta.title, description: doc.meta.description })
</script>

<template>
  <LegalDocument :doc="doc" notice="cookies">
    <template #inventario><CookieInventory /></template>
    <template #opcionais><MeasurementStatus /></template>
    <template #webchat><WebchatStatus /></template>
    <template #escolhas><CookieChoicesPanel /></template>
  </LegalDocument>
</template>
