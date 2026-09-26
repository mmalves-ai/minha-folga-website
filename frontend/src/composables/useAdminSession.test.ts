// @vitest-environment jsdom
/**
 * Riscos concretos da sessão administrativa no navegador: token CSRF só em memória e só nos
 * métodos inseguros, 401 derrubando a sessão local (sem derrubar em erro de credencial),
 * 403 com mensagem de permissão, renovação do CSRF e QR exibido apenas como imagem.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { svgToDataUrl } from '@/components/admin/qr'
import {
  FORBIDDEN_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
  __resetAdminSessionForTests,
  adminApi,
  login,
  logout,
  refreshSession,
  useAdminSession,
  verifyMfa,
} from './useAdminSession'

type Reply = { status: number; body?: unknown }

const calls: { url: string; init: RequestInit }[] = []
let replies: Reply[] = []

function json(status: number, body?: unknown): Response {
  if (status === 204) return new Response(null, { status })
  return new Response(JSON.stringify(body ?? {}), { status, headers: { 'content-type': 'application/json' } })
}

const SESSION = {
  status: 'authenticated',
  user: { id: 'u1', email: 'a@b.c', displayName: 'Ana', role: 'support', mfaEnabled: true, mustChangePassword: false, disabled: false, lastLoginAt: null, createdAt: '2026-09-01T00:00:00Z' },
  permissions: ['leads:read', 'support:read'],
  csrfToken: 'csrf-1',
}

function headersOf(i: number): Record<string, string> {
  return (calls[i]?.init.headers ?? {}) as Record<string, string>
}

beforeEach(() => {
  __resetAdminSessionForTests()
  calls.length = 0
  replies = []
  localStorage.clear()
  sessionStorage.clear()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      const next = replies.shift()
      if (!next) throw new Error(`sem resposta simulada para ${url}`)
      return json(next.status, next.body)
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function signIn() {
  replies.push({ status: 200, body: SESSION })
  await refreshSession()
}

describe('sessão administrativa', () => {
  it('envia X-CSRF-Token apenas em métodos inseguros e sempre com corpo JSON', async () => {
    await signIn()
    replies.push({ status: 200, body: { items: [] } }, { status: 204 })
    await adminApi('/admin/leads')
    await adminApi('/admin/auth/logout', { method: 'POST' })
    expect(headersOf(1)['X-CSRF-Token']).toBeUndefined()
    expect(headersOf(2)['X-CSRF-Token']).toBe('csrf-1')
    expect(headersOf(2)['Content-Type']).toBe('application/json')
    expect(calls[2]?.init.body).toBe('{}')
  })

  it('401 em chamada do painel volta para a entrada e descarta usuário, permissões e token', async () => {
    await signIn()
    replies.push({ status: 401, body: { error: { code: 'unauthorized', message: 'É preciso entrar para continuar.' } } })
    await expect(adminApi('/admin/leads')).rejects.toMatchObject({ status: 401 })
    const { state, can } = useAdminSession()
    expect(state.status).toBe('anonymous')
    expect(state.notice).toBe(SESSION_EXPIRED_MESSAGE)
    expect(state.csrfToken).toBeNull()
    expect(state.user).toBeNull()
    expect(can('leads:read')).toBe(false)
  })

  it('senha atual incorreta (401 de credencial) não derruba a sessão', async () => {
    await signIn()
    replies.push({ status: 401, body: { error: { code: 'invalid_credentials', message: 'Senha incorreta.' } } })
    await expect(adminApi('/admin/auth/password', { body: { currentPassword: 'x', newPassword: 'y'.repeat(12) } })).rejects.toMatchObject({
      code: 'invalid_credentials',
    })
    expect(useAdminSession().state.status).toBe('authenticated')
  })

  it('403 sem permissão vira mensagem de permissão, sem encerrar a sessão', async () => {
    await signIn()
    replies.push({ status: 403, body: { error: { code: 'forbidden', message: 'Você não tem permissão para esta ação.' } } })
    await expect(adminApi('/admin/users')).rejects.toMatchObject({ status: 403, message: FORBIDDEN_MESSAGE })
    expect(useAdminSession().state.status).toBe('authenticated')
  })

  it('CSRF recusado: renova a sessão uma vez e repete com o token novo', async () => {
    await signIn()
    replies.push(
      { status: 403, body: { error: { code: 'csrf_invalid', message: 'Token inválido.' } } },
      { status: 200, body: { ...SESSION, csrfToken: 'csrf-2' } },
      { status: 200, body: { id: 'x' } },
    )
    await adminApi('/admin/support/abc', { method: 'PATCH', body: { status: 'in_progress' } })
    expect(calls.map((c) => c.url)).toEqual(['/api/admin/auth/me', '/api/admin/support/abc', '/api/admin/auth/me', '/api/admin/support/abc'])
    expect(headersOf(3)['X-CSRF-Token']).toBe('csrf-2')
  })

  it('login e MFA mantêm o token só em memória (nada em localStorage/sessionStorage)', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    replies.push({ status: 200, body: { status: 'mfa_required', csrfToken: 'partial-csrf' } })
    await expect(login('a@b.c', 'senha-bem-longa')).resolves.toBe('mfa_required')
    replies.push({ status: 200, body: SESSION })
    await verifyMfa('123456')
    expect(headersOf(1)['X-CSRF-Token']).toBe('partial-csrf')
    expect(useAdminSession().state.status).toBe('authenticated')
    expect(setItem).not.toHaveBeenCalled()
    expect(localStorage.length + sessionStorage.length).toBe(0)
    expect(document.cookie).toBe('')
    setItem.mockRestore()
  })

  it('credencial inválida no login não abre sessão parcial', async () => {
    replies.push({ status: 401, body: { error: { code: 'invalid_credentials', message: 'E-mail ou senha incorretos.' } } })
    await expect(login('a@b.c', 'errada')).rejects.toMatchObject({ code: 'invalid_credentials' })
    expect(useAdminSession().state.status).toBe('loading')
    expect(useAdminSession().state.csrfToken).toBeNull()
  })

  it('logout limpa o estado local mesmo sem rede', async () => {
    await signIn()
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))))
    await logout()
    const { state } = useAdminSession()
    expect(state.status).toBe('anonymous')
    expect(state.csrfToken).toBeNull()
  })

  it('falha de rede na primeira consulta não inventa sessão', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))))
    await expect(refreshSession()).rejects.toBeTruthy()
    expect(useAdminSession().state.status).toBe('unavailable')
  })
})

describe('QR do autenticador', () => {
  it('só aceita SVG e codifica UTF-8 em base64 (exibido como <img>, nunca como HTML)', () => {
    expect(svgToDataUrl('<script>alert(1)</script>')).toBeNull()
    expect(svgToDataUrl('<div><svg></svg></div>')).toBeNull()
    const url = svgToDataUrl('<svg xmlns="http://www.w3.org/2000/svg"><title>Painel ção</title></svg>')
    expect(url).toMatch(/^data:image\/svg\+xml;base64,/)
    const decoded = new TextDecoder().decode(Uint8Array.from(atob(url!.split(',')[1]!), (c) => c.charCodeAt(0)))
    expect(decoded).toContain('Painel ção')
  })
})
