<script setup lang="ts">
import page from '@content/pages/sobre.yaml'
import { formatCnpj, formatPhoneBr } from '@/lib/format'
import { publicConfig } from '@/services/site'

/**
 * Identidade empresarial real, lida da configuração pública validada (a mesma do rodapé e dos avisos).
 * Somente dados reais são exibidos; a validação de identidade continua obrigatória na publicação.
 */
const t = page.identity
const id = publicConfig.identity
const whatsapp = publicConfig.channels.whatsappNumber

type ContactKind = 'email' | 'url' | 'text'
function kindOf(value: string): ContactKind {
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'email'
  if (/^https:\/\//.test(value)) return 'url'
  return 'text'
}
const supportKind = id.supportContact ? kindOf(id.supportContact) : 'text'
const privacyKind = id.privacyContact ? kindOf(id.privacyContact) : 'text'
</script>

<template>
  <div class="about-identity">
    <dl class="about-identity__list">
      <div>
        <dt>{{ t.labels.tradeName }}</dt>
        <dd>{{ id.tradeName }}</dd>
      </div>
      <div v-if="id.legalName">
        <dt>{{ t.labels.legalName }}</dt>
        <dd>
          <template v-if="id.legalName">{{ id.legalName }}</template>
        </dd>
      </div>
      <div v-if="id.cnpj">
        <dt>{{ t.labels.cnpj }}</dt>
        <dd>
          <template v-if="id.cnpj">{{ formatCnpj(id.cnpj) }}</template>
        </dd>
      </div>
      <div v-if="id.address">
        <dt>{{ t.labels.address }}</dt>
        <dd>
          <template v-if="id.address">{{ id.address }}</template>
        </dd>
      </div>
      <div v-if="id.supportContact || id.supportPhone || whatsapp">
        <dt>{{ t.labels.support }}</dt>
        <dd>
          <ul class="about-identity__channels">
            <li v-if="id.supportContact">
              <a v-if="supportKind === 'email'" :href="`mailto:${id.supportContact}`">{{ id.supportContact }}</a>
              <a v-else-if="supportKind === 'url'" :href="id.supportContact" rel="noopener noreferrer">{{ id.supportContact }}</a>
              <template v-else>{{ id.supportContact }}</template>
            </li>
            <li v-if="id.supportPhone">
              <a :href="`tel:${id.supportPhone}`">{{ formatPhoneBr(id.supportPhone) }}</a>
            </li>
            <li v-if="whatsapp">{{ t.whatsappLabel }}: {{ formatPhoneBr(whatsapp) }}</li>
          </ul>
        </dd>
      </div>
      <div v-if="id.supportHours">
        <dt>{{ t.labels.hours }}</dt>
        <dd>
          <template v-if="id.supportHours">{{ id.supportHours }}</template>
        </dd>
      </div>
      <div v-if="id.privacyContact">
        <dt>{{ t.labels.privacy }}</dt>
        <dd>
          <template v-if="id.privacyContact">
            <a v-if="privacyKind === 'email'" :href="`mailto:${id.privacyContact}`">{{ id.privacyContact }}</a>
            <a v-else-if="privacyKind === 'url'" :href="id.privacyContact" rel="noopener noreferrer">{{ id.privacyContact }}</a>
            <template v-else>{{ id.privacyContact }}</template>
          </template>
        </dd>
      </div>
      <div v-if="id.privacyOfficerName">
        <dt>{{ t.labels.officer }}</dt>
        <dd>
          <template v-if="id.privacyOfficerName">{{ id.privacyOfficerName }}</template>
        </dd>
      </div>
    </dl>
  </div>
</template>

<style scoped>
.about-identity {
  padding: var(--mf-space-5);
  border-radius: var(--mf-radius-card);
  background: var(--mf-paper);
  border: 1px solid var(--mf-border);
}

.about-identity__list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 var(--mf-space-5);
  margin: 0;
}

.about-identity__list > div {
  padding-block: var(--mf-space-3);
  border-bottom: 1px solid var(--mf-border);
}

.about-identity__list > div:nth-last-child(-n + 2) {
  border-bottom: 0;
}

.about-identity__list dt {
  margin-bottom: 4px;
  font-size: 0.875rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--mf-muted);
}

.about-identity__list dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.about-identity__channels {
  list-style: none;
  margin: 0;
  padding: 0;
}

.about-identity__channels li {
  margin: 0;
}

.about-identity__channels a,
.about-identity__list dd > a {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
}

@media (max-width: 767px) {
  .about-identity {
    padding: var(--mf-space-2) var(--mf-space-4);
  }

  .about-identity__list {
    grid-template-columns: minmax(0, 1fr);
  }

  .about-identity__list > div:nth-last-child(2) {
    border-bottom: 1px solid var(--mf-border);
  }
}
</style>
