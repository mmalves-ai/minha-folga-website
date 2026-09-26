import { ECDH } from 'node:crypto'
import { request as httpsRequest } from 'node:https'
import webPush from 'web-push'
import type { AppConfig } from '../../config/index.js'

export interface BrowserSubscription { endpoint: string; keys: { p256dh: string; auth: string } }
export interface PushPayload { title: string; body: string; url: string; campaignId: string }
export interface PushTransport { send(subscription: BrowserSubscription, payload: PushPayload): Promise<void> }

/** HTTPS apenas nos serviços de entrega dos navegadores. Nenhum host/porta arbitrário nem redirecionamento. */
export function safePushEndpoint(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return false
    const host = url.hostname.toLowerCase()
    return (host === 'fcm.googleapis.com' && url.pathname.startsWith('/fcm/send/')) ||
      (host === 'updates.push.services.mozilla.com' && url.pathname.startsWith('/wpush/')) ||
      (host === 'web.push.apple.com' && url.pathname.length > 1) ||
      (/^(?:[a-z0-9-]+\.)?notify\.windows\.com$/.test(host) && url.pathname.startsWith('/w/'))
  } catch { return false }
}

export function validPushKeys(keys: BrowserSubscription['keys']): boolean {
  try {
    if (!/^[A-Za-z0-9_-]{87}$/.test(keys.p256dh) || !/^[A-Za-z0-9_-]{22}$/.test(keys.auth)) return false
    const point = Buffer.from(keys.p256dh, 'base64url')
    if (point.length !== 65 || point[0] !== 4 || Buffer.from(keys.auth, 'base64url').length !== 16) return false
    ECDH.convertKey(point, 'prime256v1')
    return true
  } catch { return false }
}

/** Biblioteca cuida da criptografia/VAPID; HTTPS próprio impõe prazo absoluto e não segue Location. */
export function createPushTransport(config: AppConfig): PushTransport {
  return {
    async send(subscription, payload) {
      const cfg = config.webPush
      if (!cfg.enabled || !cfg.subject || !cfg.publicKey || !cfg.privateKey) throw new Error('push_unavailable')
      if (!safePushEndpoint(subscription.endpoint) || !validPushKeys(subscription.keys)) throw new Error('invalid_subscription')
      const details = webPush.generateRequestDetails(subscription, JSON.stringify(payload), {
        vapidDetails: { subject: cfg.subject, publicKey: cfg.publicKey, privateKey: cfg.privateKey },
        TTL: 3600, timeout: 10_000, urgency: 'normal', contentEncoding: 'aes128gcm',
        topic: payload.campaignId.replaceAll('-', '').slice(0, 32),
      })
      await new Promise<void>((resolve, reject) => {
        let settled = false
        const done = (error?: Error & { statusCode?: number }) => {
          if (settled) return
          settled = true
          clearTimeout(deadline)
          if (error) reject(error)
          else resolve()
        }
        const req = httpsRequest(details.endpoint, { method: details.method, headers: details.headers, timeout: 10_000 }, (res) => {
          const statusCode = res.statusCode ?? 0
          // Só o status interessa. Não reter corpo/headers/endpoints retornados pelo provedor.
          res.destroy()
          if (statusCode >= 200 && statusCode < 300) done()
          else done(Object.assign(new Error('push_http_error'), { statusCode }))
        })
        const deadline = setTimeout(() => req.destroy(new Error('push_deadline')), 12_000)
        deadline.unref()
        req.on('timeout', () => req.destroy(new Error('push_timeout')))
        req.on('error', () => done(new Error('push_transport_error')))
        req.end(details.body)
      })
    },
  }
}
