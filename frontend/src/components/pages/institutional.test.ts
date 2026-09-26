/**
 * Riscos concretos das páginas institucionais: canal da Bia e encaminhamento humano só aparecem com
 * configuração real (nada de chat ou atendimento fingido); o resumo da abertura mostra o marco certo
 * sem avançar sozinho; o quadro de capacidades nunca exibe como "sim" o que a Bia não faz na fase;
 * as âncoras que levam às seções do produto (sumário e /solucoes) apontam para seções existentes.
 */
import { describe, expect, it } from 'vitest'
import launch from '@content/launch.yaml'
import bia from '@content/pages/bia.yaml'
import howItWorks from '@content/pages/como-funciona.yaml'
import payroll from '@content/pages/consignado-privado.yaml'
import home from '@content/pages/home.yaml'
import about from '@content/pages/sobre.yaml'
import solutions from '@content/pages/solucoes.yaml'
import site from '@content/site.yaml'
import faq from '@content/faq.yaml'
import audienceSource from './PayrollAudience.vue?raw'
import payrollSource from '@/pages/PayrollLoanPage.vue?raw'
import {
  byWaitlist,
  capabilityKind,
  currentMilestoneIndex,
  journeyStepState,
  meets,
  onlyAvailable,
  type Capabilities,
  type JourneyStep,
  type MilestoneStatus,
  type Requirement,
} from './institutional'

const NONE: Capabilities = { humanSupport: false, webchat: false, biaWhatsapp: false, waitlist: false, support: false }
const ALL: Capabilities = { humanSupport: true, webchat: true, biaWhatsapp: true, waitlist: true, support: true }

type Gated = { text: string; requires?: Requirement }

describe('itens condicionados à configuração pública', () => {
  const now = home.solution.now as Gated[]

  it('sem canal provisionado, a home não anuncia conversa pelo WhatsApp e mantém os exemplos', () => {
    const texts = onlyAvailable(now, NONE).map((i) => i.text)
    expect(texts.some((t) => /WhatsApp/.test(t))).toBe(false)
    expect(texts.some((t) => /Exemplos de conversa/.test(t))).toBe(true)
  })

  it('com canal provisionado, troca os exemplos pela conversa real', () => {
    const texts = onlyAvailable(now, ALL).map((i) => i.text)
    expect(texts.some((t) => /WhatsApp/.test(t))).toBe(true)
    expect(texts.some((t) => /Exemplos de conversa/.test(t))).toBe(false)
  })

  it('cada canal da Bia (Hal-AI) aparece só quando ele existe: chat do site sem WhatsApp não cita WhatsApp', () => {
    const only = (caps: Capabilities) => onlyAvailable(now, caps).map((i) => i.text)
    const webchatOnly = only({ ...NONE, webchat: true })
    expect(webchatOnly.some((t) => /chat do site/.test(t))).toBe(true)
    expect(webchatOnly.some((t) => /WhatsApp/.test(t))).toBe(false)
    expect(webchatOnly.some((t) => /Exemplos de conversa/.test(t))).toBe(false)
    const whatsappOnly = only({ ...NONE, biaWhatsapp: true })
    expect(whatsappOnly.some((t) => /WhatsApp/.test(t))).toBe(true)
    expect(whatsappOnly.some((t) => /chat do site/.test(t))).toBe(false)
  })

  it('sem coleta habilitada, o cadastro de interesse não aparece como disponível', () => {
    expect(onlyAvailable(now, NONE).some((i) => /Cadastro de interesse/.test(i.text))).toBe(false)
  })

  it('"O que ela faz hoje" só promete encaminhamento a uma pessoa com atendimento humano real', () => {
    const today = bia.panels.today.items as Gated[]
    const handoff = (items: Gated[]) => items.some((i) => /encaminha/i.test(i.text))
    expect(handoff(onlyAvailable(today, NONE))).toBe(false)
    expect(handoff(onlyAvailable(today, { ...NONE, humanSupport: true }))).toBe(true)
  })
})

describe('cadastro de interesse fechado no servidor (collection.waitlistEnabled = false)', () => {
  const OPEN: Capabilities = { ...NONE, waitlist: true }
  const journey = site.journey as JourneyStep[]
  const hero = howItWorks.hero as { now: (Gated & { to: string })[]; lead: string; leadWaitlistClosed: string }

  it('a etapa "Agora" só aparece como disponível com o cadastro aberto; fechado, fica em preparação', () => {
    expect(journey.map((step) => journeyStepState(step, OPEN))).toEqual(['current', 'later', 'later', 'later'])
    expect(journey.map((step) => journeyStepState(step, NONE))).toEqual(['preparing', 'later', 'later', 'later'])
    expect(journeyStepState({ current: true }, NONE)).toBe('current')
  })

  it('as etiquetas de situação existem para cada estado (jornada e /como-funciona)', () => {
    expect(site.journeyStatus.current).toBeTruthy()
    expect(site.journeyStatus.preparing).toBeTruthy()
    for (const key of ['statusNow', 'statusPreparing', 'statusLater']) expect(howItWorks.steps[key], key).toBeTruthy()
  })

  it('"O que você já pode fazer" não oferece o cadastro com a coleta fechada', () => {
    const labels = (caps: Capabilities) => onlyAvailable(hero.now, caps).map((i) => i.to)
    expect(labels(OPEN)).toContain('/avise-me')
    expect(labels(NONE)).not.toContain('/avise-me')
    expect(labels(NONE)).toContain('/lancamento')
  })

  it('textos que dizem "cadastrar agora" têm a variante do cadastro fechado, sem esse convite', () => {
    const pairs: [string, string][] = [
      [hero.lead, hero.leadWaitlistClosed],
      [howItWorks.steps.text, howItWorks.steps.textWaitlistClosed],
      [home.journey.text, home.journey.textWaitlistClosed],
      [payroll.hero.lead, payroll.hero.leadWaitlistClosed],
      [payroll.journey.text, payroll.journey.textWaitlistClosed],
    ]
    for (const [open, closed] of pairs) {
      expect(byWaitlist(open, closed, OPEN)).toBe(open)
      expect(byWaitlist(open, closed, NONE)).toBe(closed)
      expect(closed).toMatch(/ainda não está aberto|[Ee]m breve|[Ee]stamos chegando/)
      expect(closed).not.toMatch(/já está disponível|cadastrar seu interesse agora|registrar seu interesse|cadastro de hoje/)
    }
  })

  it('o benefício "Receba o aviso de abertura" só leva ao formulário com o cadastro aberto', () => {
    const benefit = (home.value.benefits as { title: string; link: { to: string; requires?: Requirement }; linkWaitlistClosed?: { to: string } }[]).find(
      (b) => /aviso de abertura/.test(b.title),
    )!
    expect(meets(benefit.link.requires, OPEN)).toBe(true)
    expect(meets(benefit.link.requires, NONE)).toBe(false)
    expect(benefit.linkWaitlistClosed?.to).toBe('/lancamento')
  })
})

describe('Bia sem canal provisionado', () => {
  it('o painel "O que ela faz hoje" tem o aviso de canal inativo e só oferece cadastro com a coleta aberta', () => {
    expect(bia.panels.today.channelPendingIntro).toMatch(/ainda não está ativo/)
    const today = bia.panels.today.items as Gated[]
    const signup = (items: Gated[]) => items.some((i) => /se cadastrar/.test(i.text))
    expect(signup(onlyAvailable(today, { ...ALL, waitlist: false }))).toBe(false)
    expect(signup(onlyAvailable(today, ALL))).toBe(true)
  })

  it('/consignado-privado e /sobre têm textos próprios para quando não há canal', () => {
    expect(payroll.bia.canTitleNoChannel).toBeTruthy()
    expect(payroll.bia.canTitleNoChannel).not.toBe(payroll.bia.canTitle)
    expect(about.closing.textNoBiaChannel).toMatch(/Cadastre-se|exemplos de conversa/)
    expect(about.closing.textNoBiaChannel).not.toMatch(/(^|, )conversa com a Bia/)
  })

  it('o resumo da Bia preserva autorização, operadora e referência ao cadastro completo D1', () => {
    const text = bia.trust.privacy.text as string
    expect(text).toContain('autorização')
    expect(text).toContain('mesmos dados do formulário')
    expect(text).toContain('Hal-AI')
    expect(bia.trust.privacy.link.to).toBe('/privacidade')
    expect(bia.trust.privacy.sensitive).toMatch(/Nunca envie senhas/)
  })

  it('há texto de canais ativos para cada combinação de chat do site e WhatsApp', () => {
    for (const key of ['both', 'webchat', 'whatsapp']) expect(bia.panels.today.channelsIntro[key], key).toMatch(/Hal-AI/)
    expect(bia.panels.today.channelsIntro.webchat).not.toMatch(/WhatsApp/)
    expect(bia.panels.today.channelsIntro.whatsapp).not.toMatch(/chat/)
  })
})

describe('links relacionados da base de perguntas', () => {
  it('"Para quem estamos preparando" leva à seção certa da página de produto', () => {
    const items = faq.items as { id: string; related: { label: string; to: string }[] }[]
    const mei = items.find((i) => i.id === 'mei-aplicativo')!
    expect(mei.related.find((r) => /Para quem/.test(r.label))?.to).toBe('/consignado-privado#para-quem')
  })
})

describe('marco atual da abertura financeira', () => {
  const m = (...status: MilestoneStatus[]) => status.map((s) => ({ status: s }))

  it('o marco em andamento vence, mesmo com um concluído depois dele', () => {
    expect(currentMilestoneIndex(m('done', 'in_progress', 'done', 'pending'))).toBe(1)
  })

  it('sem marco em andamento, mostra o primeiro ainda não concluído (não pula etapas)', () => {
    expect(currentMilestoneIndex(m('done', 'pending', 'pending'))).toBe(1)
    expect(currentMilestoneIndex(m('pending', 'pending'))).toBe(0)
  })

  it('todos concluídos: mostra o último, sem índice inválido', () => {
    expect(currentMilestoneIndex(m('done', 'done', 'done'))).toBe(2)
  })

  it('o conteúdo atual aponta para um marco existente e não concluído sem evidência', () => {
    const milestones = launch.milestones as { status: MilestoneStatus; evidence: string | null }[]
    const current = milestones[currentMilestoneIndex(milestones)]
    expect(current).toBeDefined()
    if (current?.status === 'done') expect(current.evidence).toBeTruthy()
  })
})

describe('quadro de capacidades da Bia (seção 7)', () => {
  type Row = { capability: string; preLaunch: string; later: string; laterKind?: 'forward' }
  const rows = bia.capabilities.rows as Row[]

  it('na pré-abertura, só explicar/cadastro e preferências aparecem como "sim"', () => {
    const allowed = rows.filter((r) => capabilityKind(r.preLaunch) === 'yes').map((r) => r.capability)
    expect(allowed).toEqual(['Explicar conceitos e cadastro', 'Registrar preferências e descadastro'])
  })

  it('"Não; apresentar cálculo oficial" é negação, não permissão', () => {
    expect(capabilityKind('Não; apresentar cálculo oficial')).toBe('no')
  })

  it('assinatura e movimentação de dinheiro nunca aparecem como "sim" em nenhuma fase', () => {
    const signing = rows.find((r) => /Assinar ou movimentar/.test(r.capability))
    expect(signing).toBeDefined()
    expect(capabilityKind(signing!.preLaunch)).toBe('no')
    expect(capabilityKind(signing!.later, signing!.laterKind)).toBe('forward')
  })
})

describe('âncoras da página de produto', () => {
  // Ids das seções no template (id="…") e na faixa final (anchor-id="…").
  const ids = new Set(
    [...`${payrollSource}\n${audienceSource}`.matchAll(/\s(?:id|anchor-id)="([a-z0-9-]+)"/g)].map((m) => m[1]),
  )
  const hash = (to: string) => to.slice(to.indexOf('#') + 1)

  it('o sumário "Nesta página" e o atalho do hero levam a seções existentes', () => {
    const targets = [...(payroll.toc as { to: string }[]).map((t) => t.to), payroll.hero.secondary.to as string]
    for (const to of targets) expect(ids, to).toContain(hash(to))
    expect(payroll.toc).toHaveLength(7)
  })

  it('os atalhos de /solucoes para o produto apontam para seções existentes', () => {
    for (const { to } of solutions.consignado.explore as { to: string }[]) {
      expect(to.startsWith('/consignado-privado#')).toBe(true)
      expect(ids, to).toContain(hash(to))
    }
  })
})

describe('decisão D1 (docs/DECISOES.md) no conteúdo institucional e legal', () => {
  // Cadastro com CPF e empregador, sem código de confirmação; WhatsApp e Bia na Hal-AI.
  const sources = import.meta.glob(
    [
      '/content/faq.yaml',
      '/content/site.yaml',
      '/content/pages/{home,sobre,solucoes,consignado-privado,como-funciona,bia,seguranca,ajuda,conteudos,lancamento}.yaml',
      '/content/legal/*.{md,yaml}',
    ],
    { import: 'default', eager: true },
  ) as Record<string, unknown>

  it('os arquivos do conteúdo foram encontrados', () => {
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(16)
  })

  it.each([
    ['"não pedimos CPF"', /n[ãa]o\s+(pedimos|pede)\s+(o\s+seu\s+)?CPF/i],
    ['"sem CPF" no cadastro', /Nada de CPF|sem CPF/i],
    ['"não pedimos empresa empregadora"', /empresa empregadora ou dados banc/i],
    ['código de confirmação enviado por este sistema', /enviamos um código|código de confirmação que enviamos|confirma o (seu )?WhatsApp com (um |o )?código/i],
    ['"Deixe seu contato" como etapa da jornada', /Deixe seu contato e conte/i],
  ])('nenhum texto mantém %s', (_label, pattern) => {
    // Conteúdo já interpretado (sem os comentários do YAML, que podem citar o texto superado da especificação).
    for (const [file, data] of Object.entries(sources)) expect(JSON.stringify(data), file).not.toMatch(pattern)
  })
})
