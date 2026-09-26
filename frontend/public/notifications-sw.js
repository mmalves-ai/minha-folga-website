/*
 * Minha Folga — notificações autorizadas pelo visitante.
 * Este worker não intercepta requisições nem mantém cache de páginas, APIs ou sessões.
 * Referências: developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/push_event
 * e developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/notificationclick_event
 */
'use strict'

// Deve acompanhar contracts/notifications.json; a suíte verifica os limites e destinos.
const NOTIFICATION_LIMITS = { titleMax: 60, bodyMax: 180 }
const NOTIFICATION_PATHS = new Set([
  '/', '/avise-me', '/lancamento', '/consignado-privado', '/bia', '/conteudos', '/ajuda',
])

function allowedUrl(value, allowPageParameters = false) {
  if (typeof value !== 'string' || !value || value !== value.trim() || /[\u0000-\u001f\u007f]/u.test(value)) return null
  try {
    const url = new URL(value, self.location.origin)
    if (url.origin !== self.location.origin || url.username || url.password || !NOTIFICATION_PATHS.has(url.pathname)) return null
    if (!allowPageParameters && (url.search || url.hash)) return null
    return new URL(url.pathname, self.location.origin).href
  } catch {
    return null
  }
}

function readPayload(data) {
  if (!data) return null
  let value
  try {
    value = data.json()
  } catch {
    return null
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const url = allowedUrl(value.url)
  if (!url || typeof value.title !== 'string' || typeof value.body !== 'string') return null
  const title = value.title.trim()
  const body = value.body.trim()
  if (!title || !body || title.length > NOTIFICATION_LIMITS.titleMax || body.length > NOTIFICATION_LIMITS.bodyMax) return null
  const campaignId = typeof value.campaignId === 'string' && /^[A-Za-z0-9_-]{1,128}$/u.test(value.campaignId)
    ? value.campaignId : null
  return { title, body, url, campaignId }
}

self.addEventListener('push', (event) => {
  const payload = readPayload(event.data)
  if (!payload) return
  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body,
    icon: '/apple-touch-icon.png',
    lang: 'pt-BR',
    dir: 'ltr',
    ...(payload.campaignId ? { tag: `minha-folga-${payload.campaignId}` } : {}),
    data: { url: payload.url, campaignId: payload.campaignId },
  }))
})

async function openNotificationDestination(destination) {
  const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  // Não navega uma aba administrativa, privada ou incorporada em outro site.
  const publicWindows = windowClients.filter((client) => client.frameType !== 'nested' && allowedUrl(client.url, true))
  const alreadyOpen = publicWindows.find((client) => allowedUrl(client.url, true) === destination)
  if (alreadyOpen) {
    try {
      await alreadyOpen.focus()
      return
    } catch {
      // A janela pode ter sido fechada entre matchAll e focus; tenta outra janela disponível.
    }
  }
  for (const client of publicWindows) {
    if (client === alreadyOpen) continue
    try {
      const navigated = await client.navigate(destination)
      if (navigated) {
        await navigated.focus()
        return
      }
    } catch {
      // Uma janela encerrada ou indisponível não deve impedir a abertura do destino.
    }
  }
  await self.clients.openWindow(destination)
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  // A notificação pode ter sido criada por uma versão anterior: revalida no clique.
  const destination = allowedUrl(event.notification.data?.url)
  if (!destination) return
  event.waitUntil(openNotificationDestination(destination))
})
