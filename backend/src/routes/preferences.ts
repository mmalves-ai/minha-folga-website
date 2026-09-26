import { Router, type Request } from 'express'
import { z } from 'zod'
import { AppError } from '../lib/errors.js'
import { handler } from '../middleware/async.js'
import { endContactSession, issueContactSession, readContactSession } from '../middleware/contact-session.js'
import { limiter } from '../middleware/rate-limit.js'
import { parseOrThrow } from '../middleware/validate.js'
import { honeypotFilled, verifyFormToken } from '../services/anti-bot.service.js'
import {
  cityField,
  emailField,
  employmentTypeField,
  FIELD_MESSAGES,
  incomeRangeField,
  interestTopicField,
  jobTenureField,
  phoneField,
  ufField,
} from '../services/customer-data.js'
import type { EmploymentType, IncomeRange, InterestTopic, JobTenure, ProfileChange } from '../services/lead-lifecycle.js'
import { incrementMetric } from '../services/metrics.service.js'
import { OPT_OUT_RECEIVED, requestOptOut } from '../services/opt-out.service.js'
import { getPreferences, redeemPreferencesToken, requestDeletion, updatePreferences } from '../services/preferences.service.js'
import type { AppContext } from '../context.js'

const TEN_MINUTES = 10 * 60 * 1000

const TokenBody = z.strictObject({ token: z.string().min(20).max(100) })

/**
 * Titular com sessão: finalidades, tema de interesse e dados gerais não identificadores (faixas, cidade/UF,
 * e-mail opcional). CPF, telefone, nome e empregador não mudam por aqui (Bia com número atestado ou equipe de
 * privacidade).
 */
const PatchBody = z.strictObject({
  purposes: z.strictObject({ launch_notice: z.boolean().optional(), marketing: z.boolean().optional() }).optional(),
  consentVersions: z.strictObject({ launch_notice: z.string().max(100).optional(), marketing: z.string().max(100).optional() }).optional(),
  interestTopic: interestTopicField.nullable().optional(),
  employmentType: employmentTypeField.optional(),
  jobTenure: jobTenureField.optional(),
  incomeRange: incomeRangeField.optional(),
  city: cityField.optional(),
  uf: ufField.optional(),
  email: emailField.nullable().optional(),
})
const PATCH_MESSAGES: Record<string, string> = {
  interestTopic: FIELD_MESSAGES.interestTopic,
  employmentType: FIELD_MESSAGES.employmentType,
  jobTenure: FIELD_MESSAGES.jobTenure,
  incomeRange: FIELD_MESSAGES.incomeRange,
  city: FIELD_MESSAGES.city,
  uf: FIELD_MESSAGES.uf,
  email: FIELD_MESSAGES.email,
}

/** Pedido de saída sem sessão: só o número (e o anti-robô). Resposta sempre genérica. */
const OptOutBody = z.strictObject({
  phone: phoneField,
  antiBot: z.unknown().optional(),
  // Campo-armadilha (contracts/validation.json → waitlist.antiBot.honeypotField).
  website: z.string().max(500).optional(),
})

/** Rotas sem dados: o navegador envia `{}` (o originGuard exige JSON em métodos inseguros). */
const EmptyBody = z.strictObject({}).optional()

const sessionRequired = () =>
  new AppError(
    401,
    'session_required',
    'Para ver ou alterar suas preferências, peça à Bia, no WhatsApp oficial, um link seguro de acesso. Para só sair da lista, use o pedido de saída.',
  )

export function preferencesRoutes(ctx: AppContext): Router {
  const router = Router()
  const tokenLimit = limiter('preferences-token', TEN_MINUTES, 20)
  const optOutLimit = limiter('preferences-opt-out', TEN_MINUTES, 20)
  const actor = (req: Request) => ({ type: 'titular' as const, ipHash: req.ipHash })

  const requireSession = async (req: Request) => {
    const session = await readContactSession(ctx, req)
    if (!session) throw sessionRequired()
    return session
  }

  // Link seguro gerado pela Bia (token lido do fragmento da URL pelo frontend): uso único e validade curta.
  router.post(
    '/token',
    tokenLimit,
    handler(async (req, res) => {
      const body = parseOrThrow(TokenBody, req.body)
      const ok = await redeemPreferencesToken(ctx, body.token, (tx, leadId) => issueContactSession(ctx, tx, res, leadId))
      if (!ok) {
        throw new AppError(
          401,
          'invalid_or_expired_link',
          'Este link expirou ou já foi usado. Peça um novo link de acesso à Bia, no WhatsApp oficial.',
        )
      }
      res.status(200).json({ status: 'ok' })
    }),
  )

  // Pedido de saída pelo número, sem sessão (D1): 202 genérico, revoga aviso e novidades se o número existir.
  router.post(
    '/opt-out',
    optOutLimit,
    handler(async (req, res) => {
      if (honeypotFilled(req.body)) {
        await incrementMetric(ctx.db, ctx.now(), 'antibot_rejected', 'opt_out:honeypot')
        res.status(202).json({ ...OPT_OUT_RECEIVED })
        return
      }
      const body = parseOrThrow(OptOutBody, req.body, { phone: FIELD_MESSAGES.phone })
      const antiBot = await verifyFormToken(ctx, body.antiBot, 'opt_out')
      res.status(202).json(await requestOptOut(ctx, body.phone, actor(req), { antiBot, originKey: req.originHash }))
    }),
  )

  router.get(
    '/',
    handler(async (req, res) => {
      const session = await requireSession(req)
      res.json(await getPreferences(ctx, session.leadId))
    }),
  )

  router.patch(
    '/',
    handler(async (req, res) => {
      const session = await requireSession(req)
      const body = parseOrThrow(PatchBody, req.body, PATCH_MESSAGES)
      const profile: ProfileChange = {}
      if (body.employmentType !== undefined) profile.employmentType = body.employmentType as EmploymentType
      if (body.jobTenure !== undefined) profile.jobTenure = body.jobTenure as JobTenure
      if (body.incomeRange !== undefined) profile.incomeRange = body.incomeRange as IncomeRange
      if (body.city !== undefined) profile.city = body.city
      if (body.uf !== undefined) profile.uf = body.uf
      if (body.email !== undefined) profile.email = body.email
      const view = await updatePreferences(
        ctx,
        session.leadId,
        {
          purposes: body.purposes,
          consentVersions: body.consentVersions,
          interestTopic: body.interestTopic as InterestTopic | null | undefined,
          ...(Object.keys(profile).length ? { profile } : {}),
        },
        actor(req),
        'preferencias',
      )
      res.json(view)
    }),
  )

  router.post(
    '/deletion-request',
    handler(async (req, res) => {
      const session = await requireSession(req)
      parseOrThrow(EmptyBody, req.body)
      await requestDeletion(ctx, session.leadId, actor(req), 'preferencias')
      res.status(202).json({
        status: 'received',
        message:
          'Recebemos seu pedido de exclusão. A equipe de privacidade vai concluir o atendimento e, a partir de agora, você não recebe mais nossos avisos.',
      })
    }),
  )

  router.post(
    '/logout',
    handler(async (req, res) => {
      parseOrThrow(EmptyBody, req.body)
      await endContactSession(ctx, req, res)
      res.status(204).end()
    }),
  )

  return router
}
