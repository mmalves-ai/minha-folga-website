import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { NOTIFICATIONS } from '../config/contracts.js'
import type { AppContext } from '../context.js'
import type { Queryable } from '../db/database.js'
import { safePushEndpoint, validPushKeys, type BrowserSubscription } from '../integrations/push/client.js'
import { decryptField, encryptField, hmacHex, safeEqual, sha256Hex } from '../lib/crypto.js'
import { AppError, Errors } from '../lib/errors.js'
import type { AdminPrincipal } from './admin-auth.service.js'
import { recordAudit } from './audit.service.js'

export const PUSH_CONSENT_VERSION = NOTIFICATIONS.consent.version
export const PUSH_MAX_SUBSCRIPTIONS = 100_000
export const PUSH_DESTINATIONS = NOTIFICATIONS.destinations
export const SubscribePushSchema = z.strictObject({
  subscription: z.strictObject({
    endpoint: z.string().max(4096).refine(safePushEndpoint),
    expirationTime: z.number().nullable().optional(),
    keys: z.strictObject({ p256dh: z.string().max(100), auth: z.string().max(32) }).refine(validPushKeys),
  }),
  consentVersion: z.literal(PUSH_CONSENT_VERSION),
})
export const UnsubscribePushSchema = z.strictObject({ subscriptionId: z.uuid(), unsubscribeToken: z.string().regex(/^[a-f0-9]{64}$/) })
const visibleText = (min: number, max: number) => z.string().trim().min(min).max(max).refine((s) => !/[\x00-\x1f\x7f]/.test(s))
export const SendPushSchema = z.strictObject({ requestKey: z.uuid(), title: visibleText(1, NOTIFICATIONS.limits.titleMax), body: visibleText(1, NOTIFICATIONS.limits.bodyMax), url: z.enum(PUSH_DESTINATIONS), confirm: z.literal(true) })
export const GrantPushSchema = z.strictObject({ enabled: z.boolean(), reason: visibleText(5, 200) })
export const PUSH_FIELD_MESSAGES = {
  subscription: 'Não foi possível validar a inscrição deste navegador.', consentVersion: 'Atualize a página para confirmar a autorização vigente.',
  subscriptionId: 'Identificador da inscrição inválido.', unsubscribeToken: 'Autorização de cancelamento inválida.',
  requestKey: 'Atualize a página antes de enviar.', title: 'Informe um título de até 60 caracteres.', body: 'Informe um texto de até 180 caracteres.',
  url: 'Selecione uma página pública da Minha Folga.', confirm: 'Confirme o envio para os navegadores inscritos.',
  enabled: 'Informe se deseja autorizar ou revogar o envio.', reason: 'Descreva o motivo em 5 a 200 caracteres.',
}

export function pushConfig(ctx: AppContext) {
  return { enabled: ctx.config.webPush.enabled, publicKey: ctx.config.webPush.enabled ? ctx.config.webPush.publicKey ?? null : null, consentVersion: PUSH_CONSENT_VERSION }
}

function assertPushEnabled(ctx: AppContext) {
  if (!ctx.config.webPush.enabled) throw new AppError(503, 'notifications_unavailable', 'As notificações deste navegador ainda não estão disponíveis.')
}
const subscriptionContext = (id: string) => `push.subscription:${id}`

export async function subscribePush(ctx: AppContext, input: z.infer<typeof SubscribePushSchema>, registrationKey: string) {
  assertPushEnabled(ctx)
  const subscription: BrowserSubscription = { endpoint: input.subscription.endpoint, keys: input.subscription.keys }
  const endpointKey = hmacHex(subscription.endpoint, ctx.config.secrets.dedupKey, 'push-endpoint')
  const now = ctx.now()
  return ctx.db.transaction(async (tx) => {
    // Inscrições serializadas: unicidade, teto global e cota por rede são atômicos.
    await tx.query('SELECT pg_advisory_xact_lock($1)', [7_107_320])
    const found = await tx.query<{ id: string; subscription_ciphertext: string }>('SELECT id, subscription_ciphertext FROM push_subscriptions WHERE endpoint_key = $1', [endpointKey])
    let id = found.rows[0]?.id
    if (id) {
      const stored = JSON.parse(decryptField(found.rows[0]!.subscription_ciphertext, ctx.config.secrets.encryption, subscriptionContext(id))) as BrowserSubscription
      if (!safeEqual(stored.keys.auth, subscription.keys.auth) || !safeEqual(stored.keys.p256dh, subscription.keys.p256dh)) {
        throw Errors.conflict('subscription_conflict', 'Reative as notificações nas configurações deste navegador e tente novamente.')
      }
    } else {
      const count = await tx.query<{ total: number; recent: number }>(
        'SELECT count(*)::int AS total, count(*) FILTER (WHERE registration_key = $1 AND created_at > $2)::int AS recent FROM push_subscriptions',
        [registrationKey, new Date(now.getTime() - 3_600_000)],
      )
      if (count.rows[0]!.total >= PUSH_MAX_SUBSCRIPTIONS || count.rows[0]!.recent >= 30) {
        throw new AppError(429, 'rate_limited', 'Aguarde um pouco antes de tentar ativar novamente.')
      }
      id = randomUUID()
    }
    // Reinscrição idêntica recupera o controle do mesmo navegador sem invalidar outro token.
    const unsubscribeToken = hmacHex(`${id}:${endpointKey}`, subscription.keys.auth, 'push-owner-v1')
    await tx.query(
      `INSERT INTO push_subscriptions (id, endpoint_key, subscription_ciphertext, owner_token_hash, consent_version, registration_key, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
       ON CONFLICT (endpoint_key) DO UPDATE SET consent_version = EXCLUDED.consent_version, updated_at = EXCLUDED.updated_at`,
      [id, endpointKey, encryptField(JSON.stringify(subscription), ctx.config.secrets.encryption, subscriptionContext(id)), sha256Hex(unsubscribeToken), PUSH_CONSENT_VERSION, registrationKey, now],
    )
    await recordAudit(tx, { actorType: 'titular', action: 'push.subscription_authorized', resourceType: 'push_subscription', resourceId: id, metadata: { consentVersion: PUSH_CONSENT_VERSION } })
    return { status: 'subscribed' as const, subscriptionId: id, unsubscribeToken }
  })
}

export async function unsubscribePush(ctx: AppContext, id: string, token: string) {
  await ctx.db.transaction(async (tx) => {
    const row = await tx.query<{ owner_token_hash: string }>('SELECT owner_token_hash FROM push_subscriptions WHERE id = $1 FOR UPDATE', [id])
    if (!row.rows[0]) return // idempotente, inclusive após um 410
    if (!safeEqual(row.rows[0].owner_token_hash, sha256Hex(token))) throw Errors.forbidden()
    await tx.query("UPDATE push_deliveries SET status = 'cancelled', updated_at = $2 WHERE subscription_id = $1 AND status = 'pending'", [id, ctx.now()])
    await tx.query('DELETE FROM push_subscriptions WHERE id = $1', [id])
    await recordAudit(tx, { actorType: 'titular', action: 'push.subscription_revoked', resourceType: 'push_subscription', resourceId: id })
  })
}

export async function canSendPush(db: Queryable, userId: string): Promise<boolean> {
  const r = await db.query<{ allowed: boolean }>(
    `SELECT (u.disabled_at IS NULL AND (u.role = 'admin' OR g.user_id IS NOT NULL)) AS allowed
       FROM admin_users u LEFT JOIN push_grants g ON g.user_id = u.id WHERE u.id = $1`, [userId],
  )
  return r.rows[0]?.allowed === true
}

export async function queuePushCampaign(ctx: AppContext, principal: AdminPrincipal, input: z.infer<typeof SendPushSchema>, ipHash: string) {
  assertPushEnabled(ctx)
  const now = ctx.now()
  return ctx.db.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock($1)', [7_107_321])
    if (!await canSendPush(tx, principal.user.id)) throw Errors.forbidden()
    const existing = await tx.query<{ id: string; audience_count: number; title: string; body: string; target_url: string }>(
      'SELECT id, audience_count, title, body, target_url FROM push_campaigns WHERE created_by = $1 AND request_key = $2', [principal.user.id, input.requestKey],
    )
    if (existing.rows[0]) {
      const old = existing.rows[0]
      if (old.title !== input.title || old.body !== input.body || old.target_url !== input.url) throw Errors.conflict('request_key_reused', 'Este envio já foi registrado com outro conteúdo. Atualize a página.')
      return { status: 'queued' as const, campaignId: old.id, audienceCount: old.audience_count }
    }
    const daily = await tx.query<{ count: number }>('SELECT count(*)::int AS count FROM push_campaigns WHERE created_at > $1', [new Date(now.getTime() - 86_400_000)])
    if (daily.rows[0]!.count >= ctx.config.webPush.dailyCampaignCap) throw new AppError(429, 'campaign_limit', 'O limite de campanhas nas últimas 24 horas foi atingido.')
    const audience = await tx.query<{ id: string }>('SELECT id FROM push_subscriptions WHERE consent_version = $1 ORDER BY created_at, id LIMIT $2', [PUSH_CONSENT_VERSION, PUSH_MAX_SUBSCRIPTIONS])
    if (!audience.rowCount) throw Errors.conflict('no_subscribers', 'Ainda não há navegadores autorizados para receber este envio.')
    const id = randomUUID()
    await tx.query('INSERT INTO push_campaigns (id, request_key, created_by, title, body, target_url, audience_count, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [id, input.requestKey, principal.user.id, input.title, input.body, input.url, audience.rowCount, now])
    // IDs gerados no banco, sem uma ida/volta por destinatário.
    const inserted = await tx.query(`INSERT INTO push_deliveries (id, campaign_id, subscription_id, next_attempt_at, created_at, updated_at)
      SELECT gen_random_uuid(), $1, id, $2, $2, $2 FROM push_subscriptions WHERE id = ANY($3::uuid[])`, [id, now, audience.rows.map((r) => r.id)])
    if (!inserted.rowCount) throw Errors.conflict('no_subscribers', 'Não há mais navegadores autorizados para este envio.')
    await tx.query('UPDATE push_campaigns SET audience_count = $2 WHERE id = $1', [id, inserted.rowCount])
    await recordAudit(tx, { actorType: 'admin', actorId: principal.user.id, action: 'push.campaign_queued', resourceType: 'push_campaign', resourceId: id, metadata: { audienceCount: inserted.rowCount }, ipHash })
    return { status: 'queued' as const, campaignId: id, audienceCount: inserted.rowCount }
  })
}

export async function cancelPushCampaign(ctx: AppContext, principal: AdminPrincipal, id: string, ipHash: string) {
  await ctx.db.transaction(async (tx) => {
    const campaign = await tx.query<{ created_by: string }>('SELECT created_by FROM push_campaigns WHERE id = $1 FOR UPDATE', [id])
    if (!campaign.rows[0]) throw Errors.notFound()
    if (principal.user.role !== 'admin' && campaign.rows[0].created_by !== principal.user.id) throw Errors.forbidden()
    await tx.query('UPDATE push_campaigns SET cancelled_at = COALESCE(cancelled_at, $2) WHERE id = $1', [id, ctx.now()])
    await tx.query("UPDATE push_deliveries SET status = 'cancelled', updated_at = $2 WHERE campaign_id = $1 AND status = 'pending'", [id, ctx.now()])
    await recordAudit(tx, { actorType: 'admin', actorId: principal.user.id, action: 'push.campaign_cancelled', resourceType: 'push_campaign', resourceId: id, ipHash })
  })
}

export async function pushOverview(ctx: AppContext) {
  const subscriptions = await ctx.db.query<{ count: number }>('SELECT count(*)::int AS count FROM push_subscriptions WHERE consent_version = $1', [PUSH_CONSENT_VERSION])
  const campaigns = await ctx.db.query<{ id: string; title: string; body: string; target_url: string; audience_count: number; created_by: string; created_at: Date; cancelled_at: Date | null; pending: number; sending: number; accepted: number; failed: number; expired: number; cancelled: number }>(
    `SELECT c.*, count(d.id) FILTER (WHERE d.status = 'pending')::int AS pending,
      count(d.id) FILTER (WHERE d.status = 'sending')::int AS sending,
      count(d.id) FILTER (WHERE d.status = 'accepted')::int AS accepted,
      count(d.id) FILTER (WHERE d.status = 'failed')::int AS failed,
      count(d.id) FILTER (WHERE d.status = 'expired')::int AS expired,
      count(d.id) FILTER (WHERE d.status = 'cancelled')::int AS cancelled
      FROM (SELECT * FROM push_campaigns ORDER BY created_at DESC LIMIT 50) c
      LEFT JOIN push_deliveries d ON d.campaign_id = c.id GROUP BY c.id,c.request_key,c.created_by,c.title,c.body,c.target_url,c.audience_count,c.cancelled_at,c.created_at ORDER BY c.created_at DESC`,
  )
  return { enabled: ctx.config.webPush.enabled, subscribers: subscriptions.rows[0]!.count, dailyCampaignCap: ctx.config.webPush.dailyCampaignCap, destinations: PUSH_DESTINATIONS,
    campaigns: campaigns.rows.map((c) => ({ id: c.id, title: c.title, body: c.body, url: c.target_url, audienceCount: c.audience_count, createdBy: c.created_by, createdAt: new Date(c.created_at).toISOString(), cancelled: c.cancelled_at !== null,
      delivery: { pending: c.pending, sending: c.sending, accepted: c.accepted, failed: c.failed, expired: c.expired, cancelled: c.cancelled } })) }
}

export async function listPushGrants(ctx: AppContext) {
  const r = await ctx.db.query<{ id: string; display_name: string; role: string; disabled_at: Date | null; granted_at: Date | null }>(
    'SELECT u.id, u.display_name, u.role, u.disabled_at, g.granted_at FROM admin_users u LEFT JOIN push_grants g ON g.user_id = u.id ORDER BY u.display_name, u.id',
  )
  return { users: r.rows.map((u) => ({ id: u.id, displayName: u.display_name, role: u.role, disabled: u.disabled_at !== null, allowed: u.role === 'admin' || u.granted_at !== null, grantedAt: u.granted_at ? new Date(u.granted_at).toISOString() : null })) }
}

export async function setPushGrant(ctx: AppContext, principal: AdminPrincipal, id: string, enabled: boolean, reason: string, ipHash: string) {
  if (principal.user.role !== 'admin') throw Errors.forbidden()
  await ctx.db.transaction(async (tx) => {
    const user = await tx.query<{ role: string; disabled_at: Date | null }>('SELECT role, disabled_at FROM admin_users WHERE id = $1 FOR UPDATE', [id])
    if (!user.rows[0]) throw Errors.notFound()
    if (user.rows[0].role === 'admin') throw Errors.conflict('admin_permission', 'Administradores já possuem essa permissão pelo papel.')
    if (enabled && user.rows[0].disabled_at) throw Errors.conflict('user_disabled', 'Ative a conta antes de autorizar envios.')
    if (enabled) await tx.query('INSERT INTO push_grants (user_id, granted_by, granted_at) VALUES ($1,$2,$3) ON CONFLICT (user_id) DO UPDATE SET granted_by = EXCLUDED.granted_by, granted_at = EXCLUDED.granted_at', [id, principal.user.id, ctx.now()])
    else await tx.query('DELETE FROM push_grants WHERE user_id = $1', [id])
    await recordAudit(tx, { actorType: 'admin', actorId: principal.user.id, action: enabled ? 'push.grant_added' : 'push.grant_revoked', resourceType: 'admin_user', resourceId: id, metadata: { reason }, ipHash })
  })
  return { status: 'updated' as const }
}
