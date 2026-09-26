import { createECDH, randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadConfig, ConfigError } from '../src/config/index.js'
import { processPushBatch } from '../src/jobs/push-worker.js'
import { safePushEndpoint, validPushKeys, type PushTransport } from '../src/integrations/push/client.js'
import { createTestHarness, SITE, TEST_ENV, type TestHarness } from './helpers.js'
import { call, seedUser, signIn, type AdminClient } from './admin-fixtures.js'
const pair = createECDH('prime256v1'); pair.generateKeys()
const env = { WEB_PUSH_ENABLED: 'true', WEB_PUSH_VAPID_PUBLIC_KEY: pair.getPublicKey().toString('base64url'), WEB_PUSH_VAPID_PRIVATE_KEY: pair.getPrivateKey().toString('base64url'), WEB_PUSH_VAPID_SUBJECT: 'mailto:avisos@minhafolga.com.br' }
let h: TestHarness, admin: AdminClient, marketing: AdminClient, privacy: AdminClient, support: AdminClient
const send = vi.fn<PushTransport['send']>()
let requestIp = 0
const campaign = (extra: Record<string, unknown> = {}) => ({ requestKey: randomUUID(), title: 'A Minha Folga está chegando', body: 'Conheça a preparação e acompanhe o próximo passo.', url: '/avise-me', confirm: true, ...extra })
function subscription(endpoint = `https://fcm.googleapis.com/fcm/send/${randomUUID()}`) {
  const key = createECDH('prime256v1'); key.generateKeys()
  return { subscription: { endpoint, expirationTime: null, keys: { p256dh: key.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } }, consentVersion: '1.0' }
}
const post = (c: AdminClient, data: unknown) => call(c, 'post', '/notifications/campaigns', data).set('X-Forwarded-For', `198.51.100.${++requestIp}`)
const register = (data = subscription()) => h.api.post('/api/notifications/subscriptions').set(SITE).send(data)
const revoke = (body: { subscriptionId: string; unsubscribeToken: string }) => h.api.delete('/api/notifications/subscriptions').set(SITE).send(body)
const grant = (enabled: boolean) => call(admin, 'put', `/notifications/grants/${marketing.user.id}`, { enabled, reason: 'Autorização explícita para a campanha' })
beforeAll(async () => {
  h = await createTestHarness(env); h.ctx.push = { send }
  admin = await signIn(h, await seedUser(h, { role: 'admin' })); marketing = await signIn(h, await seedUser(h, { role: 'marketing' }))
  privacy = await signIn(h, await seedUser(h, { role: 'privacy' })); support = await signIn(h, await seedUser(h, { role: 'support' }))
})
beforeEach(async () => {
  await h.ctx.db.query('DELETE FROM push_campaigns'); await h.ctx.db.query('DELETE FROM push_subscriptions'); await h.ctx.db.query('DELETE FROM push_grants')
  send.mockReset().mockResolvedValue(undefined); h.ctx.config.webPush.enabled = true
})
afterAll(async () => { await h.close() })
describe('Web Push: segurança, autorização e fila sem rede', () => {
  it('valida VAPID e publica somente chave pública', async () => {
    expect(() => loadConfig({ source: { ...TEST_ENV, WEB_PUSH_ENABLED: 'true' } })).toThrow(ConfigError)
    expect(() => loadConfig({ source: { ...TEST_ENV, ...env, WEB_PUSH_VAPID_PRIVATE_KEY: randomBytes(32).toString('base64url') } })).toThrow(ConfigError)
    expect((await h.api.get('/api/notifications/config')).body).toEqual({ enabled: true, publicKey: env.WEB_PUSH_VAPID_PUBLIC_KEY, consentVersion: '1.0' })
    h.ctx.config.webPush.enabled = false
    expect((await h.api.get('/api/notifications/config')).body).toEqual({ enabled: false, publicKey: null, consentVersion: '1.0' })
    expect((await register()).status).toBe(503)
  })
  it('recusa SSRF, portas, credenciais, host parecido e chave inválida', async () => {
    for (const url of ['http://fcm.googleapis.com/fcm/send/x','https://127.0.0.1/fcm/send/x','https://fcm.googleapis.com.evil.test/fcm/send/x','https://fcm.googleapis.com:8443/fcm/send/x','https://x@fcm.googleapis.com/fcm/send/x','https://fcm.googleapis.com/fcm/send/x#frag']) {
      expect(safePushEndpoint(url), url).toBe(false); expect((await register(subscription(url))).status).toBe(400)
    }
    for (const url of ['https://fcm.googleapis.com/fcm/send/token','https://updates.push.services.mozilla.com/wpush/v2/token','https://web.push.apple.com/token','https://wns2-bl2p.notify.windows.com/w/?token=x']) expect(safePushEndpoint(url)).toBe(true)
    const bad = subscription(); bad.subscription.keys.p256dh = Buffer.alloc(65, 4).toString('base64url')
    expect(validPushKeys(bad.subscription.keys)).toBe(false); expect((await register(bad)).status).toBe(400)
  })
  it('cifra inscrição, não cria lead e deduplica sem permitir troca de chaves', async () => {
    const input = subscription(), first = await register(input)
    expect(first.status, JSON.stringify(first.body)).toBe(201); expect((await register(input)).body).toEqual(first.body)
    const rows = await h.ctx.db.query<Record<string, unknown>>('SELECT * FROM push_subscriptions')
    expect(rows.rowCount).toBe(1)
    for (const secret of [input.subscription.endpoint,input.subscription.keys.auth,input.subscription.keys.p256dh,first.body.unsubscribeToken]) expect(JSON.stringify(rows.rows)).not.toContain(secret)
    expect(rows.rows[0]!.consent_version).toBe('1.0'); expect((await h.ctx.db.query('SELECT id FROM leads')).rowCount).toBe(0)
    expect((await register(subscription(input.subscription.endpoint))).status).toBe(409)
  })
  it('exige consentimento/origem e token do dono para cancelar; funciona desligado', async () => {
    expect((await register({ ...subscription(), consentVersion: 'old' })).status).toBe(400)
    expect((await h.api.post('/api/notifications/subscriptions').set('Origin','https://evil.test').send(subscription())).status).toBe(403)
    const c = (await register()).body, owner = { subscriptionId: c.subscriptionId, unsubscribeToken: c.unsubscribeToken }
    expect((await revoke({ ...owner, unsubscribeToken: '0'.repeat(64) })).status).toBe(403)
    h.ctx.config.webPush.enabled = false
    expect((await revoke(owner)).status).toBe(204); expect((await revoke(owner)).status).toBe(204)
  })
  it('nega outros papéis, permite grant nominal e revoga imediatamente na mesma sessão', async () => {
    for (const c of [marketing,privacy,support]) {
      expect((await call(c,'get','/notifications')).status).toBe(403); expect((await post(c,campaign())).status).toBe(403); expect((await call(c,'get','/notifications/grants')).status).toBe(403)
    }
    expect((await grant(true)).status).toBe(200)
    const me = await call(marketing,'get','/auth/me'); expect(me.body.permissions).toContain('notifications:send'); expect(me.body.permissions).not.toContain('notifications:manage')
    expect((await call(marketing,'get','/notifications')).status).toBe(200)
    expect((await call(marketing,'put',`/notifications/grants/${support.user.id}`,{ enabled:true, reason:'Tentativa indevida' })).status).toBe(403)
    await grant(false); expect((await call(marketing,'get','/notifications')).status).toBe(403)
  })
  it('exige CSRF/confirmação e destino interno aprovado; histórico sem endpoints', async () => {
    await register()
    expect((await admin.agent.post('/api/admin/notifications/campaigns').set(SITE).send(campaign())).status).toBe(403)
    expect((await post(admin,campaign({ confirm:false }))).status).toBe(400)
    for (const url of ['https://evil.test','//evil.test','/admin','/avise-me?cpf=123']) expect((await post(admin,campaign({url}))).status).toBe(400)
    const view = await call(admin,'get','/notifications'); expect(view.status,JSON.stringify(view.body)).toBe(200); expect(view.body.subscribers).toBe(1); expect(JSON.stringify(view.body)).not.toContain('endpoint')
  })
  it('enfileira uma vez por UUID e navegador; aceitação não vira leitura', async () => {
    expect((await post(admin,campaign())).status).toBe(409); await register()
    const input = campaign(), queued = await post(admin,input)
    expect(queued.status,JSON.stringify(queued.body)).toBe(202); expect((await post(admin,input)).body).toEqual(queued.body)
    expect((await post(admin,{...input,title:'Outro conteúdo'})).status).toBe(409); expect(send).not.toHaveBeenCalled()
    expect(await processPushBatch(h.ctx)).toBe(1); expect(send).toHaveBeenCalledTimes(1); expect(await processPushBatch(h.ctx)).toBe(0)
    expect(send.mock.calls[0]![1]).toEqual({title:input.title,body:input.body,url:input.url,campaignId:queued.body.campaignId})
    const view = await call(admin,'get','/notifications'); expect(view.body.campaigns[0]).toMatchObject({audienceCount:1,delivery:{accepted:1,pending:0}})
  })
  it('remove inscrição expirada no HTTP410 sem guardar conteúdo do provedor', async () => {
    await register(); await post(admin,campaign()); send.mockRejectedValueOnce({statusCode:410,body:'SEGREDO'})
    await processPushBatch(h.ctx); expect((await h.ctx.db.query('SELECT id FROM push_subscriptions')).rowCount).toBe(0)
    expect((await h.ctx.db.query('SELECT status,last_error FROM push_deliveries')).rows[0]).toEqual({status:'expired',last_error:'http_410'}); expect(await processPushBatch(h.ctx)).toBe(0)
  })
  it('retenta erro transitório no máximo três vezes, com backoff', async () => {
    await register(); await post(admin,campaign()); send.mockRejectedValue({statusCode:503,body:'TOKEN',message:'ENDPOINT'})
    await processPushBatch(h.ctx); expect(await processPushBatch(h.ctx)).toBe(0)
    h.clock.advance(30_000); await processPushBatch(h.ctx); h.clock.advance(60_000); await processPushBatch(h.ctx)
    expect(send).toHaveBeenCalledTimes(3); expect((await h.ctx.db.query('SELECT status,last_error FROM push_deliveries')).rows[0]).toEqual({status:'failed',last_error:'http_503'})
  })
  it('não envia desligado, após opt-out ou campanha cancelada', async () => {
    const c = (await register()).body; await post(admin,campaign()); h.ctx.config.webPush.enabled=false
    expect(await processPushBatch(h.ctx)).toBe(0); h.ctx.config.webPush.enabled=true
    await revoke({subscriptionId:c.subscriptionId,unsubscribeToken:c.unsubscribeToken}); await processPushBatch(h.ctx); expect(send).not.toHaveBeenCalled()
    await register(); const queued = await post(admin,campaign())
    expect((await call(admin,'post',`/notifications/campaigns/${queued.body.campaignId}/cancel`)).status).toBe(200)
    await processPushBatch(h.ctx); expect(send).not.toHaveBeenCalled()
  })
  it('revogar remetente cancela seus envios pendentes', async () => {
    await register(); await grant(true); expect((await post(marketing,campaign())).status).toBe(202); await grant(false)
    await processPushBatch(h.ctx); expect(send).not.toHaveBeenCalled(); expect((await h.ctx.db.query('SELECT status FROM push_deliveries')).rows[0]).toEqual({status:'cancelled'})
  })
  it('limita campanhas globalmente e não adiciona inscrições futuras à audiência antiga', async () => {
    await register(); for(let i=0;i<3;i++) expect((await post(admin,campaign())).status).toBe(202)
    expect((await post(admin,campaign())).status).toBe(429); await register(); await processPushBatch(h.ctx); expect(send).toHaveBeenCalledTimes(3)
  })
  it('dois workers concorrentes não enviam a mesma reserva ativa', async () => {
    await register(); await post(admin,campaign())
    let release: (() => void) | undefined
    send.mockImplementationOnce(() => new Promise<void>((resolve) => { release=resolve }))
    const first = processPushBatch(h.ctx)
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(await processPushBatch(h.ctx)).toBe(0)
    release!(); await first
    expect(send).toHaveBeenCalledTimes(1)
  })
  it('recupera lease vencido e expira campanhas após 24h', async () => {
    await register(); await post(admin,campaign())
    await h.ctx.db.query("UPDATE push_deliveries SET status='sending',attempts=1,locked_until=$1,lease_token=$2",[new Date(h.clock.current.getTime()-1),randomUUID()])
    expect(await processPushBatch(h.ctx)).toBe(1); expect(send).toHaveBeenCalledTimes(1)
    await h.ctx.db.query('UPDATE push_campaigns SET created_at=$1',[new Date(h.clock.current.getTime()-86_400_001)])
    await h.ctx.db.query("UPDATE push_deliveries SET status='pending',next_attempt_at=$1",[h.clock.current]); await processPushBatch(h.ctx)
    expect(send).toHaveBeenCalledTimes(1); expect((await h.ctx.db.query('SELECT last_error FROM push_deliveries')).rows[0]).toEqual({last_error:'campaign_expired'})
  })
})
