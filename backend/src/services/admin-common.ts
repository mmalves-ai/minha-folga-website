import { z } from 'zod'
import { Errors } from '../lib/errors.js'
import type { AdminRole } from './admin-permissions.js'

/**
 * Utilidades compartilhadas pelas consultas do painel.
 * Datas de filtro (YYYY-MM-DD) são dias do horário de Brasília; `to` é inclusivo.
 */
export const ADMIN_TIME_ZONE = 'America/Sao_Paulo'

const DATE = /^\d{4}-\d{2}-\d{2}$/

export const dateParam = z
  .string()
  .regex(DATE)
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v))

export const pageParam = z.coerce.number().int().min(1).max(100_000).default(1)
export const pageSizeParam = z.coerce.number().int().min(1).max(100).default(25)

export const uuidParam = z.uuid()

export const DATE_MESSAGES = { from: 'Use uma data no formato AAAA-MM-DD.', to: 'Use uma data no formato AAAA-MM-DD.' }

/** Confere se o intervalo de datas é coerente. */
export function checkRange(from?: string, to?: string): void {
  if (from && to && from > to) throw Errors.validation({ to: 'A data final precisa ser igual ou posterior à inicial.' })
}

/**
 * Acrescenta a uma lista de condições o filtro de período sobre `column` (timestamptz).
 * Os parâmetros são datas; a conversão para o fuso local acontece no banco.
 */
export function addDateRange(where: string[], params: unknown[], column: string, from?: string, to?: string): void {
  if (from) {
    params.push(from)
    where.push(`${column} >= (($${params.length}::date)::timestamp AT TIME ZONE '${ADMIN_TIME_ZONE}')`)
  }
  if (to) {
    params.push(to)
    where.push(`${column} < ((($${params.length}::date) + 1)::timestamp AT TIME ZONE '${ADMIN_TIME_ZONE}')`)
  }
}

export function iso(value: Date | string | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null
}

export interface AdminUserRef {
  id: string
  displayName: string
  role: AdminRole
}

/** Monta a referência de pessoa a partir de colunas prefixadas (ex.: assignee_id, assignee_name…). */
export function userRef(id: string | null, displayName: string | null, role: AdminRole | null): AdminUserRef | null {
  return id && displayName && role ? { id, displayName, role } : null
}

export interface Page<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}
