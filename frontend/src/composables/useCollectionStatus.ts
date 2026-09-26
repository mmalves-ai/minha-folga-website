import { api } from '@/services/api'
import type { PublicConfig } from '@/types/public-config'

/**
 * Confirma no servidor (GET /api/public-config) se o cadastro e o atendimento estão recebendo dados.
 * O HTML pré-renderizado usa a configuração do build; esta checagem roda só no navegador, depois da
 * montagem, para trocar o formulário por um aviso verdadeiro caso a coleta tenha sido desligada.
 * Falha de rede não bloqueia nada: o envio ainda recebe 503 do servidor se a coleta estiver fechada.
 * A resposta vale por pouco tempo: o formulário pode ser pausado pelo painel a qualquer momento (a API promete
 * a pausa em até 30 s), e um formulário aberto depois, na mesma visita, consulta de novo.
 */
const MAX_AGE_MS = 25_000

let pending: Promise<PublicConfig['collection'] | null> | null = null
let fetchedAt = 0

export function fetchCollectionStatus(): Promise<PublicConfig['collection'] | null> {
  if (!pending || Date.now() - fetchedAt > MAX_AGE_MS) {
    fetchedAt = Date.now()
    pending = api<PublicConfig>('/public-config', { timeoutMs: 8000 })
      .then((cfg) => cfg?.collection ?? null)
      .catch(() => {
        pending = null
        return null
      })
  }
  return pending
}

/** Somente para testes. */
export function resetCollectionStatusCache() {
  pending = null
}
