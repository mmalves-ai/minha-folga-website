import { createHash, createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { APIRequestContext, APIResponse, Page } from '@playwright/test'
// @ts-expect-error módulo .mjs sem tipos
import { BACKEND_ENV_FILE, E2E_DIR, SITE_PORT } from './env.mjs'

/** Origem do site de teste (a mesma de ALLOWED_ORIGINS da API isolada). */
export const SITE_ORIGIN = `http://127.0.0.1:${SITE_PORT as string}`

export interface E2EAdmin {
  email: string
  /** Senha temporária impressa pela CLI admin-create (troca obrigatória no primeiro acesso). */
  password: string
  role: string
}

/** Pessoas usuárias criadas pela CLI em start-backend.mjs antes da API subir. */
export function e2eAdmins(): Record<'admin' | 'support' | 'marketing', E2EAdmin> {
  return JSON.parse(readFileSync(join(E2E_DIR as string, 'admins.json'), 'utf8'))
}

/** Chave de entrada da Hal-AI (X-API-Key) sorteada por start-backend.mjs para esta execução. */
export function halaiInboundApiKey(): string {
  const env = JSON.parse(readFileSync(BACKEND_ENV_FILE as string, 'utf8')) as Record<string, string>
  if (!env.HALAI_INBOUND_API_KEY) throw new Error('HALAI_INBOUND_API_KEY ausente no ambiente do e2e')
  return env.HALAI_INBOUND_API_KEY
}

// Anti-robô (docs/DECISOES.md → Anti-robô) ------------------------------------------------------------

/** Quantidade de bits zero à esquerda do resumo. */
export function leadingZeroBits(digest: Buffer): number {
  let bits = 0
  for (const byte of digest) {
    if (byte === 0) {
      bits += 8
      continue
    }
    bits += Math.clz32(byte) - 24
    break
  }
  return bits
}

/** SHA-256(UTF-8("<challenge>:<nonce>")) tem pelo menos `bits` zeros à esquerda? */
export function proofIsValid(challenge: string, nonce: string, bits: number): boolean {
  return leadingZeroBits(createHash('sha256').update(`${challenge}:${nonce}`, 'utf8').digest()) >= bits
}

/** Menor nonce decimal que satisfaz a prova (o mesmo algoritmo do Web Worker do site). */
export function solveProofOfWork(challenge: string, bits: number): string {
  for (let nonce = 0; nonce < 2 ** 32; nonce++) {
    if (proofIsValid(challenge, String(nonce), bits)) return String(nonce)
  }
  throw new Error('prova de trabalho não encontrada')
}

/** Payload do token assinado: `{ v, c, d, iat }` (a assinatura só o servidor confere). */
export function decodeFormToken(token: string): { v: number; c: string; d: number; iat: number } {
  const [encoded] = token.split('.')
  return JSON.parse(Buffer.from(encoded!, 'base64url').toString('utf8'))
}

export interface SolvedProof {
  antiBot: { token: string; nonce: string }
  /** Quando o token pode ser usado (idade mínima de preenchimento). */
  usableAt: number
}

/** Pede um desafio a GET /api/form-token e resolve a prova no Node, como faria um cliente legítimo. */
export async function solvedFormToken(request: APIRequestContext): Promise<SolvedProof> {
  const res = await request.get('/api/form-token')
  if (res.status() !== 200) throw new Error(`form-token respondeu ${res.status()}`)
  const body = (await res.json()) as { token: string; challenge: string; difficultyBits: number; minFillSeconds: number }
  return {
    antiBot: { token: body.token, nonce: solveProofOfWork(body.challenge, body.difficultyBits) },
    usableAt: Date.now() + body.minFillSeconds * 1000 + 300,
  }
}

/** Espera até todos os tokens atingirem a idade mínima de preenchimento. */
export async function waitUsable(proofs: SolvedProof[]): Promise<void> {
  const wait = Math.max(0, ...proofs.map((p) => p.usableAt - Date.now()))
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
}

// Ferramentas da Bia (Hal-AI → esta API) ---------------------------------------------------------------

export interface BiaCall {
  senderPhone?: string
  senderVerified?: boolean
  input?: Record<string, unknown>
  apiKey?: string
}

let conversationSeq = 0

/** Chamada servidor-a-servidor como a Hal-AI faria: X-API-Key e telefone do remetente atestado pelo canal. */
export async function callBiaTool(request: APIRequestContext, tool: string, call: BiaCall = {}): Promise<APIResponse> {
  const body: Record<string, unknown> = { conversationRef: `e2e-conversa-${Date.now()}-${++conversationSeq}`, input: call.input ?? {} }
  if (call.senderPhone !== undefined) body.senderPhone = call.senderPhone
  if (call.senderVerified !== undefined) body.senderVerified = call.senderVerified
  return request.post(`/api/agent/tools/${tool}`, {
    headers: { 'X-API-Key': call.apiKey ?? halaiInboundApiKey() },
    data: body,
  })
}

// Painel ---------------------------------------------------------------------------------------------------

/** TOTP RFC 6238 (SHA-1, 30 s, 6 dígitos) a partir de segredo base32. */
export function totp(secretBase32: string, at = Date.now(), offsetSteps = 0): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const clean = secretBase32.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase()
  let bits = ''
  for (const c of clean) bits += alphabet.indexOf(c).toString(2).padStart(5, '0')
  const bytes = Buffer.alloc(Math.floor(bits.length / 8))
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2)
  const counter = Math.floor(at / 1000 / 30) + offsetSteps
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64BE(BigInt(counter))
  const h = createHmac('sha1', bytes).update(buf).digest()
  const o = h[h.length - 1]! & 0xf
  const code = ((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0')
  return code
}

/** Sem rolagem horizontal na largura atual. */
export async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
}
