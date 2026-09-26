import type { AppContext } from '../context.js'
import { contactDedupKey, findLeadByDedup, lockKeys } from '../repositories/leads.repo.js'
import { cleanupAntiBot, consumeFormToken, enforceFormLimits, recordFormAttempt, type VerifiedFormToken } from './anti-bot.service.js'
import type { LifecycleActor } from './lead-lifecycle.js'
import { incrementMetric } from './metrics.service.js'
import { revokeAllCommunicationTx } from './preferences.service.js'

/**
 * Pedido de saída pelo site, sem sessão (decisão D1 → Preferências): qualquer pessoa informa o número e o
 * cadastro dele (se existir) deixa de receber o aviso de abertura e as novidades. A resposta é sempre a mesma e
 * não mostra nada — nem se o número está cadastrado. Revogar é sempre seguro para o titular; conceder de novo
 * exige a Bia (número atestado) ou a sessão de /preferencias.
 * Protegido pelo anti-robô (token de uso único e prova de trabalho) e pelo limite por IP de
 * contracts/validation.json → waitlist.limits.optOutPerIpPerHour.
 */
export const OPT_OUT_RECEIVED = {
  status: 'received' as const,
  message: 'Recebemos seu pedido. Se este número estiver cadastrado, ele não vai mais receber o aviso de abertura nem as novidades da Minha Folga.',
}

export const OPT_OUT_SOURCE = 'saida_site'

export async function requestOptOut(
  ctx: AppContext,
  phoneE164: string,
  actor: LifecycleActor,
  options: { antiBot: VerifiedFormToken; originKey: string },
): Promise<typeof OPT_OUT_RECEIVED> {
  const phoneKey = contactDedupKey(phoneE164, ctx.config.secrets.dedupKey)
  const now = ctx.now()
  await cleanupAntiBot(ctx)
  await ctx.db.transaction(async (tx) => {
    await lockKeys(tx, [phoneKey])
    await consumeFormToken(ctx, tx, options.antiBot, 'opt_out')
    const attempt = { ip: options.originKey, phone: phoneKey }
    await enforceFormLimits(ctx, tx, 'opt_out', attempt)
    await recordFormAttempt(ctx, tx, 'opt_out', attempt)
    const lead = await findLeadByDedup(tx, phoneKey, { forUpdate: true })
    if (!lead || lead.anonymized_at) return
    const summary = await revokeAllCommunicationTx(ctx, tx, lead, actor, OPT_OUT_SOURCE, now)
    if (summary.revoked.length) await incrementMetric(tx, now, 'optout_site')
  })
  return { ...OPT_OUT_RECEIVED }
}
