import { createHash } from 'node:crypto'

/**
 * Prova de trabalho do formulário (decisão D1, docs/DECISOES.md → Anti-robô).
 *
 * O navegador procura `nonce` (inteiro decimal, a partir de 0) tal que SHA-256(UTF-8("<challenge>:<nonce>"))
 * tenha pelo menos `difficultyBits` bits zero à esquerda. Este módulo não depende de nada do servidor:
 * testes e e2e importam `solveProofOfWork` para resolver o desafio como o Web Worker do site faz.
 */

/** Nonce aceito: inteiro decimal não negativo (até 16 dígitos). */
export const NONCE_PATTERN = /^\d{1,16}$/

/** Quantidade de bits zero à esquerda de um digest. */
export function leadingZeroBits(digest: Uint8Array): number {
  let bits = 0
  for (const byte of digest) {
    if (byte === 0) {
      bits += 8
      continue
    }
    return bits + Math.clz32(byte) - 24
  }
  return bits
}

export function proofDigest(challenge: string, nonce: string): Buffer {
  return createHash('sha256').update(`${challenge}:${nonce}`, 'utf8').digest()
}

/** Confere a prova: nonce no formato e digest com a dificuldade pedida. */
export function checkProofOfWork(challenge: string, nonce: string, difficultyBits: number): boolean {
  if (!NONCE_PATTERN.test(nonce)) return false
  return leadingZeroBits(proofDigest(challenge, nonce)) >= difficultyBits
}

/**
 * Resolve a prova (SOMENTE testes e e2e; o site resolve no navegador). Com 16 bits são ~65 mil tentativas
 * em média, alguns milissegundos no Node. Lança erro se passar de `maxIterations`.
 */
export function solveProofOfWork(challenge: string, difficultyBits: number, maxIterations = 50_000_000): string {
  for (let nonce = 0; nonce < maxIterations; nonce++) {
    const candidate = String(nonce)
    if (leadingZeroBits(proofDigest(challenge, candidate)) >= difficultyBits) return candidate
  }
  throw new Error('prova de trabalho não resolvida dentro do limite de tentativas')
}

/** Resolve a resposta de GET /api/form-token e devolve o `antiBot` pronto para o corpo do formulário. */
export function solveFormToken(formToken: { token: string; challenge: string; difficultyBits: number }): { token: string; nonce: string } {
  return { token: formToken.token, nonce: solveProofOfWork(formToken.challenge, formToken.difficultyBits) }
}
