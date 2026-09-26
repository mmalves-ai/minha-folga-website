import type { z } from 'zod'
import { Errors } from '../lib/errors.js'

/**
 * Valida um corpo/consulta com zod em modo estrito (campos inesperados são rejeitados pelo esquema,
 * que deve usar z.strictObject). Converte erros em `validation_error` com campos em português.
 */
export function parseOrThrow<S extends z.ZodType>(schema: S, input: unknown, messages: Record<string, string> = {}): z.infer<S> {
  const result = schema.safeParse(input)
  if (result.success) return result.data
  const fields: Record<string, string> = {}
  for (const issue of result.error.issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) fields[key] = 'Campo não esperado.'
      continue
    }
    const key = issue.path.map(String).join('.') || '_'
    if (!fields[key]) fields[key] = messages[key] ?? 'Confira este campo.'
  }
  throw Errors.validation(fields)
}
