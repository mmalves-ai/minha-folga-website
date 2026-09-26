/**
 * Sessão administrativa. A autenticação é o cookie HttpOnly `mf_admin` definido pelo servidor;
 * aqui ficam só usuário, permissões e o token CSRF — em memória, nunca em localStorage,
 * sessionStorage, cookie legível ou URL. Autorização de verdade é sempre do backend.
 *
 * No SSR/pré-render o estado permanece em `loading` e nenhuma chamada é feita: `refresh()`
 * só roda no cliente (onMounted do AdminShell).
 */
import { computed, reactive, readonly } from 'vue'
import { api, apiDownload, ApiError, NETWORK_ERROR_MESSAGE, type ApiOptions } from '@/services/api'
import type { AdminLoginStep, AdminPermission, AdminSession, AdminUser, MfaSetup } from '@/components/admin/types'

export type AdminSessionStatus =
  | 'loading'
  | 'anonymous'
  | 'mfa_required'
  | 'mfa_setup_required'
  | 'authenticated'
  | 'unavailable'

interface SessionState {
  status: AdminSessionStatus
  user: AdminUser | null
  permissions: AdminPermission[]
  /** Somente em memória; enviado em X-CSRF-Token nos métodos inseguros. */
  csrfToken: string | null
  /** Aviso para a tela de entrada (ex.: sessão encerrada). */
  notice: string | null
  /** Falha ao consultar a sessão (rede/servidor). */
  error: string | null
}

export const SESSION_EXPIRED_MESSAGE = 'Sua sessão terminou. Entre novamente para continuar.'
export const MFA_EXPIRED_MESSAGE = 'O tempo para confirmar o acesso terminou. Entre novamente com e-mail e senha.'
export const LOGGED_OUT_MESSAGE = 'Você saiu do painel interno.'
export const FORBIDDEN_MESSAGE =
  'Seu perfil não tem permissão para esta ação. Se precisar dela, fale com a administração do painel.'

/** 401 que significam "dado incorreto", não "sessão perdida" (não devem deslogar). */
const CREDENTIAL_CODES = new Set(['invalid_credentials', 'invalid_password', 'wrong_password', 'invalid_current_password'])

const state = reactive<SessionState>({
  status: 'loading',
  user: null,
  permissions: [],
  csrfToken: null,
  notice: null,
  error: null,
})

let pendingRefresh: Promise<void> | null = null

function reset(status: AdminSessionStatus, notice: string | null = null) {
  state.status = status
  state.user = null
  state.permissions = []
  state.csrfToken = null
  state.notice = notice
  state.error = null
}

function applySession(session: AdminSession) {
  state.status = 'authenticated'
  state.user = session.user
  state.permissions = [...(session.permissions ?? [])]
  state.csrfToken = session.csrfToken
  state.notice = null
  state.error = null
}

function applyStep(step: AdminLoginStep) {
  state.status = step.status
  state.user = null
  state.permissions = []
  state.csrfToken = step.csrfToken
  state.notice = null
  state.error = null
}

/** Consulta a sessão atual (GET /api/admin/auth/me). Chamadas simultâneas compartilham a mesma requisição. */
export function refreshSession(): Promise<void> {
  if (pendingRefresh) return pendingRefresh
  pendingRefresh = (async () => {
    try {
      const me = await api<AdminSession | AdminLoginStep>('/admin/auth/me')
      if (me.status === 'authenticated') applySession(me)
      else if (me.status === 'mfa_required' || me.status === 'mfa_setup_required') applyStep(me)
      else reset('anonymous')
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        const notice = state.status === 'authenticated' ? SESSION_EXPIRED_MESSAGE : state.notice
        reset('anonymous', notice)
      } else {
        // Sem conexão ou falha do servidor: não inventa sessão nem desloga quem já estava dentro.
        if (state.status === 'loading' || state.status === 'unavailable') {
          state.status = 'unavailable'
          state.error = e instanceof ApiError ? e.message : NETWORK_ERROR_MESSAGE
        }
        throw e
      }
    } finally {
      pendingRefresh = null
    }
  })()
  return pendingRefresh
}

/** Sessão perdida no meio do uso: volta à entrada com aviso. */
export function expireSession(message = SESSION_EXPIRED_MESSAGE) {
  reset('anonymous', message)
}

function isUnsafe(method: string) {
  return method !== 'GET'
}

/**
 * Traduz erros da API para a interface: 401 volta à entrada (global), 403 vira mensagem de
 * permissão, pedidos de troca de senha/MFA pendentes reconsultam a sessão.
 */
function handleAdminError(e: unknown): unknown {
  if (!(e instanceof ApiError)) return e
  if (e.status === 401 && e.code === 'mfa_required') {
    // Sessão parcial (MFA pendente): a reconsulta leva de volta à etapa do código.
    void refreshSession().catch(() => undefined)
    return e
  }
  if (e.status === 401 && !CREDENTIAL_CODES.has(e.code)) {
    expireSession()
    return e
  }
  if (e.status === 403) {
    if (/password|mfa/.test(e.code)) {
      void refreshSession().catch(() => undefined)
      return e
    }
    if (e.code === 'forbidden') return new ApiError(403, e.code, FORBIDDEN_MESSAGE, e.fields, e.details)
  }
  return e
}

/** Chamada à API administrativa: adiciona o token CSRF nos métodos inseguros e trata 401/403. */
export async function adminApi<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const method = options.method ?? (options.body !== undefined ? 'POST' : 'GET')
  // Métodos inseguros sempre vão em JSON (o servidor recusa outro Content-Type).
  const body = isUnsafe(method) && options.body === undefined ? {} : options.body
  const send = () =>
    api<T>(path, { ...options, method, body, csrfToken: isUnsafe(method) ? (state.csrfToken ?? undefined) : undefined })
  try {
    return await send()
  } catch (e) {
    // Token CSRF recusado (ex.: sessão renovada em outra aba): renova uma vez e repete.
    if (e instanceof ApiError && e.status === 403 && /csrf/i.test(e.code) && isUnsafe(method)) {
      try {
        await refreshSession()
        return await send()
      } catch (again) {
        throw handleAdminError(again)
      }
    }
    throw handleAdminError(e)
  }
}

/** Download autenticado (CSV). Mesmo tratamento de erros de `adminApi`. */
export async function adminDownload(path: string, body: unknown): Promise<Blob> {
  try {
    return await apiDownload(path, state.csrfToken ?? '', body)
  } catch (e) {
    throw handleAdminError(e)
  }
}

/** Primeiro fator. Erros (credenciais, limite de tentativas) chegam ao formulário sem deslogar ninguém. */
export async function login(email: string, password: string): Promise<AdminLoginStep['status']> {
  const step = await api<AdminLoginStep>('/admin/auth/login', { body: { email, password } })
  applyStep(step)
  return step.status
}

export async function setupMfa(): Promise<MfaSetup> {
  try {
    return await api<MfaSetup>('/admin/auth/mfa/setup', { method: 'POST', body: {}, csrfToken: state.csrfToken ?? undefined })
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) reset('anonymous', MFA_EXPIRED_MESSAGE)
    if (e instanceof ApiError && e.code === 'mfa_already_enabled') state.status = 'mfa_required'
    throw e
  }
}

export async function verifyMfa(code: string): Promise<void> {
  try {
    const session = await api<AdminSession>('/admin/auth/mfa/verify', {
      body: { code },
      csrfToken: state.csrfToken ?? undefined,
    })
    applySession(session)
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) reset('anonymous', MFA_EXPIRED_MESSAGE)
    throw e
  }
}

/** Encerra a sessão no servidor; o estado local é limpo mesmo se a rede falhar. */
export async function logout(message: string | null = LOGGED_OUT_MESSAGE): Promise<void> {
  try {
    await api<void>('/admin/auth/logout', { method: 'POST', body: {}, csrfToken: state.csrfToken ?? undefined })
  } catch {
    // Sem rede, o cookie expira pelo servidor; localmente a sessão já deixa de existir.
  } finally {
    reset('anonymous', message)
  }
}

/** Troca da própria senha. Depois reconsulta a sessão (mustChangePassword e token podem mudar). */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await adminApi<void>('/admin/auth/password', { body: { currentPassword, newPassword } })
  await refreshSession().catch(() => undefined)
}

export function can(permission: AdminPermission): boolean {
  return state.status === 'authenticated' && state.permissions.includes(permission)
}

export function useAdminSession() {
  return {
    state: readonly(state),
    isAuthenticated: computed(() => state.status === 'authenticated'),
    mustChangePassword: computed(() => state.status === 'authenticated' && Boolean(state.user?.mustChangePassword)),
    can,
    refresh: refreshSession,
    login,
    setupMfa,
    verifyMfa,
    logout,
    changePassword,
    expire: expireSession,
  }
}

/**
 * Mensagem exibível para qualquer erro. Com `withFields`, acrescenta as mensagens por campo do
 * servidor (útil em telas sem campo correspondente, como filtros e carregamentos).
 */
export function errorMessage(e: unknown, withFields = false): string {
  if (!(e instanceof ApiError)) return NETWORK_ERROR_MESSAGE
  const details = withFields ? [...new Set(Object.values(e.fields ?? {}).filter(Boolean))] : []
  return details.length ? details.join(' ') : e.message
}

/** Somente para testes: volta ao estado inicial. */
export function __resetAdminSessionForTests() {
  reset('loading')
  pendingRefresh = null
}
