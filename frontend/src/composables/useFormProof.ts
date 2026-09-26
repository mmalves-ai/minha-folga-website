import { getCurrentInstance, onBeforeUnmount, ref } from 'vue'
import { api, ApiError, NETWORK_ERROR_MESSAGE } from '@/services/api'
import { PowSearch } from '@/workers/pow'

/**
 * Anti-robô dos formulários públicos (decisão D1, docs/DECISOES.md → Anti-robô), sem terceiros:
 * GET /api/form-token entrega um desafio assinado; um Web Worker (workers/pow.worker.ts) procura o
 * nonce da prova de trabalho a partir do primeiro foco no formulário; o envio leva { token, nonce }.
 *
 * - O token é de uso único: cada envio consome um (`take`); depois de uma resposta do servidor, o
 *   formulário chama `renew()` para já deixar o próximo pronto.
 * - O servidor recusa token mais novo que `minFillSeconds`: `take` espera o que faltar (o estado
 *   "Enviando…" cobre essa espera, que só acontece em preenchimentos muito rápidos).
 * - Token perto de expirar é trocado antes do envio. Sem Worker (navegador antigo, CSP), a busca roda
 *   na página em fatias curtas, sem travar a interface.
 * Nada disso é gravado no navegador nem vai para URL ou medição.
 */

export interface FormTokenChallenge {
  token: string
  challenge: string
  difficultyBits: number
  expiresInSeconds: number
  minFillSeconds: number
}

export interface AntiBotProof {
  token: string
  nonce: string
}

interface ReadyProof {
  proof: AntiBotProof
  expiresAt: number
  usableAt: number
}

/** Troca o token se faltar menos que isto para expirar (o envio ainda precisa chegar ao servidor). */
const EXPIRY_MARGIN_MS = 60_000
/** Folga sobre o tempo mínimo de preenchimento (relógio e rede). */
const MIN_FILL_MARGIN_MS = 400
const PAGE_SLICE = 4_000

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function maxTries(bits: number): number {
  return 2 ** Math.min(bits + 8, 40)
}

function isChallenge(value: unknown): value is FormTokenChallenge {
  const v = value as Partial<FormTokenChallenge> | null
  return (
    !!v &&
    typeof v.token === 'string' &&
    v.token.length > 0 &&
    typeof v.challenge === 'string' &&
    v.challenge.length > 0 &&
    Number.isInteger(v.difficultyBits) &&
    (v.difficultyBits as number) >= 0 &&
    (v.difficultyBits as number) <= 32 &&
    typeof v.expiresInSeconds === 'number' &&
    typeof v.minFillSeconds === 'number'
  )
}

/** Busca na própria página, em fatias, cedendo a vez à interface entre elas. */
export async function solveOnPage(challenge: string, difficultyBits: number): Promise<string> {
  const search = new PowSearch(challenge, difficultyBits)
  const limit = maxTries(difficultyBits)
  while (search.next < limit) {
    const nonce = search.run(Math.min(PAGE_SLICE, limit - search.next))
    if (nonce !== null) return nonce
    await sleep(0)
  }
  throw new Error('pow_not_found')
}

export function useFormProof() {
  /** Situação da prova atual, para quem quiser exibir (o envio não depende disso). */
  const status = ref<'idle' | 'solving' | 'ready' | 'failed'>('idle')
  let current: Promise<ReadyProof> | null = null
  let worker: Worker | null = null
  let workerBroken = false
  let requestId = 0
  const waiting = new Map<number, { resolve: (nonce: string) => void; reject: (e: Error) => void }>()

  function failAllWaiting(error: Error) {
    for (const entry of waiting.values()) entry.reject(error)
    waiting.clear()
  }

  function getWorker(): Worker | null {
    if (workerBroken || typeof Worker === 'undefined') return null
    if (worker) return worker
    try {
      worker = new Worker(new URL('../workers/pow.worker.ts', import.meta.url), { type: 'module' })
    } catch {
      workerBroken = true
      return null
    }
    worker.onmessage = (event: MessageEvent<{ id: number; nonce?: string; error?: string }>) => {
      const entry = waiting.get(event.data.id)
      if (!entry) return
      waiting.delete(event.data.id)
      if (typeof event.data.nonce === 'string') entry.resolve(event.data.nonce)
      else entry.reject(new Error(event.data.error ?? 'pow_failed'))
    }
    worker.onerror = (event) => {
      // Worker bloqueado ou sem suporte a módulo: segue na página.
      event.preventDefault?.()
      workerBroken = true
      worker?.terminate()
      worker = null
      failAllWaiting(new Error('worker_unavailable'))
    }
    return worker
  }

  async function solve(challenge: string, difficultyBits: number): Promise<string> {
    const w = getWorker()
    if (!w) return solveOnPage(challenge, difficultyBits)
    const id = ++requestId
    try {
      return await new Promise<string>((resolve, reject) => {
        waiting.set(id, { resolve, reject })
        w.postMessage({ id, challenge, difficultyBits })
      })
    } catch (e) {
      if ((e as Error).message === 'worker_unavailable') return solveOnPage(challenge, difficultyBits)
      throw e
    }
  }

  async function create(): Promise<ReadyProof> {
    status.value = 'solving'
    const challenge = await api<unknown>('/form-token', { timeoutMs: 10_000 })
    const receivedAt = Date.now()
    if (!isChallenge(challenge)) throw new ApiError(0, 'unexpected_response', NETWORK_ERROR_MESSAGE)
    let nonce: string
    try {
      nonce = await solve(challenge.challenge, challenge.difficultyBits)
    } catch {
      throw new ApiError(0, 'proof_failed', NETWORK_ERROR_MESSAGE)
    }
    return {
      proof: { token: challenge.token, nonce },
      expiresAt: receivedAt + challenge.expiresInSeconds * 1000,
      usableAt: receivedAt + challenge.minFillSeconds * 1000 + MIN_FILL_MARGIN_MS,
    }
  }

  /** Começa a preparar a prova (idempotente). Chamado no primeiro foco do formulário. */
  function prepare(): void {
    if (typeof window === 'undefined' || current) return
    const pending = create()
    current = pending
    pending.then(
      () => {
        if (current === pending) status.value = 'ready'
      },
      () => {
        // Falha (rede, desafio inválido): a próxima tentativa de envio pede outro token.
        if (current === pending) {
          current = null
          status.value = 'failed'
        }
      },
    )
  }

  /** Descarta a prova atual (já usada ou recusada) e prepara a próxima. */
  function renew(): void {
    current = null
    status.value = 'idle'
    prepare()
  }

  /**
   * Entrega a prova para UM envio (uso único): espera ficar pronta, troca se estiver perto de
   * expirar e respeita o tempo mínimo de preenchimento. Erros sobem como ApiError genérico.
   */
  async function take(): Promise<AntiBotProof> {
    prepare()
    if (!current) throw new ApiError(0, 'proof_failed', NETWORK_ERROR_MESSAGE)
    let ready = await current
    if (Date.now() > ready.expiresAt - EXPIRY_MARGIN_MS) {
      renew()
      ready = await current!
    }
    const wait = ready.usableAt - Date.now()
    if (wait > 0) await sleep(wait)
    current = null
    status.value = 'idle'
    return ready.proof
  }

  function dispose(): void {
    failAllWaiting(new Error('disposed'))
    worker?.terminate()
    worker = null
    current = null
  }

  if (getCurrentInstance()) onBeforeUnmount(dispose)

  return { status, prepare, take, renew, dispose }
}
