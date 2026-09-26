import { VALIDATION } from '../config/contracts.js'

/**
 * Normaliza um celular brasileiro com DDD para E.164 (+55DDNNNNNNNNN).
 * Aceita apenas celulares (9 dígitos começando com 9): o contato é pelo WhatsApp oficial (hospedado na Hal-AI).
 * Retorna null quando o número não é plausível; a mensagem ao usuário é "Confira o DDD e o número."
 */
export function normalizeBrazilianMobile(input: string): string | null {
  let digits = input.replace(/\D/g, '')
  if (digits.length === 13 && digits.startsWith('55')) digits = digits.slice(2)
  if (digits.length === 12 && digits.startsWith('0')) digits = digits.slice(1)
  if (digits.length !== 11) return null
  const ddd = Number(digits.slice(0, 2))
  if (!VALIDATION.phone.validDdds.includes(ddd)) return null
  if (digits[2] !== '9') return null
  if (/^(\d)\1+$/.test(digits.slice(2))) return null
  return `+55${digits}`
}

/** Dica mascarada para operação: DDD e dois últimos dígitos. Ex.: "(11) •••••-••34". */
export function phoneHint(e164: string): string {
  const d = e164.replace(/\D/g, '').slice(2)
  return `(${d.slice(0, 2)}) •••••-••${d.slice(-2)}`
}
