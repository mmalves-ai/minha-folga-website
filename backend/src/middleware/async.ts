import type { NextFunction, Request, RequestHandler, Response } from 'express'

/** Express 5 já encaminha rejeições de handlers async; este wrapper só dá tipagem explícita. */
export const handler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
