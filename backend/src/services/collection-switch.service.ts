import type { AppContext } from '../context.js'
import { AppError } from '../lib/errors.js'
import { recordAudit } from './audit.service.js'
import type { AdminPrincipal } from './admin-auth.service.js'
import { iso } from './admin-common.js'

/**
 * Interruptor do formulário de cadastro do SITE (ataque de robôs, volume anormal).
 *
 * - `WAITLIST_FORM_ENABLED=false` (arquivo de ambiente + reinício) fecha o formulário; o painel não reabre.
 * - O painel (`collection:manage`, só o papel admin) pausa e reabre sem reiniciar a API, com justificativa na
 *   auditoria. O estado fica em app_settings (migração 004), lido com cache curto por processo.
 * - Fecha só o formulário do site: POST /api/waitlist → 503 `collection_unavailable` e `/api/public-config` com
 *   `collection.waitlistEnabled=false` (o site mostra o aviso de indisponível). A Bia (telefone atestado) e o pedido
 *   de saída continuam.
 */
const KEY = 'waitlist_form_paused'
/** Quanto tempo outro processo da API pode levar para ver a mudança feita no painel. */
const CACHE_MS = 5_000

const cache = new WeakMap<AppContext, { at: number; paused: boolean }>()

export const collectionUnavailable = () =>
  new AppError(503, 'collection_unavailable', 'O cadastro de interesse não está disponível no momento. Tente novamente mais tarde.')

/** Cadastro possível pela configuração (site e Bia): identidade empresarial completa em ambiente público. */
export function assertWaitlistOpen(ctx: AppContext): void {
  if (!ctx.config.collection.waitlistEnabled) throw collectionUnavailable()
}

export async function waitlistFormPaused(ctx: AppContext): Promise<boolean> {
  const now = ctx.now().getTime()
  const hit = cache.get(ctx)
  if (hit && Math.abs(now - hit.at) < CACHE_MS) return hit.paused
  const r = await ctx.db.query<{ value: string }>('SELECT value FROM app_settings WHERE key = $1', [KEY])
  const paused = r.rows[0]?.value === 'true'
  cache.set(ctx, { at: now, paused })
  return paused
}

/** O formulário do site aceita cadastros agora (configuração, variável de ambiente e pausa do painel). */
export async function waitlistFormOpen(ctx: AppContext): Promise<boolean> {
  const { collection } = ctx.config
  if (!collection.waitlistEnabled || !collection.siteFormEnabled) return false
  return !(await waitlistFormPaused(ctx))
}

export async function assertWaitlistFormOpen(ctx: AppContext): Promise<void> {
  if (!(await waitlistFormOpen(ctx))) throw collectionUnavailable()
}

export interface CollectionView {
  waitlistForm: {
    open: boolean
    paused: boolean
    lockedByEnvironment: boolean
    /** Outros motivos de configuração que fecham o cadastro (ex.: identity_incomplete). */
    reasons: string[]
    changedAt: string | null
    changedBy: string | null
  }
}

export async function getCollectionView(ctx: AppContext): Promise<CollectionView> {
  const r = await ctx.db.query<{ value: string; updated_at: Date; display_name: string | null }>(
    `SELECT s.value, s.updated_at, u.display_name
       FROM app_settings s LEFT JOIN admin_users u ON u.id = s.updated_by WHERE s.key = $1`,
    [KEY],
  )
  const row = r.rows[0]
  const paused = row?.value === 'true'
  const { collection } = ctx.config
  return {
    waitlistForm: {
      open: collection.waitlistEnabled && collection.siteFormEnabled && !paused,
      paused,
      lockedByEnvironment: collection.waitlistEnabled && !collection.siteFormEnabled,
      reasons: [...collection.reasons],
      changedAt: iso(row?.updated_at),
      changedBy: row?.display_name ?? null,
    },
  }
}

export async function setWaitlistFormPaused(
  ctx: AppContext,
  principal: AdminPrincipal,
  paused: boolean,
  reason: string,
  ipHash: string,
): Promise<CollectionView> {
  const now = ctx.now()
  await ctx.db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO app_settings (key, value, updated_at, updated_by) VALUES ($1, $2, $3, $4)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
      [KEY, String(paused), now, principal.user.id],
    )
    await recordAudit(tx, {
      actorType: 'admin',
      actorId: principal.user.id,
      action: paused ? 'admin.waitlist_form_paused' : 'admin.waitlist_form_resumed',
      resourceType: 'setting',
      resourceId: KEY,
      metadata: { reason },
      ipHash,
    })
  })
  cache.delete(ctx)
  ctx.logger.warn({ paused, adminId: principal.user.id }, paused ? 'formulário de cadastro do site pausado pelo painel' : 'formulário de cadastro do site reaberto pelo painel')
  return getCollectionView(ctx)
}
