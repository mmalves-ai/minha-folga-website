import { Router } from 'express'
import { z } from 'zod'
import { WAITLIST_SOURCES } from '../config/contracts.js'
import { handler } from '../middleware/async.js'
import { limiter } from '../middleware/rate-limit.js'
import { parseOrThrow } from '../middleware/validate.js'
import { honeypotFilled, verifyFormToken } from '../services/anti-bot.service.js'
import {
  cityField,
  cpfField,
  emailField,
  employerField,
  employmentTypeField,
  FIELD_MESSAGES,
  fullNameField,
  incomeRangeField,
  interestTopicField,
  jobTenureField,
  phoneField,
  ufField,
} from '../services/customer-data.js'
import type { EmploymentType, IncomeRange, InterestTopic, JobTenure } from '../services/lead-lifecycle.js'
import { incrementMetric } from '../services/metrics.service.js'
import { assertWaitlistFormOpen } from '../services/collection-switch.service.js'
import { assertCurrentConsentVersions, RECEIVED, submitWaitlist } from '../services/waitlist.service.js'
import type { AppContext } from '../context.js'

const TEN_MINUTES = 10 * 60 * 1000

const utmValue = z.string().max(256)

/** Corpo estrito do cadastro (docs/DECISOES.md → Cadastro pelo site). `antiBot` é conferido à parte. */
const WaitlistBody = z.strictObject({
  fullName: fullNameField,
  cpf: cpfField,
  phone: phoneField,
  email: emailField.nullable().optional(),
  employerName: employerField,
  employmentType: employmentTypeField,
  jobTenure: jobTenureField,
  incomeRange: incomeRangeField,
  city: cityField,
  uf: ufField,
  ageConfirmed: z.literal(true),
  interestTopic: interestTopicField.nullable().optional(),
  consents: z.strictObject({ launch_notice: z.literal(true), marketing: z.boolean() }),
  consentVersions: z.strictObject({ launch_notice: z.string().max(100), marketing: z.string().max(100) }),
  source: z.enum(WAITLIST_SOURCES),
  // Chaves fora da lista são recusadas; valores fora do padrão são descartados no serviço (sanitizeUtm).
  // A lista espelha contracts/validation.json → utm.allowedParams.
  utm: z
    .strictObject({
      utm_source: utmValue.optional(),
      utm_medium: utmValue.optional(),
      utm_campaign: utmValue.optional(),
      utm_content: utmValue.optional(),
      utm_term: utmValue.optional(),
    })
    .optional(),
  antiBot: z.unknown().optional(),
  // Campo-armadilha (contracts/validation.json → waitlist.antiBot.honeypotField): preenchido nunca chega aqui.
  website: z.string().max(500).optional(),
})

const WAITLIST_MESSAGES: Record<string, string> = {
  fullName: FIELD_MESSAGES.fullName,
  cpf: FIELD_MESSAGES.cpf,
  phone: FIELD_MESSAGES.phone,
  email: FIELD_MESSAGES.email,
  employerName: FIELD_MESSAGES.employerName,
  employmentType: FIELD_MESSAGES.employmentType,
  jobTenure: FIELD_MESSAGES.jobTenure,
  incomeRange: FIELD_MESSAGES.incomeRange,
  city: FIELD_MESSAGES.city,
  uf: FIELD_MESSAGES.uf,
  ageConfirmed: FIELD_MESSAGES.ageConfirmed,
  interestTopic: FIELD_MESSAGES.interestTopic,
  consents: FIELD_MESSAGES.launchNotice,
  'consents.launch_notice': FIELD_MESSAGES.launchNotice,
  source: FIELD_MESSAGES.source,
}

export function waitlistRoutes(ctx: AppContext): Router {
  const router = Router()

  // Barreira grossa em memória por IP (inclui pedidos inválidos), folgada para redes compartilhadas (CGNAT). Os
  // limites do contrato (IP/h com dificuldade adaptativa, CPF/dia, telefone/dia) contam submissões aceitas, no
  // banco (anti-bot.service.ts).
  const submitLimit = limiter('waitlist', TEN_MINUTES, 120)

  router.post(
    '/',
    submitLimit,
    handler(async (req, res) => {
      await assertWaitlistFormOpen(ctx)
      // Campo-armadilha: sucesso genérico, nada gravado, nada ensinado ao robô.
      if (honeypotFilled(req.body)) {
        await incrementMetric(ctx.db, ctx.now(), 'antibot_rejected', 'waitlist:honeypot')
        res.status(201).json({ ...RECEIVED })
        return
      }
      const body = parseOrThrow(WaitlistBody, req.body, WAITLIST_MESSAGES)
      assertCurrentConsentVersions(body.consentVersions)
      const antiBot = await verifyFormToken(ctx, body.antiBot, 'waitlist')
      const result = await submitWaitlist(
        ctx,
        {
          data: {
            fullName: body.fullName,
            cpf: body.cpf,
            phoneE164: body.phone,
            email: body.email ?? null,
            employerName: body.employerName,
            employmentType: body.employmentType as EmploymentType,
            jobTenure: body.jobTenure as JobTenure,
            incomeRange: body.incomeRange as IncomeRange,
            city: body.city,
            uf: body.uf,
            interestTopic: (body.interestTopic ?? null) as InterestTopic | null,
          },
          consents: body.consents,
          consentVersions: body.consentVersions,
          source: body.source,
          utm: body.utm,
        },
        { type: 'titular', ipHash: req.ipHash },
        { antiBot, originKey: req.originHash },
      )
      res.status(201).json(result)
    }),
  )

  return router
}
