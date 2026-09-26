import { Router } from 'express'
import { handler } from '../middleware/async.js'
import { limiter } from '../middleware/rate-limit.js'
import { issueFormToken } from '../services/anti-bot.service.js'
import type { AppContext } from '../context.js'

/**
 * GET /api/form-token — desafio assinado do anti-robô próprio (D1). Sem estado no servidor até o uso; o navegador
 * resolve a prova de trabalho e envia `antiBot: { token, nonce }` no cadastro e no pedido de saída. A dificuldade
 * sobe para a rede de origem com muitas submissões aceitas na última hora (anti-bot.service.ts).
 * Limite em memória generoso: muita gente pode sair pelo mesmo IP (CGNAT), e emitir token custa só um HMAC.
 */
export function antiBotRoutes(ctx: AppContext): Router {
  const router = Router()
  router.get(
    '/form-token',
    limiter('form-token', 10 * 60 * 1000, 300),
    handler(async (req, res) => {
      res.json(await issueFormToken(ctx, req.originHash))
    }),
  )
  return router
}
