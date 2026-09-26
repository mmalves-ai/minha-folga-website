import { createECDH, randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const network = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('node:https', () => ({ request: network.request }))
import { createPushTransport } from '../src/integrations/push/client.js'
import { loadConfig } from '../src/config/index.js'
import { TEST_ENV } from './helpers.js'
const vapid = createECDH('prime256v1'); vapid.generateKeys()
const browser = createECDH('prime256v1'); browser.generateKeys()
const config = loadConfig({ source: { ...TEST_ENV, WEB_PUSH_ENABLED:'true', WEB_PUSH_VAPID_PUBLIC_KEY:vapid.getPublicKey().toString('base64url'), WEB_PUSH_VAPID_PRIVATE_KEY:vapid.getPrivateKey().toString('base64url'), WEB_PUSH_VAPID_SUBJECT:'https://www.minhafolga.com.br' } })
const subscription = { endpoint:'https://fcm.googleapis.com/fcm/send/test-only', keys:{ p256dh:browser.getPublicKey().toString('base64url'), auth:randomBytes(16).toString('base64url') } }
const payload = { title:'Teste', body:'Nenhum envio real', url:'/avise-me', campaignId:'12345678-1234-4234-8234-123456789012' }
let status = 201
let responds = true
let request: EventEmitter & { end: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }
beforeEach(() => {
  status=201; responds=true; network.request.mockReset()
  network.request.mockImplementation((_url, _options, callback) => {
    request = Object.assign(new EventEmitter(), { end:vi.fn(), destroy:vi.fn() })
    request.destroy.mockImplementation(() => { request.emit('error',new Error('sensitive endpoint')); return request })
    request.end.mockImplementation(() => { if(responds) callback({ statusCode:status, destroy:vi.fn() }) })
    return request
  })
})
afterEach(() => vi.useRealTimers())
it('monta payload cifrado e VAPID sem enviar texto puro e aceita201', async () => {
  await createPushTransport(config).send(subscription,payload)
  expect(network.request).toHaveBeenCalledTimes(1)
  const options = network.request.mock.calls[0]![1]
  expect(options.headers.Authorization).toMatch(/^vapid /)
  expect(options.headers['Content-Encoding']).toBe('aes128gcm')
  expect(request.end.mock.calls[0]![0]).toBeInstanceOf(Buffer)
  expect(request.end.mock.calls[0]![0].toString()).not.toContain(payload.body)
})
it('não segue redirecionamento e devolve somente status seguro', async () => {
  status=302
  await expect(createPushTransport(config).send(subscription,payload)).rejects.toMatchObject({message:'push_http_error',statusCode:302})
  expect(network.request).toHaveBeenCalledTimes(1)
})
it('interrompe requisição pelo deadline absoluto, sem depender de dados do provedor', async () => {
  vi.useFakeTimers(); responds=false
  const pending = expect(createPushTransport(config).send(subscription,payload)).rejects.toThrow('push_transport_error')
  await vi.advanceTimersByTimeAsync(12_000)
  await pending; expect(request.destroy).toHaveBeenCalledTimes(1)
})
it('recusa endpoint externo antes de abrir qualquer request', async () => {
  await expect(createPushTransport(config).send({...subscription,endpoint:'https://127.0.0.1/internal'},payload)).rejects.toThrow('invalid_subscription')
  expect(network.request).not.toHaveBeenCalled()
})
