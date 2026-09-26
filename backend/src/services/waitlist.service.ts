import { randomUUID } from 'node:crypto'
import { CONSENTS, VALIDATION, type ConsentPurpose } from '../config/contracts.js'
import type { AppContext } from '../context.js'
import type { Queryable } from '../db/database.js'
import { cpfKey } from '../lib/cpf.js'
import {
  contactDedupKey,
  findLeadByCpfKey,
  findLeadByDedup,
  insertLead,
  isSuppressed,
  LeadEventLog,
  lockKeys,
  PURPOSES,
  readPreferences,
  releaseAnonymizedDedupKey,
  type LeadRow,
  type UtmKey,
} from '../repositories/leads.repo.js'
import { insertSubmission, type SubmissionReason } from '../repositories/submissions.repo.js'
import {
  cleanupAntiBot,
  consumeFormToken,
  enforceFormLimits,
  recordFormAttempt,
  type VerifiedFormToken,
} from './anti-bot.service.js'
import { assertWaitlistFormOpen } from './collection-switch.service.js'
import type { CustomerData, LifecycleActor, WaitlistReceived, WaitlistSubmission } from './lead-lifecycle.js'
import { incrementMetric } from './metrics.service.js'
import { CURRENT_CONSENT_VERSIONS, consentVersionOutdated, setPurpose } from './preferences.service.js'
import { maybeQueueSignupTemplate } from './signup-template.service.js'

/**
 * Cadastro de interesse pelo site (decisão D1, docs/DECISOES.md → Cadastro pelo site).
 *
 * - Sem confirmação por WhatsApp: o cadastro novo nasce `received` (telefone não validado) e só passa a
 *   `verified` quando a própria pessoa fala com a Bia (ferramenta upsert_customer, número atestado).
 * - Resposta 201 IDÊNTICA para CPF/telefone novo, já cadastrado, suprimido ou campo-armadilha: não revela cadastro.
 * - Cadastro existente (mesmo telefone ou mesmo CPF) NUNCA é sobrescrito pelo site: a submissão fica guardada à parte,
 *   cifrada (lead_submissions), para revisão; só a Bia (número atestado) ou a equipe de privacidade mudam o cadastro.
 * - Anti-robô (anti-bot.service.ts): token de uso único gravado na MESMA transação, limites por IP/CPF/telefone,
 *   e só então a gravação. O placeholder de template da Hal-AI (signup-template.service.ts) roda por último,
 *   só para cadastro novo e desligado por padrão.
 * - CPF, telefone, e-mail e empregador cifrados; HMAC de deduplicação para CPF e telefone; dicas mascaradas.
 */

export const RECEIVED_MESSAGE =
  'Recebemos seu cadastro. Vamos avisar quando a análise estiver disponível. Enquanto isso, você pode conversar com a Bia.'

export const RECEIVED: WaitlistReceived = { status: 'received', message: RECEIVED_MESSAGE }

// Normalização -----------------------------------------------------------------------------------------

const UTM_PATTERN = new RegExp(VALIDATION.utm.pattern)
const UTM_KEYS = VALIDATION.utm.allowedParams as UtmKey[]

/**
 * Decisão documentada: UTM é atribuição de campanha, não dado do titular. Chaves fora da lista são
 * recusadas pelo esquema (contrato), mas VALORES fora do padrão são descartados em silêncio — um link de
 * campanha malformado não pode impedir um cadastro legítimo. Valores são normalizados para minúsculas e
 * sequências de 8+ dígitos (telefone/CPF) são descartadas mesmo quando casam com o padrão.
 */
export function sanitizeUtm(utm: Partial<Record<string, unknown>> | undefined): Partial<Record<UtmKey, string>> {
  const out: Partial<Record<UtmKey, string>> = {}
  if (!utm) return out
  for (const key of UTM_KEYS) {
    const raw = utm[key]
    if (typeof raw !== 'string') continue
    const value = raw.trim().toLowerCase()
    if (UTM_PATTERN.test(value) && !/\d{8,}/.test(value)) out[key] = value
  }
  return out
}

/** As duas versões precisam ser as vigentes: os dois textos foram exibidos (aceitos ou não). */
export function assertCurrentConsentVersions(versions: Record<ConsentPurpose, string>): void {
  for (const purpose of PURPOSES) {
    if (versions?.[purpose] !== CURRENT_CONSENT_VERSIONS[purpose]) throw consentVersionOutdated()
  }
}

// Gravação -----------------------------------------------------------------------------------------------

export interface CreateLeadInput {
  data: CustomerData
  consents: Record<ConsentPurpose, boolean>
  source: string
  utm: Partial<Record<UtmKey, string>>
}

/** Cria o cadastro (estado `received`) com finalidades e trilha. Usado pelo site e pela Bia. */
export async function createLeadTx(
  ctx: AppContext,
  tx: Queryable,
  log: LeadEventLog,
  input: CreateLeadInput,
  keys: { dedupKey: string; cpfKey: string },
  now: Date,
): Promise<LeadRow> {
  const lead = await insertLead(tx, ctx.config.secrets.encryption, {
    id: randomUUID(),
    data: input.data,
    dedupKey: keys.dedupKey,
    cpfKey: keys.cpfKey,
    source: input.source,
    utm: input.utm,
    privacyNoticeVersion: CONSENTS.notices.privacy.version,
    at: now,
  })
  await log.add(lead.id, { type: 'state_changed', fromState: null, toState: 'received' })
  const current = await readPreferences(tx, lead.id)
  for (const purpose of PURPOSES) {
    await setPurpose(tx, log, lead, current, purpose, input.consents[purpose], CURRENT_CONSENT_VERSIONS[purpose], input.source, now)
  }
  for (const purpose of PURPOSES) if (input.consents[purpose]) await incrementMetric(tx, now, 'preference_granted', purpose)
  return lead
}

/** Motivo da retenção de uma submissão sobre cadastro existente. */
function holdReason(byPhone: LeadRow | null, byCpf: LeadRow | null): SubmissionReason {
  if (byPhone && byCpf) return byPhone.id === byCpf.id ? 'existing_phone_and_cpf' : 'cpf_conflict'
  return byPhone ? 'existing_phone' : 'existing_cpf'
}

export interface SubmitWaitlistContext {
  /** Token do anti-robô já conferido (assinatura, idade e prova); o uso único é gravado aqui. */
  antiBot: VerifiedFormToken
  /** HMAC da rede de origem (req.originHash), para o limite por IP. */
  originKey: string
}

/**
 * Registra a submissão do site. Resposta sempre `RECEIVED` (idêntica em todos os casos de sucesso).
 * Erros possíveis: `form_expired` (token reutilizado), `rate_limited` (limites) — ambos antes de qualquer gravação.
 */
export async function submitWaitlist(
  ctx: AppContext,
  input: WaitlistSubmission,
  actor: LifecycleActor,
  options: SubmitWaitlistContext,
): Promise<WaitlistReceived> {
  await assertWaitlistFormOpen(ctx)
  assertCurrentConsentVersions(input.consentVersions)
  const d = input.data
  const secrets = ctx.config.secrets
  const phoneKey = contactDedupKey(d.phoneE164, secrets.dedupKey)
  const docKey = cpfKey(d.cpf, secrets.dedupKey)
  const consents = { launch_notice: input.consents.launch_notice === true, marketing: input.consents.marketing === true }
  const utm = sanitizeUtm(input.utm)
  const now = ctx.now()
  await cleanupAntiBot(ctx)

  await ctx.db.transaction(async (tx) => {
    await lockKeys(tx, [phoneKey, docKey])
    await consumeFormToken(ctx, tx, options.antiBot, 'waitlist')
    const attempt = { ip: options.originKey, cpf: docKey, phone: phoneKey }
    await enforceFormLimits(ctx, tx, 'waitlist', attempt, options.antiBot)
    await recordFormAttempt(ctx, tx, 'waitlist', attempt)

    // Pedido de exclusão/oposição registrado: nada é gravado sobre o titular (mesma resposta).
    if (await isSuppressed(tx, phoneKey, docKey)) {
      await incrementMetric(tx, now, 'waitlist_suppressed', input.source)
      return
    }

    let byPhone = await findLeadByDedup(tx, phoneKey, { forUpdate: true })
    if (byPhone?.anonymized_at) {
      await releaseAnonymizedDedupKey(tx, byPhone.id)
      byPhone = null
    }
    const byCpf = await findLeadByCpfKey(tx, docKey, { forUpdate: true })

    if (byPhone || byCpf) {
      const target = (byPhone ?? byCpf)!
      const reason = holdReason(byPhone, byCpf)
      await insertSubmission(tx, secrets.encryption, {
        leadId: target.id,
        channel: 'site',
        source: input.source,
        reason,
        phoneKey,
        cpfKey: docKey,
        payload: { v: 1, data: d, consents, source: input.source },
        at: now,
      })
      await new LeadEventLog(tx, actor, input.source, now).add(target.id, { type: 'submission_held' })
      await incrementMetric(tx, now, 'waitlist_held', reason)
      return
    }

    const log = new LeadEventLog(tx, actor, input.source, now)
    const lead = await createLeadTx(ctx, tx, log, { data: d, consents, source: input.source, utm }, { dedupKey: phoneKey, cpfKey: docKey }, now)
    await incrementMetric(tx, now, 'waitlist_received', input.source)
    // PLACEHOLDER: agente Hal-AI ainda não provisionado — desligado por padrão; ver signup-template.service.ts.
    await maybeQueueSignupTemplate(ctx, tx, lead, d.phoneE164, consents.launch_notice, now)
  })
  return { ...RECEIVED }
}
