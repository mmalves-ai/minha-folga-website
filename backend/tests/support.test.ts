import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { verifyV1 } from '../src/integrations/halai/signature.js'
import { ProviderError } from '../src/integrations/provider-error.js'
import { deliverInternalWebhook } from '../src/integrations/notify/webhook.js'
import { processOutboxBatch } from '../src/jobs/outbox-worker.js'
import { decryptField, sha256Hex } from '../src/lib/crypto.js'
import {
  createSupportRequest,
  DOCUMENT_REDACTION,
  encryptSupportNote,
  PROTOCOL_PATTERN,
  SUPPORT_CIPHER_CONTEXT,
} from '../src/services/support.service.js'
import { createTestHarness, SITE, type TestHarness } from './helpers.js'

// Protocolo com alfabeto Crockford (sem I, L, O, U).
const CROCKFORD_PROTOCOL = /^MF-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{2}$/

let ipCounter = 0
/** Cada chamada usa um IP distinto (X-Forwarded-For confiável no loopback) para não esbarrar no limite. */
const freshIp = () => `198.51.100.${++ipCounter}`

const EMAIL = 'pessoa.teste@exemplo-mf.com.br'
const MESSAGE = 'Gostaria de entender como funciona o aviso de abertura.'

function validBody(overrides: Record<string, unknown> = {}) {
  return { name: 'Pessoa Teste', contactMethod: 'email', contact: EMAIL, subject: 'cadastro_avisos', message: MESSAGE, ...overrides }
}

function postSupport(h: TestHarness, body: unknown, ip = freshIp()) {
  return h.api.post('/api/support').set(SITE).set('X-Forwarded-For', ip).send(body as object)
}

interface SupportRow {
  id: string
  protocol: string
  tracking_token_hash: string
  requester_name: string
  contact_method: string
  contact_ciphertext: string
  contact_hint: string
  subject: string
  message_ciphertext: string
  status: string
  source: string
}

async function rowByProtocol(h: TestHarness, protocol: string): Promise<SupportRow | undefined> {
  const r = await h.ctx.db.query<SupportRow>('SELECT * FROM support_requests WHERE protocol = $1', [protocol])
  return r.rows[0]
}

let h: TestHarness
beforeAll(async () => {
  h = await createTestHarness()
})
afterAll(async () => {
  await h.close()
})

describe('POST /api/support — criação', () => {
  it('persiste com protocolo aleatório, contato e mensagem cifrados e token só como hash', async () => {
    const res = await postSupport(h, validBody())
    expect(res.status).toBe(201)
    expect(res.body.status).toBe('received')
    expect(res.body.protocol).toMatch(CROCKFORD_PROTOCOL)
    expect(typeof res.body.trackingToken).toBe('string')
    expect(res.body.trackingToken.length).toBeGreaterThanOrEqual(40)
    expect(res.body.message).toBeTruthy()

    const row = await rowByProtocol(h, res.body.protocol)
    expect(row).toBeDefined()
    // Nada de e-mail, mensagem ou token em claro em nenhuma coluna.
    const raw = JSON.stringify(row)
    expect(raw).not.toContain(EMAIL)
    expect(raw).not.toContain('pessoa.teste')
    expect(raw).not.toContain(MESSAGE)
    expect(raw).not.toContain(res.body.trackingToken)
    expect(row!.tracking_token_hash).toBe(sha256Hex(res.body.trackingToken))
    expect(row!.contact_hint).toBe('p•••@e•••.com.br')

    const keyring = h.ctx.config.secrets.encryption
    expect(decryptField(row!.contact_ciphertext, keyring, SUPPORT_CIPHER_CONTEXT.contact(row!.id))).toBe(EMAIL)
    expect(decryptField(row!.message_ciphertext, keyring, SUPPORT_CIPHER_CONTEXT.message(row!.id))).toBe(MESSAGE)
    // Contexto é dado autenticado: cifra de um campo não abre com o contexto de outro.
    expect(() => decryptField(row!.contact_ciphertext, keyring, SUPPORT_CIPHER_CONTEXT.message(row!.id))).toThrow()

    const events = await h.ctx.db.query<{ event_type: string; actor_type: string }>(
      'SELECT event_type, actor_type FROM support_events WHERE support_request_id = $1',
      [row!.id],
    )
    expect(events.rows).toEqual([{ event_type: 'created', actor_type: 'titular' }])
    // Sem webhook configurado, nada vai para a outbox.
    const outbox = await h.ctx.db.query('SELECT 1 FROM outbox_messages WHERE support_request_id = $1', [row!.id])
    expect(outbox.rowCount).toBe(0)

    const metric = await h.ctx.db.query<{ count: number }>(
      "SELECT count FROM metric_counters WHERE name = 'support_request_created' AND dimension = 'web_form:cadastro_avisos'",
    )
    expect(metric.rows[0]?.count).toBeGreaterThanOrEqual(1)
  })

  it('protocolos não se repetem e seguem o formato', async () => {
    const protocols = new Set<string>()
    for (let i = 0; i < 6; i++) {
      const res = await postSupport(h, validBody())
      expect(res.status).toBe(201)
      expect(res.body.protocol).toMatch(PROTOCOL_PATTERN)
      protocols.add(res.body.protocol)
    }
    expect(protocols.size).toBe(6)
  })

  it('colisão de protocolo gera outro sem perder a solicitação', async () => {
    const first = await postSupport(h, validBody())
    const taken = first.body.protocol as string
    const candidates = [taken, taken, 'MF-ZZZZ-ZZZZ-Z9']
    let calls = 0
    const created = await createSupportRequest(
      h.ctx,
      { requesterName: 'Pessoa', contactMethod: 'email', contact: EMAIL, subject: 'outro', message: MESSAGE, source: 'web_form' },
      { type: 'titular' },
      { generateProtocol: () => candidates[calls++]! },
    )
    expect(calls).toBe(3)
    expect(created.protocol).toBe('MF-ZZZZ-ZZZZ-Z9')
    expect(await rowByProtocol(h, taken)).toBeDefined()
    expect(await rowByProtocol(h, 'MF-ZZZZ-ZZZZ-Z9')).toBeDefined()
  })

  it('remove CPF da mensagem antes de gravar, preservando telefones', async () => {
    const res = await postSupport(h, validBody({ message: 'Meu CPF é 529.982.247-25 e meu número é 11987654321, 52998224725.' }))
    expect(res.status).toBe(201)
    const row = await rowByProtocol(h, res.body.protocol)
    const stored = decryptField(row!.message_ciphertext, h.ctx.config.secrets.encryption, SUPPORT_CIPHER_CONTEXT.message(row!.id))
    expect(stored).not.toContain('529.982.247-25')
    expect(stored).not.toContain('52998224725')
    expect(stored).toContain('11987654321')
    expect(stored.split(DOCUMENT_REDACTION).length - 1).toBe(2)
  })

  it('assunto privacidade abre pedido de titular vinculado, sem o texto da mensagem', async () => {
    const res = await postSupport(h, validBody({ subject: 'privacidade', message: 'Quero saber quais dados vocês têm sobre mim.' }))
    expect(res.status).toBe(201)
    const row = await rowByProtocol(h, res.body.protocol)
    const pr = await h.ctx.db.query<{ request_type: string; status: string; summary: string; channel: string }>(
      'SELECT request_type, status, summary, channel FROM privacy_requests WHERE support_request_id = $1',
      [row!.id],
    )
    expect(pr.rows).toHaveLength(1)
    expect(pr.rows[0]).toMatchObject({ request_type: 'information', status: 'open', channel: 'atendimento_site' })
    expect(pr.rows[0]!.summary).not.toContain('dados vocês têm')
    const audit = await h.ctx.db.query("SELECT 1 FROM audit_log WHERE action = 'privacy_request.created'")
    expect(audit.rowCount).toBeGreaterThanOrEqual(1)
  })
})

describe('POST /api/support — validação', () => {
  it('devolve todos os campos inválidos de uma vez', async () => {
    const res = await postSupport(h, { name: '', contactMethod: 'fax', contact: '', subject: 'reclamacao', message: 'curta' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('validation_error')
    expect(Object.keys(res.body.error.fields).sort()).toEqual(['contact', 'contactMethod', 'message', 'name', 'subject'])
  })

  it.each([
    ['e-mail sem domínio', { contact: 'pessoa@' }, 'contact', 'Confira o e-mail.'],
    ['e-mail sem arroba', { contact: 'pessoa.exemplo.com' }, 'contact', 'Confira o e-mail.'],
    ['assunto fora da lista', { subject: 'promocao' }, 'subject', 'Escolha um assunto.'],
    ['mensagem com 9 caracteres', { message: '123456789' }, 'message', undefined],
    ['mensagem acima de 2000', { message: 'a'.repeat(2001) }, 'message', undefined],
    ['nome acima de 80', { name: 'n'.repeat(81) }, 'name', undefined],
    ['campo inesperado', { cpf: '52998224725' }, 'cpf', 'Campo não esperado.'],
  ])('%s', async (_label, overrides, field, message) => {
    const res = await postSupport(h, validBody(overrides))
    expect(res.status).toBe(400)
    expect(res.body.error.fields[field]).toBeDefined()
    if (message) expect(res.body.error.fields[field]).toBe(message)
  })

  it('mensagem de 10 e de 2000 caracteres são aceitas', async () => {
    expect((await postSupport(h, validBody({ message: '1234567890' }))).status).toBe(201)
    expect((await postSupport(h, validBody({ message: 'b'.repeat(2000) }))).status).toBe(201)
  })

  it('WhatsApp sem número empresarial configurado é recusado no campo contactMethod', async () => {
    const res = await postSupport(h, validBody({ contactMethod: 'whatsapp', contact: '(11) 98765-4321' }))
    expect(res.status).toBe(400)
    expect(res.body.error.fields).toEqual({ contactMethod: 'Este canal ainda não está disponível.' })
  })

  it('atendimento desligado responde 503 support_unavailable sem gravar', async () => {
    const before = await h.ctx.db.query<{ n: number }>('SELECT count(*)::int AS n FROM support_requests')
    h.ctx.config.collection.supportEnabled = false
    try {
      const res = await postSupport(h, validBody())
      expect(res.status).toBe(503)
      expect(res.body.error.code).toBe('support_unavailable')
    } finally {
      h.ctx.config.collection.supportEnabled = true
    }
    const after = await h.ctx.db.query<{ n: number }>('SELECT count(*)::int AS n FROM support_requests')
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n)
  })

  it('limite por IP: a sexta solicitação em 10 minutos recebe 429', async () => {
    const ip = freshIp()
    for (let i = 0; i < 5; i++) expect((await postSupport(h, validBody(), ip)).status).toBe(201)
    const blocked = await postSupport(h, validBody(), ip)
    expect(blocked.status).toBe(429)
    expect(blocked.body.error.code).toBe('rate_limited')
  })
})

describe('WhatsApp como meio de retorno', () => {
  let wa: TestHarness
  beforeAll(async () => {
    wa = await createTestHarness({ WHATSAPP_BUSINESS_NUMBER: '+5511900000001' })
  })
  afterAll(async () => {
    await wa.close()
  })

  it('aceita celular válido, grava E.164 cifrado e dica mascarada', async () => {
    const res = await postSupport(wa, validBody({ contactMethod: 'whatsapp', contact: '(11) 98765-4321' }))
    expect(res.status).toBe(201)
    const row = await rowByProtocol(wa, res.body.protocol)
    expect(row!.contact_hint).toBe('(11) •••••-••21')
    expect(JSON.stringify(row)).not.toContain('987654321')
    expect(decryptField(row!.contact_ciphertext, wa.ctx.config.secrets.encryption, SUPPORT_CIPHER_CONTEXT.contact(row!.id))).toBe(
      '+5511987654321',
    )
  })

  it.each(['(00) 98765-4321', '11 8765-4321', '1198765'])('celular inválido %s → "Confira o DDD e o número."', async (contact) => {
    const res = await postSupport(wa, validBody({ contactMethod: 'whatsapp', contact }))
    expect(res.status).toBe(400)
    expect(res.body.error.fields).toEqual({ contact: 'Confira o DDD e o número.' })
  })
})

describe('GET /api/support/{protocol} — acompanhamento', () => {
  let protocol: string
  let token: string
  let requestId: string

  beforeAll(async () => {
    const res = await postSupport(h, validBody({ subject: 'bia' }))
    protocol = res.body.protocol
    token = res.body.trackingToken
    requestId = (await rowByProtocol(h, protocol))!.id
  })

  const track = (p: string, t?: string) => {
    const req = h.api.get(`/api/support/${p}`).set('X-Forwarded-For', freshIp())
    return t === undefined ? req : req.set('X-Support-Token', t)
  }

  it('token correto mostra status e linha do tempo, sem contato, nome ou mensagem', async () => {
    const res = await track(protocol, token)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ protocol, status: 'received', subject: 'bia', subjectLabel: 'Bia, nossa assistente de IA' })
    expect(res.body.timeline).toEqual([expect.objectContaining({ type: 'created', status: 'received', text: null })])
    const text = JSON.stringify(res.body)
    for (const secret of [EMAIL, 'Pessoa Teste', MESSAGE, 'p•••@']) expect(text).not.toContain(secret)
  })

  it('protocolo em minúsculas também é aceito', async () => {
    expect((await track(protocol.toLowerCase(), token)).status).toBe(200)
  })

  it('token ausente, token errado, protocolo inexistente e formato inválido têm a mesma resposta 404', async () => {
    const responses = await Promise.all([
      track(protocol),
      track(protocol, `${token.slice(0, -2)}xx`),
      track(protocol, 'curto'),
      track('MF-0000-0000-00', token),
      track('qualquer-coisa', token),
    ])
    for (const res of responses) {
      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('not_found')
      expect(res.body.error.message).toBe(responses[0]!.body.error.message)
    }
  })

  it('mostra mudanças de status e somente respostas marcadas como visíveis', async () => {
    const base = h.clock.current.getTime()
    const statusId = randomUUID()
    const replyId = randomUUID()
    const internalId = randomUUID()
    await h.ctx.db.query(
      `INSERT INTO support_events (id, support_request_id, event_type, from_status, to_status, actor_type, created_at)
       VALUES ($1, $2, 'status_changed', 'received', 'in_progress', 'admin', $3)`,
      [statusId, requestId, new Date(base + 1000)],
    )
    await h.ctx.db.query(
      `INSERT INTO support_events (id, support_request_id, event_type, note_ciphertext, visible_to_requester, actor_type, created_at)
       VALUES ($1, $2, 'reply_recorded', $3, true, 'admin', $4), ($5, $2, 'note_added', $6, false, 'admin', $7)`,
      [
        replyId,
        requestId,
        encryptSupportNote(h.ctx, replyId, 'Olá! Já estamos verificando sua dúvida.'),
        new Date(base + 2000),
        internalId,
        encryptSupportNote(h.ctx, internalId, 'Nota interna: não mostrar ao titular.'),
        new Date(base + 3000),
      ],
    )
    await h.ctx.db.query("UPDATE support_requests SET status = 'in_progress' WHERE id = $1", [requestId])

    const res = await track(protocol, token)
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('in_progress')
    expect(res.body.timeline.map((t: { type: string }) => t.type)).toEqual(['created', 'status_changed', 'reply'])
    expect(res.body.timeline[1].status).toBe('in_progress')
    expect(res.body.timeline[2].text).toBe('Olá! Já estamos verificando sua dúvida.')
    expect(JSON.stringify(res.body)).not.toContain('Nota interna')
  })
})

describe('notificação interna', () => {
  let server: Server
  let status = 500
  const received: { headers: IncomingMessage['headers']; body: string }[] = []
  let n: TestHarness
  const SECRET = 'test-only-notify-secret-0123456789abcdef'

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        received.push({ headers: req.headers, body })
        res.statusCode = status
        res.end()
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    n = await createTestHarness({ SUPPORT_NOTIFY_WEBHOOK_URL: `http://127.0.0.1:${port}/hook`, SUPPORT_NOTIFY_WEBHOOK_SECRET: SECRET })
  })
  afterAll(async () => {
    await n.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('enfileira evento sem dados pessoais; falha do webhook não apaga a solicitação nem a outbox', async () => {
    status = 500
    const res = await postSupport(n, validBody())
    expect(res.status).toBe(201)
    const row = await rowByProtocol(n, res.body.protocol)

    const outbox = await n.ctx.db.query<{ id: string; kind: string; channel: string; purpose: string; payload_ciphertext: string; recipient_ciphertext: string | null }>(
      'SELECT id, kind, channel, purpose, payload_ciphertext, recipient_ciphertext FROM outbox_messages WHERE support_request_id = $1',
      [row!.id],
    )
    expect(outbox.rows).toHaveLength(1)
    const msg = outbox.rows[0]!
    expect(msg).toMatchObject({ kind: 'support_notification', channel: 'webhook', purpose: 'internal', recipient_ciphertext: null })
    const payload = JSON.parse(decryptField(msg.payload_ciphertext, n.ctx.config.secrets.encryption, `outbox.payload:${msg.id}`))
    expect(payload.event).toMatchObject({ type: 'support_request.created', protocol: res.body.protocol, subject: 'cadastro_avisos' })
    const text = JSON.stringify(payload)
    for (const pii of [EMAIL, 'Pessoa Teste', MESSAGE, res.body.trackingToken]) expect(text).not.toContain(pii)

    const events = await n.ctx.db.query<{ event_type: string }>(
      'SELECT event_type FROM support_events WHERE support_request_id = $1 ORDER BY event_type',
      [row!.id],
    )
    expect(events.rows.map((e) => e.event_type)).toEqual(['created', 'notification_queued'])

    // Entrega direta: 5xx é retentável.
    await expect(deliverInternalWebhook(n.ctx, payload.event, `support_notification:${row!.id}`)).rejects.toMatchObject({
      name: 'ProviderError',
      retryable: true,
    })
    // Worker da outbox (implementação de outro módulo) tenta entregar; o registro continua lá.
    await processOutboxBatch(n.ctx)
    expect(await rowByProtocol(n, res.body.protocol)).toBeDefined()
    const still = await n.ctx.db.query('SELECT status FROM outbox_messages WHERE id = $1', [msg.id])
    expect(still.rowCount).toBe(1)
  })

  it('assina o corpo com v1 e envia a chave de idempotência', async () => {
    status = 204
    received.length = 0
    const event = { type: 'support_request.created', protocol: 'MF-AAAA-BBBB-CC' }
    await deliverInternalWebhook(n.ctx, event, 'support_notification:x1')
    expect(received).toHaveLength(1)
    const { headers, body } = received[0]!
    expect(JSON.parse(body)).toEqual(event)
    expect(headers['x-mf-idempotency-key']).toBe('support_notification:x1')
    const signed = {
      secret: SECRET,
      timestamp: headers['x-mf-timestamp'] as string,
      signature: headers['x-mf-signature'] as string,
      rawBody: body,
      nowSeconds: Math.floor(n.clock.current.getTime() / 1000),
    }
    expect(verifyV1(signed).ok).toBe(true)
    expect(verifyV1({ ...signed, secret: 'outro-segredo' }).ok).toBe(false)
  })

  it('4xx é definitivo; rede indisponível é retentável', async () => {
    status = 400
    const err = await deliverInternalWebhook(n.ctx, { type: 't' }, 'k2').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect((err as ProviderError).retryable).toBe(false)

    const closed = createServer()
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve))
    const { port } = closed.address() as AddressInfo
    await new Promise<void>((resolve) => closed.close(() => resolve()))
    const saved = n.ctx.config.supportNotify.url
    n.ctx.config.supportNotify.url = `http://127.0.0.1:${port}/hook`
    try {
      const netErr = await deliverInternalWebhook(n.ctx, { type: 't' }, 'k3').catch((e: unknown) => e)
      expect(netErr).toBeInstanceOf(ProviderError)
      expect((netErr as ProviderError).retryable).toBe(true)
      expect((netErr as Error).message).not.toContain('127.0.0.1')
    } finally {
      n.ctx.config.supportNotify.url = saved
    }
  })

  it('sem webhook configurado a entrega falha de forma definitiva', async () => {
    const err = await deliverInternalWebhook(h.ctx, { type: 't' }, 'k4').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect((err as ProviderError).retryable).toBe(false)
  })
})
