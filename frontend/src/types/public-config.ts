/** Espelho do contrato `PublicConfig` do backend (backend/src/config/public.ts). */
export type CreditPhase = 'PRE_LAUNCH' | 'PILOT' | 'LIVE'

export interface NoticeMeta {
  version: string
  status: 'draft' | 'approved'
  draftedAt: string
  revisedAt: string | null
  reviewedBy: string | null
}

/**
 * Widget de webchat da Hal-AI (decisão D1, docs/DECISOES.md). Placeholder: enquanto a Hal-AI não
 * provisionar o widget, `enabled` fica false e nada é carregado. Sem chave de API: só o endereço público
 * do script e o identificador público do widget.
 */
export interface WebchatChannel {
  enabled: boolean
  /** Endereço HTTPS do script do widget (a origem precisa estar liberada na CSP do servidor web). */
  scriptUrl: string | null
  /** Identificador público do widget na Hal-AI. */
  widgetId: string | null
}

export interface PublicConfig {
  schemaVersion: 1
  siteUrl: string
  environment: 'development' | 'test' | 'staging' | 'production'
  credit: { phase: CreditPhase; operationsEnabled: boolean }
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
    /** Número oficial hospedado na Hal-AI (WhatsApp Cloud). */
    whatsappNumber: string | null
    biaOnWhatsapp: boolean
    humanSupport: boolean
    webchat: WebchatChannel
  }
  collection: { waitlistEnabled: boolean; supportEnabled: boolean }
  analyticsEnabled: boolean
  notices: Record<'privacy' | 'terms' | 'cookies', NoticeMeta>
  consentVersions: Record<'launch_notice' | 'marketing', string>
}
