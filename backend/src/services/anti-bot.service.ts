import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { VALIDATION } from '../config/contracts.js'
import type { AppContext } from '../context.js'
import type { Queryable } from '../db/database.js'
import { safeEqual, sha256Hex } from '../lib/crypto.js'
import { AppError, Errors } from '../lib/errors.js'
import { checkProofOfWork, NONCE_PATTERN } from '../lib/proof-of-work.js'
import { incrementMetric } from './metrics.service.js'

/**
 * Anti-robô próprio, sem terceiros (decisão D1, docs/DECISOES.md → Anti-robô; contracts/validation.json →
 * waitlist.antiBot e waitlist.limits). Protege o cadastro e o pedido de saída: robôs não podem gerar custo
 * (templates pagos na Hal-AI) nem lixo no cadastro.
 *
 * - GET /api/form-token entrega `token = base64url(JSON payload) + "." + base64url(HMAC-SHA256(SESSION_SECRET,
 *   <payload codificado>))`, payload `{ v: 1, c: <desafio base64url de 16 bytes>, d: <bits>, iat: <epoch ms> }`.
 *   Nada é gravado até o uso.
 * - O navegador resolve a prova de trabalho (lib/proof-of-work.ts) e envia `antiBot: { token, nonce }`.
 * - No envio: assinatura válida; idade do token entre `minFillSeconds` e `tokenTtlSeconds`; prova correta; uso
 *   único (sha256 do token em form_token_uses até expirar). Qualquer falha → 400 `form_expired` (o site pega
 *   outro token e reenvia uma vez, sem perder o que foi digitado).
 * - Campo-armadilha (`website`) preenchido → a rota responde o sucesso genérico SEM gravar (não ensina o robô).
 * - Limites de submissões aceitas por rede de origem (HMAC do IP, IPv6 agrupado), por CPF e por telefone (HMAC),
 *   contados em form_attempts → 429 `rate_limited`.
 * - Dificuldade adaptativa: muita gente legítima sai pelo mesmo IP (CGNAT das operadoras móveis). Em vez de barrar
 *   cedo, a rede que já passou de `limits.elevatedAfterPerIpPerHour` submissões aceitas na última hora recebe tokens
 *   com `antiBot.elevatedDifficultyBits`; um token mais fácil emitido antes disso vira `form_expired` (o site pega
 *   outro, já com a dificuldade nova, e reenvia). O 429 por IP só vem em `limits.submissionsPerIpPerHour`.
 * Métricas só agregadas (motivo da recusa), sem identificar ninguém.
 */
export const ANTI_BOT = VALIDATION.waitlist.antiBot
export const FORM_LIMITS = VALIDATION.waitlist.limits

export type FormPurpose = 'waitlist' | 'opt_out'

export interface FormTokenResponse {
  token: string
  challenge: string
  difficultyBits: number
  expiresInSeconds: number
  minFillSeconds: number
}

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
/** Tentativas guardadas além da maior janela de limite (24 h) não protegem mais nada. */
const ATTEMPTS_RETENTION_MS = 2 * DAY_MS
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000
const CHALLENGE = /^[A-Za-z0-9_-]{22}$/
const TOKEN_MAX = 512

export const FORM_MESSAGES = {
  expired: 'O formulário expirou. Tente enviar de novo.',
} as const

export const formExpired = () => new AppError(400, 'form_expired', FORM_MESSAGES.expired)

function sign(ctx: AppContext, encodedPayload: string): string {
  return createHmac('sha256', ctx.config.secrets.sessionSecret).update(encodedPayload).digest('base64url')
}

/** Dificuldade exigida da rede de origem agora (contando as submissões aceitas do cadastro na última hora). */
export async function requiredDifficulty(q: Queryable, originKey: string, now: Date): Promise<number> {
  const recent = await countSince(q, 'waitlist', 'ip_key', originKey, new Date(now.getTime() - HOUR_MS))
  return recent >= FORM_LIMITS.elevatedAfterPerIpPerHour ? ANTI_BOT.elevatedDifficultyBits : ANTI_BOT.difficultyBits
}

export async function issueFormToken(ctx: AppContext, originKey: string): Promise<FormTokenResponse> {
  const challenge = randomBytes(16).toString('base64url')
  const now = ctx.now()
  const d = await requiredDifficulty(ctx.db, originKey, now)
  const payload = { v: 1, c: challenge, d, iat: now.getTime() }
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return {
    token: `${encoded}.${sign(ctx, encoded)}`,
    challenge,
    difficultyBits: d,
    expiresInSeconds: ANTI_BOT.tokenTtlSeconds,
    minFillSeconds: ANTI_BOT.minFillSeconds,
  }
}

export interface VerifiedFormToken {
  tokenHash: string
  expiresAt: Date
  /** Dificuldade da prova resolvida (a do token assinado). */
  difficultyBits: number
}

type Rejection = 'malformed' | 'invalid_signature' | 'too_young' | 'expired' | 'bad_proof'

async function reject(ctx: AppContext, purpose: FormPurpose, reason: Rejection | 'reused'): Promise<never> {
  await incrementMetric(ctx.db, ctx.now(), 'antibot_rejected', `${purpose}:${reason}`).catch(() => undefined)
  throw formExpired()
}

/**
 * Confere o `antiBot` do corpo SEM gravar nada (assinatura, idade, prova). Lança `form_expired`.
 * O uso único é gravado depois, na transação da submissão (consumeFormToken), para que um pedido recusado por
 * validação ou limite não queime o token.
 */
export async function verifyFormToken(ctx: AppContext, antiBot: unknown, purpose: FormPurpose): Promise<VerifiedFormToken> {
  const input = (antiBot && typeof antiBot === 'object' ? antiBot : {}) as { token?: unknown; nonce?: unknown }
  const keys = Object.keys(input)
  const token = input.token
  const nonce = typeof input.nonce === 'number' && Number.isSafeInteger(input.nonce) && input.nonce >= 0 ? String(input.nonce) : input.nonce
  if (
    keys.some((k) => k !== 'token' && k !== 'nonce') ||
    typeof token !== 'string' ||
    token.length > TOKEN_MAX ||
    typeof nonce !== 'string' ||
    !NONCE_PATTERN.test(nonce)
  ) {
    return reject(ctx, purpose, 'malformed')
  }
  const [encoded, signature, extra] = token.split('.')
  if (!encoded || !signature || extra !== undefined || !safeEqual(signature, sign(ctx, encoded))) {
    return reject(ctx, purpose, 'invalid_signature')
  }
  let payload: { v?: unknown; c?: unknown; d?: unknown; iat?: unknown }
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
  } catch {
    return reject(ctx, purpose, 'malformed')
  }
  const { v, c, d, iat } = payload
  if (v !== 1 || typeof c !== 'string' || !CHALLENGE.test(c) || typeof d !== 'number' || !Number.isInteger(d) || typeof iat !== 'number') {
    return reject(ctx, purpose, 'malformed')
  }
  // Token emitido com dificuldade menor que a vigente (mudança de contrato) não vale mais.
  if (d < ANTI_BOT.difficultyBits || d > 32) return reject(ctx, purpose, 'malformed')
  const age = ctx.now().getTime() - iat
  if (age < ANTI_BOT.minFillSeconds * 1000) return reject(ctx, purpose, 'too_young')
  if (age > ANTI_BOT.tokenTtlSeconds * 1000) return reject(ctx, purpose, 'expired')
  if (!checkProofOfWork(c, nonce, d)) return reject(ctx, purpose, 'bad_proof')
  return { tokenHash: sha256Hex(token), expiresAt: new Date(iat + ANTI_BOT.tokenTtlSeconds * 1000), difficultyBits: d }
}

/** Grava o uso único do token na transação da submissão. Token já usado → `form_expired`. */
export async function consumeFormToken(ctx: AppContext, tx: Queryable, verified: VerifiedFormToken, purpose: FormPurpose): Promise<void> {
  const r = await tx.query(
    `INSERT INTO form_token_uses (token_hash, purpose, used_at, expires_at) VALUES ($1, $2, $3, $4)
     ON CONFLICT (token_hash) DO NOTHING RETURNING token_hash`,
    [verified.tokenHash, purpose, ctx.now(), verified.expiresAt],
  )
  if (!r.rows.length) {
    await incrementMetric(tx, ctx.now(), 'antibot_rejected', `${purpose}:reused`)
    throw formExpired()
  }
}

export interface AttemptKeys {
  /** HMAC da rede de origem (req.originHash). */
  ip: string
  cpf?: string | null
  phone?: string | null
}

async function countSince(tx: Queryable, purpose: FormPurpose, column: 'ip_key' | 'cpf_key' | 'phone_key', key: string, since: Date): Promise<number> {
  const r = await tx.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM form_attempts WHERE purpose = $1 AND ${column} = $2 AND created_at > $3`,
    [purpose, key, since],
  )
  return r.rows[0]?.n ?? 0
}

/**
 * Limites de contracts/validation.json → waitlist.limits sobre as submissões já aceitas. Acima → 429.
 * No cadastro, a rede que passou de `elevatedAfterPerIpPerHour` precisa de prova com `elevatedDifficultyBits`:
 * token mais fácil → `form_expired` (o site pede outro token e reenvia uma vez).
 * Chamar dentro da transação da submissão, depois de travar as chaves do contato.
 */
export async function enforceFormLimits(
  ctx: AppContext,
  tx: Queryable,
  purpose: FormPurpose,
  keys: AttemptKeys,
  proof?: Pick<VerifiedFormToken, 'difficultyBits'>,
): Promise<void> {
  const now = ctx.now().getTime()
  const hourAgo = new Date(now - HOUR_MS)
  const dayAgo = new Date(now - DAY_MS)
  let exceeded: string | null = null
  const fromIp = await countSince(tx, purpose, 'ip_key', keys.ip, hourAgo)
  if (purpose === 'opt_out') {
    if (fromIp >= FORM_LIMITS.optOutPerIpPerHour) exceeded = 'ip'
  } else if (fromIp >= FORM_LIMITS.submissionsPerIpPerHour) {
    exceeded = 'ip'
  } else if (proof && fromIp >= FORM_LIMITS.elevatedAfterPerIpPerHour && proof.difficultyBits < ANTI_BOT.elevatedDifficultyBits) {
    // Fora da transação (desfeita pelo erro), como a métrica de limite abaixo.
    void incrementMetric(ctx.db, ctx.now(), 'antibot_rejected', `${purpose}:needs_elevated`).catch(() => undefined)
    throw formExpired()
  } else if (keys.cpf && (await countSince(tx, purpose, 'cpf_key', keys.cpf, dayAgo)) >= FORM_LIMITS.submissionsPerCpfPerDay) {
    exceeded = 'cpf'
  } else if (keys.phone && (await countSince(tx, purpose, 'phone_key', keys.phone, dayAgo)) >= FORM_LIMITS.submissionsPerPhonePerDay) {
    exceeded = 'phone'
  }
  if (exceeded) {
    // A métrica fica fora da transação (que será desfeita pelo 429) e não é aguardada: no PGlite (conexão única)
    // ela roda depois do fim da transação; no PostgreSQL, em outra conexão do pool.
    void incrementMetric(ctx.db, ctx.now(), 'antibot_rejected', `${purpose}:limit_${exceeded}`).catch(() => undefined)
    throw Errors.tooMany()
  }
}

export async function recordFormAttempt(ctx: AppContext, tx: Queryable, purpose: FormPurpose, keys: AttemptKeys): Promise<void> {
  await tx.query(
    'INSERT INTO form_attempts (id, purpose, ip_key, cpf_key, phone_key, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
    [randomUUID(), purpose, keys.ip, keys.cpf ?? null, keys.phone ?? null, ctx.now()],
  )
}

let lastCleanup = 0

/** Limpeza oportunista (no máximo a cada 10 min): tokens vencidos e tentativas fora de qualquer janela. */
export async function cleanupAntiBot(ctx: AppContext): Promise<void> {
  const now = ctx.now().getTime()
  if (Math.abs(now - lastCleanup) < CLEANUP_INTERVAL_MS) return
  lastCleanup = now
  try {
    await ctx.db.query('DELETE FROM form_token_uses WHERE expires_at < $1', [new Date(now)])
    await ctx.db.query('DELETE FROM form_attempts WHERE created_at < $1', [new Date(now - ATTEMPTS_RETENTION_MS)])
  } catch (err) {
    ctx.logger.warn({ code: (err as { code?: string })?.code }, 'limpeza do anti-robô não concluída')
  }
}

export const ANTI_BOT_ATTEMPTS_RETENTION_MS = ATTEMPTS_RETENTION_MS

/** Campo-armadilha preenchido (humanos nunca veem o campo). */
export function honeypotFilled(body: unknown): boolean {
  const value = (body && typeof body === 'object' ? (body as Record<string, unknown>)[ANTI_BOT.honeypotField] : undefined) as unknown
  return typeof value === 'string' ? value.trim().length > 0 : value !== undefined && value !== null && value !== ''
}
