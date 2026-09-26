import { biaOnWhatsapp as siteBiaOnWhatsapp, openContactPanel, webchatAvailable as siteWebchat } from '@/components/site/channels'
import { publicConfig } from '@/services/site'

/**
 * Canais da Bia usados pelos formulários e páginas de relacionamento (decisão D1). A fonte é a mesma
 * do botão flutuante do site (components/site/channels.ts), que valida a configuração pública.
 * - Chat do site (webchat da Hal-AI): canal preferencial. Abrir = pedir ao painel flutuante que mostre
 *   o aviso de tratamento; o script do widget só carrega depois da confirmação da pessoa. No chat não
 *   há número atestado: ele tira dúvidas, mas não valida o telefone.
 * - WhatsApp oficial hospedado na Hal-AI: última alternativa, útil para validar o telefone e para
 *   pedir o link seguro de preferências. Texto inicial genérico, sem dados pessoais.
 */

export const webchatAvailable: boolean = siteWebchat
export const whatsappNumber: string | null = publicConfig.channels.whatsappNumber ?? null
/** A Bia responde no WhatsApp oficial (Hal-AI provisionada e número configurado). */
export const biaOnWhatsapp: boolean = siteBiaOnWhatsapp
/** A Bia pode encaminhar a uma pessoa (atendimento humano da Hal-AI). */
export const humanHandoff: boolean = publicConfig.channels.humanSupport === true

/** Link wa.me do número oficial com texto genérico (nenhum dado pessoal), ou null sem número. */
export function officialWhatsappLink(text = 'Olá, Bia! Quero falar com a Minha Folga.'): string | null {
  if (!whatsappNumber) return null
  const digits = whatsappNumber.replace(/\D/g, '')
  return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : null
}

/** Abre o chat da Bia no site (painel do botão flutuante, direto no aviso de tratamento). */
export function openWebchat(): void {
  if (webchatAvailable) openContactPanel('webchat')
}
