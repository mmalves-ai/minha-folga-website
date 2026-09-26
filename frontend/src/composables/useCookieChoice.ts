import { computed, readonly, ref } from 'vue'
import { publicConfig } from '@/services/site'

/**
 * Escolha de cookies do visitante (seção 9 do briefing).
 *
 * - Guardada somente no navegador, em localStorage `mf_cookie_choice`, sem dado pessoal:
 *   { version, measurement, savedAt }.
 * - `version` acompanha a versão da Política de Cookies (contracts/consents.json → notices.cookies).
 *   Escolha de outra versão é ignorada e o visitante decide de novo.
 * - Só existe escolha a fazer quando há tecnologia opcional (ANALYTICS_ENABLED no backend). Sem ela,
 *   nada é gravado e o banner não aparece.
 * - A escolha de cookies não autoriza mensagens nem consulta de margem: essas finalidades dependem
 *   das escolhas do cadastro, geridas em /preferencias.
 *
 * Estado de módulo: nunca é alterado durante a pré-renderização (só em onMounted/eventos do navegador).
 */
export const COOKIE_CHOICE_KEY = 'mf_cookie_choice'
export const OPEN_COOKIE_SETTINGS_EVENT = 'mf:open-cookie-settings'
export const COOKIE_CHOICE_VERSION: string = publicConfig.notices.cookies.version

export interface CookieChoice {
  version: string
  /** Medição agregada de uso (categoria opcional). */
  measurement: boolean
  /** Data civil (AAAA-MM-DD) em que a escolha foi salva. */
  savedAt: string
}

const choice = ref<CookieChoice | null>(null)
const loaded = ref(false)

/** Valida o conteúdo guardado. Qualquer formato inesperado ou versão diferente vale como "sem escolha". */
export function parseCookieChoice(raw: string | null, version: string = COOKIE_CHOICE_VERSION): CookieChoice | null {
  if (!raw || raw.length > 200) return null
  try {
    const data = JSON.parse(raw) as Partial<CookieChoice> | null
    if (!data || typeof data !== 'object') return null
    if (data.version !== version || typeof data.measurement !== 'boolean') return null
    const savedAt = typeof data.savedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.savedAt) ? data.savedAt : ''
    return { version: data.version, measurement: data.measurement, savedAt }
  } catch {
    return null
  }
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    // Navegador com armazenamento bloqueado: a escolha vale só para esta página.
    return null
  }
}

function today(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}

/** Lê a escolha salva (somente no navegador). Chamadas repetidas não releem o armazenamento. */
export function loadCookieChoice(force = false): void {
  if (typeof window === 'undefined' || (loaded.value && !force)) return
  let raw: string | null = null
  try {
    raw = storage()?.getItem(COOKIE_CHOICE_KEY) ?? null
  } catch {
    raw = null
  }
  choice.value = publicConfig.analyticsEnabled ? parseCookieChoice(raw) : null
  loaded.value = true
}

/** Salva a escolha. Sem tecnologia opcional nesta versão, não há o que gravar. */
export function saveCookieChoice(measurement: boolean): CookieChoice | null {
  if (typeof window === 'undefined' || !publicConfig.analyticsEnabled) return null
  const next: CookieChoice = { version: COOKIE_CHOICE_VERSION, measurement, savedAt: today() }
  try {
    storage()?.setItem(COOKIE_CHOICE_KEY, JSON.stringify(next))
  } catch {
    // Sem armazenamento disponível: a escolha continua valendo nesta visita.
  }
  choice.value = next
  loaded.value = true
  return next
}

/** Consentimento de medição vigente. Lê o armazenamento na primeira chamada no navegador. */
export function hasMeasurementConsent(): boolean {
  if (!publicConfig.analyticsEnabled || typeof window === 'undefined') return false
  loadCookieChoice()
  return choice.value?.measurement === true
}

/** Abre o painel de escolhas (atendido por CookieConsent, montado no DefaultLayout). */
export function openCookieSettings(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(OPEN_COOKIE_SETTINGS_EVENT))
}

export function useCookieChoice() {
  return {
    choice: readonly(choice),
    loaded: readonly(loaded),
    /** Há tecnologia opcional nesta versão do site. */
    hasOptional: publicConfig.analyticsEnabled,
    /** Banner: tecnologia opcional ativa e nenhuma escolha válida salva. */
    needsDecision: computed(() => publicConfig.analyticsEnabled && loaded.value && !choice.value),
    measurementAllowed: computed(() => publicConfig.analyticsEnabled && choice.value?.measurement === true),
    load: loadCookieChoice,
    save: saveCookieChoice,
    openSettings: openCookieSettings,
  }
}
