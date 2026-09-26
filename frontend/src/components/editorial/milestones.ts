/**
 * Marcos da abertura financeira (content/launch.yaml), validados no build.
 * Regra editorial (seção 6.6): qualquer mudança de status — "em andamento" ou "concluído" — só aparece com
 * evidência, data e responsável registrados; sem eles o marco fica "pending". Conteúdo inconsistente
 * interrompe a pré-renderização em vez de publicar um status sem prova.
 */
export type MilestoneStatus = 'pending' | 'in_progress' | 'done'

export interface Milestone {
  id: string
  title: string
  description: string
  status: MilestoneStatus
  /** Descrição pública da evidência conferida (sem dados internos sensíveis). */
  evidence: string | null
  updatedAt: string | null
  /** Registro interno de quem conferiu a evidência; não é exibido na página. */
  responsible: string | null
}

const STATUSES: readonly MilestoneStatus[] = ['pending', 'in_progress', 'done']
const DATE = /^\d{4}-\d{2}-\d{2}$/

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

export function parseMilestones(raw: unknown): Milestone[] {
  const list = (raw as { milestones?: unknown })?.milestones
  if (!Array.isArray(list) || list.length === 0) throw new Error('[launch.yaml] lista "milestones" ausente')
  return list.map((m: Record<string, unknown>, i) => {
    const where = `[launch.yaml] marco ${i + 1} (${String(m?.id ?? '?')})`
    const status = m?.status as MilestoneStatus
    if (!STATUSES.includes(status)) throw new Error(`${where}: status inválido "${String(m?.status)}"`)
    const id = text(m.id)
    const title = text(m.title)
    const description = text(m.description)
    if (!id || !title || !description) throw new Error(`${where}: id, title e description são obrigatórios`)
    const updatedAt = m.updatedAt == null ? null : String(m.updatedAt)
    if (updatedAt && !DATE.test(updatedAt)) throw new Error(`${where}: updatedAt deve estar no formato AAAA-MM-DD`)
    const milestone: Milestone = {
      id,
      title,
      description,
      status,
      evidence: text(m.evidence),
      updatedAt,
      responsible: text(m.responsible),
    }
    if (status !== 'pending' && !(milestone.evidence && milestone.updatedAt && milestone.responsible)) {
      throw new Error(`${where}: "${status}" exige evidence, updatedAt e responsible registrados`)
    }
    return milestone
  })
}

/**
 * Marco em que a operação está agora: o que está em andamento; sem nenhum, o primeiro ainda não
 * concluído (mesma regra do resumo da home). Todos concluídos: null.
 */
export function currentMilestone(list: Milestone[]): Milestone | null {
  return list.find((m) => m.status === 'in_progress') ?? list.find((m) => m.status !== 'done') ?? null
}
