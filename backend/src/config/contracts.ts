import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CONTRACTS_DIR } from './paths.js'

export interface Option<T extends string = string> {
  value: T
  label: string
}

export interface ValidationContract {
  version: string
  phone: { validDdds: number[] }
  waitlist: {
    fullNameMin: number
    fullNameMax: number
    emailMax: number
    employerNameMin: number
    employerNameMax: number
    cityMax: number
    employmentTypes: Option[]
    jobTenureRanges: Option[]
    incomeRanges: Option[]
    ufs: string[]
    interestTopics: Option[]
    sources: string[]
    /** Anti-robô próprio (D1): prova de trabalho, token assinado de uso único, idade mínima e campo-armadilha. */
    antiBot: {
      difficultyBits: number
      /** Dificuldade para a rede de origem que passou de `limits.elevatedAfterPerIpPerHour` na última hora. */
      elevatedDifficultyBits: number
      minFillSeconds: number
      tokenTtlSeconds: number
      honeypotField: string
    }
    /** Limites de submissões aceitas (contadas no banco por HMAC; nunca o dado em claro). */
    limits: {
      elevatedAfterPerIpPerHour: number
      submissionsPerIpPerHour: number
      submissionsPerCpfPerDay: number
      submissionsPerPhonePerDay: number
      optOutPerIpPerHour: number
    }
    /** Validade do link seguro de preferências emitido pela Bia (uso único). */
    preferencesLinkTtlSeconds: number
  }
  support: {
    nameMax: number
    contactMax: number
    messageMin: number
    messageMax: number
    contactMethods: (Option & { requires: string | null })[]
    subjects: Option[]
  }
  utm: { allowedParams: string[]; pattern: string }
  /** Eventos de produto: nome → tipo de dimensão (services/product-events.service.ts monta as listas). */
  events: { names: Record<string, string> }
}

export type ConsentPurpose = 'launch_notice' | 'marketing'

export interface NoticeMeta {
  version: string
  status: 'draft' | 'approved'
  draftedAt: string
  revisedAt: string | null
  reviewedBy: string | null
}

export interface ConsentsContract {
  purposes: Record<ConsentPurpose, { version: string; requiredForWaitlist: boolean; channel: string; text: string }>
  notices: Record<'privacy' | 'terms' | 'cookies', NoticeMeta>
}

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(CONTRACTS_DIR, name), 'utf8')) as T
}

export const VALIDATION = readJson<ValidationContract>('validation.json')
export const CONSENTS = readJson<ConsentsContract>('consents.json')
export const NOTIFICATIONS = readJson<{ version: string; consent: { version: string; text: string }; limits: { titleMax: number; bodyMax: number; campaignTtlSeconds: number; deliveryTtlSeconds: number; maxAttempts: number }; destinations: [string, ...string[]] }>('notifications.json')

export const EMPLOYMENT_TYPES = VALIDATION.waitlist.employmentTypes.map((o) => o.value) as [string, ...string[]]
export const JOB_TENURE_RANGES = VALIDATION.waitlist.jobTenureRanges.map((o) => o.value) as [string, ...string[]]
export const INCOME_RANGES = VALIDATION.waitlist.incomeRanges.map((o) => o.value) as [string, ...string[]]
export const UFS = VALIDATION.waitlist.ufs as [string, ...string[]]
export const INTEREST_TOPICS = VALIDATION.waitlist.interestTopics.map((o) => o.value) as [string, ...string[]]
export const SUPPORT_SUBJECTS = VALIDATION.support.subjects.map((o) => o.value) as [string, ...string[]]
export const SUPPORT_CONTACT_METHODS = VALIDATION.support.contactMethods.map((o) => o.value) as [string, ...string[]]
export const WAITLIST_SOURCES = VALIDATION.waitlist.sources as [string, ...string[]]
