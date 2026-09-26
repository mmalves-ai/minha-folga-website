import { hmacHex } from './crypto.js'

/**
 * CPF (decisão D1, docs/DECISOES.md): validado pelos dígitos verificadores, guardado só cifrado
 * (contexto `lead.cpf:<id>`), deduplicado por HMAC com a chave de deduplicação (domínio 'cpf') e exibido
 * mascarado (`***.***.***-12`). Nunca em log, URL, métrica ou armazenamento do navegador.
 */

/** Confere os dígitos verificadores de 11 dígitos. Sequências repetidas (000…, 111…) são recusadas. */
export function isValidCpfDigits(digits: string): boolean {
  if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return false
  const check = (len: number) => {
    let sum = 0
    for (let i = 0; i < len; i++) sum += Number(digits[i]) * (len + 1 - i)
    const rest = (sum * 10) % 11
    return rest === 10 ? 0 : rest
  }
  return check(9) === Number(digits[9]) && check(10) === Number(digits[10])
}

/**
 * Normaliza o CPF digitado (com ou sem pontuação: `529.982.247-25`, `52998224725`, `529 982 247 25`)
 * para os 11 dígitos. Retorna null quando há outro caractere, quantidade errada ou dígito verificador inválido.
 */
export function normalizeCpf(input: string): string | null {
  if (typeof input !== 'string' || input.length > 20) return null
  const trimmed = input.trim()
  if (!/^[\d.\-\s/]+$/.test(trimmed)) return null
  const digits = trimmed.replace(/\D/g, '')
  return isValidCpfDigits(digits) ? digits : null
}

/** Dica mascarada para o painel e para o titular: só os dois dígitos verificadores. */
export function cpfHint(digits: string): string {
  return `***.***.***-${digits.slice(9, 11)}`
}

/** Formato de exibição completo (somente na revelação auditada do painel). */
export function formatCpf(digits: string): string {
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9, 11)}`
}

/** Chave de deduplicação do CPF (HMAC). Pseudonimização, não anonimização. */
export function cpfKey(digits: string, dedupKey: Buffer): string {
  return hmacHex(digits, dedupKey, 'cpf')
}
