import type { AppContext } from '../context.js'
import { cpfKey } from '../lib/cpf.js'
import { Errors } from '../lib/errors.js'
import { findActiveLead, findLeadByCpfKey, isSuppressed, LeadEventLog, lockKeys, updateLeadData, type LeadDataUpdate } from '../repositories/leads.repo.js'
import { readSubmissionPayload, type SubmissionPayload, type SubmissionReason, type SubmissionRow } from '../repositories/submissions.repo.js'
import { recordAudit } from './audit.service.js'
import type { AdminPrincipal } from './admin-auth.service.js'

/**
 * Revisão das submissões guardadas (lead_submissions) pela equipe de privacidade (`privacy:manage`). O site e a Bia
 * nunca sobrescrevem um cadastro existente em caso de dúvida; aqui uma pessoa da equipe aplica ou descarta, sempre com
 * justificativa, e tudo vai para a auditoria (sem valores).
 *
 * - Aplicar muda só dados cadastrais: nome, CPF, e-mail, empregador, vínculo, tempo no emprego, faixa de renda,
 *   cidade/UF e tema de interesse. **Nunca** o telefone (validado só pela Bia) nem as preferências de comunicação
 *   (mudam só pelo titular, via Bia ou link de preferências). E-mail e tema ausentes na submissão não apagam o que
 *   já existe.
 * - Não se aplica: `cpf_conflict` (CPF de outro cadastro; mesclar cadastros é decisão fora do painel) e
 *   `suppressed` (pedido de exclusão/oposição registrado). Esses só podem ser descartados.
 * - Troca de CPF só se o CPF novo não pertence a outro cadastro ativo nem está suprimido.
 * - Depois da revisão o conteúdo cifrado é apagado (minimização): o que foi aplicado já está no cadastro.
 */
export const NOT_APPLICABLE_REASONS: readonly SubmissionReason[] = ['cpf_conflict', 'suppressed']

export function isApplicable(reason: SubmissionReason, payload: SubmissionPayload | null): boolean {
  return payload !== null && !NOT_APPLICABLE_REASONS.includes(reason)
}

const SOURCE = 'admin_privacy'

export type ReviewAction = 'apply' | 'discard'

export interface ReviewResult {
  status: 'applied' | 'discarded'
  /** Campos do cadastro alterados (só nomes). */
  changed: string[]
}

/** Dados cadastrais da submissão que podem ir para o cadastro (sem telefone; opcionais vazios não apagam). */
function profileChange(payload: SubmissionPayload): LeadDataUpdate {
  const d = payload.data
  const change: LeadDataUpdate = {}
  if (d.fullName !== undefined) change.fullName = d.fullName
  if (d.cpf !== undefined) change.cpf = d.cpf
  if (d.email) change.email = d.email
  if (d.employerName !== undefined) change.employerName = d.employerName
  if (d.employmentType !== undefined) change.employmentType = d.employmentType
  if (d.jobTenure !== undefined) change.jobTenure = d.jobTenure
  if (d.incomeRange !== undefined) change.incomeRange = d.incomeRange
  if (d.city !== undefined) change.city = d.city
  if (d.uf !== undefined) change.uf = d.uf
  if (d.interestTopic) change.interestTopic = d.interestTopic
  return change
}

export async function reviewSubmission(
  ctx: AppContext,
  principal: AdminPrincipal,
  leadId: string,
  submissionId: string,
  action: ReviewAction,
  reason: string,
  ipHash: string,
): Promise<ReviewResult> {
  const now = ctx.now()
  const { encryption, dedupKey } = ctx.config.secrets
  return ctx.db.transaction(async (tx): Promise<ReviewResult> => {
    const r = await tx.query<SubmissionRow>(
      `SELECT id, lead_id, channel, source, reason, payload_ciphertext, status, created_at
         FROM lead_submissions WHERE id = $1 AND lead_id = $2 FOR UPDATE`,
      [submissionId, leadId],
    )
    const submission = r.rows[0]
    if (!submission) throw Errors.notFound('Submissão não encontrada.')
    if (submission.status !== 'pending') throw Errors.conflict('submission_already_reviewed', 'Esta submissão já foi revisada.')

    let changed: string[] = []
    if (action === 'apply') {
      const payload = readSubmissionPayload(submission, encryption)
      if (!isApplicable(submission.reason, payload)) {
        throw Errors.conflict('submission_not_applicable', 'Esta submissão não pode ser aplicada ao cadastro; só descartada.')
      }
      const change = profileChange(payload!)
      const newCpfKey = change.cpf ? cpfKey(change.cpf, dedupKey) : null
      await lockKeys(tx, [newCpfKey])
      const lead = await findActiveLead(tx, leadId, { forUpdate: true })
      if (!lead) throw Errors.conflict('lead_anonymized', 'Este cadastro foi anonimizado; não há o que atualizar.')
      if (newCpfKey && newCpfKey !== lead.cpf_key) {
        const owner = await findLeadByCpfKey(tx, newCpfKey, { forUpdate: true })
        if (owner && owner.id !== lead.id) throw Errors.conflict('cpf_in_use', 'Este CPF já pertence a outro cadastro.')
        if (await isSuppressed(tx, newCpfKey)) {
          throw Errors.conflict('submission_not_applicable', 'O CPF desta submissão tem pedido de exclusão ou oposição registrado.')
        }
      }
      changed = await updateLeadData(tx, encryption, dedupKey, lead, change, now)
      if (changed.length) {
        await new LeadEventLog(tx, { type: 'admin', adminId: principal.user.id, ipHash }, SOURCE, now).add(lead.id, { type: 'profile_updated' })
      }
    }

    const status = action === 'apply' ? 'applied' : 'discarded'
    await tx.query(`UPDATE lead_submissions SET status = $2, reviewed_at = $3, payload_ciphertext = '' WHERE id = $1`, [submission.id, status, now])
    await recordAudit(tx, {
      actorType: 'admin',
      actorId: principal.user.id,
      action: action === 'apply' ? 'admin.lead_submission_applied' : 'admin.lead_submission_discarded',
      resourceType: 'lead',
      resourceId: leadId,
      metadata: { submissionId: submission.id, channel: submission.channel, submissionReason: submission.reason, reason, fieldsChanged: changed },
      ipHash,
    })
    return { status, changed }
  })
}
