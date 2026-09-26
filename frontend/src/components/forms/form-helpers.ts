/** Utilitários dos formulários de relacionamento (sem dependência de Vue, testáveis isoladamente). */
import { ApiError, NETWORK_ERROR_MESSAGE } from '@/services/api'

/**
 * Mesma checagem simples do servidor para e-mail (formato, sem espaços). Limite: 120 no atendimento
 * (support.contactMax) e 160 no cadastro (waitlist.emailMax).
 */
export function isValidEmail(value: string, max = 120): boolean {
  const v = value.trim()
  return v.length > 0 && v.length <= max && /^[^\s@]+@[^\s@]+\.[^\s@.]{2,}$/.test(v)
}

/** Espaços repetidos viram um só (nome, empresa, cidade), sem mexer no que foi digitado na tela. */
export function collapseSpaces(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

// Mesmas regras do servidor (backend/src/services/customer-data.ts), para o erro aparecer antes do envio.
/** Letras (com acentos), espaço, apóstrofo, hífen e ponto: nomes de pessoas e de cidades. */
const NAME_CHARS = /^[\p{L}\p{M}' ’.-]+$/u

/** Nome completo: só caracteres de nome e ao menos duas palavras com letras (o tamanho é conferido à parte). */
export function looksLikeFullName(value: string): { chars: boolean; words: boolean } {
  const v = collapseSpaces(value)
  return { chars: NAME_CHARS.test(v), words: v.split(' ').filter((w) => /\p{L}/u.test(w)).length >= 2 }
}

/** Empresa: sem e-mail e sem sequência de 6 ou mais dígitos (número de documento). */
export function looksLikeEmployer(value: string): boolean {
  const v = collapseSpaces(value)
  return !v.includes('@') && !/\d{6,}/.test(v.replace(/[.\-/\s]/g, ''))
}

/** Cidade: só caracteres de nome. */
export function looksLikeCity(value: string): boolean {
  return NAME_CHARS.test(collapseSpaces(value))
}

/** Aceita número colado com +55 ou 0 na frente antes de aplicar a máscara (autopreenchimento). */
export function stripCountryPrefix(value: string): string {
  let digits = value.replace(/\D/g, '')
  if (digits.length >= 12 && digits.startsWith('55')) digits = digits.slice(2)
  if (digits.length === 12 && digits.startsWith('0')) digits = digits.slice(1)
  return digits
}

/** Substitui {chave} por valores (textos de interface vindos do conteúdo versionado). */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, key: string) => (key in values ? String(values[key]) : m))
}

/** Erro de rede, resposta inesperada ou falha interna: mensagem genérica, nunca sucesso. */
export function isTransientError(e: unknown): boolean {
  return !(e instanceof ApiError) || e.status === 0 || e.status >= 500 || e.code === 'unexpected_response'
}

/** Mensagem exibível de um erro da API; falhas transitórias usam o texto padrão de rede. */
export function errorMessage(e: unknown): string {
  if (isTransientError(e)) return NETWORK_ERROR_MESSAGE
  return (e as ApiError).message || NETWORK_ERROR_MESSAGE
}

/** Número inteiro de um detalhe de erro (attemptsRemaining, retryAfterSeconds). */
export function detailNumber(e: ApiError, key: string): number | null {
  const n = Number(e.details[key])
  return Number.isFinite(n) ? n : null
}

// ---------------------------------------------------------------------- acompanhamento de atendimento
export const PROTOCOL_PATTERN = /^MF-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{2}$/
const TOKEN_PATTERN = /^[A-Za-z0-9_\-.~]{16,256}$/

export interface TrackingRef {
  protocol: string
  token: string
}

/**
 * Lê protocolo e token de um link de acompanhamento: URL completa, só o fragmento (#p=…&t=…)
 * ou o trecho "p=…&t=…". Retorna null se faltar algo ou se o formato não for o esperado.
 */
export function parseTrackingRef(input: string): TrackingRef | null {
  const text = input.replace(/\s+/g, '')
  if (!text) return null
  const hashAt = text.indexOf('#')
  const part = hashAt >= 0 ? text.slice(hashAt + 1) : text.includes('?') ? text.slice(text.indexOf('?') + 1) : text
  const params = new URLSearchParams(part)
  const protocol = (params.get('p') ?? '').toUpperCase()
  const token = params.get('t') ?? ''
  if (!PROTOCOL_PATTERN.test(protocol) || !TOKEN_PATTERN.test(token)) return null
  return { protocol, token }
}

/** Caminho do link seguro. Protocolo e token ficam no fragmento, que não vai ao servidor nem ao Referer. */
export function trackingPath(ref: TrackingRef): string {
  return `/atendimento/acompanhar#p=${encodeURIComponent(ref.protocol)}&t=${encodeURIComponent(ref.token)}`
}

/** Token de link de preferências (#token=…) conforme o contrato (20 a 100 caracteres). */
export function parsePreferencesToken(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const token = (params.get('token') ?? '').trim()
  return token.length >= 20 && token.length <= 100 && /^[A-Za-z0-9_\-.~]+$/.test(token) ? token : null
}

/** Leva o foco a um elemento sem rolagem brusca e o traz para a área visível. */
export function focusAndReveal(el: HTMLElement | null | undefined) {
  if (!el) return
  el.focus({ preventScroll: true })
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  el.scrollIntoView?.({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })
}

/**
 * Foco perdido: no <body> (o controle acionado sumiu ou ficou desabilitado) ou em elemento que
 * saiu da página. Nesses casos quem usa teclado voltaria ao topo, e o leitor de tela não saberia
 * onde está.
 */
export function focusIsLost(): boolean {
  if (typeof document === 'undefined') return false
  const active = document.activeElement
  return !active || active === document.body || active === document.documentElement || !active.isConnected
}

/** Depois de uma ação: se o foco se perdeu, leva-o ao alvo indicado (sem tirar um foco já colocado). */
export function focusIfLost(target: HTMLElement | null | undefined): void {
  if (focusIsLost()) target?.focus()
}
