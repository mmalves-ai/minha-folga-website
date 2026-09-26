<script setup lang="ts">
import texts from '@content/legal/cookie-consent.yaml'
import RichText from '@/components/content/RichText.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import type { MeasurementEventText } from '@/components/legal/legal'
import { publicConfig } from '@/services/site'

/**
 * Situação real da medição de uso nesta versão (ANALYTICS_ENABLED no backend, exportado no build).
 * Ativa, lista todos os eventos do contrato (content/legal/cookie-consent.yaml → events), com o único
 * valor que segue com cada um, para o consentimento ser informado sobre exatamente o que é enviado.
 */
const enabled = publicConfig.analyticsEnabled
const status = texts.measurementStatus as { enabled_md: string; disabled_md: string; eventsTitle: string; eventsDimension: string }
const html: string = enabled ? status.enabled_md : status.disabled_md
const events = enabled ? (texts.events as MeasurementEventText[]) : []
</script>

<template>
  <div class="measurement-status" :class="enabled ? 'measurement-status--on' : 'measurement-status--off'">
    <AppIcon :name="enabled ? 'eye' : 'check-circle'" />
    <div class="measurement-status__body">
      <RichText :html="html" />
      <template v-if="events.length">
        <p class="measurement-status__title">{{ status.eventsTitle }}</p>
        <ul class="measurement-status__events">
          <li v-for="e in events" :key="e.name">
            <span class="measurement-status__event">{{ e.label }}</span>
            <span class="measurement-status__meta"><code>{{ e.name }}</code> · {{ status.eventsDimension }}: {{ e.dimension }}</span>
          </li>
        </ul>
      </template>
    </div>
  </div>
</template>

<style scoped>
.measurement-status {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  gap: 12px;
  padding: 18px 20px;
  border-radius: 16px;
  border: 1px solid var(--mf-border);
  border-left: 4px solid var(--mf-forest);
  background: var(--mf-cream);
  font-size: 1rem;
  line-height: 1.6;
}

.measurement-status .icon {
  width: 22px;
  height: 22px;
  margin-top: 3px;
  color: var(--mf-forest);
}

.measurement-status__body {
  min-width: 0;
}

.measurement-status :deep(p) {
  margin: 0;
}

.measurement-status .measurement-status__title {
  margin-top: var(--mf-space-3);
  font-weight: 700;
}

.measurement-status__events {
  display: grid;
  gap: 8px;
  margin: var(--mf-space-2) 0 0;
  padding-left: 1.2em;
}

.measurement-status__events li {
  margin: 0;
}

.measurement-status__event {
  display: block;
}

.measurement-status__meta {
  display: block;
  font-size: 0.875rem;
  color: var(--mf-muted);
  overflow-wrap: anywhere;
}
</style>
