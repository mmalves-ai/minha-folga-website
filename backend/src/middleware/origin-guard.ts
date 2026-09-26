import type { NextFunction, Request, Response } from 'express'
import { AppError } from '../lib/errors.js'
import type { AppContext } from '../context.js'

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Defesa de base contra CSRF para rotas acionadas pelo navegador:
 * - métodos inseguros exigem `Content-Type: application/json` (força preflight entre origens);
 * - se o navegador enviar `Origin`, ela precisa estar na lista permitida.
 * Rotas de webhook/servidor-a-servidor não usam este middleware (usam assinatura).
 * A área administrativa soma a isto um token CSRF por sessão.
 */
export function originGuard(ctx: AppContext) {
  const allowed = new Set(ctx.config.allowedOrigins)
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!UNSAFE.has(req.method)) return next()
    const origin = req.get('origin')
    if (origin && !allowed.has(origin.replace(/\/$/, ''))) {
      return next(new AppError(403, 'origin_not_allowed', 'Origem da requisição não permitida.'))
    }
    if (!req.is('application/json')) {
      return next(new AppError(415, 'unsupported_media_type', 'Envie os dados em JSON.'))
    }
    next()
  }
}
