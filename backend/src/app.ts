import cookieParser from 'cookie-parser'
import express from 'express'
import helmet from 'helmet'
import type { IncomingMessage } from 'node:http'
import { apiNotFound, errorHandler } from './middleware/error-handler.js'
import { requestContext } from './middleware/request-context.js'
import { apiRouter } from './routes/index.js'
import type { AppContext } from './context.js'

declare module 'node:http' {
  interface IncomingMessage {
    /** Corpo bruto, usado apenas para conferir a assinatura opcional das ferramentas da Bia. */
    rawBody?: Buffer
  }
}

/**
 * Limite de corpo das rotas do site, do painel e da Bia. Não há mais /api/webhooks (decisão D1: o WhatsApp é
 * todo da Hal-AI), então nenhuma rota aceita corpo maior.
 */
export const API_BODY_LIMIT = '16kb'

function parseTrustProxy(value: string): boolean | number | string {
  if (value === 'false') return false
  if (/^\d+$/.test(value)) return Number(value)
  return value // 'loopback', 'uniquelocal' ou lista de IPs/CIDRs da topologia real
}

export function createApp(ctx: AppContext): express.Express {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', parseTrustProxy(ctx.config.trustProxy))
  app.set('query parser', 'simple')

  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-origin' },
      hsts: false, // HSTS é definido no servidor web do domínio, após validação do HTTPS.
    }),
  )
  app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    next()
  })
  app.use(requestContext(ctx))
  app.use(cookieParser())
  // JSON de até 16 KB; o corpo bruto fica disponível para a assinatura opcional das chamadas da Bia.
  app.use(
    express.json({
      limit: API_BODY_LIMIT,
      strict: true,
      verify: (req: IncomingMessage, _res, buf) => {
        req.rawBody = buf
      },
    }),
  )

  app.use('/api', apiRouter(ctx))
  app.use('/api', apiNotFound)
  app.use(apiNotFound)
  app.use(errorHandler(ctx))
  return app
}
