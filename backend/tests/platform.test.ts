import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ConfigError, loadConfig } from '../src/config/index.js'
import { createTestHarness, SITE, TEST_ENV, type TestHarness } from './helpers.js'

let h: TestHarness
beforeAll(async () => {
  h = await createTestHarness()
})
afterAll(async () => {
  await h.close()
})

describe('plataforma', () => {
  it('health responde estado mínimo, sem detalhes', async () => {
    const res = await h.api.get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok' })
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.headers['x-powered-by']).toBeUndefined()
  })

  it('prontidão interna exige token e não aparece sem ele', async () => {
    expect((await h.api.get('/api/internal/ready')).status).toBe(404)
    const ok = await h.api.get('/api/internal/ready').set('x-readiness-token', TEST_ENV.READINESS_TOKEN!)
    expect(ok.status).toBe(200)
    expect(ok.body.checks.database).toBe('ok')
    expect(ok.body.checks.migrations).toBe('ok')
    // D1: sem provedor de mensagens, não há verificação de mensageria.
    expect(Object.keys(ok.body.checks).sort()).toEqual(['database', 'migrations'])
  })

  it('rota de API inexistente retorna 404 em JSON (nunca HTML da home)', async () => {
    const res = await h.api.get('/api/nao-existe')
    expect(res.status).toBe(404)
    expect(res.headers['content-type']).toMatch(/application\/json/)
    expect(res.body.error.code).toBe('not_found')
  })

  it('config pública expõe somente a lista permitida', async () => {
    const res = await h.api.get('/api/public-config')
    expect(res.status).toBe(200)
    const text = JSON.stringify(res.body)
    for (const secret of [TEST_ENV.SESSION_SECRET, TEST_ENV.CONTACT_DEDUP_HMAC_KEY, TEST_ENV.CONTACT_ENCRYPTION_KEY, 'pglite']) {
      expect(text).not.toContain(secret)
    }
    expect(res.body.credit).toEqual({ phase: 'PRE_LAUNCH', operationsEnabled: false })
    expect(Object.keys(res.body).sort()).toEqual(
      ['analyticsEnabled', 'channels', 'collection', 'consentVersions', 'credit', 'environment', 'identity', 'notices', 'schemaVersion', 'siteUrl'].sort(),
    )
    expect(res.body.channels).toEqual({
      whatsappNumber: null,
      biaOnWhatsapp: false,
      humanSupport: false,
      webchat: { enabled: false, scriptUrl: null, widgetId: null },
    })
    // Sem provedor de mensagens (D1): a coleta de cadastro não depende mais dele.
    expect(res.body.collection).toEqual({ waitlistEnabled: true, supportEnabled: true })
  })

  it('config pública do webchat (placeholder) sai só com ele ligado e completo; o número oficial é o da Hal-AI', async () => {
    const on = await createTestHarness({
      HALAI_WEBCHAT_ENABLED: 'true',
      HALAI_WEBCHAT_SCRIPT_URL: 'https://webchat.halai.invalid/widget.js',
      HALAI_WEBCHAT_WIDGET_ID: 'mf-widget-1',
      HALAI_ENABLED: 'true',
      HALAI_INBOUND_API_KEY: 'test-only-halai-inbound-api-key-0123456789abcdef',
      WHATSAPP_BUSINESS_NUMBER: '+5511900000002',
    })
    try {
      const res = await on.api.get('/api/public-config')
      expect(res.body.channels).toEqual({
        whatsappNumber: '+5511900000002',
        biaOnWhatsapp: true,
        humanSupport: false,
        webchat: { enabled: true, scriptUrl: 'https://webchat.halai.invalid/widget.js', widgetId: 'mf-widget-1' },
      })
      expect(JSON.stringify(res.body)).not.toContain('test-only-halai-inbound')
    } finally {
      await on.close()
    }
  })

  it('JSON malformado e corpo grande têm erro estruturado', async () => {
    const bad = await h.api.post('/api/waitlist').set(SITE).set('content-type', 'application/json').send('{"a":')
    expect(bad.status).toBe(400)
    expect(bad.body.error.code).toBe('invalid_json')
    const big = await h.api.post('/api/waitlist').set(SITE).send({ x: 'a'.repeat(20_000) })
    expect(big.status).toBe(413)
  })

  it('origem estranha e conteúdo não-JSON são recusados em rotas do navegador', async () => {
    const foreign = await h.api.post('/api/waitlist').set('Origin', 'https://evil.example').send({})
    expect(foreign.status).toBe(403)
    expect(foreign.body.error.code).toBe('origin_not_allowed')
    const form = await h.api.post('/api/waitlist').set(SITE).type('form').send('a=1')
    expect(form.status).toBe(415)
  })
})

describe('fase financeira no servidor', () => {
  it.each([
    ['post', '/api/credit/eligibility'],
    ['post', '/api/credit/margin'],
    ['post', '/api/credit/simulations'],
    ['get', '/api/credit/proposals'],
    ['get', '/api/credit/proposals/123'],
    ['post', '/api/credit/contracts'],
    ['get', '/api/credit/qualquer-coisa'],
  ] as const)('PRE_LAUNCH nega %s %s', async (method, path) => {
    const res = await h.api[method](path).set(SITE).send({})
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('credit_phase_locked')
  })

  it('PILOT sem integração homologada continua indisponível', async () => {
    const pilot = await createTestHarness({ CREDIT_PHASE: 'PILOT', CREDIT_OPERATIONS_ENABLED: 'true' })
    const res = await pilot.api.get('/api/credit/proposals')
    expect(res.status).toBe(503)
    expect(res.body.error.code).toBe('credit_unavailable')
    await pilot.close()
  })

  it('PRE_LAUNCH com operações habilitadas é configuração inválida', () => {
    expect(() => loadConfig({ source: { ...TEST_ENV, CREDIT_OPERATIONS_ENABLED: 'true' } })).toThrow(ConfigError)
  })
})

describe('validação de configuração de publicação', () => {
  it('produção sem identidade empresarial falha', () => {
    try {
      loadConfig({ source: { ...TEST_ENV, NODE_ENV: 'production', DATABASE_URL: 'postgres://u@localhost/mf', COOKIE_SECURE: 'true' } })
      expect.unreachable()
    } catch (err) {
      const keys = (err as ConfigError).issues.map((i) => i.key)
      expect(keys).toEqual(expect.arrayContaining(['LEGAL_ENTITY_NAME', 'LEGAL_ENTITY_CNPJ', 'PRIVACY_CONTACT', 'SUPPORT_CONTACT']))
      expect((err as Error).message).not.toContain(TEST_ENV.SESSION_SECRET)
    }
  })

  it('HALAI_ENABLED exige HALAI_INBOUND_API_KEY; webchat ligado exige script e widget; número oficial em E.164', () => {
    const keys = (source: Record<string, string>) => {
      try {
        loadConfig({ source })
        return []
      } catch (err) {
        return (err as ConfigError).issues.map((i) => i.key)
      }
    }
    expect(keys({ ...TEST_ENV, HALAI_ENABLED: 'true' })).toEqual(['HALAI_INBOUND_API_KEY'])
    expect(keys({ ...TEST_ENV, HALAI_WEBCHAT_ENABLED: 'true' }).sort()).toEqual(['HALAI_WEBCHAT_SCRIPT_URL', 'HALAI_WEBCHAT_WIDGET_ID'])
    expect(keys({ ...TEST_ENV, HALAI_WEBCHAT_SCRIPT_URL: 'javascript:alert(1)', HALAI_WEBCHAT_WIDGET_ID: 'x y' }).sort()).toEqual(['HALAI_WEBCHAT_SCRIPT_URL', 'HALAI_WEBCHAT_WIDGET_ID'])
    expect(keys({ ...TEST_ENV, WHATSAPP_BUSINESS_NUMBER: '11 99999-0000' })).toEqual(['WHATSAPP_BUSINESS_NUMBER'])
  })

  it('variáveis de WhatsApp anteriores à D1 são ignoradas e listadas para aviso (só os nomes)', () => {
    const config = loadConfig({ source: { ...TEST_ENV, MESSAGE_PROVIDER: 'whatsapp_cloud', WHATSAPP_TEMPLATE_VERIFICATION: 'codigo', DEV_MESSAGE_LOG_FILE: '.dev/x' } })
    expect(config.obsoleteKeys.sort()).toEqual(['DEV_MESSAGE_LOG_FILE', 'MESSAGE_PROVIDER', 'WHATSAPP_TEMPLATE_VERIFICATION'])
    expect(JSON.stringify(config)).not.toContain('whatsapp_cloud')
  })

  it('CNPJ com dígito inválido é recusado; marcadores de documentação também', () => {
    const base = {
      ...TEST_ENV,
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://u@localhost/mf',
      COOKIE_SECURE: 'true',
      LEGAL_ENTITY_NAME: '<identidade real>',
      LEGAL_ENTITY_CNPJ: '11.111.111/1111-11',
    }
    try {
      loadConfig({ source: base })
      expect.unreachable()
    } catch (err) {
      const msgs = (err as ConfigError).issues.filter((i) => i.key.startsWith('LEGAL_ENTITY')).map((i) => i.message)
      expect(msgs.join(' ')).toMatch(/marcador/)
      expect(msgs.join(' ')).toMatch(/CNPJ/)
    }
  })

  // Produção completa e válida, com todas as integrações ligadas (valores só de teste).
  const PROD: Record<string, string> = {
    ...TEST_ENV,
    NODE_ENV: 'production',
    PORT: '3107',
    COOKIE_SECURE: 'true',
    DATABASE_URL: 'postgres://mf@127.0.0.1:5432/minhafolga',
    LEGAL_ENTITY_NAME: 'Empresa de Teste Ltda',
    LEGAL_ENTITY_CNPJ: '11.222.333/0001-81',
    LEGAL_ENTITY_ADDRESS: 'Rua de Teste, 100, São Paulo, SP',
    PRIVACY_CONTACT: 'privacidade@minhafolga.com.br',
    PRIVACY_OFFICER_NAME: 'Pessoa Encarregada',
    SUPPORT_CONTACT: 'atendimento@minhafolga.com.br',
    SUPPORT_HOURS: 'segunda a sexta, 9h às 18h',
    WHATSAPP_BUSINESS_NUMBER: '+5511999990000',
    HALAI_ENABLED: 'true',
    HALAI_INBOUND_API_KEY: 'test-only-halai-inbound-api-key-0123456789abcdef',
    HALAI_WEBHOOK_SECRET: 'test-only-halai-webhook-secret-0123456789abcdef',
    HALAI_API_KEY: 'test-only-halai-api-key-000000',
    HALAI_CHANNEL: 'canal-minhafolga',
    HALAI_SIGNUP_TEMPLATE_ENABLED: 'true',
    HALAI_SIGNUP_TEMPLATE: 'mf_cadastro',
    HALAI_TEMPLATE_DAILY_CAP: '200',
    HALAI_WEBCHAT_ENABLED: 'true',
    HALAI_WEBCHAT_SCRIPT_URL: 'https://webchat.halai.invalid/widget.js',
    HALAI_WEBCHAT_WIDGET_ID: 'minhafolga',
    SUPPORT_NOTIFY_WEBHOOK_URL: 'https://hooks.minhafolga.com.br/atendimento',
    SUPPORT_NOTIFY_WEBHOOK_SECRET: 'test-only-notify-secret-0123456789abcdef',
  }
  const issuesOf = (source: Record<string, string>) => {
    try {
      loadConfig({ source })
      return []
    } catch (err) {
      return (err as ConfigError).issues
    }
  }

  it('produção com segredos de integração fortes e distintos é aceita', () => {
    expect(issuesOf(PROD)).toEqual([])
  })

  it('produção recusa segredos de integração curtos, marcadores e repetidos, sem mostrar o valor', () => {
    const issues = issuesOf({
      ...PROD,
      HALAI_WEBHOOK_SECRET: 'x',
      HALAI_INBOUND_API_KEY: 'x'.repeat(31),
      SUPPORT_NOTIFY_WEBHOOK_SECRET: '<segredo de assinatura>',
      HALAI_API_KEY: 'z',
    })
    const keys = issues.map((i) => i.key)
    for (const key of ['HALAI_WEBHOOK_SECRET', 'HALAI_INBOUND_API_KEY', 'SUPPORT_NOTIFY_WEBHOOK_SECRET', 'HALAI_API_KEY']) {
      expect(keys, key).toContain(key)
    }
    expect(issues.find((i) => i.key === 'SUPPORT_NOTIFY_WEBHOOK_SECRET')?.message).toMatch(/marcador/)
    expect(JSON.stringify(issues)).not.toContain('xxxxxxxx')

    const reused = issuesOf({ ...PROD, HALAI_INBOUND_API_KEY: PROD.HALAI_WEBHOOK_SECRET!, SUPPORT_NOTIFY_WEBHOOK_SECRET: PROD.SESSION_SECRET! })
    expect(reused).toEqual(
      expect.arrayContaining([
        { key: 'HALAI_WEBHOOK_SECRET', message: 'precisa ser distinto de HALAI_INBOUND_API_KEY' },
        { key: 'SUPPORT_NOTIFY_WEBHOOK_SECRET', message: 'precisa ser distinto de SESSION_SECRET' },
      ]),
    )
  })

  it('produção recusa URL da Hal-AI e do webchat sem HTTPS', () => {
    const keys = issuesOf({ ...PROD, HALAI_API_BASE_URL: 'http://api.halai.invalid', HALAI_WEBCHAT_SCRIPT_URL: 'http://webchat.halai.invalid/w.js' }).map((i) => i.key)
    expect(keys.sort()).toEqual(['HALAI_API_BASE_URL', 'HALAI_WEBCHAT_SCRIPT_URL'])
  })

  it.each(['0.0.0.0', '::', '192.0.2.10'])('produção recusa HOST=%s (a API escuta só em loopback)', (host) => {
    expect(issuesOf({ ...PROD, HOST: host }).map((i) => i.key)).toContain('HOST')
  })

  it.each(['127.0.0.1', '::1', 'localhost'])('produção aceita HOST=%s', (host) => {
    expect(issuesOf({ ...PROD, HOST: host })).toEqual([])
  })

  it('desenvolvimento e testes continuam aceitando segredos de integração locais', () => {
    expect(issuesOf({ ...TEST_ENV, HALAI_WEBHOOK_SECRET: 'curto', HOST: '0.0.0.0' })).toEqual([])
  })
})
