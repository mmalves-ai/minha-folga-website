import { formatDate } from '@/lib/format'
import type { NoticeMeta } from '@/types/public-config'

/** Documentos legais do site, na ordem exibida no seletor e nos links cruzados. */
export type NoticeKey = 'privacy' | 'terms' | 'cookies'

export interface LegalDocLink {
  notice: NoticeKey
  label: string
  /** Rótulo curto do seletor no celular. */
  short: string
  to: string
  hint: string
}

export const LEGAL_DOCS: LegalDocLink[] = [
  { notice: 'privacy', label: 'Aviso de Privacidade', short: 'Privacidade', to: '/privacidade', hint: 'Como cuidamos dos seus dados' },
  { notice: 'terms', label: 'Termos de uso', short: 'Termos', to: '/termos', hint: 'Regras do site, do atendimento e do cadastro' },
  { notice: 'cookies', label: 'Política de cookies', short: 'Cookies', to: '/cookies', hint: 'O que fica no seu navegador' },
]

/**
 * Linha de versão a partir de contracts/consents.json (via publicConfig.notices). Só é "revisada" com
 * status approved E data de revisão; qualquer outro caso é rascunho pendente de revisão jurídica.
 */
export function noticeVersionLabel(meta: NoticeMeta): string {
  if (meta.status === 'approved' && meta.revisedAt) {
    return `Versão ${meta.version} · revisada em ${formatDate(meta.revisedAt)}`
  }
  return `Versão ${meta.version} · rascunho elaborado em ${formatDate(meta.draftedAt)} · pendente de revisão jurídica`
}

export function isNoticeApproved(meta: NoticeMeta): boolean {
  return meta.status === 'approved' && Boolean(meta.revisedAt)
}

export interface TocItem {
  id: string
  text: string
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }

function plainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m] ?? m)
    .replace(/\s+/g, ' ')
    .trim()
}

/** Sumário a partir dos H2 do HTML gerado no build (os ids vêm do plugin de conteúdo). */
export function extractToc(html: string): TocItem[] {
  return [...html.matchAll(/<h2 id="([^"]+)">([\s\S]*?)<\/h2>/g)].map((m) => ({ id: m[1]!, text: plainText(m[2]!) }))
}

export type LegalBlock = { type: 'html'; html: string } | { type: 'slot'; name: string }

/**
 * Divide o HTML nos pontos marcados com um parágrafo `[[nome]]` no Markdown, onde a página encaixa
 * conteúdo dinâmico (inventário de cookies, contato de privacidade, situação da medição).
 */
export function splitLegalBlocks(html: string): LegalBlock[] {
  const parts = html.split(/<p>\[\[([a-z0-9-]+)\]\]<\/p>\n?/)
  const blocks: LegalBlock[] = []
  parts.forEach((part, i) => {
    if (i % 2 === 1) blocks.push({ type: 'slot', name: part })
    else if (part.trim()) blocks.push({ type: 'html', html: part })
  })
  return blocks
}

/** Tecnologia listada no inventário (content/legal/cookie-consent.yaml → technologies). */
export interface CookieTechnology {
  id: string
  name: string
  kind: string
  category: 'essential' | 'measurement'
  /** `analytics`: só existe com a medição agregada ativada (publicConfig.analyticsEnabled). */
  when: 'always' | 'analytics'
  provider: string
  purpose: string
  content: string
  duration: string
  details: string
}

/** Evento da medição agregada descrito ao visitante (content/legal/cookie-consent.yaml → events). */
export interface MeasurementEventText {
  /** Nome do evento no contrato (contracts/validation.json → events.names). */
  name: string
  label: string
  /** O único valor que segue com o evento, em linguagem simples. */
  dimension: string
}

/** Somente o que o código desta versão realmente usa. */
export function activeTechnologies(list: CookieTechnology[], analyticsEnabled: boolean): CookieTechnology[] {
  return list.filter((t) => t.when === 'always' || (t.when === 'analytics' && analyticsEnabled))
}
