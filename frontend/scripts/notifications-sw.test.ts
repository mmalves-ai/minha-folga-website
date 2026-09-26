import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const source = readFileSync(new URL('../public/notifications-sw.js', import.meta.url), 'utf8')
const contract = JSON.parse(readFileSync(new URL('../../contracts/notifications.json', import.meta.url), 'utf8')) as {
  limits: { titleMax: number; bodyMax: number }
  destinations: string[]
}
const origin = 'https://www.minhafolga.com.br'
const validPayload = {
  title: 'A Minha Folga tem uma novidade',
  body: 'Conheça as novidades no site.',
  url: '/avise-me',
  campaignId: 'abertura-2026',
}

function browserWindow(url: string, frameType = 'top-level') {
  const client = { url, frameType, focus: vi.fn(), navigate: vi.fn() }
  client.focus.mockResolvedValue(client)
  client.navigate.mockImplementation(async (destination: string) => {
    client.url = destination
    return client
  })
  return client
}

function worker(windows: ReturnType<typeof browserWindow>[] = []) {
  const handlers: Record<string, (event: Record<string, unknown>) => void> = {}
  const showNotification = vi.fn().mockResolvedValue(undefined)
  const matchAll = vi.fn().mockResolvedValue(windows)
  const openWindow = vi.fn().mockResolvedValue(null)
  const fetch = vi.fn(() => { throw new Error('SW de notificações não deve fazer fetch') })
  const self = {
    location: { origin },
    addEventListener(name: string, handler: (event: Record<string, unknown>) => void) { handlers[name] = handler },
    registration: { showNotification },
    clients: { matchAll, openWindow },
  }
  const configuration = runInNewContext(`${source}\n;({ paths: [...NOTIFICATION_PATHS], limits: NOTIFICATION_LIMITS })`, { self, URL, fetch }, { filename: 'notifications-sw.js' })
  async function dispatch(name: string, data: Record<string, unknown>) {
    const promises: Promise<unknown>[] = []
    handlers[name]!({ ...data, waitUntil(value: Promise<unknown>) { promises.push(value) } })
    await Promise.all(promises)
  }
  return {
    handlers, showNotification, matchAll, openWindow, fetch, configuration,
    push: (payload: unknown) => dispatch('push', { data: { json: () => payload } }),
    invalidJson: () => dispatch('push', { data: { json: () => { throw new SyntaxError('Inválido') } } }),
    noData: () => dispatch('push', { data: null }),
    async click(data: unknown) {
      const close = vi.fn()
      await dispatch('notificationclick', { notification: { data, close } })
      return close
    },
  }
}

describe('service worker de notificações', () => {
  it('mantém os destinos e limites públicos sincronizados com o contrato de envio', async () => {
    const sw = worker()
    expect(sw.configuration.paths).toEqual(contract.destinations)
    expect(sw.configuration.limits).toEqual({ titleMax: contract.limits.titleMax, bodyMax: contract.limits.bodyMax })
    await sw.push({ ...validPayload, title: 'a'.repeat(contract.limits.titleMax), body: 'b'.repeat(contract.limits.bodyMax) })
    expect(sw.showNotification).toHaveBeenCalledOnce()
  })

  it('mostra o texto recebido com ícone local e apenas o destino validado nos dados', async () => {
    const sw = worker()
    await sw.push({ ...validPayload, unusedPersonalData: 'não deve ser persistido' })
    expect(sw.showNotification).toHaveBeenCalledExactlyOnceWith(validPayload.title, {
      body: validPayload.body,
      icon: '/apple-touch-icon.png',
      lang: 'pt-BR',
      dir: 'ltr',
      tag: 'minha-folga-abertura-2026',
      data: { url: `${origin}/avise-me`, campaignId: validPayload.campaignId },
    })
    expect(sw.fetch).not.toHaveBeenCalled()
  })

  it.each(contract.destinations)(
    'aceita o destino público %s', async (url) => {
      const sw = worker()
      await sw.push({ ...validPayload, url })
      expect(sw.showNotification).toHaveBeenCalledOnce()
      expect(sw.showNotification.mock.calls[0]![1].data.url).toBe(`${origin}${url}`)
    },
  )

  it('ignora JSON quebrado ou evento sem conteúdo', async () => {
    const sw = worker()
    await sw.invalidJson()
    await sw.noData()
    expect(sw.showNotification).not.toHaveBeenCalled()
  })

  it.each([
    null, [], 'texto', {},
    { ...validPayload, title: '' },
    { ...validPayload, title: 'a'.repeat(contract.limits.titleMax + 1) },
    { ...validPayload, body: 123 },
    { ...validPayload, body: ' '.repeat(4) },
    { ...validPayload, body: 'b'.repeat(contract.limits.bodyMax + 1) },
  ].map((payload) => [payload]))('descarta payload incompleto ou inválido (%j)', async (payload) => {
    const sw = worker()
    await sw.push(payload)
    expect(sw.showNotification).not.toHaveBeenCalled()
  })

  it.each([
    'https://externo.example/avise-me', '//externo.example/',
    'javascript:alert(1)', 'https://[inválida', '/admin/leads', '/preferencias',
    '/avise-me?token=segredo', '/avise-me#formulario',
    'https://usuario:senha@www.minhafolga.com.br/avise-me', '/avise-me\n',
  ])('ignora destino externo, privado ou malformado (%s) no push e no clique', async (url) => {
    const sw = worker()
    await sw.push({ ...validPayload, url })
    const close = await sw.click({ url })
    expect(close).toHaveBeenCalledOnce()
    expect(sw.showNotification).not.toHaveBeenCalled()
    expect(sw.matchAll).not.toHaveBeenCalled()
    expect(sw.openWindow).not.toHaveBeenCalled()
  })

  it('descarta campaignId inválido sem transformar conteúdo arbitrário em tag', async () => {
    const sw = worker()
    await sw.push({ ...validPayload, campaignId: { arbitrary: true } })
    expect(sw.showNotification).toHaveBeenCalledOnce()
    const options = sw.showNotification.mock.calls[0]![1]
    expect(options).not.toHaveProperty('tag')
    expect(options.data.campaignId).toBeNull()
  })

  it('prioriza a janela que já mostra o destino, inclusive sem controle do worker', async () => {
    const first = browserWindow(`${origin}/`)
    const destination = browserWindow(`${origin}/avise-me?utm_source=busca`)
    const sw = worker([first, destination])
    const close = await sw.click({ url: '/avise-me' })
    expect(close).toHaveBeenCalledOnce()
    expect(sw.matchAll).toHaveBeenCalledExactlyOnceWith({ type: 'window', includeUncontrolled: true })
    expect(destination.focus).toHaveBeenCalledOnce()
    expect(destination.navigate).not.toHaveBeenCalled()
    expect(first.navigate).not.toHaveBeenCalled()
    expect(sw.openWindow).not.toHaveBeenCalled()
  })

  it('reutiliza uma janela pública existente, navega e dá foco, evitando duplicação', async () => {
    const current = browserWindow(`${origin}/bia`)
    const sw = worker([current])
    await sw.click({ url: `${origin}/avise-me` })
    expect(current.navigate).toHaveBeenCalledExactlyOnceWith(`${origin}/avise-me`)
    expect(current.focus).toHaveBeenCalledOnce()
    expect(sw.openWindow).not.toHaveBeenCalled()
  })

  it('não interfere em outra origem, área administrativa ou iframe', async () => {
    const windows = [
      browserWindow('https://outro.example/avise-me'),
      browserWindow(`${origin}/admin/leads`),
      browserWindow(`${origin}/avise-me`, 'nested'),
    ]
    const sw = worker(windows)
    await sw.click({ url: '/avise-me' })
    expect(sw.openWindow).toHaveBeenCalledExactlyOnceWith(`${origin}/avise-me`)
    for (const client of windows) {
      expect(client.navigate).not.toHaveBeenCalled()
      expect(client.focus).not.toHaveBeenCalled()
    }
  })

  it('abre a página permitida quando não há janela disponível', async () => {
    const sw = worker()
    await sw.click({ url: '/lancamento' })
    expect(sw.openWindow).toHaveBeenCalledExactlyOnceWith(`${origin}/lancamento`)
  })

  it('trata janela fechada durante o clique e tenta outra janela existente', async () => {
    const closed = browserWindow(`${origin}/avise-me`)
    const available = browserWindow(`${origin}/ajuda`)
    closed.focus.mockRejectedValue(new Error('Janela fechada'))
    const sw = worker([closed, available])
    await sw.click({ url: '/avise-me' })
    expect(available.navigate).toHaveBeenCalledExactlyOnceWith(`${origin}/avise-me`)
    expect(available.focus).toHaveBeenCalledOnce()
    expect(sw.openWindow).not.toHaveBeenCalled()
  })

  it('abre o destino quando a janela existente deixa de aceitar navegação', async () => {
    const closed = browserWindow(`${origin}/bia`)
    closed.navigate.mockRejectedValue(new Error('Janela fechada'))
    const sw = worker([closed])
    await sw.click({ url: '/avise-me' })
    expect(sw.openWindow).toHaveBeenCalledExactlyOnceWith(`${origin}/avise-me`)
  })

  it('clique sem dados apenas fecha a notificação', async () => {
    const sw = worker()
    const close = await sw.click(null)
    expect(close).toHaveBeenCalledOnce()
    expect(sw.openWindow).not.toHaveBeenCalled()
  })

  it('não instala interceptação de navegação, cache ou renovação de inscrição', () => {
    const sw = worker()
    expect(Object.keys(sw.handlers).sort()).toEqual(['notificationclick', 'push'])
    expect(sw.fetch).not.toHaveBeenCalled()
  })
})
