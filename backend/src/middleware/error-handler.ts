import type { NextFunction, Request, Response } from 'express'
import { AppError } from '../lib/errors.js'
import type { AppContext } from '../context.js'

/** Resposta de erro padronizada: sempre JSON, nunca HTML, nunca detalhe interno. */
export function errorHandler(ctx: AppContext) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return
    const bodyError = err as { type?: string; status?: number }
    if (bodyError?.type === 'entity.too.large') {
      res.status(413).json({ error: { code: 'payload_too_large', message: 'O conteúdo enviado é maior que o permitido.' }, requestId: req.requestId })
      return
    }
    if (bodyError?.type === 'entity.parse.failed') {
      res.status(400).json({ error: { code: 'invalid_json', message: 'Não foi possível ler os dados enviados.' }, requestId: req.requestId })
      return
    }
    if (err instanceof AppError) {
      if (!err.expose) ctx.logger.error({ requestId: req.requestId, code: err.code, err: err.cause ?? err }, 'app error')
      res.status(err.status).json({
        error: { code: err.code, message: err.message, ...(err.fields ? { fields: err.fields } : {}), ...(err.extra ?? {}) },
        requestId: req.requestId,
      })
      return
    }
    ctx.logger.error({ requestId: req.requestId, err }, 'unhandled error')
    res.status(500).json({
      error: { code: 'internal_error', message: 'Não foi possível concluir. Tente novamente em instantes.' },
      requestId: req.requestId,
    })
  }
}

export function apiNotFound(req: Request, res: Response) {
  res.status(404).json({ error: { code: 'not_found', message: 'Rota da API inexistente.' }, requestId: req.requestId })
}
