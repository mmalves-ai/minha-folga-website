import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { SUPPORT_CONTACT_METHODS, SUPPORT_SUBJECTS, VALIDATION } from '../config/contracts.js'
import type { Queryable } from '../db/database.js'
import { decryptField, encryptField, hmacHex, randomProtocol, randomToken, safeEqual, sha256Hex } from '../lib/crypto.js'
import { AppError, Errors } from '../lib/errors.js'
import { isValidCpfDigits } from '../lib/cpf.js'
import { emailHint } from '../lib/email.js'
import { normalizeBrazilianMobile, phoneHint } from '../lib/phone.js'
import { contactDedupKey } from '../repositories/leads.repo.js'
import { enqueueMessage } from '../repositories/outbox.repo.js'
import type { AppContext } from '../context.js'
import { recordAudit } from './audit.service.js'
import { incrementMetric } from './metrics.service.js'

/**
 * Atendimento: solicitação com protocolo aleatório, acompanhamento por token e notificação interna.
 *
 * Regras:
 * - persistência primeiro (support_requests + support_events 'created' na mesma transação);
 * - contato e mensagem cifrados (AES-256-GCM) com contexto por campo; contact_hint mascarado;
 * - o token de acompanhamento só existe em claro na resposta de criação; o banco guarda sha256;
 * - a notificação interna vai pela outbox, sem dados pessoais; falha de entrega nunca apaga a solicitação;
 * - assunto "privacidade" também abre um pedido de titular (privacy_requests) vinculado.
 */

export type SupportSubject = (typeof SUPPORT_SUBJECTS)[number]
export type SupportContactMethod = 'email' | 'whatsapp'
export type SupportState = 'received' | 'in_progress' | 'answered' | 'closed'
export type SupportSource = 'web_form' | 'agent'

/** Contextos de cifragem (dado autenticado) de cada campo cifrado do atendimento. */
export const SUPPORT_CIPHER_CONTEXT = {
  contact: (requestId: string) => `support.contact:${requestId}`,
  message: (requestId: string) => `support.message:${requestId}`,
  /** Notas e respostas registradas pela equipe (support_events.note_ciphertext). */
  note: (eventId: string) => `support.note:${eventId}`,
} as const

export const SUPPORT_MESSAGES = {
  created:
    'Recebemos sua mensagem. Guarde o protocolo e o link de acompanhamento: o link é a forma segura de consultar o andamento. A resposta chegará pelo meio de retorno que você escolheu.',
  emailInvalid: 'Confira o e-mail.',
  phoneInvalid: 'Confira o DDD e o número.',
  channelUnavailable: 'Este canal ainda não está disponível.',
  unavailable: 'O formulário de atendimento está indisponível no momento. Tente novamente mais tarde.',
  notFound: 'Não encontramos uma solicitação com esses dados. Confira o link de acompanhamento.',
} as const

export interface NewSupportRequest {
  requesterName: string
  contactMethod: SupportContactMethod
  /** E-mail em minúsculas ou celular em E.164, já validados. */
  contact: string
  subject: SupportSubject
  message: string
  source: SupportSource
  leadId?: string | null
}

export type SupportActor = { type: 'titular'; ipHash?: string } | { type: 'agent' }

export interface SupportCreated {
  id: string
  protocol: string
  trackingToken: string
  status: 'received'
  message: string
  createdAt: string
}

export interface SupportTimelineItem {
  type: 'created' | 'status_changed' | 'reply'
  status?: SupportState
  text: string | null
  at: string
}

export interface SupportStatusView {
  protocol: string
  status: SupportState
  subject: string
  subjectLabel: string
  createdAt: string
  updatedAt: string
  timeline: SupportTimelineItem[]
}

const SUBJECT_LABEL = new Map(VALIDATION.support.subjects.map((s) => [s.value, s.label]))
export const supportSubjectLabel = (subject: string): string => SUBJECT_LABEL.get(subject) ?? subject

export const PROTOCOL_PATTERN = /^MF-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{2}$/

// ------------------------------------------------------------------------------------ validação

/** Sem caracteres de controle (exceto quebra de linha e tabulação, permitidas só na mensagem). */
const NO_CONTROL = /^[^\p{Cc}\p{Cf}]*$/u
const NO_CONTROL_MULTILINE = /^(?:[^\p{Cc}\p{Cf}]|[\n\r\t])*$/u

const SupportFormSchema = z.strictObject({
  name: z.string().trim().min(1).max(VALIDATION.support.nameMax).regex(NO_CONTROL),
  contactMethod: z.enum(SUPPORT_CONTACT_METHODS),
  contact: z.string().trim().min(1).max(VALIDATION.support.contactMax),
  subject: z.enum(SUPPORT_SUBJECTS),
  message: z
    .string()
    .trim()
    .min(VALIDATION.support.messageMin)
    .max(VALIDATION.support.messageMax)
    .regex(NO_CONTROL_MULTILINE),
})

const FORM_MESSAGES: Record<string, string> = {
  name: `Informe seu nome (até ${VALIDATION.support.nameMax} caracteres).`,
  contactMethod: 'Escolha como prefere receber o retorno.',
  contact: 'Informe o contato para retorno.',
  subject: 'Escolha um assunto.',
  message: `Escreva sua mensagem com ${VALIDATION.support.messageMin} a ${VALIDATION.support.messageMax} caracteres.`,
}

const EmailSchema = z.email()

/** Normaliza e valida o contato conforme o meio escolhido. Retorna null quando inválido. */
export function normalizeSupportContact(method: SupportContactMethod, contact: string): string | null {
  const value = contact.trim()
  if (method === 'email') {
    const email = value.toLowerCase()
    return email.length <= VALIDATION.support.contactMax && EmailSchema.safeParse(email).success ? email : null
  }
  return normalizeBrazilianMobile(value)
}

export function whatsappChannelAvailable(ctx: AppContext): boolean {
  return Boolean(ctx.config.whatsapp.businessNumber)
}

/**
 * Valida o formulário de /atendimento (corpo de POST /api/support). Todos os campos com problema
 * voltam juntos em `fields`, com mensagens em português para exibição junto ao campo.
 */
export function parseSupportForm(ctx: AppContext, body: unknown): NewSupportRequest {
  const parsed = SupportFormSchema.safeParse(body)
  const fields: Record<string, string> = {}
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      if (issue.code === 'unrecognized_keys') {
        for (const key of issue.keys) fields[key] = 'Campo não esperado.'
        continue
      }
      const key = issue.path.map(String).join('.') || '_'
      fields[key] ??= FORM_MESSAGES[key] ?? 'Confira este campo.'
    }
  }

  // Contato conferido mesmo quando outro campo falhou, para devolver todos os erros de uma vez.
  const raw = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
  const method = raw.contactMethod
  if (method === 'whatsapp' && !whatsappChannelAvailable(ctx)) {
    // Sem número empresarial configurado não há como responder pelo WhatsApp.
    fields.contactMethod = SUPPORT_MESSAGES.channelUnavailable
    delete fields.contact
  } else if (method === 'email' || method === 'whatsapp') {
    if (typeof raw.contact === 'string' && raw.contact.trim() && !normalizeSupportContact(method, raw.contact)) {
      fields.contact = method === 'email' ? SUPPORT_MESSAGES.emailInvalid : SUPPORT_MESSAGES.phoneInvalid
    }
  }

  if (Object.keys(fields).length || !parsed.success) throw Errors.validation(fields)
  const data = parsed.data
  return {
    requesterName: data.name,
    contactMethod: data.contactMethod as SupportContactMethod,
    contact: normalizeSupportContact(data.contactMethod as SupportContactMethod, data.contact)!,
    subject: data.subject,
    message: redactDocuments(data.message),
    source: 'web_form',
  }
}

// ------------------------------------------------------------------------------------ minimização

const validCpf = isValidCpfDigits

export const DOCUMENT_REDACTION = '[documento removido]'

/**
 * Remove números de CPF do texto antes de gravar (o atendimento orienta a não enviá-los).
 * Formato pontuado sempre; sequência de 11 dígitos só quando os dígitos verificadores conferem,
 * para não apagar telefones.
 */
export function redactDocuments(text: string): string {
  return text
    .replace(/(?<!\d)\d{3}\.\d{3}\.\d{3}-\d{2}(?!\d)/g, DOCUMENT_REDACTION)
    // Sequência isolada: não faz parte de um número maior nem de outro número pontuado.
    .replace(/(?<!\d|\d[.-])\d{11}(?!\d|[.-]\d)/g, (m) => (validCpf(m) ? DOCUMENT_REDACTION : m))
}

// ------------------------------------------------------------------------------------ criação

export { emailHint }

export function contactHint(method: SupportContactMethod, contact: string): string {
  return method === 'email' ? emailHint(contact) : phoneHint(contact)
}

/**
 * Chave HMAC do contato do atendimento (support_requests.contact_key), com a chave da deduplicação.
 * WhatsApp usa exatamente a chave do cadastro (`contactDedupKey`), para que o pedido de exclusão de um cadastro
 * alcance os atendimentos do mesmo número; e-mail usa contexto próprio. Pseudonimização, não anonimização.
 */
export function supportContactKey(ctx: AppContext, method: SupportContactMethod, contact: string): string {
  const key = ctx.config.secrets.dedupKey
  return method === 'whatsapp' ? contactDedupKey(contact, key) : hmacHex(contact.trim().toLowerCase(), key, 'support.email')
}

/**
 * Preenche contact_key de atendimentos gravados antes da coluna existir (decifra o contato só para calcular a
 * chave). Roda dentro da transação de quem precisa localizar atendimentos por contato; depois da primeira vez
 * não há mais linhas a preencher.
 */
export async function backfillSupportContactKeys(ctx: AppContext, tx: Queryable): Promise<number> {
  const r = await tx.query<{ id: string; contact_method: SupportContactMethod; contact_ciphertext: string }>(
    `SELECT id, contact_method, contact_ciphertext FROM support_requests
      WHERE contact_key IS NULL AND anonymized_at IS NULL AND contact_ciphertext <> '' FOR UPDATE`,
  )
  let filled = 0
  for (const row of r.rows) {
    let contact: string
    try {
      contact = decryptField(row.contact_ciphertext, ctx.config.secrets.encryption, SUPPORT_CIPHER_CONTEXT.contact(row.id))
    } catch {
      ctx.logger.warn({ supportRequestId: row.id }, 'contato de atendimento não pôde ser decifrado para calcular a chave')
      continue
    }
    await tx.query('UPDATE support_requests SET contact_key = $2 WHERE id = $1', [row.id, supportContactKey(ctx, row.contact_method, contact)])
    filled++
  }
  return filled
}

export function supportTrackingUrl(ctx: AppContext, protocol: string, trackingToken: string): string {
  // Fragmento (#) não é enviado ao servidor nem registrado em logs de acesso.
  return `${ctx.config.siteUrl}/atendimento/acompanhar#p=${encodeURIComponent(protocol)}&t=${encodeURIComponent(trackingToken)}`
}

const MAX_PROTOCOL_ATTEMPTS = 8

export interface CreateSupportOptions {
  /** Somente testes: gerador de protocolo substituível para simular colisão. */
  generateProtocol?: () => string
}

export async function createSupportRequest(
  ctx: AppContext,
  input: NewSupportRequest,
  actor: SupportActor,
  options: CreateSupportOptions = {},
): Promise<SupportCreated> {
  if (!ctx.config.collection.supportEnabled) throw Errors.unavailable('support_unavailable', SUPPORT_MESSAGES.unavailable)

  const id = randomUUID()
  const trackingToken = randomToken(32)
  const now = ctx.now()
  const keyring = ctx.config.secrets.encryption
  const generate = options.generateProtocol ?? randomProtocol

  const protocol = await ctx.db.transaction(async (tx) => {
    const protocol = await insertWithUniqueProtocol(tx, generate, (candidate) => [
      id,
      candidate,
      sha256Hex(trackingToken),
      input.requesterName,
      input.contactMethod,
      encryptField(input.contact, keyring, SUPPORT_CIPHER_CONTEXT.contact(id)),
      contactHint(input.contactMethod, input.contact),
      input.subject,
      encryptField(input.message, keyring, SUPPORT_CIPHER_CONTEXT.message(id)),
      input.leadId ?? null,
      input.source,
      now,
      supportContactKey(ctx, input.contactMethod, input.contact),
    ])

    await tx.query(
      `INSERT INTO support_events (id, support_request_id, event_type, to_status, actor_type, created_at)
       VALUES ($1, $2, 'created', 'received', $3, $4)`,
      [randomUUID(), id, actor.type, now],
    )

    if (input.subject === 'privacidade') {
      const privacyId = randomUUID()
      await tx.query(
        `INSERT INTO privacy_requests
           (id, request_type, lead_id, support_request_id, channel, status, summary, received_at, created_at, updated_at)
         VALUES ($1, 'information', $2, $3, $4, 'open', $5, $6, $6, $6)`,
        [
          privacyId,
          input.leadId ?? null,
          id,
          input.source === 'agent' ? 'bia' : 'atendimento_site',
          // Resumo sem conteúdo da mensagem: a equipe lê o texto (cifrado) na solicitação vinculada.
          `Pedido recebido pelo atendimento (protocolo ${protocol}). Detalhes na solicitação vinculada.`,
          now,
        ],
      )
      await recordAudit(tx, {
        actorType: actor.type,
        action: 'privacy_request.created',
        resourceType: 'privacy_request',
        resourceId: privacyId,
        metadata: { supportRequestId: id, source: input.source },
        ipHash: actor.type === 'titular' ? actor.ipHash ?? null : null,
      })
    }

    if (ctx.config.supportNotify.url) {
      const queued = await enqueueMessage(ctx, tx, {
        kind: 'support_notification',
        channel: 'webhook',
        purpose: 'internal',
        supportRequestId: id,
        // Somente identificadores e metadados não pessoais.
        payload: {
          event: {
            type: 'support_request.created',
            supportRequestId: id,
            protocol,
            subject: input.subject,
            subjectLabel: supportSubjectLabel(input.subject),
            source: input.source,
            createdAt: now.toISOString(),
          },
        },
        idempotencyKey: `support_notification:${id}`,
      })
      if (queued) {
        await tx.query(
          `INSERT INTO support_events (id, support_request_id, event_type, actor_type, created_at)
           VALUES ($1, $2, 'notification_queued', 'system', $3)`,
          [randomUUID(), id, now],
        )
      }
    }

    await incrementMetric(tx, now, 'support_request_created', `${input.source}:${input.subject}`)
    return protocol
  })

  return { id, protocol, trackingToken, status: 'received', message: SUPPORT_MESSAGES.created, createdAt: now.toISOString() }
}

/** Insere com protocolo aleatório; em colisão (raríssima), gera outro sem abortar a transação. */
async function insertWithUniqueProtocol(
  tx: Queryable,
  generate: () => string,
  params: (protocol: string) => unknown[],
): Promise<string> {
  for (let attempt = 0; attempt < MAX_PROTOCOL_ATTEMPTS; attempt++) {
    const candidate = generate()
    if (!PROTOCOL_PATTERN.test(candidate)) throw new Error('gerador de protocolo produziu formato inválido')
    const r = await tx.query(
      `INSERT INTO support_requests
         (id, protocol, tracking_token_hash, requester_name, contact_method, contact_ciphertext, contact_hint,
          subject, message_ciphertext, status, lead_id, source, created_at, updated_at, contact_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'received', $10, $11, $12, $12, $13)
       ON CONFLICT (protocol) DO NOTHING
       RETURNING id`,
      params(candidate),
    )
    if (r.rows.length) return candidate
  }
  throw new AppError(500, 'protocol_generation_failed', 'Não foi possível concluir. Tente novamente em instantes.')
}

// ------------------------------------------------------------------------------------ acompanhamento

interface SupportRow {
  id: string
  protocol: string
  tracking_token_hash: string
  subject: string
  status: SupportState
  created_at: Date
  updated_at: Date
  anonymized_at: Date | null
}

interface SupportEventRow {
  id: string
  event_type: string
  to_status: SupportState | null
  note_ciphertext: string | null
  visible_to_requester: boolean
  created_at: Date
}

// Hash fixo usado quando o protocolo não existe, para a comparação custar o mesmo tempo.
const DUMMY_HASH = sha256Hex('minhafolga.support.dummy')

const iso = (d: Date | string) => (d instanceof Date ? d : new Date(d)).toISOString()

/**
 * Status para o titular. Protocolo inexistente, token ausente ou token errado → a mesma resposta 404.
 * A resposta não contém nome, contato nem a mensagem original.
 */
export async function getSupportStatus(ctx: AppContext, protocolInput: string, token: string | undefined): Promise<SupportStatusView> {
  const protocol = protocolInput.trim().toUpperCase()
  const validToken = typeof token === 'string' && token.length >= 20 && token.length <= 100
  const row = PROTOCOL_PATTERN.test(protocol)
    ? (
        await ctx.db.query<SupportRow>(
          `SELECT id, protocol, tracking_token_hash, subject, status, created_at, updated_at, anonymized_at
             FROM support_requests WHERE protocol = $1`,
          [protocol],
        )
      ).rows[0]
    : undefined
  const given = validToken ? sha256Hex(token) : DUMMY_HASH
  const authorized = safeEqual(given, row?.tracking_token_hash ?? DUMMY_HASH) && Boolean(row) && validToken
  if (!row || !authorized) throw new AppError(404, 'not_found', SUPPORT_MESSAGES.notFound)

  const events = await ctx.db.query<SupportEventRow>(
    `SELECT id, event_type, to_status, note_ciphertext, visible_to_requester, created_at
       FROM support_events
      WHERE support_request_id = $1
        AND (event_type IN ('created', 'status_changed') OR (visible_to_requester AND note_ciphertext IS NOT NULL))
      ORDER BY created_at, id`,
    [row.id],
  )

  const timeline: SupportTimelineItem[] = []
  for (const ev of events.rows) {
    if (ev.event_type === 'created') {
      timeline.push({ type: 'created', status: 'received', text: null, at: iso(ev.created_at) })
    } else if (ev.event_type === 'status_changed' && ev.to_status) {
      timeline.push({ type: 'status_changed', status: ev.to_status, text: null, at: iso(ev.created_at) })
    }
    // Uma mudança de status pode vir acompanhada de resposta visível; a resposta vira item próprio.
    if (ev.visible_to_requester && ev.note_ciphertext && !row.anonymized_at) {
      const text = decryptNote(ctx, ev.id, ev.note_ciphertext)
      if (text !== null) timeline.push({ type: 'reply', text, at: iso(ev.created_at) })
    }
  }

  return {
    protocol: row.protocol,
    status: row.status,
    subject: row.subject,
    subjectLabel: supportSubjectLabel(row.subject),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    timeline,
  }
}

/** Cifra uma nota/resposta da equipe com o contexto padrão (o mesmo de admin-support.service). */
export function encryptSupportNote(ctx: AppContext, eventId: string, note: string): string {
  return encryptField(note, ctx.config.secrets.encryption, SUPPORT_CIPHER_CONTEXT.note(eventId))
}

function decryptNote(ctx: AppContext, eventId: string, ciphertext: string): string | null {
  try {
    return decryptField(ciphertext, ctx.config.secrets.encryption, SUPPORT_CIPHER_CONTEXT.note(eventId))
  } catch {
    // Resposta ilegível não derruba o acompanhamento; o item é omitido e o fato vai para o log técnico.
    ctx.logger.warn({ supportEventId: eventId }, 'resposta de atendimento não pôde ser decifrada')
    return null
  }
}
