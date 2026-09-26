import validation from '@contracts/validation.json'

/** Mesma regra do backend (contracts/validation.json): celular brasileiro com DDD válido. */
export function normalizeBrazilianMobile(input: string): string | null {
  let digits = input.replace(/\D/g, '')
  if (digits.length === 13 && digits.startsWith('55')) digits = digits.slice(2)
  if (digits.length === 12 && digits.startsWith('0')) digits = digits.slice(1)
  if (digits.length !== 11) return null
  if (!validation.phone.validDdds.includes(Number(digits.slice(0, 2)))) return null
  if (digits[2] !== '9') return null
  if (/^(\d)\1+$/.test(digits.slice(2))) return null
  return `+55${digits}`
}

/** Máscara de digitação: (11) 91234-5678. Não pune digitação incompleta. */
export function maskPhoneInput(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 2) return d.length ? `(${d}` : ''
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}
