import publicConfig from 'virtual:mf-public-config'
import site from '@content/site.yaml'
import type { CreditPhase } from '@/types/public-config'

export { publicConfig, site }

export const SITE_URL = (import.meta.env.VITE_SITE_URL || publicConfig.siteUrl).replace(/\/$/, '')

export interface AvailabilityTexts {
  ready: boolean
  badge: string
  short: string
  footer: string
  microcopy: string
}

const phase: CreditPhase = publicConfig.credit.phase
const texts = site.availability[phase] as AvailabilityTexts | undefined
if (!texts?.ready) {
  // Mudança de fase é coordenada: sem textos próprios revisados, o build é interrompido.
  throw new Error(`Textos de disponibilidade da fase ${phase} não estão prontos em content/site.yaml`)
}

export const availability: AvailabilityTexts = texts
export const creditPhase = phase
export const isPreLaunch = phase === 'PRE_LAUNCH'

/** Link do WhatsApp oficial, somente com número confirmado na configuração. Texto genérico, sem dados pessoais. */
export function whatsappLink(text = 'Olá! Quero tirar uma dúvida sobre a Minha Folga.'): string | null {
  const n = publicConfig.channels.whatsappNumber
  if (!n) return null
  return `https://wa.me/${n.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`
}

/** Bia só aparece como canal real quando Hal-AI e WhatsApp estão provisionados. */
export const biaChannelAvailable = publicConfig.channels.biaOnWhatsapp && Boolean(publicConfig.channels.whatsappNumber)
