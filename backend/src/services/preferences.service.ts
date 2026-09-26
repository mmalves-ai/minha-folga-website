import { randomUUID } from 'node:crypto'
import { CONSENTS, VALIDATION, type ConsentPurpose } from '../config/contracts.js'
import type { AppContext } from '../context.js'
import type { Queryable } from '../db/database.js'
import { randomToken, sha256Hex } from '../lib/crypto.js'
import { AppError, Errors } from '../lib/errors.js'
import {
  actorColumns,
  cancelPendingMessages,
  contactDedupKey,
  decryptLeadField,
  findActiveLead,
  findLeadByDedup,
  LeadEventLog,
  PURPOSES,
  readPreferences,
  touchInteraction,
  updateLeadData,
  upsertPreference,
  type LeadRow,
  type PreferenceRow,
} from '../repositories/leads.repo.js'
import { recordAudit } from './audit.service.js'
import { nameHint } from './customer-data.js'
import type { LeadState, LifecycleActor, PreferencesChange, PreferencesView } from './lead-lifecycle.js'
import { incrementMetric } from './metrics.service.js'

/**
 * Preferências do titular (seções 6.15 e 8.6, com a decisão D1). A escolha do titular prevalece sobre qualquer
 * envio: revogar cancela as mensagens pendentes da finalidade e o worker confere a autorização de novo no envio.
 * Toda mudança gera lead_events; ações de equipe, Bia ou sistema também vão para audit_log.
 *
 * Acesso (D1): a Bia gera, por API, um link seguro de uso único (issue_preferences_link) — o número já está
 * atestado pela conversa. Não há mais código de acesso por WhatsApp. Sem sessão, o site só aceita o pedido de
 * saída pelo número (POST /api/preferences/opt-out), que não mostra nada.
 */

export const CURRENT_CONSENT_VERSIONS: Record<ConsentPurpose, string> = {
  launch_notice: CONSENTS.purposes.launch_notice.version,
  marketing: CONSENTS.purposes.marketing.version,
}

/** Estados laterais de onde (re)conceder o aviso de abertura volta ao fluxo principal. */
const REJOIN_STATES: readonly LeadState[] = ['unsubscribed', 'expired']

/** Validade do link seguro de preferências emitido pela Bia (uso único). */
export const PREFERENCES_LINK_TTL_SECONDS = VALIDATION.waitlist.preferencesLinkTtlSeconds

export const consentVersionOutdated = () =>
  new AppError(
    409,
    'consent_version_outdated',
    'Os textos de autorização foram atualizados. Recarregue a página para ver a versão atual e escolha de novo.',
  )

const leadNotFound = () => Errors.notFound('Não encontramos este cadastro.')

// Leitura ----------------------------------------------------------------------------------------------

const iso = (d: Date | string) => (d instanceof Date ? d : new Date(d)).toISOString()

/** Visão do titular: dados mascarados (nome, telefone, CPF, e-mail) e os dados gerais que ele pode mudar. */
export async function buildPreferencesView(ctx: AppContext, q: Queryable, lead: LeadRow): Promise<PreferencesView> {
  const prefs = await readPreferences(q, lead.id)
  const purpose = (p: ConsentPurpose) => {
    const row = prefs.get(p)
    return row
      ? { granted: row.granted, updatedAt: iso(row.updated_at), consentTextVersion: row.consent_text_version }
      : { granted: false, updatedAt: iso(lead.created_at), consentTextVersion: CURRENT_CONSENT_VERSIONS[p] }
  }
  return {
    preferredName: lead.preferred_name,
    nameHint: nameHint(lead.full_name ?? lead.preferred_name),
    contactHint: lead.phone_hint,
    contactVerified: lead.contact_verified_at !== null,
    cpfHint: lead.cpf_hint,
    emailHint: lead.email_hint,
    employerName: decryptLeadField(lead, 'employer', ctx.config.secrets.encryption),
    employmentType: lead.employment_type,
    jobTenure: lead.job_tenure,
    incomeRange: lead.income_range,
    city: lead.city,
    uf: lead.uf,
    interestTopic: lead.interest_topic,
    state: lead.state,
    purposes: { launch_notice: purpose('launch_notice'), marketing: purpose('marketing') },
  }
}

export async function getPreferences(ctx: AppContext, leadId: string): Promise<PreferencesView> {
  const lead = await findActiveLead(ctx.db, leadId)
  if (!lead) throw leadNotFound()
  return buildPreferencesView(ctx, ctx.db, lead)
}

// Mudanças ----------------------------------------------------------------------------------------------

export interface PreferencesChangeSummary {
  granted: ConsentPurpose[]
  revoked: ConsentPurpose[]
  interestChanged: boolean
  /** Nomes dos dados gerais alterados (sem valores). */
  profileChanged: string[]
}

/**
 * Grava uma finalidade se algo mudou (concessão, revogação ou nova versão do texto).
 * `current` é atualizado para refletir a gravação. Retorna true quando houve mudança.
 */
export async function setPurpose(
  tx: Queryable,
  log: LeadEventLog,
  lead: LeadRow,
  current: Map<ConsentPurpose, PreferenceRow>,
  purpose: ConsentPurpose,
  granted: boolean,
  version: string,
  source: string,
  now: Date,
): Promise<boolean> {
  const prev = current.get(purpose)
  if (prev && prev.granted === granted && prev.consent_text_version === version) return false
  await upsertPreference(tx, lead.id, purpose, granted, version, source, now)
  await log.add(lead.id, { type: 'preference_changed', purpose, granted, consentTextVersion: version })
  current.set(purpose, { purpose, granted, consent_text_version: version, source, updated_at: now })
  return true
}

/**
 * Marca o número como atestado pela Bia (primeira vez) e registra o evento. `received` → `verified`.
 * Só as ferramentas da Bia chamam: o número vem do canal, atestado pela plataforma (D1).
 */
export async function markContactVerified(tx: Queryable, log: LeadEventLog, lead: LeadRow, now: Date): Promise<boolean> {
  const first = !lead.contact_verified_at
  if (first) {
    await tx.query('UPDATE leads SET contact_verified_at = $2, updated_at = $2 WHERE id = $1', [lead.id, now])
    lead.contact_verified_at = now
    await log.add(lead.id, { type: 'contact_verified' })
  }
  if (lead.state === 'received' || lead.state === 'verification_pending' || lead.state === 'waiting') {
    await log.transition(lead, 'verified')
  }
  return first
}

/** Consequências de revogação: cancela pendências e, para o aviso de abertura, tira o contato da lista. */
export async function applyRevocations(
  tx: Queryable,
  log: LeadEventLog,
  lead: LeadRow,
  revoked: ConsentPurpose[],
  source: string,
  now: Date,
): Promise<void> {
  if (!revoked.length) return
  await cancelPendingMessages(tx, lead.id, revoked, 'purpose_revoked', now)
  for (const purpose of revoked) await incrementMetric(tx, now, 'preference_revoked', purpose)
  if (revoked.includes('launch_notice') && lead.state !== 'unsubscribed') {
    await log.transition(lead, 'unsubscribed')
    await incrementMetric(tx, now, 'unsubscribed', source)
  }
}

/** Estado de volta ao fluxo principal: `verified` se a Bia já atestou o número, senão `received`. */
export const mainState = (lead: Pick<LeadRow, 'contact_verified_at'>): LeadState => (lead.contact_verified_at ? 'verified' : 'received')

export async function applyPreferencesChangeTx(
  ctx: AppContext,
  tx: Queryable,
  lead: LeadRow,
  change: PreferencesChange,
  actor: LifecycleActor,
  source: string,
  now: Date,
  /** Trilha já aberta pelo mesmo ato (mantém a ordem dos eventos). */
  existingLog?: LeadEventLog,
): Promise<PreferencesChangeSummary> {
  const log = existingLog ?? new LeadEventLog(tx, actor, source, now)
  const current = await readPreferences(tx, lead.id)
  const summary: PreferencesChangeSummary = { granted: [], revoked: [], interestChanged: false, profileChanged: [] }
  const ownerAction = actor.type === 'titular' || actor.type === 'agent'

  for (const purpose of PURPOSES) {
    const want = change.purposes?.[purpose]
    if (want === undefined) continue
    if (want) {
      // Consentimento só pelo próprio titular (site com sessão ou canal atestado), com o texto vigente.
      if (!ownerAction) throw Errors.forbidden('Somente o titular pode autorizar comunicações.')
      const version = change.consentVersions?.[purpose]
      if (!version) throw Errors.validation({ [`consentVersions.${purpose}`]: 'Informe a versão do texto de autorização exibido.' })
      if (version !== CURRENT_CONSENT_VERSIONS[purpose]) throw consentVersionOutdated()
      if (await setPurpose(tx, log, lead, current, purpose, true, version, source, now)) summary.granted.push(purpose)
    } else {
      const version = current.get(purpose)?.consent_text_version ?? CURRENT_CONSENT_VERSIONS[purpose]
      if (await setPurpose(tx, log, lead, current, purpose, false, version, source, now)) summary.revoked.push(purpose)
    }
  }

  if (change.interestTopic !== undefined && change.interestTopic !== lead.interest_topic) {
    await tx.query('UPDATE leads SET interest_topic = $2, updated_at = $3 WHERE id = $1', [lead.id, change.interestTopic, now])
    lead.interest_topic = change.interestTopic
    await log.add(lead.id, { type: 'interest_updated' })
    summary.interestChanged = true
  }

  if (change.profile) {
    if (!ownerAction) throw Errors.forbidden('Somente o titular pode alterar os próprios dados.')
    summary.profileChanged = await updateLeadData(tx, ctx.config.secrets.encryption, ctx.config.secrets.dedupKey, lead, change.profile, now)
    if (summary.profileChanged.length) await log.add(lead.id, { type: 'profile_updated' })
  }

  await applyRevocations(tx, log, lead, summary.revoked, source, now)
  for (const purpose of summary.granted) await incrementMetric(tx, now, 'preference_granted', purpose)

  // Reconceder o aviso de abertura recoloca o contato no fluxo principal.
  if (summary.granted.includes('launch_notice') && REJOIN_STATES.includes(lead.state)) {
    await log.transition(lead, mainState(lead))
  }

  if (ownerAction) await touchInteraction(tx, lead.id, now)
  const anything = summary.granted.length || summary.revoked.length || summary.interestChanged || summary.profileChanged.length
  if (actor.type !== 'titular' && anything) {
    const { actorType, actorId } = actorColumns(actor)
    await recordAudit(tx, {
      actorType,
      actorId,
      action: 'lead.preferences_updated',
      resourceType: 'lead',
      resourceId: lead.id,
      metadata: {
        source,
        granted: summary.granted,
        revoked: summary.revoked,
        interestChanged: summary.interestChanged,
        profileChanged: summary.profileChanged,
      },
      ipHash: 'ipHash' in actor ? (actor.ipHash ?? null) : null,
    })
  }
  return summary
}

/** Aplica mudanças com trilha em lead_events. Revogar launch_notice → `unsubscribed`; reconceder → fluxo principal. */
export async function updatePreferences(
  ctx: AppContext,
  leadId: string,
  change: PreferencesChange,
  actor: LifecycleActor,
  source: string,
): Promise<PreferencesView> {
  const now = ctx.now()
  return ctx.db.transaction(async (tx) => {
    const lead = await findActiveLead(tx, leadId, { forUpdate: true })
    if (!lead) throw leadNotFound()
    await applyPreferencesChangeTx(ctx, tx, lead, change, actor, source, now)
    return buildPreferencesView(ctx, tx, lead)
  })
}

/** Localiza o cadastro ativo (não anonimizado) de um número E.164 pela chave HMAC. */
export async function findLeadIdByPhone(ctx: AppContext, phoneE164: string, q: Queryable = ctx.db): Promise<string | null> {
  const lead = await findLeadByDedup(q, contactDedupKey(phoneE164, ctx.config.secrets.dedupKey))
  return lead && !lead.anonymized_at ? lead.id : null
}

export async function revokeAllCommunicationTx(
  ctx: AppContext,
  tx: Queryable,
  lead: LeadRow,
  actor: LifecycleActor,
  source: string,
  now: Date,
): Promise<PreferencesChangeSummary> {
  const summary = await applyPreferencesChangeTx(ctx, tx, lead, { purposes: { launch_notice: false, marketing: false } }, actor, source, now)
  const { actorType, actorId } = actorColumns(actor)
  await recordAudit(tx, {
    actorType,
    actorId,
    action: 'lead.communication_revoked',
    resourceType: 'lead',
    resourceId: lead.id,
    metadata: { source, revoked: summary.revoked },
    ipHash: 'ipHash' in actor ? (actor.ipHash ?? null) : null,
  })
  return summary
}

/** Revoga todas as finalidades de comunicação (pedidos "sair", "pare", "não me mande"). */
export async function revokeAllCommunication(ctx: AppContext, leadId: string, actor: LifecycleActor, source: string): Promise<void> {
  const now = ctx.now()
  await ctx.db.transaction(async (tx) => {
    const lead = await findActiveLead(tx, leadId, { forUpdate: true })
    if (!lead) throw leadNotFound()
    await revokeAllCommunicationTx(ctx, tx, lead, actor, source, now)
  })
}

// Pedido de exclusão -------------------------------------------------------------------------------------

export interface DeletionRequestResult {
  requestId: string
  alreadyOpen: boolean
}

/**
 * Registra o pedido de exclusão (cumprido pela equipe de privacidade no painel). Enquanto isso,
 * todas as comunicações são revogadas: quem pediu exclusão não deve continuar recebendo avisos.
 * Pedido repetido com outro ainda aberto não cria duplicata.
 */
export async function requestDeletion(ctx: AppContext, leadId: string, actor: LifecycleActor, channel: string): Promise<DeletionRequestResult> {
  const now = ctx.now()
  return ctx.db.transaction(async (tx) => {
    const lead = await findActiveLead(tx, leadId, { forUpdate: true })
    if (!lead) throw leadNotFound()
    const open = await tx.query<{ id: string }>(
      `SELECT id FROM privacy_requests
        WHERE lead_id = $1 AND request_type = 'deletion' AND status IN ('open', 'in_progress')
        ORDER BY received_at LIMIT 1`,
      [lead.id],
    )
    let requestId = open.rows[0]?.id
    const alreadyOpen = Boolean(requestId)
    if (!requestId) {
      requestId = randomUUID()
      await tx.query(
        `INSERT INTO privacy_requests (id, request_type, lead_id, channel, status, summary, received_at, created_at, updated_at)
         VALUES ($1, 'deletion', $2, $3, 'open', $4, $5, $5, $5)`,
        [requestId, lead.id, channel, 'Pedido de exclusão dos dados feito pelo titular na página de preferências.', now],
      )
      const { actorType, actorId } = actorColumns(actor)
      await recordAudit(tx, {
        actorType,
        actorId,
        action: 'privacy.deletion_requested',
        resourceType: 'privacy_request',
        resourceId: requestId,
        metadata: { leadId: lead.id, channel },
        ipHash: 'ipHash' in actor ? (actor.ipHash ?? null) : null,
      })
      await incrementMetric(tx, now, 'deletion_requested', channel)
    }
    await revokeAllCommunicationTx(ctx, tx, lead, actor, channel, now)
    return { requestId, alreadyOpen }
  })
}

// Link seguro de preferências ----------------------------------------------------------------------------

export interface IssuedPreferencesLink {
  url: string
  expiresInSeconds: number
}

/**
 * Cria o link seguro de /preferencias para o próprio titular (uso único, `waitlist.preferencesLinkTtlSeconds`).
 * Chamado pela Bia com o número atestado pela conversa (D1): o link é devolvido à Bia, que o mostra na conversa —
 * nada é enviado por este sistema. O token vai no fragmento da URL (`/preferencias#token=…`), que o navegador não
 * envia ao servidor web; o banco guarda só o sha256.
 */
export async function issuePreferencesLink(ctx: AppContext, leadId: string, actor: LifecycleActor, source: string): Promise<IssuedPreferencesLink> {
  const now = ctx.now()
  return ctx.db.transaction(async (tx) => {
    const lead = await findActiveLead(tx, leadId, { forUpdate: true })
    if (!lead) throw leadNotFound()
    const token = randomToken(32)
    await tx.query(
      `INSERT INTO contact_access_tokens (token_hash, lead_id, purpose, expires_at, created_at)
       VALUES ($1, $2, 'preferences', $3, $4)`,
      [sha256Hex(token), lead.id, new Date(now.getTime() + PREFERENCES_LINK_TTL_SECONDS * 1000), now],
    )
    const { actorType, actorId } = actorColumns(actor)
    await recordAudit(tx, {
      actorType,
      actorId,
      action: 'contact.preferences_link_issued',
      resourceType: 'lead',
      resourceId: lead.id,
      metadata: { source },
    })
    await incrementMetric(tx, now, 'preferences_link_issued', source)
    return { url: `${ctx.config.siteUrl}/preferencias#token=${token}`, expiresInSeconds: PREFERENCES_LINK_TTL_SECONDS }
  })
}

/** Troca o token do link seguro por sessão: uso único, validade curta, cadastro ativo. */
export async function redeemPreferencesToken(
  ctx: AppContext,
  token: string,
  onRedeemed: (tx: Queryable, leadId: string) => Promise<void>,
): Promise<boolean> {
  const now = ctx.now()
  return ctx.db.transaction(async (tx) => {
    const r = await tx.query<{ lead_id: string }>(
      `UPDATE contact_access_tokens SET used_at = $2
        WHERE token_hash = $1 AND purpose = 'preferences' AND used_at IS NULL AND expires_at > $2
        RETURNING lead_id`,
      [sha256Hex(token), now],
    )
    const leadId = r.rows[0]?.lead_id
    const lead = leadId ? await findActiveLead(tx, leadId) : null
    if (!lead) return false
    await touchInteraction(tx, lead.id, now)
    await recordAudit(tx, { actorType: 'titular', action: 'contact.preferences_access', resourceType: 'lead', resourceId: lead.id })
    await onRedeemed(tx, lead.id)
    return true
  })
}
