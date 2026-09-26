import { randomUUID } from 'node:crypto'
import type { AppContext } from '../context.js'
import type { BrowserSubscription } from '../integrations/push/client.js'
import { decryptField } from '../lib/crypto.js'
import { recordAudit } from '../services/audit.service.js'
import { canSendPush, PUSH_CONSENT_VERSION } from '../services/push.service.js'

const MAX_ATTEMPTS = 3
const LEASE_MS = 120_000
interface Delivery { id: string; campaign_id: string; subscription_id: string | null; attempts: number; lease_token: string }

/** Mesmo worker e ciclo de vida da outbox, com tabela própria para não misturar WhatsApp/lead com navegador. */
export async function processPushBatch(ctx: AppContext, limit = 10): Promise<number> {
  // Desligado: nenhum envio; cancelamentos do usuário continuam funcionando pelas rotas públicas.
  if (!ctx.config.webPush.enabled || !ctx.push) return 0
  const now = ctx.now()
  await ctx.db.query(`UPDATE push_deliveries SET status = CASE WHEN attempts >= $2 THEN 'failed' ELSE 'pending' END,
    locked_until = NULL, lease_token = NULL, last_error = 'lease_expired', updated_at = $1
    WHERE status = 'sending' AND locked_until <= $1`, [now, MAX_ATTEMPTS])
  limit = Math.max(1, Math.min(limit, 10))
  const lease = randomUUID()
  const claimed = await ctx.db.query<Delivery>(`UPDATE push_deliveries d SET status = 'sending', attempts = d.attempts + 1,
      locked_until = $2, lease_token = $4, updated_at = $1
    WHERE d.id IN (SELECT id FROM push_deliveries WHERE status = 'pending' AND next_attempt_at <= $1
      ORDER BY created_at, id LIMIT $3 FOR UPDATE SKIP LOCKED)
    RETURNING d.id, d.campaign_id, d.subscription_id, d.attempts, d.lease_token`, [now, new Date(now.getTime() + LEASE_MS), limit, lease])
  for (const delivery of claimed.rows) await deliver(ctx, delivery)
  return claimed.rowCount
}

async function finish(ctx: AppContext, d: Delivery, status: string, reason: string | null, retryAfter?: Date) {
  const updated = await ctx.db.query(`UPDATE push_deliveries SET status = $2, last_error = $3, locked_until = NULL, lease_token = NULL,
    next_attempt_at = COALESCE($5, next_attempt_at), updated_at = $4 WHERE id = $1 AND status = 'sending' AND lease_token = $6`,
    [d.id, status, reason, ctx.now(), retryAfter ?? null, d.lease_token])
  if (updated.rowCount && status !== 'pending') await recordAudit(ctx.db, { actorType: 'system', action: 'push.delivery_finished', resourceType: 'push_campaign', resourceId: d.campaign_id, metadata: { status, reason } })
}

async function deliver(ctx: AppContext, d: Delivery) {
  const r = await ctx.db.query<{ title: string; body: string; target_url: string; created_by: string; created_at: Date; cancelled_at: Date | null; subscription_ciphertext: string | null; consent_version: string | null }>(
    `SELECT c.title,c.body,c.target_url,c.created_by,c.created_at,c.cancelled_at,s.subscription_ciphertext,s.consent_version
      FROM push_campaigns c LEFT JOIN push_subscriptions s ON s.id = $2 WHERE c.id = $1`, [d.campaign_id, d.subscription_id],
  )
  const row = r.rows[0]
  if (!row || row.cancelled_at || !row.subscription_ciphertext || row.consent_version !== PUSH_CONSENT_VERSION) {
    await finish(ctx, d, 'cancelled', 'consent_or_campaign_inactive'); return
  }
  if (ctx.now().getTime() - new Date(row.created_at).getTime() >= 86_400_000) {
    await finish(ctx, d, 'cancelled', 'campaign_expired'); return
  }
  if (!await canSendPush(ctx.db, row.created_by)) {
    await finish(ctx, d, 'cancelled', 'sender_permission_revoked'); return
  }
  let subscription: BrowserSubscription
  try { subscription = JSON.parse(decryptField(row.subscription_ciphertext, ctx.config.secrets.encryption, `push.subscription:${d.subscription_id}`)) as BrowserSubscription }
  catch { await finish(ctx, d, 'failed', 'subscription_unavailable'); return }
  // Relê imediatamente antes de chamar o provedor. Um pedido já aceito pelo provedor não pode ser recolhido.
  const active = await ctx.db.query('SELECT id FROM push_subscriptions WHERE id = $1', [d.subscription_id])
  if (!active.rowCount) { await finish(ctx, d, 'cancelled', 'subscription_removed'); return }
  // Um lote pode esperar por mensagens anteriores: não envia se outro worker recuperou esta reserva.
  const at = ctx.now()
  const owned = await ctx.db.query(`UPDATE push_deliveries SET locked_until = $2
    WHERE id = $1 AND status = 'sending' AND lease_token = $3 AND locked_until > $4 RETURNING id`,
    [d.id, new Date(at.getTime() + LEASE_MS), d.lease_token, at])
  if (!owned.rowCount) return
  try {
    await ctx.push!.send(subscription, { title: row.title, body: row.body, url: row.target_url, campaignId: d.campaign_id })
    // Aceitação pelo serviço Push NÃO significa leitura nem exibição no dispositivo.
    await finish(ctx, d, 'accepted', null)
  } catch (error) {
    const code = typeof (error as { statusCode?: unknown })?.statusCode === 'number' ? (error as { statusCode: number }).statusCode : 0
    if (code === 404 || code === 410) {
      await finish(ctx, d, 'expired', `http_${code}`)
      await ctx.db.query('DELETE FROM push_subscriptions WHERE id = $1', [d.subscription_id])
      return
    }
    const retryable = !code || code === 429 || code >= 500
    const retry = retryable && d.attempts < MAX_ATTEMPTS
    // Nunca salvar/logar erro do provedor: ele pode incluir endpoint, headers e chaves.
    await finish(ctx, d, retry ? 'pending' : 'failed', code ? `http_${code}` : 'transport_error',
      retry ? new Date(ctx.now().getTime() + 30_000 * 2 ** (d.attempts - 1)) : undefined)
  }
}
