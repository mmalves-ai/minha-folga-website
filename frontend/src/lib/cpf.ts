/**
 * CPF no cliente com as mesmas regras do servidor (decisão D1, docs/DECISOES.md): 11 dígitos, sem
 * sequência de um só algarismo e com os dois dígitos verificadores corretos (módulo 11). O valor
 * enviado à API é só dígitos; a máscara é apenas de digitação. Nada disso é gravado no navegador.
 */

/** Só os dígitos (no máximo 11), aceitando CPF colado com pontos, traço ou espaços. */
export function cpfDigits(value: string): string {
  return value.replace(/\D/g, '').slice(0, 11)
}

function checkDigit(digits: string, length: number): number {
  let sum = 0
  for (let i = 0; i < length; i++) sum += Number(digits[i]) * (length + 1 - i)
  const rest = (sum * 10) % 11
  return rest === 10 ? 0 : rest
}

/** CPF válido: 11 dígitos, não repetidos, com os dígitos verificadores corretos. */
export function isValidCpf(value: string): boolean {
  const digits = value.replace(/\D/g, '')
  if (digits.length !== 11) return false
  if (/^(\d)\1{10}$/.test(digits)) return false
  return checkDigit(digits, 9) === Number(digits[9]) && checkDigit(digits, 10) === Number(digits[10])
}

/** CPF normalizado para a API (11 dígitos) ou null se inválido. */
export function normalizeCpf(value: string): string | null {
  const digits = value.replace(/\D/g, '')
  return isValidCpf(digits) ? digits : null
}

/** Máscara de digitação 000.000.000-00. Não pune digitação incompleta. */
export function maskCpfInput(value: string): string {
  const d = cpfDigits(value)
  if (d.length <= 3) return d
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
}
