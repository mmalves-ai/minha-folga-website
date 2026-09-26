import { expect, test, type APIResponse, type Page, type Request, type Response } from '@playwright/test'
import consents from '../../contracts/consents.json' with { type: 'json' }
import validation from '../../contracts/validation.json' with { type: 'json' }
import {
  callBiaTool,
  decodeFormToken,
  e2eAdmins,
  proofIsValid,
  SITE_ORIGIN,
  solvedFormToken,
  totp,
  waitUsable,
  type SolvedProof,
} from './support/helpers'

/**
 * Jornadas reais contra a API isolada do e2e (PGlite; integração de entrada da Hal-AI ligada com chave aleatória).
 * Decisão D1 (docs/DECISOES.md): nenhum WhatsApp sai deste sistema — o cadastro pelo site não tem código de
 * confirmação; o telefone só fica validado quando a própria pessoa fala com a Bia (número atestado pela Hal-AI).
 * A ordem importa: os cadastros, o link da Bia e o atendimento criados aqui aparecem depois no painel.
 * Limites do contrato (waitlist.limits, D1.1): todas as jornadas saem do mesmo IP. A jornada da API leva a rede até
 * `elevatedAfterPerIpPerHour` cadastros aceitos e confere a dificuldade adaptativa (prova mais difícil em vez de 429);
 * o 429 por rede (`submissionsPerIpPerHour`) é coberto pelos testes da API.
 */
test.describe.configure({ mode: 'serial' })

interface Person {
  fullName: string
  cpf: string
  cpfDigits: string
  cpfHint: string
  phone: string
  phoneE164: string
  phoneHint: string
  email: string
  employer: string
  city: string
  uf: string
}

/** CPF com dígitos verificadores válidos a partir de 9 dígitos. */
function cpfFrom(base: string): string {
  const d = base.split('').map(Number)
  for (const len of [9, 10]) {
    const r = (d.slice(0, len).reduce((s, n, i) => s + n * (len + 1 - i), 0) * 10) % 11
    d.push(r === 10 ? 0 : r)
  }
  return d.join('')
}

function person(fullName: string, cpfDigits: string, phoneE164: string, extra: Partial<Person> = {}): Person {
  const d = phoneE164.slice(3)
  return {
    fullName,
    cpfDigits,
    cpf: `${cpfDigits.slice(0, 3)}.${cpfDigits.slice(3, 6)}.${cpfDigits.slice(6, 9)}-${cpfDigits.slice(9)}`,
    cpfHint: `***.***.***-${cpfDigits.slice(9)}`,
    phoneE164,
    phone: `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`,
    phoneHint: `(${d.slice(0, 2)}) •••••-••${d.slice(-2)}`,
    email: '',
    employer: 'Mercado Bom Preço',
    city: 'Campinas',
    uf: 'SP',
    ...extra,
  }
}

/** Titular que se cadastra pelo site, com todos os campos. */
const ANA = person('Ana Paula Ribeiro', '52998224725', '+5511987654321', {
  email: 'ana.ribeiro@example.org',
  employer: 'Padaria Estrela do Bairro',
  city: 'São Paulo',
})
/** Cadastro novo feito pela API (mesmo formato do site). */
const BRUNO = person('Bruno Carvalho Lima', '11144477735', '+5521998765432', { city: 'Niterói', uf: 'RJ' })
/** Robô: preenche o campo-armadilha. Nunca pode virar cadastro. */
const ROBO = person('Rafael Armadilha Souza', '39053344705', '+5531991234567', { city: 'Belo Horizonte', uf: 'MG' })
/** Cadastrada pela Bia no WhatsApp da Hal-AI (telefone atestado pelo canal). */
const DEBORA = person('Débora Nunes Castro', '86288366757', '+5562998761234', { employer: 'Clínica Vida Plena', city: 'Goiânia', uf: 'GO' })
const OTHER_PHONE = '+5541998887766'
const OTHER_CPF = '15350946056'
const LIMIT_PHONE = '+5551997776655'
const LIMIT_CPF = '28625587887'
/** Número sem cadastro, para o pedido de saída. */
/** Cadastros extras da rede compartilhada (CGNAT): levam a rede até o limiar da dificuldade adaptativa. */
const SHARED_NETWORK = ['Fábio Moura Leite', 'Gisele Prado Nunes', 'Heitor Campos Reis', 'Iara Fontes Duarte'].map((name, i) =>
  person(name, cpfFrom(String(410_000_000 + i * 7919)), `+55519971${String(10_000 + i)}`),
)
const ELISA = person('Elisa Barros Teixeira', '47345612813', '+5551997120099')
const UNKNOWN_PHONE = '(48) 99612-3478'

const WAITLIST_URL = '/avise-me'
const RECEIVED_TITLE = 'Cadastro recebido.'
const OPT_OUT_DONE =
  'Pedido registrado. Se este número estiver na nossa lista, ele não vai mais receber o aviso de abertura nem conteúdos e novidades da Minha Folga.'
const REVEAL_REASON = 'Retorno pedido pela titular no atendimento'
const CONSENT_VERSIONS = { launch_notice: consents.purposes.launch_notice.version, marketing: consents.purposes.marketing.version }
const JSON_HEADERS = { Origin: SITE_ORIGIN }

/** Resposta de sucesso do cadastro (a mesma para todos os casos), lida na primeira jornada. */
let received: Record<string, unknown> | null = null

const isWaitlistPost = (r: Request) => new URL(r.url()).pathname === '/api/waitlist' && r.method() === 'POST'

async function fillWaitlist(page: Page, p: Person, cpf = p.cpf) {
  await page.getByLabel('Nome completo').fill(p.fullName)
  await page.getByLabel('CPF', { exact: true }).fill(cpf)
  await page.getByLabel('WhatsApp com DDD').fill(p.phone)
  if (p.email) await page.getByLabel('E-mail').fill(p.email)
  // CPF inválido permanece na primeira etapa, sem submissão parcial.
  if (cpf !== p.cpf) return
  await page.getByRole('button', { name: 'Continuar para trabalho e avisos' }).click()
  await fillWork(page, p)
}

async function fillWork(page: Page, p: Person) {
  await page.getByLabel('Empresa onde você trabalha').fill(p.employer)
  await page.getByLabel('Tipo de vínculo de trabalho').selectOption({ label: 'CLT' })
  await page.getByLabel('Tempo no emprego atual').selectOption({ label: 'De 1 a 3 anos' })
  await page.getByLabel('Faixa de salário líquido').selectOption({ label: 'De R$ 2.000,01 a R$ 4.000' })
  await page.getByLabel('Cidade', { exact: true }).fill(p.city)
  await page.getByLabel('UF', { exact: true }).selectOption(p.uf)
  await page.getByRole('checkbox', { name: 'Tenho 18 anos ou mais' }).check()
  await page.getByRole('checkbox', { name: consents.purposes.launch_notice.text, includeHidden: true }).check()
}

/** Corpo de POST /api/waitlist (docs/DECISOES.md → Cadastro pelo site). */
function waitlistBody(p: Person, proof?: SolvedProof, extra: Record<string, unknown> = {}) {
  return {
    fullName: p.fullName,
    cpf: p.cpfDigits,
    phone: p.phoneE164,
    employerName: p.employer,
    employmentType: 'clt',
    jobTenure: '3_a_12_meses',
    incomeRange: 'nao_informar',
    city: p.city,
    uf: p.uf,
    ageConfirmed: true,
    consents: { launch_notice: true, marketing: false },
    consentVersions: CONSENT_VERSIONS,
    source: 'avise-me',
    ...(proof ? { antiBot: proof.antiBot } : {}),
    ...extra,
  }
}

async function errorCode(res: APIResponse): Promise<string> {
  return ((await res.json()) as { error?: { code?: string } }).error?.code ?? ''
}

async function biaResult(res: APIResponse): Promise<Record<string, any>> {
  expect(res.status(), await res.text()).toBe(200)
  const body = (await res.json()) as { ok: boolean; result: Record<string, any> }
  expect(body.ok).toBe(true)
  return body.result
}

test('cadastro pelo /avise-me: todos os campos, prova de trabalho no navegador, CPF inválido com foco e envio único', async ({ page }) => {
  const workers: string[] = []
  const tokenRequests: string[] = []
  const submissions: Request[] = []
  page.on('worker', (w) => workers.push(w.url()))
  page.on('request', (r) => {
    if (new URL(r.url()).pathname === '/api/form-token') tokenRequests.push(r.url())
    if (isWaitlistPost(r)) submissions.push(r)
  })

  await page.goto(WAITLIST_URL)
  const next = page.getByRole('button', { name: 'Continuar para trabalho e avisos' })
  const submit = page.getByRole('button', { name: 'Quero entrar na fila', exact: true })

  // Sem campo de código de confirmação (a pergunta do FAQ sobre código continua, com a resposta "Não").
  await expect(page.getByRole('textbox', { name: /código/i })).toHaveCount(0)

  // Envio vazio: foco no primeiro campo inválido e mensagens associadas.
  await next.click()
  await expect(page.getByLabel('Nome completo')).toBeFocused()
  await expect(page.getByText('Informe seu nome completo.')).toBeVisible()
  await expect(page.getByText('Informe seu CPF.')).toBeVisible()
  await expect(page.getByLabel('Empresa onde você trabalha')).not.toBeVisible()

  // Consentimentos separados e desmarcados; marketing opcional recusado não impede o cadastro.
  await expect(page.locator('input[name="launch_notice"]')).not.toBeChecked()
  await expect(page.locator('input[name="marketing"]')).not.toBeChecked()

  // Primeira etapa preenchida, mas CPF com dígito verificador errado: foco no CPF, nada enviado.
  await fillWaitlist(page, ANA, '529.982.247-24')
  await next.click()
  const cpf = page.getByLabel('CPF', { exact: true })
  await expect(cpf).toBeFocused()
  await expect(page.getByText('Confira o CPF.')).toBeVisible()
  await expect(cpf).toHaveAttribute('aria-invalid', 'true')
  await expect(cpf).toHaveAttribute('aria-describedby', /erro/)
  expect(submissions, 'CPF inválido não chega ao servidor').toHaveLength(0)

  // Corrigido o CPF, clique duplo: um único envio.
  await cpf.fill(ANA.cpf)
  await expect(page.getByText('Confira o CPF.')).toHaveCount(0)
  await next.click()
  await fillWork(page, ANA)
  const response = page.waitForResponse((r) => isWaitlistPost(r.request()))
  await submit.dblclick()
  const res = await response
  expect(res.status()).toBe(201)
  received = (await res.json()) as Record<string, unknown>
  expect(received.status).toBe('received')

  await expect(page).toHaveURL(/\/cadastro-confirmado$/)
  await expect(page.getByRole('heading', { level: 1, name: RECEIVED_TITLE })).toBeVisible()
  // Telefone "não validado" até a pessoa falar com a Bia; sem canal configurado, nada de link de WhatsApp.
  await expect(page.getByRole('heading', { name: 'Seu telefone ainda não está validado' })).toBeVisible()
  await expect(page.locator('a[href*="wa.me"]')).toHaveCount(0)
  expect(submissions, 'clique duplo não pode gerar dois envios').toHaveLength(1)

  // Nenhum dado pessoal na URL nem no armazenamento do navegador.
  expect(page.url()).not.toMatch(/98765|4321|52998224725|529\.982/)
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }))
  for (const secret of [ANA.cpfDigits, ANA.cpf, '98765', ANA.email, ANA.employer]) expect(stored).not.toContain(secret)

  // Corpo enviado: todos os campos no formato do contrato, campo-armadilha vazio e prova de trabalho real.
  const body = submissions[0]!.postDataJSON() as Record<string, any>
  expect(body).toMatchObject({
    fullName: ANA.fullName,
    cpf: ANA.cpfDigits,
    phone: ANA.phoneE164,
    email: ANA.email,
    employerName: ANA.employer,
    employmentType: 'clt',
    jobTenure: '1_a_3_anos',
    incomeRange: '2000_a_4000',
    city: ANA.city,
    uf: ANA.uf,
    ageConfirmed: true,
    consents: { launch_notice: true, marketing: false },
    consentVersions: CONSENT_VERSIONS,
    source: 'avise-me',
  })
  expect(body.website ?? '').toBe('')
  const token = decodeFormToken(body.antiBot.token)
  expect(token.d).toBeGreaterThanOrEqual(validation.waitlist.antiBot.difficultyBits)
  expect(String(body.antiBot.nonce)).toMatch(/^\d+$/)
  expect(proofIsValid(token.c, String(body.antiBot.nonce), token.d), 'nonce resolve o desafio').toBe(true)
  expect(tokenRequests.length, 'desafio pedido ao servidor').toBeGreaterThanOrEqual(1)
  expect(workers.some((u) => /pow\.worker/.test(u)), `prova calculada no Web Worker (${workers.join(', ')})`).toBe(true)
})

test('campo-armadilha preenchido: sucesso genérico e nenhum cadastro criado', async ({ page, request }) => {
  await page.goto(WAITLIST_URL)
  await fillWaitlist(page, ROBO)
  // Robô que preenche tudo, inclusive o campo que pessoas não veem.
  await page.locator('form input[name="website"]').fill('https://oferta.example', { force: true })
  const response = page.waitForResponse((r) => isWaitlistPost(r.request()))
  await page.getByRole('button', { name: 'Quero entrar na fila' }).click()
  const res = await response
  expect(res.request().postDataJSON().website).toBe('https://oferta.example')
  expect(res.status()).toBe(201)
  expect(await res.json(), 'mesma resposta de um cadastro real').toEqual(received)
  await expect(page).toHaveURL(/\/cadastro-confirmado$/)

  // Robô direto na API, sem nem resolver a prova: mesma resposta, nada gravado.
  const direct = await request.post('/api/waitlist', { data: waitlistBody(ROBO, undefined, { website: 'x' }), headers: JSON_HEADERS })
  expect(direct.status()).toBe(201)
  expect(await direct.json()).toEqual(received)

  // Nenhum cadastro com esse número (a Bia não encontra; o painel confere de novo mais adiante).
  const status = await biaResult(await callBiaTool(request, 'get_customer_status', { senderPhone: ROBO.phoneE164, senderVerified: true }))
  expect(status.status).toBe('not_registered')
})

test('API: anti-robô, resposta idêntica para CPF ou telefone já cadastrados e limite por IP', async ({ request }) => {
  const post = (data: unknown) => request.post('/api/waitlist', { data, headers: JSON_HEADERS })

  // CPF inválido: erro de campo com a mensagem do contrato (antes de qualquer token).
  const badCpf = await post(waitlistBody({ ...BRUNO, cpfDigits: '11144477734' }))
  expect(badCpf.status()).toBe(400)
  const badCpfBody = await badCpf.json()
  expect(badCpfBody.error.code).toBe('validation_error')
  expect(badCpfBody.error.fields.cpf).toBe('Confira o CPF.')

  // Sem prova de trabalho, prova errada ou token novo demais: 400 form_expired, nada gravado.
  const noProof = await post(waitlistBody(BRUNO))
  expect(noProof.status()).toBe(400)
  expect(await errorCode(noProof)).toBe('form_expired')
  const young = await solvedFormToken(request)
  const tooYoung = await post(waitlistBody(BRUNO, young))
  expect(await errorCode(tooYoung), 'token mais novo que minFillSeconds').toBe('form_expired')

  const proofs = await Promise.all(Array.from({ length: 6 }, () => solvedFormToken(request)))
  await waitUsable([young, ...proofs])
  const wrongNonce = await post(waitlistBody(BRUNO, { ...young, antiBot: { token: young.antiBot.token, nonce: String(Number(young.antiBot.nonce) + 1) } }))
  // O nonce seguinte quase nunca resolve o desafio; se resolver, a prova é aceita e o teste perde o sentido.
  if (!proofIsValid(decodeFormToken(young.antiBot.token).c, String(Number(young.antiBot.nonce) + 1), validation.waitlist.antiBot.difficultyBits)) {
    expect(await errorCode(wrongNonce), 'prova de trabalho errada').toBe('form_expired')
  }

  // Mesmo CPF e telefone da Ana, CPF da Ana com outro número, telefone da Ana com outro CPF e um cadastro novo:
  // todos recebem exatamente a mesma resposta (não revela quem já está cadastrado).
  const cases = [
    { label: 'CPF e telefone já cadastrados', body: waitlistBody({ ...ANA, fullName: 'Ana Paula Outra', employer: 'Empresa Trocada' }, proofs[0]) },
    { label: 'CPF já cadastrado, outro telefone', body: waitlistBody({ ...ANA, phoneE164: OTHER_PHONE }, proofs[1]) },
    { label: 'telefone já cadastrado, outro CPF', body: waitlistBody({ ...ANA, cpfDigits: OTHER_CPF }, proofs[2]) },
    { label: 'cadastro novo', body: waitlistBody(BRUNO, proofs[3]) },
  ]
  for (const c of cases) {
    const res = await post(c.body)
    expect(res.status(), c.label).toBe(201)
    expect(await res.json(), c.label).toEqual(received)
  }

  // Token de uso único: reapresentar um já usado não passa.
  const reused = await post(waitlistBody(person('Carla Mendes Rocha', LIMIT_CPF, LIMIT_PHONE), proofs[0]))
  expect(await errorCode(reused), 'token reutilizado').toBe('form_expired')

  // Rede compartilhada (CGNAT, D1.1): até aqui, 5 cadastros aceitos deste IP (Ana pelo navegador + 4 casos). Mais
  // 4 + Carla levam a rede ao limiar: nada de 429, mas os tokens novos saem com a prova mais difícil, e um token
  // fácil emitido antes disso (proofs[4]) vira form_expired — o site pegaria outro e reenviaria.
  const { elevatedAfterPerIpPerHour, submissionsPerIpPerHour } = validation.waitlist.limits
  const { difficultyBits, elevatedDifficultyBits } = validation.waitlist.antiBot
  expect(elevatedAfterPerIpPerHour).toBe(5 + SHARED_NETWORK.length + 1)
  expect(submissionsPerIpPerHour).toBeGreaterThan(elevatedAfterPerIpPerHour)
  const fillerProofs = await Promise.all(SHARED_NETWORK.map(() => solvedFormToken(request)))
  await waitUsable(fillerProofs)
  for (const [i, p] of SHARED_NETWORK.entries()) {
    expect(decodeFormToken(fillerProofs[i]!.antiBot.token).d).toBe(difficultyBits)
    expect((await post(waitlistBody(p, fillerProofs[i]))).status(), p.fullName).toBe(201)
  }
  const carla = await post(waitlistBody(person('Carla Mendes Rocha', LIMIT_CPF, LIMIT_PHONE), proofs[5]))
  expect(carla.status(), 'no limiar ainda não há 429').toBe(201)
  const stale = await post(waitlistBody(ELISA, proofs[4]))
  expect(await errorCode(stale), 'token fácil emitido antes do limiar').toBe('form_expired')
  const hard = await solvedFormToken(request)
  expect(decodeFormToken(hard.antiBot.token).d, 'prova mais difícil para a rede').toBe(elevatedDifficultyBits)
  await waitUsable([hard])
  expect((await post(waitlistBody(ELISA, hard))).status()).toBe(201)

  // O site não sobrescreve o cadastro existente: a Bia (número atestado) ainda vê os dados da primeira submissão.
  const ana = await biaResult(await callBiaTool(request, 'get_customer_status', { senderPhone: ANA.phoneE164, senderVerified: true }))
  expect(ana.status).toBe('registered')
  expect(ana.contactVerified, 'cadastro pelo site fica com telefone não validado').toBe(false)
  expect(ana.customer.employerName).toBe(ANA.employer)
  expect(ana.customer.cpfHint).toBe(ANA.cpfHint)
  expect(JSON.stringify(ana)).not.toContain(ANA.cpfDigits)
})

let preferencesUrl = ''

test('Bia (Hal-AI): cadastro pelo telefone atestado e link seguro de preferências de uso único', async ({ page, request }) => {
  const issue = (call: Parameters<typeof callBiaTool>[2]) => callBiaTool(request, 'issue_preferences_link', call)

  // Sem a chave de entrada da Hal-AI, ou com chave errada, nada responde.
  const noKey = await request.post('/api/agent/tools/issue_preferences_link', {
    data: { conversationRef: 'e2e-sem-chave', senderPhone: ANA.phoneE164, senderVerified: true, input: {} },
  })
  expect(noKey.status()).toBe(401)
  expect(await errorCode(noKey)).toBe('invalid_api_key')
  const wrongKey = await issue({ apiKey: 'chave-errada-'.padEnd(43, 'x'), senderPhone: ANA.phoneE164, senderVerified: true })
  expect(wrongKey.status()).toBe(401)
  // Sem o atestado do canal (preenchido pela plataforma, nunca pelo modelo): recusado.
  const unverified = await issue({ senderPhone: ANA.phoneE164 })
  expect(unverified.status()).toBe(403)
  expect(await errorCode(unverified)).toBe('sender_not_verified')
  // Número sem cadastro: resposta própria, sem link.
  const unknown = await biaResult(await issue({ senderPhone: ROBO.phoneE164, senderVerified: true }))
  expect(unknown.status).toBe('not_registered')
  expect(unknown.url).toBeUndefined()

  // A Bia cadastra quem está falando com ela no WhatsApp da Hal-AI: telefone já validado pelo canal.
  const created = await biaResult(
    await callBiaTool(request, 'upsert_customer', {
      senderPhone: DEBORA.phoneE164,
      senderVerified: true,
      input: {
        fullName: DEBORA.fullName,
        cpf: DEBORA.cpfDigits,
        employerName: DEBORA.employer,
        employmentType: 'clt',
        jobTenure: 'mais_3_anos',
        incomeRange: '4000_a_7000',
        city: DEBORA.city,
        uf: DEBORA.uf,
        ageConfirmed: true,
        consents: { launch_notice: true, marketing: true },
        consentVersions: CONSENT_VERSIONS,
      },
    }),
  )
  expect(created.status).toBe('created')
  expect(created.contactVerified).toBe(true)
  expect(created.customer.cpfHint).toBe(DEBORA.cpfHint)

  // Quando a Ana fala com a Bia, o número dela passa a ser validado (sem mudar os dados do site).
  const updated = await biaResult(
    await callBiaTool(request, 'upsert_customer', { senderPhone: ANA.phoneE164, senderVerified: true, input: { interestTopic: 'entender_portabilidade' } }),
  )
  expect(updated.status).toBe('updated')
  expect(updated.contactVerified).toBe(true)
  expect(updated.customer.employerName).toBe(ANA.employer)

  // Link seguro para a própria Ana.
  const issued = await biaResult(await issue({ senderPhone: ANA.phoneE164, senderVerified: true }))
  expect(issued.status).toBe('issued')
  expect(issued.expiresInSeconds).toBe(validation.waitlist.preferencesLinkTtlSeconds)
  expect(issued.url).toMatch(new RegExp(`^${SITE_ORIGIN.replace(/\./g, '\\.')}/preferencias#token=[A-Za-z0-9_-]{20,}$`))
  preferencesUrl = issued.url as string

  await page.goto(preferencesUrl)
  await expect(page.locator('#preferencias-titulo')).toContainText('Ana')
  // O token sai da barra de endereço na hora.
  await expect.poll(() => page.evaluate(() => window.location.href)).not.toContain('token=')

  // Dados só mascarados; telefone já validado pela Bia.
  await expect(page.getByText(ANA.phoneHint).first()).toBeVisible()
  await expect(page.getByText(ANA.cpfHint)).toBeVisible()
  await expect(page.getByText(ANA.employer)).toBeVisible()
  await expect(page.getByText(/Validado pela Bia/).first()).toBeVisible()
  const html = await page.content()
  for (const secret of [ANA.phone, ANA.cpf, ANA.cpfDigits, ANA.email]) expect(html).not.toContain(secret)

  // Sair da lista de aviso.
  const launch = page.getByRole('checkbox', { name: consents.purposes.launch_notice.text })
  await expect(launch).toBeChecked()
  await page.getByRole('button', { name: 'Sair da lista de aviso' }).click()
  await expect(page.getByText('Pronto. Você saiu da lista de aviso.', { exact: false })).toBeVisible()
  await expect(launch).not.toBeChecked()

  // Encerrar a sessão: sem sessão, nenhuma informação do cadastro.
  await page.getByRole('button', { name: 'Encerrar sessão' }).click()
  await expect(page.getByText('Sessão encerrada neste navegador.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Peça seu link seguro à Bia' })).toBeVisible()
  await expect(page.locator('#preferencias-titulo')).toHaveCount(0)
  await expect(page.getByText(ANA.phoneHint)).toHaveCount(0)

  // Uso único: o mesmo link não abre outra sessão.
  await page.goto('/')
  await page.goto(preferencesUrl)
  await expect(page.getByText('Este link de preferências expirou ou já foi usado. Peça um novo link à Bia.')).toBeVisible()
  await expect(page.locator('#preferencias-titulo')).toHaveCount(0)
})

test('pedido de saída pelo número: resposta genérica, sem revelar se o número está cadastrado', async ({ page, request }) => {
  const responses: Response[] = []
  page.on('response', (r) => {
    if (new URL(r.url()).pathname === '/api/preferences/opt-out') responses.push(r)
  })
  await page.goto('/preferencias')
  await expect(page.getByRole('heading', { name: 'Pedir saída das comunicações' })).toBeVisible()
  const phone = page.getByLabel('WhatsApp com DDD')
  const done = page.getByText(OPT_OUT_DONE)

  await phone.fill(BRUNO.phone)
  await page.getByRole('button', { name: 'Pedir saída', exact: true }).click()
  await expect(done).toBeVisible()
  await expect(page.locator('.optout__done'), 'foco na confirmação').toBeFocused()

  await page.getByRole('button', { name: 'Pedir saída para outro número' }).click()
  await expect(phone).toBeFocused()
  await phone.fill(UNKNOWN_PHONE)
  await page.getByRole('button', { name: 'Pedir saída', exact: true }).click()
  await expect(done).toBeVisible()

  // Cadastrado ou não, a API responde igual (202 genérico, com prova de trabalho feita no navegador).
  expect(responses.map((r) => r.status())).toEqual([202, 202])
  expect(await responses[0]!.json()).toEqual(await responses[1]!.json())
  for (const r of responses) {
    const body = r.request().postDataJSON() as { antiBot: { token: string; nonce: string } }
    const t = decodeFormToken(body.antiBot.token)
    expect(proofIsValid(t.c, String(body.antiBot.nonce), t.d)).toBe(true)
  }
  await expect(page.getByText(BRUNO.fullName)).toHaveCount(0)

  // O número cadastrado deixou de receber o aviso e as novidades.
  const bruno = await biaResult(await callBiaTool(request, 'get_customer_status', { senderPhone: BRUNO.phoneE164, senderVerified: true }))
  expect(bruno.purposes).toEqual({ launch_notice: false, marketing: false })
})

let trackingUrl = ''

test('atendimento: solicitação persistida, protocolo e acompanhamento por link seguro', async ({ page, request }) => {
  await page.goto('/atendimento')
  await expect(page.getByText('Não envie CPF, documentos, senhas ou dados bancários.').first()).toBeVisible()
  await page.getByLabel('Nome', { exact: true }).fill('Carla')
  await page.getByLabel('E-mail para resposta').fill('carla@example.org')
  await page.getByLabel('Assunto').selectOption({ label: 'Cadastro e avisos' })
  await page.getByLabel('Mensagem').fill('Quero entender como funciona o aviso de abertura da operação.')
  await page.getByRole('button', { name: 'Enviar solicitação' }).click()

  await expect(page.getByText('Recebemos sua solicitação.')).toBeVisible()
  const protocol = (await page.getByText(/MF-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{2}/).first().textContent())!.match(/MF-[0-9A-Z-]+/)![0]
  trackingUrl = (await page.getByRole('link', { name: /Acompanhar agora/ }).getAttribute('href'))!
  expect(trackingUrl).toContain(`#p=${protocol}`)

  // O protocolo sozinho não autoriza leitura.
  const denied = await request.get(`/api/support/${protocol}`, { headers: { 'X-Support-Token': 'x'.repeat(43) } })
  expect(denied.status()).toBe(404)

  await page.goto(trackingUrl)
  await expect(page.getByText(protocol).first()).toBeVisible()
  await expect(page.getByText(/Recebid/).first()).toBeVisible()
  expect(page.url()).not.toContain('&t=') // token removido da barra de endereço
})

async function firstLogin(page: Page, who: { email: string; password: string }) {
  await page.goto('/admin')
  await page.getByLabel('E-mail').fill(who.email)
  await page.getByLabel('Senha', { exact: true }).fill(who.password)
  await page.getByRole('button', { name: 'Continuar' }).click()
  await expect(page.getByRole('heading', { name: 'Cadastre o autenticador' })).toBeVisible()
  const secret = ((await page.locator('.login__secret-code').textContent()) ?? '').replace(/\s+/g, '')
  expect(secret).toMatch(/^[A-Z2-7]{16,}$/)
  await page.getByLabel(/código/i).fill(totp(secret))
  await page.getByRole('button', { name: /confirmar|ativar|concluir/i }).first().click()
  // Troca obrigatória de senha no primeiro acesso.
  await expect(page.getByRole('heading', { name: 'Minha conta' })).toBeVisible()
}

test('painel: senha temporária, MFA, troca de senha, cadastros mascarados e revelação auditada', async ({ page }) => {
  const { admin } = e2eAdmins()
  await page.goto('/admin')
  await page.getByLabel('E-mail').fill(admin.email)
  await page.getByLabel('Senha', { exact: true }).fill('senha-errada-123456')
  await page.getByRole('button', { name: 'Continuar' }).click()
  await expect(page.getByText('E-mail ou senha incorretos.')).toBeVisible()

  await firstLogin(page, admin)
  const newPassword = 'Nova-senha-e2e-2026!'
  await page.getByLabel(/Senha atual/).fill(admin.password)
  await page.getByLabel('Nova senha', { exact: true }).fill(newPassword)
  await page.getByLabel('Confirme a nova senha').fill(newPassword)
  await page.getByRole('button', { name: /trocar|salvar|alterar/i }).first().click()
  await expect(page.getByRole('status').or(page.getByText(/senha (foi )?alterada|atualizada/i)).first()).toBeVisible()

  // Cadastros: Ana (site), Bruno (API), Débora (Bia) e os 6 da rede compartilhada (API). O robô do campo-armadilha não
  // existe.
  await page.getByRole('link', { name: 'Cadastros' }).click()
  const table = page.getByRole('table')
  await expect(table).toBeVisible()
  await expect(page.locator('#leads-caption')).toContainText(`${3 + SHARED_NETWORK.length + 2} resultados`)
  await expect(table.getByRole('link', { name: ANA.fullName })).toBeVisible()
  await expect(table.getByRole('link', { name: BRUNO.fullName })).toBeVisible()
  await expect(table.getByRole('link', { name: DEBORA.fullName })).toBeVisible()
  await expect(page.getByText(ROBO.fullName)).toHaveCount(0)
  await expect(page.getByText('Ana Paula Outra')).toHaveCount(0) // reenvio pelo site não sobrescreve
  // Contato sempre mascarado; os três reenvios da Ana ficaram guardados para revisão.
  const anaRow = page.getByRole('row').filter({ has: page.getByRole('link', { name: ANA.fullName }) })
  await expect(anaRow.getByText(ANA.phoneHint)).toBeVisible()
  await expect(anaRow.getByText('3 submissões em revisão')).toBeVisible()
  await expect(anaRow.getByText('Validado pela Bia')).toBeVisible()
  const brunoRow = page.getByRole('row').filter({ has: page.getByRole('link', { name: BRUNO.fullName }) })
  await expect(brunoRow.getByText('Não validado')).toBeVisible()
  for (const secret of [ANA.phone, ANA.cpf, BRUNO.phone, BRUNO.cpf]) await expect(page.getByText(secret)).toHaveCount(0)

  // Detalhe: CPF mascarado; revelar exige justificativa e fica na auditoria.
  await table.getByRole('link', { name: ANA.fullName }).click()
  await expect(page.getByRole('heading', { level: 1, name: ANA.fullName })).toBeVisible()
  await expect(page.getByText(ANA.employer).first()).toBeVisible()
  const contact = page.getByRole('region', { name: 'Contato e documento' })
  await expect(contact.getByText(ANA.cpfHint)).toBeVisible()
  await expect(contact.getByText(ANA.phoneHint)).toBeVisible()
  await expect(page.getByText(ANA.cpf)).toHaveCount(0)

  await contact.getByRole('button', { name: 'Revelar contato' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Revelar contato' }).click()
  await expect(dialog.getByText('Escreva a justificativa com pelo menos 5 caracteres.')).toBeVisible()
  await expect(dialog.getByLabel('Justificativa')).toBeFocused()
  await dialog.getByLabel('Justificativa').fill(REVEAL_REASON)
  await dialog.getByRole('button', { name: 'Revelar contato' }).click()
  await expect(dialog).toBeHidden()
  await expect(contact.getByText(ANA.cpf)).toBeVisible()
  await expect(contact.getByText(ANA.phone)).toBeVisible()
  await expect(contact.getByText(ANA.email)).toBeVisible()
  await contact.getByRole('button', { name: 'Ocultar contato' }).click()
  await expect(page.getByText(ANA.cpf)).toHaveCount(0)
  await expect(contact.getByRole('button', { name: 'Revelar contato' })).toBeFocused()

  // Auditoria: quem revelou, com a justificativa, sem o dado revelado; e o link emitido pela Bia.
  await page.getByRole('link', { name: 'Auditoria' }).click()
  const revealRow = page.getByRole('row').filter({ hasText: 'admin.lead_contact_revealed' }).first()
  await expect(revealRow).toBeVisible()
  await expect(revealRow).toContainText(REVEAL_REASON)
  await expect(revealRow).toContainText('Admin E2E')
  await expect(page.getByRole('row').filter({ hasText: 'contact.preferences_link_issued' }).first()).toBeVisible()
  for (const secret of [ANA.phone, ANA.cpf, ANA.cpfDigits, ANA.email]) await expect(page.getByText(secret)).toHaveCount(0)

  // Atendimentos: a solicitação do teste anterior está na fila e muda de status com registro.
  await page.getByRole('link', { name: 'Atendimentos' }).click()
  await page.getByRole('link', { name: /MF-/ }).first().click()
  await expect(page.getByText('Quero entender como funciona o aviso de abertura da operação.')).toBeVisible()
  await page.getByRole('button', { name: 'Assumir' }).click()
  await expect(page.getByLabel('Pessoa da equipe')).toHaveValue(/.+/)
  await page.getByRole('button', { name: 'Iniciar atendimento' }).click()
  const status = page.getByRole('region', { name: 'Status' })
  await expect(status.getByText('Em andamento', { exact: true })).toBeVisible()
  // A mudança fica registrada com responsável e horário na linha do tempo.
  await expect(page.getByText(/Admin E2E/).first()).toBeVisible()
})

test('painel: perfil de marketing vê só métricas agregadas; a API nega o resto', async ({ page, request }) => {
  const res = await request.get('/api/admin/leads')
  expect(res.status(), 'sem sessão').toBe(401)
  const { marketing } = e2eAdmins()
  await firstLogin(page, marketing)
  await expect(page.getByRole('link', { name: 'Cadastros' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Atendimentos' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Auditoria' })).toHaveCount(0)
  // Mesmo com a sessão do navegador, a API aplica a permissão.
  const api = await page.evaluate(async () => {
    const leads = await fetch('/api/admin/leads', { credentials: 'same-origin' })
    const audit = await fetch('/api/admin/audit', { credentials: 'same-origin' })
    return [leads.status, audit.status]
  })
  for (const s of api) expect([401, 403]).toContain(s)
})

test('teclado: menu móvel acessível e link para pular ao conteúdo', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Pular para o conteúdo' })).toBeFocused()
  const toggle = page.locator('button[aria-controls="menu-principal-movel"]')
  const panel = page.locator('#menu-principal-movel')
  const panelLink = (name: string) => panel.getByRole('link', { name, exact: true })
  const destinations = ['Início', 'A Minha Folga', 'Soluções', 'Como funciona', 'Bia', 'Conteúdos', 'Ajuda', 'Quero entrar na fila']

  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(panel).toBeVisible()

  // O painel cobre da base do cabeçalho até o fim da janela (toBeVisible não detecta corte por overflow).
  const header = (await page.locator('header.site-header').boundingBox())!
  const box = (await panel.boundingBox())!
  expect(Math.abs(box.y - (header.y + header.height)), 'painel começa na base do cabeçalho').toBeLessThanOrEqual(2)
  expect(Math.abs(box.y + box.height - 844), 'painel vai até o fim da janela').toBeLessThanOrEqual(1)

  // Todos os destinos e o CTA aparecem inteiros, dentro do painel e da janela, sem nada por cima.
  for (const name of destinations) {
    const link = panelLink(name)
    const b = (await link.boundingBox())!
    expect(b.y, `${name}: topo visível`).toBeGreaterThanOrEqual(box.y)
    expect(b.y + b.height, `${name}: base dentro do painel`).toBeLessThanOrEqual(box.y + box.height)
    expect(b.y + b.height, `${name}: base dentro da janela`).toBeLessThanOrEqual(844)
    const onTop = await link.evaluate((el) => {
      const r = el.getBoundingClientRect()
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return !!hit && (hit === el || el.contains(hit))
    })
    expect(onTop, `${name}: pode ser tocado`).toBe(true)
  }

  // Fundo inerte enquanto o painel está aberto (leitor de tela não percorre o conteúdo encoberto).
  for (const selector of ['.skip-link', '#conteudo', 'footer.site-footer']) {
    await expect(page.locator(selector)).toHaveAttribute('inert', '')
  }

  // Ciclo de Tab preso no menu: destinos → CTA → Fechar → Início.
  for (const name of destinations) {
    await expect(panelLink(name)).toBeFocused()
    await page.keyboard.press('Tab')
  }
  await expect(toggle).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(panelLink('Início')).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(toggle).toBeFocused()
  await expect(panel).toBeHidden()
  await expect(page.locator('#conteudo')).not.toHaveAttribute('inert', '')

  // Zoom de 200% (janela de 1280×800 vira 640×400 px CSS): o painel ocupa a altura disponível e
  // rola por dentro; o foco leva o CTA para dentro da janela.
  await page.setViewportSize({ width: 640, height: 400 })
  await toggle.click()
  const zoomed = (await panel.boundingBox())!
  expect(Math.abs(zoomed.y + zoomed.height - 400), 'painel vai até o fim da janela com zoom').toBeLessThanOrEqual(1)
  for (let i = 0; i < destinations.length - 1; i++) await page.keyboard.press('Tab')
  const cta = panelLink('Quero entrar na fila')
  await expect(cta).toBeFocused()
  const ctaBox = (await cta.boundingBox())!
  expect(ctaBox.y).toBeGreaterThanOrEqual(zoomed.y)
  expect(ctaBox.y + ctaBox.height).toBeLessThanOrEqual(400)
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
})

test('botão flutuante: com os canais desligados não aparece, e nada da Hal-AI ou do WhatsApp é carregado', async ({ page }) => {
  const external: string[] = []
  page.on('request', (r) => {
    const url = new URL(r.url())
    if (url.protocol.startsWith('http') && url.origin !== SITE_ORIGIN) external.push(url.origin)
  })
  for (const path of ['/', WAITLIST_URL, '/bia', '/atendimento', '/preferencias', '/seguranca', '/cadastro-confirmado']) {
    await page.goto(path)
    // Espera a aplicação montar: o botão só existiria depois disso.
    await page.waitForFunction(() => Boolean((document.querySelector('#app') as { __vue_app__?: unknown } | null)?.__vue_app__))
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    // Pedido de abertura vindo de outra tela (ex.: CTA da página /bia) também não mostra nada.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('mf:open-contact', { detail: { target: 'webchat' } })))
    await expect(page.locator('.floating-contact'), path).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Conversar com a Minha Folga' }), path).toHaveCount(0)
    await expect(page.locator('a[href*="wa.me"], a[href*="api.whatsapp.com"]'), path).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.classList.contains('mf-floating-contact')), path).toBe(false)
  }
  expect(external, 'nenhuma origem externa carregada sem clique').toEqual([])
})
