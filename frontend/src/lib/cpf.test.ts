/**
 * CPF no cliente (decisão D1): mesma regra do servidor (11 dígitos, sem sequência repetida, dígitos
 * verificadores do módulo 11). A máscara é só de digitação; a API recebe apenas os dígitos.
 */
import { describe, expect, it } from 'vitest'
import { cpfDigits, isValidCpf, maskCpfInput, normalizeCpf } from './cpf'

/** Gera um CPF válido a partir de 9 dígitos (cálculo independente do código testado). */
function withCheckDigits(base: string): string {
  const calc = (digits: string) => {
    const sum = digits.split('').reduce((acc, d, i) => acc + Number(d) * (digits.length + 1 - i), 0)
    const r = sum % 11
    return r < 2 ? 0 : 11 - r
  }
  const d1 = calc(base)
  const d2 = calc(`${base}${d1}`)
  return `${base}${d1}${d2}`
}

describe('CPF', () => {
  it('aceita CPFs com dígitos verificadores corretos, com ou sem máscara', () => {
    for (const cpf of ['52998224725', '529.982.247-25', '111.444.777-35', ' 111 444 777 35 ']) expect(isValidCpf(cpf), cpf).toBe(true)
    for (const base of ['123456789', '987654321', '000000001', '100000000', '739104582']) {
      expect(isValidCpf(withCheckDigits(base)), base).toBe(true)
    }
  })

  it('recusa dígito verificador errado, tamanho errado e sequências de um só algarismo', () => {
    expect(isValidCpf('52998224724')).toBe(false)
    expect(isValidCpf('52998224735')).toBe(false)
    expect(isValidCpf('5299822472')).toBe(false)
    expect(isValidCpf('529982247250')).toBe(false)
    expect(isValidCpf('')).toBe(false)
    for (let d = 0; d <= 9; d++) expect(isValidCpf(String(d).repeat(11)), `${d} repetido`).toBe(false)
  })

  it('confere ao contrário: qualquer outro par de dígitos verificadores é recusado', () => {
    for (const base of ['390533447', '123456789', '000000001']) {
      const valid = withCheckDigits(base)
      for (let dv = 0; dv < 100; dv++) {
        const candidate = `${base}${String(dv).padStart(2, '0')}`
        expect(isValidCpf(candidate), candidate).toBe(candidate === valid)
      }
    }
  })

  it('a API recebe só os 11 dígitos; inválido não sai do formulário', () => {
    expect(normalizeCpf('529.982.247-25')).toBe('52998224725')
    expect(normalizeCpf('529.982.247-24')).toBeNull()
    expect(cpfDigits('529.982.247-25999')).toBe('52998224725')
  })

  it('máscara de digitação progressiva 000.000.000-00', () => {
    expect(maskCpfInput('')).toBe('')
    expect(maskCpfInput('529')).toBe('529')
    expect(maskCpfInput('5299')).toBe('529.9')
    expect(maskCpfInput('5299822')).toBe('529.982.2')
    expect(maskCpfInput('52998224725')).toBe('529.982.247-25')
    expect(maskCpfInput('529.982.247-25 extra 99')).toBe('529.982.247-25')
  })
})
