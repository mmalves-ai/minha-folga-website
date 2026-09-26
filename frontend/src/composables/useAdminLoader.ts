/**
 * Carregamento de dados do painel com estados de carregamento/erro e proteção contra
 * respostas fora de ordem (só a última requisição disparada atualiza a tela).
 */
import { ref, shallowRef, type Ref, type ShallowRef } from 'vue'
import { useHead } from '@unhead/vue'
import { errorMessage } from './useAdminSession'

export interface AdminLoader<T> {
  data: ShallowRef<T | null>
  loading: Ref<boolean>
  error: Ref<string | null>
  load: () => Promise<void>
}

export function useAdminLoader<T>(fetcher: () => Promise<T>): AdminLoader<T> {
  const data = shallowRef<T | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  let seq = 0

  async function load() {
    const id = ++seq
    loading.value = true
    error.value = null
    try {
      const result = await fetcher()
      if (id === seq) data.value = result
    } catch (e) {
      if (id === seq) error.value = errorMessage(e, true)
    } finally {
      if (id === seq) loading.value = false
    }
  }

  return { data, loading, error, load }
}

/** Título da aba por tela do painel (o `noindex` vem do AdminShell). */
export function useAdminTitle(title: string | (() => string)) {
  useHead({ title: () => `${typeof title === 'function' ? title() : title} · Painel interno | Minha Folga` })
}

/** Monta a query string, ignorando valores vazios. Nunca inclua dados pessoais aqui. */
export function toQuery(params: Record<string, string | number | null | undefined>): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v))
  }
  const s = q.toString()
  return s ? `?${s}` : ''
}

/** Lê um parâmetro de rota como string simples. */
export function queryValue(value: unknown): string {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : ''
  return typeof value === 'string' ? value : ''
}

/** Data civil AAAA-MM-DD no fuso de São Paulo, deslocada em dias. */
export function isoDay(offsetDays = 0, base = new Date()): string {
  const d = new Date(base.getTime() + offsetDays * 86_400_000)
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}
