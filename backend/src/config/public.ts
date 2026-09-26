import { CONSENTS } from './contracts.js'
import type { AppConfig } from './index.js'

/**
 * Lista PERMITIDA de campos públicos. É o único recorte da configuração que sai do servidor:
 * - no build do frontend (scripts/build.sh → export-public-config) para pré-renderizar rodapé,
 *   páginas legais e canais;
 * - em GET /api/public-config, para componentes interativos confirmarem disponibilidade.
 * Nunca serializar `AppConfig` inteiro nem `process.env`.
 */
export interface PublicConfig {
  schemaVersion: 1
  siteUrl: string
  environment: 'development' | 'test' | 'staging' | 'production'
  credit: { phase: AppConfig['credit']['phase']; operationsEnabled: boolean }
  identity: {
    tradeName: string
    legalName: string | null
    cnpj: string | null
    address: string | null
    privacyContact: string | null
    privacyOfficerName: string | null
    supportContact: string | null
    supportPhone: string | null
    supportHours: string | null
    supportResponseTime: string | null
    complete: boolean
    missing: string[]
  }
  channels: {
    /** Número oficial do WhatsApp hospedado na Hal-AI (botão flutuante, wa.me, texto genérico). */
    whatsappNumber: string | null
    biaOnWhatsapp: boolean
    humanSupport: boolean
    /**
     * Webchat da Hal-AI (placeholder, D1): canal preferencial do site. O widget só é carregado depois do clique,
     * com aviso de tratamento; a CSP do servidor web precisa liberar a origem de `scriptUrl` quando habilitado.
     */
    webchat: { enabled: boolean; scriptUrl: string | null; widgetId: string | null }
  }
  collection: { waitlistEnabled: boolean; supportEnabled: boolean }
  analyticsEnabled: boolean
  notices: typeof CONSENTS.notices
  consentVersions: Record<keyof typeof CONSENTS.purposes, string>
}

export function toPublicConfig(config: AppConfig): PublicConfig {
  const id = config.identity
  return {
    schemaVersion: 1,
    siteUrl: config.siteUrl,
    environment: config.env,
    credit: { phase: config.credit.phase, operationsEnabled: config.credit.operationsEnabled },
    identity: {
      tradeName: id.tradeName,
      legalName: id.legalName ?? null,
      cnpj: id.cnpj ?? null,
      address: id.address ?? null,
      privacyContact: id.privacyContact ?? null,
      privacyOfficerName: id.privacyOfficerName ?? null,
      supportContact: id.supportContact ?? null,
      supportPhone: id.supportPhone ?? null,
      supportHours: id.supportHours ?? null,
      supportResponseTime: id.supportResponseTime ?? null,
      complete: id.complete,
      missing: id.missing,
    },
    channels: {
      whatsappNumber: config.whatsapp.businessNumber ?? null,
      biaOnWhatsapp: config.halai.enabled && Boolean(config.whatsapp.businessNumber),
      humanSupport: config.humanSupport.enabled,
      webchat: config.halai.webchat.enabled
        ? { enabled: true, scriptUrl: config.halai.webchat.scriptUrl ?? null, widgetId: config.halai.webchat.widgetId ?? null }
        : { enabled: false, scriptUrl: null, widgetId: null },
    },
    collection: {
      // Formulário do site (inclui WAITLIST_FORM_ENABLED); a rota /api/public-config também aplica a pausa do painel.
      waitlistEnabled: config.collection.siteFormEnabled,
      supportEnabled: config.collection.supportEnabled,
    },
    analyticsEnabled: config.analyticsEnabled,
    notices: CONSENTS.notices,
    consentVersions: {
      launch_notice: CONSENTS.purposes.launch_notice.version,
      marketing: CONSENTS.purposes.marketing.version,
    },
  }
}
