import type { Request, Response } from 'express'
import { randomToken, sha256Hex } from '../lib/crypto.js'
import type { AppContext } from '../context.js'
import type { Queryable } from '../db/database.js'

/**
 * Sessão do titular do contato, aberta pelo link seguro de uso único que a Bia gera (issue_preferences_link, D1).
 * Cookie HttpOnly, Secure, SameSite=Strict, restrito a /api. O banco guarda apenas o hash.
 * Não há PII em cookie, URL ou armazenamento do navegador.
 */
export const CONTACT_COOKIE = 'mf_contact'
const TTL_MS = 30 * 60 * 1000

export async function issueContactSession(ctx: AppContext, db: Queryable, res: Response, leadId: string): Promise<void> {
  const token = randomToken(32)
  const now = ctx.now()
  await db.query(
    'INSERT INTO contact_sessions (id_hash, lead_id, created_at, expires_at) VALUES ($1, $2, $3, $4)',
    [sha256Hex(token), leadId, now, new Date(now.getTime() + TTL_MS)],
  )
  res.cookie(CONTACT_COOKIE, token, {
    httpOnly: true,
    secure: ctx.config.cookieSecure,
    sameSite: 'strict',
    path: '/api',
    maxAge: TTL_MS,
  })
}

/** Retorna o lead da sessão válida, ou null. Não diferencia sessão expirada de inexistente. */
export async function readContactSession(ctx: AppContext, req: Request): Promise<{ leadId: string; sessionHash: string } | null> {
  const token = req.cookies?.[CONTACT_COOKIE]
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null
  const hash = sha256Hex(token)
  const r = await ctx.db.query<{ lead_id: string }>(
    `SELECT s.lead_id FROM contact_sessions s JOIN leads l ON l.id = s.lead_id
      WHERE s.id_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > $2 AND l.anonymized_at IS NULL`,
    [hash, ctx.now()],
  )
  const row = r.rows[0]
  return row ? { leadId: row.lead_id, sessionHash: hash } : null
}

export async function endContactSession(ctx: AppContext, req: Request, res: Response): Promise<void> {
  const token = req.cookies?.[CONTACT_COOKIE]
  if (typeof token === 'string') {
    await ctx.db.query('UPDATE contact_sessions SET revoked_at = $2 WHERE id_hash = $1', [sha256Hex(token), ctx.now()])
  }
  res.clearCookie(CONTACT_COOKIE, { path: '/api', httpOnly: true, secure: ctx.config.cookieSecure, sameSite: 'strict' })
}
