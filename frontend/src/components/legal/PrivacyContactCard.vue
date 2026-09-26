<script setup lang="ts">
import AppIcon from '@/components/ui/AppIcon.vue'
import { formatCnpj } from '@/lib/format'
import { publicConfig } from '@/services/site'

/**
 * Canais para exercer direitos de titular, com a mesma identidade validada do rodapé.
 * Dado ausente só aparece como pendência em builds não publicáveis (o release estrito falha antes).
 */
const id = publicConfig.identity
const pending = (label: string) => `[pendente: ${label}]`

/** O canal de privacidade pode ser e-mail ou endereço web; outros formatos aparecem como texto. */
function contactHref(value: string | null): string | null {
  if (!value) return null
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return `mailto:${value}`
  if (/^https:\/\//.test(value)) return value
  return null
}

const privacyHref = contactHref(id.privacyContact)
</script>

<template>
  <div class="privacy-contact">
    <div class="privacy-contact__channel">
      <span class="privacy-contact__icon" aria-hidden="true"><AppIcon name="shield" /></span>
      <div>
        <p class="privacy-contact__label">Canal de privacidade</p>
        <p class="privacy-contact__value">
          <a v-if="privacyHref && id.privacyContact" :href="privacyHref">{{ id.privacyContact }}</a>
          <span v-else-if="id.privacyContact">{{ id.privacyContact }}</span>
          <span v-else class="pending-data">{{ pending('canal de privacidade') }}</span>
        </p>
        <p class="privacy-contact__officer">
          Encarregado:
          <span :class="{ 'pending-data': !id.privacyOfficerName }">{{ id.privacyOfficerName ?? pending('encarregado de dados') }}</span>
        </p>
      </div>
    </div>

    <dl class="privacy-contact__identity">
      <div>
        <dt>Controladora</dt>
        <dd :class="{ 'pending-data': !id.legalName }">{{ id.legalName ?? pending('razão social') }}</dd>
      </div>
      <div>
        <dt>CNPJ</dt>
        <dd :class="{ 'pending-data': !id.cnpj }">{{ id.cnpj ? formatCnpj(id.cnpj) : pending('CNPJ') }}</dd>
      </div>
      <div>
        <dt>Endereço</dt>
        <dd :class="{ 'pending-data': !id.address }">{{ id.address ?? pending('endereço') }}</dd>
      </div>
    </dl>

    <div class="privacy-contact__actions cluster">
      <RouterLink to="/preferencias" class="btn btn--primary">Gerenciar preferências</RouterLink>
      <RouterLink to="/atendimento" class="btn btn--secondary">Falar com o atendimento</RouterLink>
    </div>
  </div>
</template>

<style scoped>
.privacy-contact {
  display: grid;
  gap: var(--mf-space-4);
  padding: var(--mf-space-5);
  border-radius: var(--mf-radius-card);
  background: var(--mf-forest);
  color: var(--mf-cream);
  font-size: 1rem;
  line-height: 1.5;
}

.privacy-contact :focus-visible {
  outline-color: var(--mf-focus-on-dark);
}

.privacy-contact p {
  margin: 0;
}

.privacy-contact__channel {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr);
  gap: var(--mf-space-3);
  align-items: start;
}

.privacy-contact__icon {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: 14px;
  background: rgb(248 246 240 / 12%);
}

.privacy-contact__icon .icon {
  width: 24px;
  height: 24px;
}

.privacy-contact__label {
  font-size: 0.875rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mf-cream-on-dark-muted);
}

.privacy-contact__value {
  margin-top: 2px;
  font-family: var(--mf-font-heading);
  font-size: clamp(1.125rem, 1vw + 0.8rem, 1.375rem);
  font-weight: 600;
  overflow-wrap: anywhere;
}

.privacy-contact__value a {
  color: #fff;
}

.privacy-contact__officer {
  margin-top: 6px;
  color: var(--mf-cream);
}

.privacy-contact__identity {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px 24px;
  margin: 0;
  padding-top: var(--mf-space-3);
  border-top: 1px solid rgb(248 246 240 / 18%);
}

.privacy-contact__identity dt {
  font-size: 0.875rem;
  font-weight: 700;
  color: var(--mf-cream-on-dark-muted);
}

.privacy-contact__identity dd {
  margin: 2px 0 0;
  font-size: 0.9375rem;
  overflow-wrap: anywhere;
}

.privacy-contact .btn--primary {
  background: var(--mf-cream);
  color: var(--mf-forest);
}

.privacy-contact .btn--primary:hover {
  background: #fff;
  color: var(--mf-forest-hover);
}

.privacy-contact .btn--secondary {
  color: var(--mf-cream);
  border-color: var(--mf-cream);
}

.privacy-contact .btn--secondary:hover {
  background: rgb(248 246 240 / 12%);
  color: #fff;
}

.pending-data {
  background: #fff1c2;
  color: #4d3a00;
}

@media (max-width: 767px) {
  .privacy-contact {
    padding: var(--mf-space-4);
  }

  .privacy-contact__identity {
    grid-template-columns: minmax(0, 1fr);
  }

  .privacy-contact__actions .btn {
    width: 100%;
  }
}
</style>
