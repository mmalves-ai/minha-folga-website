/**
 * Web Worker da prova de trabalho do formulário (decisão D1). Recebe { id, challenge, difficultyBits },
 * procura o nonce fora da thread da página e responde { id, nonce } ou { id, error }. Não faz rede,
 * não lê nem grava nada no navegador: só calcula SHA-256 (JavaScript puro, ./pow.ts).
 */
import { PowSearch } from './pow'

interface PowRequest {
  id: number
  challenge: string
  difficultyBits: number
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<PowRequest>) => void) | null
  postMessage(message: unknown): void
}

const scope = self as unknown as WorkerScope
// Teto de tentativas: 256 vezes o esperado para a dificuldade (limitado a 2^40).
const maxTries = (bits: number) => 2 ** Math.min(bits + 8, 40)

scope.onmessage = (event) => {
  const { id, challenge, difficultyBits } = event.data
  try {
    const search = new PowSearch(challenge, difficultyBits)
    const limit = maxTries(difficultyBits)
    while (search.next < limit) {
      const nonce = search.run(Math.min(100_000, limit - search.next))
      if (nonce !== null) {
        scope.postMessage({ id, nonce })
        return
      }
    }
    scope.postMessage({ id, error: 'not_found' })
  } catch {
    scope.postMessage({ id, error: 'invalid_challenge' })
  }
}
