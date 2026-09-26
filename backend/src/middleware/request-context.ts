import { randomUUID } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { ipKeyGenerator } from 'express-rate-limit'
import { hmacHex } from '../lib/crypto.js'
import type { AppContext } from '../context.js'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string
      /** HMAC do IP (com chave do servidor) para limites e auditoria, sem guardar o IP em claro. */
      ipHash: string
      /**
       * HMAC da rede de origem (IPv4 inteiro; IPv6 agrupado em /56, como nos limites por IP). Usado nos limites do
       * anti-robô por IP (cadastro e pedido de saída): trocar de endereço na mesma rede não renova a cota.
       * Nunca guarda o IP.
       */
      originHash: string
    }
  }
}

export function requestContext(ctx: AppContext) {
  return (req: Request, res: Response, next: NextFunction) => {
    req.requestId = randomUUID()
    req.ipHash = hmacHex(req.ip ?? 'unknown', ctx.config.secrets.sessionSecret, 'ip').slice(0, 32)
    req.originHash = hmacHex(ipKeyGenerator(req.ip ?? 'unknown'), ctx.config.secrets.sessionSecret, 'origin').slice(0, 32)
    res.setHeader('X-Request-Id', req.requestId)
    const started = process.hrtime.bigint()
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6
      // Somente método, rota, status e duração. Sem corpo, query string, cookies ou IP.
      ctx.logger.info(
        {
          requestId: req.requestId,
          method: req.method,
          route: req.route?.path ? `${req.baseUrl}${req.route.path}` : req.baseUrl || 'unmatched',
          status: res.statusCode,
          ms: Math.round(ms),
        },
        'request',
      )
    })
    next()
  }
}
