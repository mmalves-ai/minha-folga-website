import { onMounted } from 'vue'
import validation from '@contracts/validation.json'

/**
 * Parâmetros de campanha (UTM) permitidos por contracts/validation.json. Só as chaves da lista,
 * só valores no padrão do contrato e nunca algo que pareça dado pessoal.
 *
 * Ficam somente na memória da página aberta (sobrevivem à navegação interna do site, não a um
 * recarregamento nem a outra aba) e seguem para o servidor apenas junto com um cadastro enviado.
 * Nada é gravado no navegador — nem sessionStorage, nem localStorage, nem cookie —, por isso a
 * atribuição de campanha não é uma tecnologia a declarar na Política de cookies nem depende de escolha.
 */
export type UtmKey = 'utm_source' | 'utm_medium' | 'utm_campaign' | 'utm_content' | 'utm_term'
export type UtmParams = Partial<Record<UtmKey, string>>

const ALLOWED = validation.utm.allowedParams as UtmKey[]
const PATTERN = new RegExp(validation.utm.pattern)
// Sequência longa de dígitos pode ser telefone ou documento: descartada mesmo dentro do padrão.
const LOOKS_PERSONAL = /\d{8,}/

/** Campanha capturada nesta página (estado de módulo, alterado só no navegador). */
let captured: UtmParams | undefined

/** Filtra um conjunto de parâmetros: chaves permitidas, valor normalizado e validado. */
export function sanitizeUtm(params: URLSearchParams | Record<string, unknown>): UtmParams {
  const get = (key: string): unknown => (params instanceof URLSearchParams ? params.get(key) : params[key])
  const out: UtmParams = {}
  for (const key of ALLOWED) {
    const raw = get(key)
    if (typeof raw !== 'string') continue
    const value = raw.trim().toLowerCase()
    if (PATTERN.test(value) && !LOOKS_PERSONAL.test(value)) out[key] = value
  }
  return out
}

/**
 * Lê a URL atual e, se houver UTM válida, substitui a campanha capturada nesta página.
 * URL sem UTM válida não apaga a campanha já capturada (a navegação interna perde a query string).
 */
export function captureUtm(search: string = typeof window === 'undefined' ? '' : window.location.search): UtmParams {
  const found = sanitizeUtm(new URLSearchParams(search))
  if (Object.keys(found).length) captured = found
  return found
}

/** Campanha capturada nesta página ou undefined. */
export function readUtm(): UtmParams | undefined {
  return captured ? { ...captured } : undefined
}

/** Esquece a campanha capturada (testes). */
export function resetUtm(): void {
  captured = undefined
}

/** Captura as UTMs da URL depois da montagem (nunca durante a pré-renderização). */
export function useUtm() {
  onMounted(() => {
    captureUtm()
  })
  return { readUtm }
}
