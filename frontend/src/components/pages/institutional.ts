import { biaOnWhatsapp, webchatAvailable } from '@/components/site/channels'
import { publicConfig } from '@/services/site'
import type { CreditPhase } from '@/types/public-config'

/** Nome das fases financeiras em linguagem do site. */
export const PHASE_LABELS: Record<CreditPhase, string> = {
  PRE_LAUNCH: 'Pré-lançamento',
  PILOT: 'Piloto',
  LIVE: 'Operação aberta',
}

/**
 * Condição de exibição de um item do conteúdo versionado. Só aparece o que é verdade na
 * configuração pública do build (canal da Bia, atendimento humano, coleta habilitada).
 * `biaChannel` = qualquer canal real da Bia (chat do site ou WhatsApp, ambos da Hal-AI — decisão D1);
 * `webchat` e `biaWhatsapp` distinguem o canal quando o texto cita um deles.
 */
export type Requirement =
  | 'humanSupport'
  | 'biaChannel'
  | 'noBiaChannel'
  | 'webchat'
  | 'biaWhatsapp'
  | 'waitlist'
  | 'noWaitlist'
  | 'support'

/** Recursos confirmados pela configuração pública. */
export interface Capabilities {
  humanSupport: boolean
  /** Chat do site da Hal-AI habilitado e válido. */
  webchat: boolean
  /** Bia no WhatsApp oficial hospedado na Hal-AI. */
  biaWhatsapp: boolean
  waitlist: boolean
  support: boolean
}

const BUILD_CAPABILITIES: Capabilities = {
  humanSupport: publicConfig.channels.humanSupport,
  webchat: webchatAvailable,
  biaWhatsapp: biaOnWhatsapp,
  waitlist: publicConfig.collection.waitlistEnabled,
  support: publicConfig.collection.supportEnabled,
}

/** Há algum canal real para conversar com a Bia. */
export function hasBiaChannel(caps: Capabilities = BUILD_CAPABILITIES): boolean {
  return caps.webchat || caps.biaWhatsapp
}

export function meets(requirement?: Requirement | null, caps: Capabilities = BUILD_CAPABILITIES): boolean {
  switch (requirement) {
    case 'humanSupport':
      return caps.humanSupport
    case 'biaChannel':
      return hasBiaChannel(caps)
    case 'noBiaChannel':
      return !hasBiaChannel(caps)
    case 'webchat':
      return caps.webchat
    case 'biaWhatsapp':
      return caps.biaWhatsapp
    case 'waitlist':
      return caps.waitlist
    case 'noWaitlist':
      return !caps.waitlist
    case 'support':
      return caps.support
    default:
      return true
  }
}

export function onlyAvailable<T extends { requires?: Requirement | null }>(items: T[], caps: Capabilities = BUILD_CAPABILITIES): T[] {
  return items.filter((item) => meets(item.requires, caps))
}

/**
 * Texto que depende do cadastro de interesse: `open` com a coleta habilitada, `closed` quando o
 * servidor não recebe cadastros (ex.: sem provedor de mensagens). Evita "cadastre-se agora" com o
 * formulário fechado.
 */
export function byWaitlist<T>(open: T, closed: T, caps: Capabilities = BUILD_CAPABILITIES): T {
  return caps.waitlist ? open : closed
}

/** Etapa da jornada (content/site.yaml → journey). */
export interface JourneyStep {
  stage: string
  title: string
  text: string
  /** Etapa atual sem condição. */
  current?: boolean
  /** Etapa atual somente quando o recurso existe; sem ele, aparece "em preparação". */
  currentWhen?: Requirement
}

export type JourneyState = 'current' | 'preparing' | 'later'

/** Situação de uma etapa na configuração do build: disponível, em preparação ou posterior. */
export function journeyStepState(step: Pick<JourneyStep, 'current' | 'currentWhen'>, caps: Capabilities = BUILD_CAPABILITIES): JourneyState {
  if (step.currentWhen) return meets(step.currentWhen, caps) ? 'current' : 'preparing'
  return step.current ? 'current' : 'later'
}

export type MilestoneStatus = 'pending' | 'in_progress' | 'done'

/**
 * Marco atual da abertura financeira: o que está em andamento; sem nenhum, o primeiro ainda não
 * concluído; todos concluídos, o último. Nunca avança por conta própria (só o status manual conta).
 */
export function currentMilestoneIndex(milestones: { status: MilestoneStatus }[]): number {
  const inProgress = milestones.findIndex((m) => m.status === 'in_progress')
  if (inProgress >= 0) return inProgress
  const open = milestones.findIndex((m) => m.status !== 'done')
  return open >= 0 ? open : milestones.length - 1
}

/**
 * Tipo de resposta no quadro de capacidades da Bia: "Não…" nega; `forward` indica que ela só
 * encaminha para o fluxo formal (nunca exibido como "sim"); o restante é permissão, total ou condicionada.
 */
export type CapabilityKind = 'yes' | 'no' | 'forward'

export function capabilityKind(value: string, kind?: 'forward'): CapabilityKind {
  if (kind === 'forward') return 'forward'
  return /^Não\b/.test(value) ? 'no' : 'yes'
}

export interface IconLink {
  icon: 'chat' | 'shield' | 'lock' | 'book' | 'layers' | 'compass' | 'home' | 'calendar' | 'user' | 'list' | 'eye' | 'hand' | 'clock'
  label: string
  to: string
  text?: string
}
