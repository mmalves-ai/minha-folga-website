import { normalizeSearch } from '@/lib/format'

/**
 * Busca local da central editorial e da central de ajuda.
 * Sem acento, sem diferença entre maiúsculas e minúsculas; todos os termos precisam aparecer
 * (em qualquer ordem) no texto indexado. Plural simples ("golpes") encontra o singular ("golpe").
 */

const ENTITY = /&(?:[a-z]+|#\d+|#x[0-9a-f]+);/gi

/** Texto indexável: junta as partes, remove HTML/entidades e normaliza. */
export function buildSearchIndex(parts: (string | null | undefined)[]): string {
  return normalizeSearch(
    parts
      .filter(Boolean)
      .join(' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(ENTITY, ' '),
  )
}

/** Termos da consulta, normalizados. Termos longos terminados em "s" perdem o "s" final. */
export function searchTerms(query: string): string[] {
  return normalizeSearch(query)
    .split(' ')
    .filter(Boolean)
    .map((t) => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t))
}

export function matchesTerms(index: string, terms: string[]): boolean {
  return terms.every((t) => index.includes(t))
}

/**
 * Âncora de uma pergunta da ajuda: aceita "#<id>" e "#faq-<id>" (id do painel do acordeão).
 * Retorna o id da pergunta somente se ele existir na base.
 */
export function faqIdFromHash(hash: string, ids: readonly string[]): string | null {
  let raw = hash.replace(/^#/, '')
  try {
    raw = decodeURIComponent(raw)
  } catch {
    return null
  }
  const id = raw.startsWith('faq-') && !ids.includes(raw) ? raw.slice(4) : raw
  return ids.includes(id) ? id : null
}

/**
 * Busca "assentada": avisa quando a consulta fica parada por `delay` ms, uma vez por consulta distinta, para
 * a medição contar buscas e não teclas. O aviso não recebe a consulta: o texto digitado nunca sai daqui.
 * Consulta vazia cancela o aviso pendente e permite contar de novo a mesma busca depois.
 */
export function createSearchSettler(delay: number, onSettled: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let last = ''
  return {
    update(terms: readonly string[]) {
      clearTimeout(timer)
      timer = undefined
      const key = terms.join(' ')
      if (!key) {
        last = ''
        return
      }
      timer = setTimeout(() => {
        timer = undefined
        if (key === last) return
        last = key
        onSettled()
      }, delay)
    },
    cancel() {
      clearTimeout(timer)
      timer = undefined
    },
  }
}
