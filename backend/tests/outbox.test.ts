import { randomUUID } from 'node:crypto'
import { createServer, type IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { HalaiOutbound } from '../src/integrations/halai/client.js'
import { ProviderError } from '../src/integrations/provider-error.js'
import { backoffMs, processOutboxBatch, startOutboxWorker } from '../src/jobs/outbox-worker.js'
import { encryptField } from '../src/lib/crypto.js'
import { enqueueMessage, type EnqueueMessage } from '../src/repositories/outbox.repo.js'
import { revokeAllCommunication } from '../src/services/preferences.service.js'
import { createTestHarness, HALAI_ENV, type TestHarness } from './helpers.js'
import { dedupFor, newPerson, registerByBia } from './lead-flow.js'

/**
 * Worker da outbox depois da D1: canal `webhook` (aviso interno de atendimento), canal `halai` (placeholder de
 * template pela API da Hal-AI, aqui com um dublê em memória) e itens legados do canal `whatsapp`, cancelados.
 */
let h: TestHarness
beforeAll(async () => {
  h = await createTestHarness({
    ...HALAI_ENV,
    HALAI_API_KEY: 'test-only-halai-api-key-000000',
    HALAI_CHANNEL: 'canal-teste',
    HALAI_SIGNUP_TEMPLATE_ENABLED: 'true',
    HALAI_SIGNUP_TEMPLATE: 'mf_cadastro',
    HALAI_TEMPLATE_DAILY_CAP: '1000',
  })
})
afterAll(async () => {
  await h.close()
})

interface OutboxRow {
  status: string
  attempts: number
  last_error: string | null
  next_attempt_at: Date
  provider_message_id: string | null
  payload_ciphertext: string
}

const row = async (id: string) =>
  (
    await h.ctx.db.query<OutboxRow>(
      'SELECT status, attempts, last_error, next_attempt_at, provider_message_id, payload_ciphertext FROM outbox_messages WHERE id = $1',
      [id],
    )
  ).rows[0]!

let keySeq = 0
const enqueue = async (msg: Partial<EnqueueMessage>) =>
  (await enqueueMessage(h.ctx, h.ctx.db, {
    kind: 'halai_template',
    channel: 'halai',
    purpose: 'launch_notice',
    payload: { template: { name: 'mf_cadastro', language: 'pt_BR', bodyVariables: ['Carla'] } },
    idempotencyKey: `test:${++keySeq}`,
    ...msg,
  })) as string

/** Cadastro pela Bia com aviso de abertura autorizado (a Bia não dispara template: a fila começa vazia). */
async function lead() {
  const person = newPerson()
  const leadId = await registerByBia(h, person)
  return { phone: person.phone.e164, leadId }
}

const template = (leadId: string | null, to: string, extra: Partial<EnqueueMessage> = {}) => enqueue({ leadId, recipient: to, ...extra })
const sentTo = (to: string) => h.halai.sent.filter((m) => m.to === to)

async function withHalai(client: HalaiOutbound, fn: () => Promise<void>) {
  const original = h.ctx.halai
  h.ctx.halai = client
  try {
    await fn()
  } finally {
    h.ctx.halai = original
  }
}

describe('retentativa e falhas (canal halai)', () => {
  it('falha temporária: backoff exponencial e envio posterior, sem duplicar; conteúdo apagado depois do envio', async () => {
    const { phone, leadId } = await lead()
    const id = await template(leadId, phone)
    h.halai.failNext = 2

    await processOutboxBatch(h.ctx)
    let r = await row(id)
    expect(r).toMatchObject({ status: 'pending', attempts: 1, last_error: 'falha simulada' })
    expect(r.next_attempt_at.getTime() - h.clock.current.getTime()).toBe(backoffMs(1))

    await processOutboxBatch(h.ctx)
    expect((await row(id)).attempts).toBe(1)

    h.clock.advance(backoffMs(1))
    await processOutboxBatch(h.ctx)
    r = await row(id)
    expect(r).toMatchObject({ status: 'pending', attempts: 2 })
    expect(backoffMs(2)).toBe(2 * backoffMs(1))

    h.clock.advance(backoffMs(2))
    await processOutboxBatch(h.ctx)
    r = await row(id)
    expect(r).toMatchObject({ status: 'sent', attempts: 3, last_error: null, payload_ciphertext: 'redacted' })
    expect(r.provider_message_id).toMatch(/^hal-/)
    expect(sentTo(phone)).toEqual([{ to: phone, templateName: 'mf_cadastro', language: 'pt_BR', bodyVariables: ['Carla'] }])

    await processOutboxBatch(h.ctx)
    expect(sentTo(phone)).toHaveLength(1)
  })

  it('erro definitivo → failed na primeira tentativa, sem telefone no last_error; retentável esgota max_attempts', async () => {
    const { phone, leadId } = await lead()
    const payload = (v: string) => ({ template: { name: 'mf_cadastro', language: 'pt_BR', bodyVariables: [v] } })
    const definitive = await template(leadId, phone, { idempotencyKey: `test:definitive:${leadId}`, payload: payload('definitivo') })
    const retryable = await template(leadId, phone, { idempotencyKey: `test:retry:${leadId}`, maxAttempts: 2, payload: payload('retry') })
    let calls = 0
    const failing: HalaiOutbound = {
      configured: true,
      async sendTemplate(message) {
        calls++
        const retry = message.bodyVariables[0] === 'retry'
        throw new ProviderError(`recusado para ${message.to} / ${message.to.slice(3, 5)} ${message.to.slice(5)}`, retry)
      },
    }
    await withHalai(failing, async () => {
      await processOutboxBatch(h.ctx)
      h.clock.advance(backoffMs(1))
      await processOutboxBatch(h.ctx)
    })
    expect(calls).toBe(3)
    const d = await row(definitive)
    expect(d).toMatchObject({ status: 'failed', attempts: 1, payload_ciphertext: 'redacted' })
    const r = await row(retryable)
    expect(r).toMatchObject({ status: 'failed', attempts: 2 })
    for (const err of [d.last_error!, r.last_error!]) {
      expect(err).toContain('[number]')
      expect(err).not.toMatch(/\d{4}/)
    }
  })

  it('item preso em "sending" (processo encerrado) volta para a fila quando o prazo vence', async () => {
    const { phone, leadId } = await lead()
    const stuck = await template(leadId, phone)
    const exhausted = await template(leadId, phone, { maxAttempts: 1 })
    await h.ctx.db.query(
      `UPDATE outbox_messages SET status = 'sending', attempts = CASE WHEN id = $3 THEN 1 ELSE 0 END, locked_until = $2
        WHERE id = ANY($1::uuid[])`,
      [[stuck, exhausted], new Date(h.clock.current.getTime() + 60_000), exhausted],
    )
    await processOutboxBatch(h.ctx)
    expect((await row(stuck)).status).toBe('sending')
    h.clock.advance(61_000)
    await processOutboxBatch(h.ctx)
    expect(await row(stuck)).toMatchObject({ status: 'sent', attempts: 1 })
    expect(await row(exhausted)).toMatchObject({ status: 'failed', last_error: 'lock_expired_max_attempts' })
  })
})

describe('reivindicação do lote e idempotência', () => {
  it('chave repetida não duplica; lotes concorrentes não enviam a mesma mensagem duas vezes', async () => {
    const { phone, leadId } = await lead()
    const key = `test:dup:${leadId}`
    expect(await template(leadId, phone, { idempotencyKey: key })).toBeTruthy()
    expect(await template(leadId, phone, { idempotencyKey: key })).toBeNull()
    for (let i = 0; i < 4; i++) await template(leadId, phone)
    const [a, b] = await Promise.all([processOutboxBatch(h.ctx, 3), processOutboxBatch(h.ctx, 3)])
    expect(a + b).toBe(5)
    expect(sentTo(phone)).toHaveLength(5)
  })
})

describe('conferência no momento do envio', () => {
  it('supressão, cadastro anonimizado, finalidade não autorizada e sem cadastro → cancelled', async () => {
    const suppressed = await lead()
    const anonymized = await lead()
    const noMarketing = await lead()
    await revokeAllCommunication(h.ctx, noMarketing.leadId, { type: 'titular' }, 'teste')
    const ids = {
      suppressed: await template(suppressed.leadId, suppressed.phone),
      anonymized: await template(anonymized.leadId, anonymized.phone),
      revoked: await template(noMarketing.leadId, noMarketing.phone),
      noLead: await template(null, newPerson().phone.e164),
    }
    await h.ctx.db.query(`INSERT INTO suppression_list (dedup_key, reason) VALUES ($1, 'opposition')`, [dedupFor(h, suppressed.phone)])
    await h.ctx.db.query('UPDATE leads SET anonymized_at = $2 WHERE id = $1', [anonymized.leadId, h.clock.current])
    const before = h.halai.sent.length
    await processOutboxBatch(h.ctx, 50)
    const reasons = Object.fromEntries(await Promise.all(Object.entries(ids).map(async ([k, id]) => [k, await row(id)])))
    expect(reasons.suppressed).toMatchObject({ status: 'cancelled', last_error: 'contact_suppressed' })
    expect(reasons.anonymized).toMatchObject({ status: 'cancelled', last_error: 'lead_anonymized' })
    expect(reasons.revoked).toMatchObject({ status: 'cancelled', last_error: 'purpose_not_authorized' })
    expect(reasons.noLead).toMatchObject({ status: 'cancelled', last_error: 'purpose_not_authorized' })
    expect(h.halai.sent.length).toBe(before)
  })

  it('placeholder desligado depois do enfileiramento → cancelled template_disabled, nada enviado', async () => {
    const { phone, leadId } = await lead()
    const id = await template(leadId, phone)
    const cfg = h.ctx.config.halai.signupTemplate
    cfg.enabled = false
    try {
      await processOutboxBatch(h.ctx)
    } finally {
      cfg.enabled = true
    }
    expect(await row(id)).toMatchObject({ status: 'cancelled', last_error: 'template_disabled' })
    expect(sentTo(phone)).toHaveLength(0)
  })

  it('finalidade revogada durante a retentativa não é enviada', async () => {
    const { phone, leadId } = await lead()
    const id = await template(leadId, phone)
    h.halai.failNext = 1
    await processOutboxBatch(h.ctx)
    expect((await row(id)).status).toBe('pending')
    await revokeAllCommunication(h.ctx, leadId, { type: 'titular' }, 'preferencias')
    h.clock.advance(backoffMs(1))
    await processOutboxBatch(h.ctx)
    expect(await row(id)).toMatchObject({ status: 'cancelled', last_error: 'purpose_revoked' })
    expect(sentTo(phone)).toHaveLength(0)
  })
})

describe('itens legados do canal whatsapp (antes da D1)', () => {
  it('código, link e aviso antigos na fila são cancelados sem envio (whatsapp_removed)', async () => {
    const ids: string[] = []
    for (const kind of ['verification_code', 'preferences_link', 'launch_notice']) {
      const id = randomUUID()
      await h.ctx.db.query(
        `INSERT INTO outbox_messages (id, kind, channel, purpose, recipient_ciphertext, payload_ciphertext, idempotency_key, status, next_attempt_at)
         VALUES ($1, $2, 'whatsapp', 'transactional', $3, $4, $5, 'pending', $6)`,
        [
          id,
          kind,
          encryptField('+5511987654321', h.ctx.config.secrets.encryption, `outbox.recipient:${id}`),
          encryptField(JSON.stringify({ template: kind, params: ['123456'] }), h.ctx.config.secrets.encryption, `outbox.payload:${id}`),
          `legacy:${id}`,
          h.clock.current,
        ],
      )
      ids.push(id)
    }
    const before = h.halai.sent.length
    await processOutboxBatch(h.ctx, 50)
    for (const id of ids) expect(await row(id)).toMatchObject({ status: 'cancelled', last_error: 'whatsapp_removed' })
    expect(h.halai.sent.length).toBe(before)
    // Conteúdo com segredo (código, link) é apagado ao encerrar.
    const redacted = await h.ctx.db.query<{ kind: string; payload_ciphertext: string }>(
      `SELECT kind, payload_ciphertext FROM outbox_messages WHERE id = ANY($1::uuid[]) ORDER BY kind`,
      [ids],
    )
    expect(redacted.rows.filter((r) => r.kind !== 'launch_notice').every((r) => r.payload_ciphertext === 'redacted')).toBe(true)
  })
})

describe('canal interno (webhook) e laço do worker', () => {
  it('mensagem channel=webhook é entregue pelo webhook interno com a chave de idempotência', async () => {
    const received: IncomingHttpHeaders[] = []
    const server = createServer((req, res) => {
      received.push(req.headers)
      req.resume()
      req.on('end', () => res.writeHead(204).end())
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const n = await createTestHarness({
      SUPPORT_NOTIFY_WEBHOOK_URL: `http://127.0.0.1:${port}/hook`,
      SUPPORT_NOTIFY_WEBHOOK_SECRET: 'test-only-notify-secret-0123456789abcdef',
    })
    try {
      const id = (await enqueueMessage(n.ctx, n.ctx.db, {
        kind: 'support_notification',
        channel: 'webhook',
        purpose: 'internal',
        payload: { event: { type: 'support_request.created', protocol: 'MF-AAAA-BBBB-CC' } },
        idempotencyKey: 'support_notification:teste',
      }))!
      await processOutboxBatch(n.ctx)
      const r = await n.ctx.db.query<{ status: string }>('SELECT status FROM outbox_messages WHERE id = $1', [id])
      expect(r.rows[0]!.status).toBe('sent')
      expect(received).toHaveLength(1)
      expect(received[0]!['x-mf-idempotency-key']).toBe('support_notification:teste')
      expect(n.halai.sent).toHaveLength(0)
    } finally {
      await n.close()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('startOutboxWorker envia em segundo plano e stop() encerra o laço', async () => {
    const { phone, leadId } = await lead()
    const worker = startOutboxWorker(h.ctx, { intervalMs: 5 })
    try {
      const id = await template(leadId, phone)
      const deadline = Date.now() + 5_000
      while ((await row(id)).status !== 'sent' && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10))
      expect((await row(id)).status).toBe('sent')
    } finally {
      await worker.stop()
    }
    const later = await template(leadId, phone)
    await new Promise((r) => setTimeout(r, 50))
    expect((await row(later)).status).toBe('pending')
  })
})
