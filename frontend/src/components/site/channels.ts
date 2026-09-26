import { biaChannelAvailable, publicConfig, whatsappLink } from '@/services/site'
import type { WebchatChannel } from '@/types/public-config'

/**
 * Canais de conversa exibidos no site (decisão D1, docs/DECISOES.md). Todo o atendimento por mensagem é da
 * plataforma Hal-AI: o chat do site (webchat, canal preferencial) e o WhatsApp oficial hospedado nela (última
 * alternativa). Este site não envia nem recebe mensagens; ele só oferece o caminho até esses canais.
 *
 * Tudo aqui é decidido pela configuração pública do build: nada lê `window` e o módulo é seguro na
 * pré-renderização.
 */

/** Widget pronto para carregar: só existe com o canal ligado e com endereço e identificador válidos. */
export interface WebchatConfig {
  scriptUrl: string
  widgetId: string
  /** Origem do script (para a CSP e para o aviso de tratamento). */
  origin: string
}

/** Identificador público do widget: caracteres simples, sem espaço nem sinais que mudem o HTML. */
const WIDGET_ID = /^[A-Za-z0-9_-]{1,128}$/

/**
 * Valida a configuração do widget. Recusa (null) qualquer coisa que não seja `https://` absoluto, com
 * credenciais na URL ou sem identificador: nesse caso o canal simplesmente não aparece.
 */
export function resolveWebchat(raw: Partial<WebchatChannel> | null | undefined): WebchatConfig | null {
  if (!raw || raw.enabled !== true || typeof raw.scriptUrl !== 'string' || typeof raw.widgetId !== 'string') return null
  if (!WIDGET_ID.test(raw.widgetId)) return null
  let url: URL
  try {
    url = new URL(raw.scriptUrl)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null
  return { scriptUrl: url.href, widgetId: raw.widgetId, origin: url.origin }
}

/** Texto genérico do link do WhatsApp: nunca CPF, número ou dado de crédito (seção 7, "Canais"). */
export const WHATSAPP_CONTACT_TEXT = 'Olá! Quero tirar uma dúvida sobre a Minha Folga.'

/** Widget da Hal-AI configurado neste build (null = desligado, o padrão). */
export const webchat: WebchatConfig | null = resolveWebchat(publicConfig.channels.webchat)
export const webchatAvailable = webchat !== null

/** Link `wa.me` para o número oficial hospedado na Hal-AI, só com número configurado. */
export const whatsappContactUrl: string | null = whatsappLink(WHATSAPP_CONTACT_TEXT)

/** A Bia atende no WhatsApp oficial (Hal-AI provisionada e número configurado). */
export const biaOnWhatsapp = biaChannelAvailable

/** Há algum canal real para conversar com a Bia (chat do site ou WhatsApp). */
export const biaAnyChannel = webchatAvailable || biaOnWhatsapp

export type BiaChannelSet = 'both' | 'webchat' | 'whatsapp' | 'none'

/** Combinação de canais da Bia ativos, para escolher o texto certo de cada página. */
export function biaChannelSet(hasWebchat: boolean = webchatAvailable, hasWhatsapp: boolean = biaOnWhatsapp): BiaChannelSet {
  if (hasWebchat && hasWhatsapp) return 'both'
  if (hasWebchat) return 'webchat'
  if (hasWhatsapp) return 'whatsapp'
  return 'none'
}

/**
 * Marcador (atributo, sem valor) dos blocos da página que já mostram os canais de conversa da Bia (chat do site ou
 * WhatsApp): ações de BiaChannelActions, lista de canais do /atendimento etc. Enquanto um deles está na área
 * visível, o botão flutuante se recolhe para não cobri-lo (FloatingContact). Só marque o bloco quando ele de fato
 * mostrar um canal, e nunca um elemento com `display: contents` (sem caixa, nunca aparece como visível).
 */
export const INLINE_CONTACT_ATTR = 'data-inline-contact'

/** Evento que abre o painel do botão flutuante (atendido por FloatingContact, montado no DefaultLayout). */
export const OPEN_CONTACT_EVENT = 'mf:open-contact'

export type ContactTarget = 'menu' | 'webchat'

/**
 * Abre o painel de conversa. `webchat` leva direto ao aviso de tratamento do chat do site (o script da
 * Hal-AI continua carregando só depois da confirmação da pessoa). Sem efeito na pré-renderização.
 */
export function openContactPanel(target: ContactTarget = 'menu'): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<{ target: ContactTarget }>(OPEN_CONTACT_EVENT, { detail: { target } }))
}
