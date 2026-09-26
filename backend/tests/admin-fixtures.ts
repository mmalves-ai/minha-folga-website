import { randomInt, randomUUID } from 'node:crypto'
import supertest from 'supertest'
import { expect } from 'vitest'
import { CONSENTS } from '../src/config/contracts.js'
import { encryptField, randomProtocol, randomToken, sha256Hex } from '../src/lib/crypto.js'
import { hashPassword } from '../src/lib/password.js'
import { phoneHint } from '../src/lib/phone.js'
import { generateTotpSecret, totpCode, totpStep } from '../src/lib/totp.js'
import { cpfKey } from '../src/lib/cpf.js'
import { contactDedupKey, insertLead as insertLeadRow, PURPOSES, upsertPreference } from '../src/repositories/leads.repo.js'
import { mfaContext } from '../src/services/admin-auth.service.js'
import type { AdminRole } from '../src/services/admin-permissions.js'
import { SUPPORT_CIPHER_CONTEXT } from '../src/services/support.service.js'
import { SITE, type TestHarness } from './helpers.js'
import { newCpf } from './lead-flow.js'

/**
 * Dados de teste da área administrativa, criados direto no banco (sem depender das rotas de cadastro).
 * Cifragem pelas mesmas funções e contextos do código de produção: o lead é gravado pelo repositório do
 * cadastro ('lead.phone:<id>'), o atendimento com SUPPORT_CIPHER_CONTEXT e o MFA com mfaContext.
 */
export const DEFAULT_PASSWORD = 'uma-senha-de-teste-longa-42'

export interface SeedUser {
  id: string
  email: string
  password: string
  role: AdminRole
  totpSecret: string | null
  /** Último passo TOTP usado pelos testes (o servidor recusa reuso). */
  lastStep: number
}

export async function seedUser(
  h: TestHarness,
  opts: { role: AdminRole; email?: string; password?: string; mfa?: boolean; mustChange?: boolean; disabled?: boolean; name?: string },
): Promise<SeedUser> {
  const id = randomUUID()
  const email = opts.email ?? `${opts.role}-${id.slice(0, 8)}@equipe.test`
  const password = opts.password ?? DEFAULT_PASSWORD
  const mfa = opts.mfa ?? true
  const secret = mfa ? generateTotpSecret() : null
  const now = h.clock.current
  await h.ctx.db.query(
    `INSERT INTO admin_users (id, email, display_name, role, password_hash, must_change_password, mfa_secret_ciphertext,
                              mfa_enabled_at, disabled_at, created_at, updated_at, password_changed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $10)`,
    [
      id,
      email,
      opts.name ?? `Pessoa ${opts.role}`,
      opts.role,
      await hashPassword(password),
      opts.mustChange ?? false,
      secret ? encryptField(secret, h.ctx.config.secrets.encryption, mfaContext(id)) : null,
      mfa ? now : null,
      opts.disabled ? now : null,
      now,
    ],
  )
  return { id, email, password, role: opts.role, totpSecret: secret, lastStep: -1 }
}

/** Código TOTP válido e ainda não usado por esta pessoa (avança o relógio de teste se preciso). */
export function nextCode(h: TestHarness, user: SeedUser, secret = user.totpSecret): string {
  if (!secret) throw new Error('pessoa sem MFA')
  let step = totpStep(h.clock.current)
  if (step <= user.lastStep) {
    h.clock.advance((user.lastStep - step + 1) * 30_000)
    step = totpStep(h.clock.current)
  }
  user.lastStep = step
  return totpCode(secret, h.clock.current)
}

export type Agent = ReturnType<typeof supertest.agent>

export interface AdminClient {
  agent: Agent
  csrf: string
  user: SeedUser
}

export function cookieToken(res: supertest.Response): string | undefined {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined
  const cookie = raw?.find((c) => c.startsWith('mf_admin='))
  return cookie?.slice('mf_admin='.length).split(';')[0] || undefined
}

/** Login completo (senha + TOTP). */
export async function signIn(h: TestHarness, user: SeedUser): Promise<AdminClient> {
  const agent = supertest.agent(h.app)
  const login = await agent.post('/api/admin/auth/login').set(SITE).send({ email: user.email, password: user.password })
  expect(login.status, JSON.stringify(login.body)).toBe(200)
  const verify = await agent
    .post('/api/admin/auth/mfa/verify')
    .set(SITE)
    .set('X-CSRF-Token', login.body.csrfToken)
    .send({ code: nextCode(h, user) })
  expect(verify.status, JSON.stringify(verify.body)).toBe(200)
  return { agent, csrf: verify.body.csrfToken, user }
}

/** Chamada autenticada com cabeçalhos do site e CSRF. */
export function call(c: AdminClient, method: 'get' | 'post' | 'patch' | 'put', path: string, body?: unknown) {
  const req = c.agent[method](`/api/admin${path}`).set(SITE).set('X-CSRF-Token', c.csrf)
  return method === 'get' ? req : req.send((body ?? {}) as object)
}

export function randomMobile(): string {
  return `+55119${String(randomInt(10_000_000, 99_999_999))}`
}

export interface SeedLead {
  id: string
  phone: string
  name: string
  dedupKey: string
  cpf: string
  cpfKey: string
  email: string | null
}

export async function insertLead(
  h: TestHarness,
  opts: {
    name?: string
    phone?: string
    employmentType?: 'clt' | 'domestico' | 'rural' | 'outro'
    jobTenure?: 'menos_3_meses' | '3_a_12_meses' | '1_a_3_anos' | 'mais_3_anos'
    incomeRange?: 'ate_2000' | '2000_a_4000' | '4000_a_7000' | 'acima_7000' | 'nao_informar'
    uf?: string
    city?: string
    cpf?: string
    email?: string | null
    employerName?: string
    state?: string
    source?: string
    verifiedAt?: Date | null
    launch?: boolean
    marketing?: boolean
    createdAt?: Date
    anonymized?: boolean
  } = {},
): Promise<SeedLead> {
  const id = randomUUID()
  const phone = opts.phone ?? randomMobile()
  const name = opts.name ?? 'Pessoa Cadastrada'
  const createdAt = opts.createdAt ?? h.clock.current
  const source = opts.source ?? 'avise-me'
  const dedupKey = contactDedupKey(phone, h.ctx.config.secrets.dedupKey)
  const cpf = opts.cpf ?? newCpf().digits
  const email = opts.email === undefined ? 'pessoa.cadastrada@exemplo-mf.com.br' : opts.email
  const verifiedAt = opts.verifiedAt === undefined ? createdAt : opts.verifiedAt
  // Mesmo caminho de escrita do cadastro: telefone, CPF, e-mail e empregador cifrados pelo repositório de leads.
  await insertLeadRow(h.ctx.db, h.ctx.config.secrets.encryption, {
    id,
    data: {
      fullName: name,
      cpf,
      phoneE164: phone,
      email,
      employerName: opts.employerName ?? 'Empresa Empregadora Ltda',
      employmentType: opts.employmentType ?? 'clt',
      jobTenure: opts.jobTenure ?? '1_a_3_anos',
      incomeRange: opts.incomeRange ?? '2000_a_4000',
      city: opts.city ?? 'São Paulo',
      uf: opts.uf ?? 'SP',
      interestTopic: null,
    },
    dedupKey,
    cpfKey: cpfKey(cpf, h.ctx.config.secrets.dedupKey),
    source,
    utm: {},
    privacyNoticeVersion: CONSENTS.notices.privacy.version,
    at: createdAt,
  })
  await h.ctx.db.query('UPDATE leads SET state = $2, contact_verified_at = $3, anonymized_at = $4 WHERE id = $1', [
    id,
    opts.state ?? (verifiedAt ? 'verified' : 'received'),
    verifiedAt,
    opts.anonymized ? createdAt : null,
  ])
  const granted = { launch_notice: opts.launch ?? true, marketing: opts.marketing ?? false }
  for (const purpose of PURPOSES) {
    await upsertPreference(h.ctx.db, id, purpose, granted[purpose], CONSENTS.purposes[purpose].version, source, createdAt)
  }
  return { id, phone, name, dedupKey, cpf, cpfKey: cpfKey(cpf, h.ctx.config.secrets.dedupKey), email }
}

export interface SeedSupport {
  id: string
  protocol: string
  contact: string
  message: string
  name: string
  trackingHash: string
}

export async function insertSupportRequest(
  h: TestHarness,
  opts: { leadId?: string; name?: string; contact?: string; message?: string; status?: string; createdAt?: Date; firstResponseAt?: Date } = {},
): Promise<SeedSupport> {
  const id = randomUUID()
  const contact = opts.contact ?? randomMobile()
  const message = opts.message ?? 'Quero entender como funciona o aviso de abertura.'
  const name = opts.name ?? 'Pessoa Solicitante'
  const protocol = randomProtocol()
  const createdAt = opts.createdAt ?? h.clock.current
  const trackingHash = sha256Hex(randomToken(32))
  const keyring = h.ctx.config.secrets.encryption
  await h.ctx.db.query(
    `INSERT INTO support_requests (id, protocol, tracking_token_hash, requester_name, contact_method, contact_ciphertext, contact_hint,
                                   subject, message_ciphertext, status, lead_id, source, created_at, updated_at, first_response_at)
     VALUES ($1, $2, $3, $4, 'whatsapp', $5, $6, 'cadastro_avisos', $7, $8, $9, 'web_form', $10, $10, $11)`,
    [
      id,
      protocol,
      trackingHash,
      name,
      encryptField(contact, keyring, SUPPORT_CIPHER_CONTEXT.contact(id)),
      phoneHint(contact),
      encryptField(message, keyring, SUPPORT_CIPHER_CONTEXT.message(id)),
      opts.status ?? 'received',
      opts.leadId ?? null,
      createdAt,
      opts.firstResponseAt ?? null,
    ],
  )
  await h.ctx.db.query(
    `INSERT INTO support_events (id, support_request_id, event_type, to_status, actor_type, created_at)
     VALUES ($1, $2, 'created', 'received', 'titular', $3)`,
    [randomUUID(), id, createdAt],
  )
  return { id, protocol, contact, message, name, trackingHash }
}

export async function auditRows(h: TestHarness, action: string) {
  const r = await h.ctx.db.query<{ actor_id: string | null; resource_id: string | null; metadata: Record<string, unknown> }>(
    'SELECT actor_id, resource_id, metadata FROM audit_log WHERE action = $1 ORDER BY created_at',
    [action],
  )
  return r.rows
}
