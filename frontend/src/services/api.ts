/**
 * Cliente HTTP da API (mesma origem, sob /api). Nunca envia segredos: autenticação é feita por
 * cookies HttpOnly definidos pelo servidor. Erros sempre viram ApiError com mensagem em português.
 */
const BASE = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')

export const NETWORK_ERROR_MESSAGE = 'Não foi possível concluir. Tente novamente em instantes.'

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly fields: Record<string, string>
  readonly details: Record<string, unknown>
  constructor(status: number, code: string, message: string, fields: Record<string, string> = {}, details: Record<string, unknown> = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.fields = fields
    this.details = details
  }
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  /** Token CSRF da sessão administrativa (enviado em cabeçalho, nunca em URL). */
  csrfToken?: string
  timeoutMs?: number
  signal?: AbortSignal
  headers?: Record<string, string>
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000)
  options.signal?.addEventListener('abort', () => controller.abort())
  const headers: Record<string, string> = { Accept: 'application/json', ...options.headers }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (options.csrfToken) headers['X-CSRF-Token'] = options.csrfToken

  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      method: options.method ?? (options.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      credentials: 'same-origin',
      signal: controller.signal,
      cache: 'no-store',
    })
  } catch {
    throw new ApiError(0, 'network_error', NETWORK_ERROR_MESSAGE)
  } finally {
    clearTimeout(timeout)
  }

  if (res.status === 204) return undefined as T
  const type = res.headers.get('content-type') ?? ''
  if (!type.includes('application/json')) {
    throw new ApiError(res.status, 'unexpected_response', NETWORK_ERROR_MESSAGE)
  }
  const data = (await res.json().catch(() => null)) as any
  if (!res.ok) {
    const err = data?.error ?? {}
    const { code, message, fields, ...details } = err
    throw new ApiError(res.status, code ?? 'unknown_error', message ?? NETWORK_ERROR_MESSAGE, fields ?? {}, details)
  }
  return data as T
}

/** Download autenticado (ex.: exportação CSV do painel). */
export async function apiDownload(path: string, csrfToken: string, body: unknown): Promise<Blob> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify(body),
    credentials: 'same-origin',
  }).catch(() => {
    throw new ApiError(0, 'network_error', NETWORK_ERROR_MESSAGE)
  })
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as any
    throw new ApiError(res.status, data?.error?.code ?? 'unknown_error', data?.error?.message ?? NETWORK_ERROR_MESSAGE)
  }
  return res.blob()
}
