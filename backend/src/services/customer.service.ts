import type { ConsentPurpose } from '../config/contracts.js'
import type { AppContext } from '../context.js'
import { cpfKey } from '../lib/cpf.js'
import { Errors } from '../lib/errors.js'
import {
  actorColumns,
  contactDedupKey,
  findLeadByCpfKey,
  findLeadByDedup,
  isSuppressed,
  LeadEventLog,
  lockKeys,
  PURPOSES,
  releaseAnonymizedDedupKey,
  updateLeadData,
  type LeadRow,
} from '../repositories/leads.repo.js'
import { insertSubmission, type SubmissionReason } from '../repositories/submissions.repo.js'
import { recordAudit } from './audit.service.js'
import type { CustomerData, LifecycleActor } from './lead-lifecycle.js'
import { incrementMetric } from './metrics.service.js'
import { applyPreferencesChangeTx, consentVersionOutdated, CURRENT_CONSENT_VERSIONS, markContactVerified } from './preferences.service.js'
import { assertWaitlistOpen } from './collection-switch.service.js'
import { createLeadTx } from './waitlist.service.js'

/**
 * Cadastro pela Bia (ferramenta upsert_customer, decisão D1): o telefone é o do remetente ATESTADO pela plataforma
 * (nunca informado pelo modelo). Cria ou atualiza o cadastro desse número com os mesmos campos do formulário do
 * site e marca o número como validado (`contact_verified_at`, estado `verified`).
 *
 * Sem mesclar cadastros: CPF de OUTRO cadastro (outro telefone), CPF diferente do já cadastrado para este número ou
 * contato suprimido → nada muda; a submissão fica guardada (cifrada) para revisão e o resultado é `needs_review`.
 */

export type CustomerFields = Partial<Omit<CustomerData, 'phoneE164'>>

export interface UpsertCustomerInput {
  data: CustomerFields
  ageConfirmed?: boolean
  consents?: Partial<Record<ConsentPurpose, boolean>>
  consentVersions?: Partial<Record<ConsentPurpose, string>>
}

export type UpsertCustomerResult =
  | { status: 'created' | 'updated'; lead: LeadRow; changed: string[] }
  | { status: 'needs_review'; reason: SubmissionReason }

/** Campos exigidos para criar um cadastro (os mesmos do formulário do site; e-mail e tema são opcionais). */
const REQUIRED_TO_CREATE = ['fullName', 'cpf', 'employerName', 'employmentType', 'jobTenure', 'incomeRange', 'city', 'uf'] as const

const REQUIRED_MESSAGE = 'Obrigatório para criar o cadastro. Pergunte à pessoa.'

function checkVersions(input: UpsertCustomerInput, required: readonly ConsentPurpose[]): void {
  const fields: Record<string, string> = {}
  for (const purpose of PURPOSES) {
    const needed = required.includes(purpose) || input.consents?.[purpose] === true
    if (!needed) continue
    const version = input.consentVersions?.[purpose]
    if (!version) fields[`input.consentVersions.${purpose}`] = 'Informe a versão do texto de consentimento apresentado.'
    else if (version !== CURRENT_CONSENT_VERSIONS[purpose]) throw consentVersionOutdated()
  }
  if (Object.keys(fields).length) throw Errors.validation(fields)
}

export async function upsertCustomer(
  ctx: AppContext,
  attestedPhone: string,
  input: UpsertCustomerInput,
  actor: Extract<LifecycleActor, { type: 'agent' }>,
): Promise<UpsertCustomerResult> {
  assertWaitlistOpen(ctx)
  checkVersions(input, [])
  const secrets = ctx.config.secrets
  const phoneKey = contactDedupKey(attestedPhone, secrets.dedupKey)
  const docKey = input.data.cpf ? cpfKey(input.data.cpf, secrets.dedupKey) : null
  const now = ctx.now()
  const source = 'bia'

  return ctx.db.transaction(async (tx): Promise<UpsertCustomerResult> => {
    await lockKeys(tx, [phoneKey, docKey])
    let byPhone = await findLeadByDedup(tx, phoneKey, { forUpdate: true })
    if (byPhone?.anonymized_at) {
      await releaseAnonymizedDedupKey(tx, byPhone.id)
      byPhone = null
    }
    const byCpf = docKey ? await findLeadByCpfKey(tx, docKey, { forUpdate: true }) : null

    const hold = async (reason: SubmissionReason, leadId: string | null): Promise<UpsertCustomerResult> => {
      await insertSubmission(tx, secrets.encryption, {
        leadId,
        channel: 'bia',
        source,
        reason,
        phoneKey,
        cpfKey: docKey,
        payload: { v: 1, data: { ...input.data, phoneE164: attestedPhone }, consents: input.consents ?? {}, source },
        at: now,
      })
      if (leadId) await new LeadEventLog(tx, actor, source, now).add(leadId, { type: 'submission_held' })
      await incrementMetric(tx, now, 'waitlist_held', `bia:${reason}`)
      return { status: 'needs_review', reason }
    }

    const audit = async (lead: LeadRow, outcome: 'created' | 'updated', fieldsChanged: string[]) => {
      const { actorType, actorId } = actorColumns(actor)
      await recordAudit(tx, {
        actorType,
        actorId,
        action: 'lead.customer_upserted',
        resourceType: 'lead',
        resourceId: lead.id,
        metadata: { outcome, fieldsChanged, source },
      })
    }

    if (await isSuppressed(tx, phoneKey, docKey)) return hold('suppressed', byPhone?.id ?? null)

    if (!byPhone) {
      if (byCpf) return hold('cpf_conflict', byCpf.id)
      const fields: Record<string, string> = {}
      for (const key of REQUIRED_TO_CREATE) if (input.data[key] === undefined) fields[`input.${key}`] = REQUIRED_MESSAGE
      if (input.ageConfirmed !== true) fields['input.ageConfirmed'] = 'É preciso a confirmação explícita de 18 anos ou mais.'
      if (input.consents?.launch_notice !== true) fields['input.consents.launch_notice'] = 'O aviso de abertura exige consentimento explícito (true).'
      if (typeof input.consents?.marketing !== 'boolean') {
        fields['input.consents.marketing'] = 'Informe explicitamente se a pessoa aceitou (true) ou não (false) conteúdos e novidades.'
      }
      if (Object.keys(fields).length) throw Errors.validation(fields)
      // Os dois textos foram apresentados (aceitos ou não): as duas versões precisam ser as vigentes.
      checkVersions(input, PURPOSES)
      const data = { ...(input.data as Omit<CustomerData, 'phoneE164'>), email: input.data.email ?? null, interestTopic: input.data.interestTopic ?? null }
      const log = new LeadEventLog(tx, actor, source, now)
      const lead = await createLeadTx(
        ctx,
        tx,
        log,
        { data: { ...data, phoneE164: attestedPhone }, consents: { launch_notice: true, marketing: input.consents!.marketing === true }, source, utm: {} },
        { dedupKey: phoneKey, cpfKey: docKey! },
        now,
      )
      await markContactVerified(tx, log, lead, now)
      await incrementMetric(tx, now, 'waitlist_received', source)
      await incrementMetric(tx, now, 'contact_verified_bia')
      await audit(lead, 'created', [])
      return { status: 'created', lead, changed: [] }
    }

    if (docKey) {
      if (byCpf && byCpf.id !== byPhone.id) return hold('cpf_conflict', byPhone.id)
      if (byPhone.cpf_key && byPhone.cpf_key !== docKey) return hold('cpf_mismatch', byPhone.id)
    }

    const log = new LeadEventLog(tx, actor, source, now)
    const firstVerification = await markContactVerified(tx, log, byPhone, now)
    // "expired" é só inatividade (revisão de retenção): a própria pessoa voltando pela Bia reativa o cadastro.
    // "unsubscribed" continua até uma nova autorização explícita do aviso.
    if (byPhone.state === 'expired') await log.transition(byPhone, 'verified')
    const { interestTopic, ...rest } = input.data
    const changed = await updateLeadData(tx, secrets.encryption, secrets.dedupKey, byPhone, rest, now)
    if (changed.length) await log.add(byPhone.id, { type: 'profile_updated' })
    const prefChange: Parameters<typeof applyPreferencesChangeTx>[3] = { purposes: input.consents, consentVersions: input.consentVersions }
    if (interestTopic !== undefined) prefChange.interestTopic = interestTopic
    await applyPreferencesChangeTx(ctx, tx, byPhone, prefChange, actor, source, now, log)
    if (firstVerification) await incrementMetric(tx, now, 'contact_verified_bia')
    await audit(byPhone, 'updated', changed)
    return { status: 'updated', lead: byPhone, changed }
  })
}
