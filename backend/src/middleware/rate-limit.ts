import { randomBytes } from 'node:crypto'
import { ipKeyGenerator, rateLimit, type Options } from 'express-rate-limit'
import type { Request } from 'express'
import { hmacHex } from '../lib/crypto.js'

// Chave aleatória por processo: as contagens vivem só em memória, então não precisam de segredo persistente.
const LIMIT_KEY = randomBytes(32)

/**
 * Limite por HMAC do IP, em memória: adequado a uma instância da API.
 * IPv6 é agrupado pela sub-rede /56 (ipKeyGenerator): trocar de endereço dentro do mesmo prefixo
 * não renova a cota. O IP nunca é guardado em claro.
 * Com mais de uma instância, trocar por armazenamento compartilhado exclusivo da Minha Folga.
 */
export function limiter(name: string, windowMs: number, limit: number, extra: Partial<Options> = {}) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req: Request) => `${name}:${hmacHex(ipKeyGenerator(req.ip ?? 'unknown'), LIMIT_KEY, 'rate-limit').slice(0, 32)}`,
    handler: (req, res) => {
      res.status(429).json({
        error: { code: 'rate_limited', message: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' },
        requestId: req.requestId,
      })
    },
    ...extra,
  })
}
