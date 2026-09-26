import type { NextFunction, Request, Response } from 'express'
import type { AppContext } from '../../context.js'
import { safeEqual, sha256Hex } from '../../lib/crypto.js'
import { AppError, Errors } from '../../lib/errors.js'
import { verifyV1 } from './signature.js'

/**
 * Autenticação servidor-a-servidor das chamadas da Hal-AI (Bia) — decisão D1:
 * - HALAI_ENABLED=false ou HALAI_INBOUND_API_KEY ausente → 503 agent_disabled (antes de qualquer verificação);
 * - `X-API-Key: <HALAI_INBOUND_API_KEY>`, comparação em tempo constante → 401 invalid_api_key (é o modelo que a
 *   Hal-AI usa para chamar APIs externas);
 * - com HALAI_WEBHOOK_SECRET configurado, a assinatura v1 também é exigida: X-MF-Timestamp + X-MF-Signature sobre o
 *   corpo bruto (req.rawBody) → 401 invalid_signature / stale_request, e X-MF-Request-Id único por chamada
 *   (webhook_events, provider 'halai') → 409 replayed_request. Como o id não entra na assinatura, a própria
 *   assinatura também é registrada: reenviar a mesma chamada com outro id não passa.
 * - sem assinatura configurada, X-MF-Request-Id é opcional; quando enviado, repetições também respondem 409.
 */
export const HALAI_PROVIDER = 'halai'
const REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/
const API_KEY_MAX = 512

export const AGENT_AUTH_MESSAGES = {
  disabled: 'A integração da Bia está desligada neste ambiente.',
  invalidApiKey: 'Chave de API inválida.',
  invalidSignature: 'Assinatura da requisição inválida.',
  stale: 'Requisição fora da janela de tempo permitida. Confira o relógio do servidor que assina.',
  replayed: 'Esta requisição já foi processada.',
} as const

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Assinatura v1 aceita (preenchida por verifyAgentSignature quando a assinatura é exigida). */
      agentSignature?: string
    }
  }
}

export function requireAgentEnabled(ctx: AppContext) {
  return (_req: Request, _res: Response, next: NextFunction) => {
    if (!ctx.config.halai.enabled || !ctx.config.halai.inboundApiKey) {
      return next(Errors.unavailable('agent_disabled', AGENT_AUTH_MESSAGES.disabled))
    }
    next()
  }
}

/** Confere X-API-Key em tempo constante (o tamanho diferente também é comparado sem atalho de conteúdo). */
export function verifyAgentApiKey(ctx: AppContext) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const expected = ctx.config.halai.inboundApiKey ?? ''
    const given = req.get('x-api-key') ?? ''
    const ok = expected.length > 0 && given.length > 0 && given.length <= API_KEY_MAX && safeEqual(sha256Hex(given), sha256Hex(expected))
    if (!ok) return next(new AppError(401, 'invalid_api_key', AGENT_AUTH_MESSAGES.invalidApiKey))
    next()
  }
}

/** Assinatura v1 — exigida somente quando HALAI_WEBHOOK_SECRET está configurado. */
export function verifyAgentSignature(ctx: AppContext) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const secret = ctx.config.halai.webhookSecret
    if (!secret) return next()
    const check = verifyV1({
      secret,
      timestamp: req.get('x-mf-timestamp'),
      signature: req.get('x-mf-signature'),
      rawBody: req.rawBody,
      nowSeconds: Math.floor(ctx.now().getTime() / 1000),
    })
    if (!check.ok) {
      const message = check.code === 'stale_request' ? AGENT_AUTH_MESSAGES.stale : AGENT_AUTH_MESSAGES.invalidSignature
      return next(new AppError(401, check.code, message))
    }
    req.agentSignature = check.signature
    next()
  }
}

// Registros de replay além da janela de assinatura não protegem mais nada: guardamos 1 dia e limpamos
// no máximo a cada 10 minutos, sem depender de outra tarefa agendada.
const REPLAY_RETENTION_MS = 24 * 60 * 60 * 1000
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000

/**
 * Registra o id da chamada (e a assinatura, quando exigida); qualquer repetição responde 409.
 * Usar depois de verifyAgentSignature. Com assinatura, X-MF-Request-Id é obrigatório.
 */
export function rejectReplay(ctx: AppContext) {
  let lastCleanup = 0
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const nowMs = ctx.now().getTime()
      if (nowMs - lastCleanup > CLEANUP_INTERVAL_MS) {
        lastCleanup = nowMs
        await ctx.db.query('DELETE FROM webhook_events WHERE provider = $1 AND received_at < $2', [
          HALAI_PROVIDER,
          new Date(nowMs - REPLAY_RETENTION_MS),
        ])
      }
      const signed = Boolean(req.agentSignature)
      const requestId = req.get('x-mf-request-id')
      if (requestId === undefined && !signed) return next()
      if (!REQUEST_ID.test(requestId ?? '')) {
        throw Errors.validation({ 'X-MF-Request-Id': 'Informe um identificador único da chamada (8 a 128 caracteres: letras, números, . _ : -).' })
      }
      const ids = [`req:${requestId}`]
      if (signed) ids.push(`sig:${sha256Hex(req.agentSignature!)}`)
      const r = await ctx.db.query<{ event_id: string }>(
        `INSERT INTO webhook_events (provider, event_id, received_at)
         SELECT $1, unnest($2::text[]), $3
         ON CONFLICT (provider, event_id) DO NOTHING
         RETURNING event_id`,
        [HALAI_PROVIDER, ids, ctx.now()],
      )
      if (r.rows.length < ids.length) throw Errors.conflict('replayed_request', AGENT_AUTH_MESSAGES.replayed)
      next()
    } catch (err) {
      next(err)
    }
  }
}
