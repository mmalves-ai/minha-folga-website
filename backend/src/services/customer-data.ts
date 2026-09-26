import { z } from 'zod'
import {
  EMPLOYMENT_TYPES,
  INCOME_RANGES,
  INTEREST_TOPICS,
  JOB_TENURE_RANGES,
  UFS,
  VALIDATION,
} from '../config/contracts.js'
import { normalizeCpf } from '../lib/cpf.js'
import { normalizeBrazilianMobile } from '../lib/phone.js'

/**
 * Campos do cadastro (decisão D1): normalização e validação compartilhadas pelo formulário do site
 * (POST /api/waitlist), pelas ferramentas da Bia (upsert_customer) e pela página de preferências.
 * Limites e listas vêm de contracts/validation.json → waitlist. Mensagens em português, exibidas junto ao campo.
 */

export const FIELD_MESSAGES = {
  fullName: 'Informe seu nome completo (nome e sobrenome).',
  cpf: 'Confira o CPF.',
  phone: 'Confira o DDD e o número.',
  email: 'Confira o e-mail.',
  employerName: 'Informe o nome da empresa onde você trabalha.',
  employmentType: 'Escolha o tipo de vínculo.',
  jobTenure: 'Escolha há quanto tempo você está no emprego atual.',
  incomeRange: 'Escolha a faixa de salário líquido.',
  city: 'Informe a cidade.',
  uf: 'Escolha o estado (UF).',
  ageConfirmed: 'Confirme que você tem 18 anos ou mais.',
  launchNotice: 'Para entrar na lista, autorize o aviso de abertura pelo WhatsApp.',
  interestTopic: 'Escolha um tema da lista.',
  source: 'Confira este campo.',
} as const

const W = VALIDATION.waitlist

/** Sem caracteres de controle, espaços colapsados, forma NFC. */
export function cleanText(value: string): string {
  return value
    .normalize('NFC')
    .replace(/\p{C}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Letras (com acentos), espaço, apóstrofo, hífen e ponto: nomes de pessoas e de cidades. */
const NAME_CHARS = /^[\p{L}\p{M}' ’.-]+$/u

/**
 * Nome completo: 5 a 120 caracteres, ao menos duas palavras com letras, sem números nem símbolos (evita CPF,
 * telefone ou e-mail no campo de nome).
 */
export function cleanFullName(value: string): string | null {
  const name = cleanText(value)
  if (name.length < W.fullNameMin || name.length > W.fullNameMax) return null
  if (!NAME_CHARS.test(name)) return null
  const words = name.split(' ').filter((w) => /\p{L}/u.test(w))
  return words.length >= 2 ? name : null
}

const NAME_PARTICLES = new Set(['da', 'das', 'de', 'di', 'do', 'dos', 'du', 'e'])

/** Nome mascarado: primeiro nome e iniciais dos demais ("Ana Paula de Souza" → "Ana P. S."). */
export function nameHint(fullName: string): string {
  const [first, ...rest] = fullName.split(' ').filter(Boolean)
  const initials = rest
    .filter((w) => /\p{L}/u.test(w) && !NAME_PARTICLES.has(w.toLowerCase()))
    .map((w) => `${[...w][0]!.toUpperCase()}.`)
  return [first ?? '', ...initials].join(' ').trim()
}

/** Empregador (nome da empresa): 2 a 120 caracteres; recusa e-mail e sequências de 6+ dígitos (documentos). */
export function cleanEmployer(value: string): string | null {
  const name = cleanText(value)
  if (name.length < W.employerNameMin || name.length > W.employerNameMax) return null
  if (name.includes('@') || /\d{6,}/.test(name.replace(/[.\-/\s]/g, ''))) return null
  return name
}

/** Cidade: até 80 caracteres, só letras e pontuação de nomes. */
export function cleanCity(value: string): string | null {
  const city = cleanText(value)
  if (city.length < 2 || city.length > W.cityMax) return null
  return NAME_CHARS.test(city) ? city : null
}

const EmailSchema = z.email()

/** E-mail em minúsculas; null quando inválido. */
export function normalizeEmail(value: string): string | null {
  const email = value.trim().toLowerCase()
  if (!email || email.length > W.emailMax) return null
  return EmailSchema.safeParse(email).success ? email : null
}

export function normalizeUf(value: string): string | null {
  const uf = value.trim().toUpperCase()
  return (UFS as readonly string[]).includes(uf) ? uf : null
}

// Campos zod (transformam e validam; a mensagem de cada campo vem de FIELD_MESSAGES) -------------------------

function refine<T>(max: number, fn: (v: string) => T | null) {
  return z
    .string()
    .max(max)
    .transform((value, ctx) => {
      const out = fn(value)
      if (out === null) {
        ctx.addIssue({ code: 'custom', message: 'invalid' })
        return z.NEVER
      }
      return out
    })
}

export const fullNameField = refine(300, cleanFullName)
export const cpfField = refine(20, normalizeCpf)
export const phoneField = refine(20, normalizeBrazilianMobile)
export const employerField = refine(300, cleanEmployer)
export const cityField = refine(200, cleanCity)
export const ufField = refine(10, normalizeUf)
/** E-mail opcional: vazio vira null (sem e-mail). */
export const emailField = z
  .string()
  .max(300)
  .transform((value, ctx) => {
    if (!value.trim()) return null
    const email = normalizeEmail(value)
    if (!email) {
      ctx.addIssue({ code: 'custom', message: 'invalid' })
      return z.NEVER
    }
    return email
  })
export const employmentTypeField = z.enum(EMPLOYMENT_TYPES)
export const jobTenureField = z.enum(JOB_TENURE_RANGES)
export const incomeRangeField = z.enum(INCOME_RANGES)
export const interestTopicField = z.enum(INTEREST_TOPICS)
