/**
 * Rótulos da área administrativa (pt-BR) e regras de interface derivadas do contrato.
 * Códigos desconhecidos continuam visíveis (texto cru), nunca somem da tela.
 */
import validation from '@contracts/validation.json'
import type {
  AdminPermission,
  AdminRole,
  LeadState,
  PrivacyAction,
  PrivacyRequestType,
  PrivacyStatus,
  SupportState,
} from './types'

/** Tom visual do selo. O texto sempre acompanha; a cor nunca é a única pista. */
export type StatusTone = 'neutral' | 'pending' | 'progress' | 'success' | 'muted' | 'danger'

interface StatusMeta {
  label: string
  tone: StatusTone
}

export const LEAD_STATES: Record<LeadState, StatusMeta> = {
  received: { label: 'Recebido pelo site', tone: 'pending' },
  verified: { label: 'Validado pela Bia', tone: 'success' },
  invited: { label: 'Aviso enviado', tone: 'progress' },
  unsubscribed: { label: 'Descadastrado', tone: 'muted' },
  expired: { label: 'Expirado', tone: 'muted' },
  // Fluxo anterior (confirmação por código): só em dados antigos.
  verification_pending: { label: 'Aguardando confirmação (fluxo anterior)', tone: 'muted' },
  waiting: { label: 'Na lista de aviso (fluxo anterior)', tone: 'muted' },
  human_support: { label: 'Em atendimento humano (fluxo anterior)', tone: 'muted' },
}

/** Estados do fluxo vigente (decisão D1), na ordem do ciclo de vida: opções do filtro. */
export const CURRENT_LEAD_STATES: LeadState[] = ['received', 'verified', 'invited', 'unsubscribed', 'expired']

/** Por que uma submissão ficou guardada para revisão (backend: SubmissionReason). */
export const SUBMISSION_REASONS: Record<string, string> = {
  existing_phone: 'Telefone já cadastrado',
  existing_cpf: 'CPF já cadastrado',
  existing_phone_and_cpf: 'CPF e telefone já cadastrados',
  cpf_conflict: 'CPF de outro cadastro, com outro telefone',
  cpf_mismatch: 'CPF diferente do cadastro deste telefone',
  suppressed: 'Número com comunicações suprimidas',
}

/** Motivos que impedem aplicar a submissão ao cadastro (o servidor devolve `applicable: false`). */
const DISCARD_ONLY_REASONS = new Set(['cpf_conflict', 'suppressed'])

/**
 * A submissão pode ser aplicada ao cadastro? Vale o `applicable` do servidor; sem ele (versão anterior da
 * API), a mesma regra: nem CPF de outro cadastro, nem contato suprimido, nem conteúdo ilegível.
 */
export function submissionApplicable(sub: { applicable?: boolean; reason: string; data: unknown }): boolean {
  if (typeof sub.applicable === 'boolean') return sub.applicable
  return sub.data !== null && !DISCARD_ONLY_REASONS.has(sub.reason)
}

/** Por que uma submissão só pode ser descartada (texto curto ao lado do botão "Descartar"). */
export function discardOnlyReason(sub: { reason: string; data: unknown }): string {
  if (sub.data === null) return 'O conteúdo desta submissão não pode ser lido: ela só pode ser descartada.'
  if (sub.reason === 'cpf_conflict') return 'O CPF enviado pertence a outro cadastro: esta submissão não pode ser aplicada aqui, só descartada.'
  if (sub.reason === 'suppressed') return 'O contato tem pedido de exclusão ou de oposição: esta submissão não pode ser aplicada, só descartada.'
  return 'Esta submissão não pode ser aplicada ao cadastro, só descartada.'
}

/** Motivos de configuração do servidor que fecham o cadastro (backend: config.collection.reasons). */
export const COLLECTION_REASONS: Record<string, string> = {
  identity_incomplete: 'Dados da empresa incompletos na configuração do servidor (exigidos pelo Aviso de Privacidade).',
}

export const SUBMISSION_CHANNELS: Record<string, string> = {
  site: 'Formulário do site',
  bia: 'Bia (WhatsApp)',
}

/** Campos do cadastro (nomes do contrato), para mostrar quais diferem numa submissão. */
export const LEAD_FIELDS: Record<string, string> = {
  fullName: 'Nome completo',
  cpf: 'CPF',
  phone: 'WhatsApp',
  email: 'E-mail',
  employerName: 'Empresa',
  employmentType: 'Vínculo',
  jobTenure: 'Tempo no emprego',
  incomeRange: 'Faixa de salário líquido',
  city: 'Cidade',
  uf: 'UF',
  interestTopic: 'Tema de interesse',
  consents: 'Finalidades',
}

export const SUPPORT_STATES: Record<SupportState, StatusMeta> = {
  received: { label: 'Recebido', tone: 'pending' },
  in_progress: { label: 'Em andamento', tone: 'progress' },
  answered: { label: 'Respondido', tone: 'success' },
  closed: { label: 'Encerrado', tone: 'muted' },
}

export const PRIVACY_STATUSES: Record<PrivacyStatus, StatusMeta> = {
  open: { label: 'Aberto', tone: 'pending' },
  in_progress: { label: 'Em andamento', tone: 'progress' },
  fulfilled: { label: 'Cumprido', tone: 'success' },
  rejected: { label: 'Recusado', tone: 'muted' },
}

/**
 * Transições de atendimento permitidas (seção 6.17): received → in_progress → answered → closed;
 * answered → in_progress; closed → in_progress. O servidor valida de novo (`invalid_transition`).
 */
export const SUPPORT_TRANSITIONS: Record<SupportState, SupportState[]> = {
  received: ['in_progress'],
  in_progress: ['answered'],
  answered: ['closed', 'in_progress'],
  closed: ['in_progress'],
}

export function transitionLabel(from: SupportState, to: SupportState): string {
  if (to === 'in_progress') return from === 'received' ? 'Iniciar atendimento' : 'Reabrir atendimento'
  if (to === 'answered') return 'Marcar como respondido'
  if (to === 'closed') return 'Encerrar atendimento'
  return SUPPORT_STATES[to].label
}

export const ROLES: Record<AdminRole, string> = {
  admin: 'Administração',
  support: 'Atendimento',
  privacy: 'Privacidade',
  marketing: 'Marketing',
}

export const PERMISSIONS: Record<AdminPermission, string> = {
  'metrics:read': 'Ver métricas agregadas',
  'leads:read': 'Consultar cadastros (contato mascarado)',
  'leads:read_contact': 'Revelar telefone, e-mail e CPF de um cadastro, com justificativa auditada',
  'leads:export': 'Exportar cadastros em CSV, com justificativa auditada',
  'support:read': 'Consultar atendimentos',
  'support:update': 'Atualizar status, responsável e notas de atendimentos',
  'team:read': 'Ver a equipe disponível para atendimentos',
  'privacy:manage': 'Registrar e cumprir pedidos de privacidade',
  'audit:read': 'Consultar a trilha de auditoria',
  'users:manage': 'Gerenciar usuários do painel',
  'notifications:send': 'Criar e cancelar campanhas de notificações autorizadas',
  'notifications:manage': 'Autorizar pessoas a enviar notificações',
  'collection:manage': 'Pausar e reabrir o formulário de cadastro do site, com justificativa auditada',
}

export const PURPOSES: Record<string, string> = {
  launch_notice: 'Aviso de abertura',
  marketing: 'Conteúdos e novidades',
}

export const ACTOR_TYPES: Record<string, string> = {
  titular: 'Titular',
  admin: 'Equipe',
  system: 'Sistema',
  agent: 'Bia (IA)',
}

export const LEAD_EVENTS: Record<string, string> = {
  created: 'Cadastro recebido pelo site',
  state_changed: 'Mudança de estado',
  preference_changed: 'Preferência alterada',
  contact_verified: 'Telefone validado pela Bia',
  submission_held: 'Nova submissão guardada para revisão',
  profile_updated: 'Dados gerais atualizados',
  interest_updated: 'Interesse atualizado',
  preferences_link_issued: 'Link de preferências gerado pela Bia',
  opt_out_requested: 'Pedido de saída das comunicações',
  deletion_requested: 'Pedido de exclusão dos dados',
  anonymized: 'Cadastro anonimizado',
  invited: 'Aviso enviado',
}

export const SUPPORT_EVENTS: Record<string, string> = {
  created: 'Solicitação recebida',
  status_changed: 'Status alterado',
  assigned: 'Responsável definido',
  note_added: 'Nota registrada',
  reply_recorded: 'Resposta registrada',
  notification_queued: 'Notificação enfileirada',
  notification_failed: 'Falha ao notificar',
}

export const PRIVACY_TYPES: Record<PrivacyRequestType, string> = {
  access: 'Acesso aos dados',
  correction: 'Correção de dados',
  deletion: 'Eliminação de dados',
  revocation: 'Revogação de consentimento',
  opposition: 'Oposição ao tratamento',
  portability: 'Portabilidade',
  information: 'Informação sobre tratamento',
  other: 'Outro pedido',
}

export const PRIVACY_ACTIONS: Record<PrivacyAction, { label: string; description: string }> = {
  revoke_all: {
    label: 'Revogar todas as finalidades',
    description: 'Revoga o aviso de abertura e os conteúdos e novidades. Nenhuma nova mensagem dessas finalidades será enviada.',
  },
  suppress_contact: {
    label: 'Suprimir o contato',
    description: 'Impede novos envios para este número, inclusive depois de uma eventual anonimização.',
  },
  anonymize_lead: {
    label: 'Anonimizar o cadastro',
    description:
      'Substitui os dados pessoais do cadastro (inclusive CPF, e-mail e empresa), das submissões guardadas para revisão e das solicitações vinculadas, e encerra sessões. Não pode ser desfeita.',
  },
}

export const EMPLOYMENT_TYPES: Record<string, string> = Object.fromEntries(
  validation.waitlist.employmentTypes.map((t) => [t.value, t.label]),
)

export const INTEREST_TOPICS: Record<string, string> = Object.fromEntries(
  validation.waitlist.interestTopics.map((t) => [t.value, t.label]),
)

export const JOB_TENURES: Record<string, string> = Object.fromEntries(
  validation.waitlist.jobTenureRanges.map((t) => [t.value, t.label]),
)

export const INCOME_RANGES: Record<string, string> = Object.fromEntries(
  validation.waitlist.incomeRanges.map((t) => [t.value, t.label]),
)

export const UFS: string[] = validation.waitlist.ufs

export const SUPPORT_SUBJECTS: Record<string, string> = Object.fromEntries(
  validation.support.subjects.map((s) => [s.value, s.label]),
)

export const CONTACT_METHODS: Record<string, string> = Object.fromEntries(
  validation.support.contactMethods.map((m) => [m.value, m.label]),
)

const SOURCE_NAMES: Record<string, string> = {
  'avise-me': 'Avise-me',
  home: 'Home',
  'consignado-privado': 'Consignado privado',
  solucoes: 'Soluções',
  'como-funciona': 'Como funciona',
  bia: 'Bia',
  lancamento: 'Lançamento',
  conteudos: 'Conteúdos',
  ajuda: 'Ajuda',
  web_form: 'Formulário do site',
  agent: 'Bia (IA)',
  // Origens de eventos gravadas pelo backend fora das páginas do site.
  preferencias: 'Central de preferências',
  opt_out: 'Pedido de saída pelo site',
  retencao: 'Rotina de retenção',
  admin_privacy: 'Equipe de privacidade',
}

export const LEAD_SOURCES: string[] = validation.waitlist.sources

export const METRIC_EVENTS: Record<string, string> = {
  page_section_view: 'Página visitada',
  article_read: 'Conteúdo lido',
  help_search: 'Pesquisa na ajuda',
  help_search_empty: 'Pesquisa na ajuda sem resultado',
  waitlist_start: 'Cadastro iniciado',
  waitlist_cta_click: 'Clique para iniciar cadastro',
  waitlist_error: 'Cadastro com erro exibido',
  waitlist_confirmed: 'Recebimento confirmado no navegador',
  bia_demo_tab: 'Aba da demonstração da Bia',
  bia_channel_click: 'Clique no canal da Bia',
  support_form_start: 'Formulário de atendimento iniciado',
}

/**
 * Contadores operacionais gravados pelo servidor (backend: incrementMetric). Códigos sem rótulo
 * aparecem como vieram (nada some da tela quando o servidor evolui).
 */
export const METRIC_COUNTERS: Record<string, string> = {
  waitlist_received: 'Cadastros recebidos',
  waitlist_held: 'Submissões guardadas para revisão (CPF ou telefone já cadastrado)',
  waitlist_suppressed: 'Cadastros de número com comunicações suprimidas',
  contact_verified_bia: 'Telefones validados pela Bia',
  antibot_rejected: 'Envios recusados pela proteção anti-robô',
  preferences_link_issued: 'Links de preferências gerados pela Bia',
  preference_granted: 'Finalidades autorizadas',
  preference_revoked: 'Finalidades revogadas',
  unsubscribed: 'Saídas da lista de aviso',
  optout_site: 'Pedidos de saída pelo site',
  deletion_requested: 'Pedidos de exclusão',
  support_request_created: 'Solicitações de atendimento',
  agent_tool_call: 'Chamadas de ferramenta da Bia',
  halai_template_queued: 'Templates da Hal-AI enfileirados',
  halai_template_withheld: 'Templates da Hal-AI retidos (desligado, limite ou trava)',
  outbox_sent: 'Mensagens enviadas pela Hal-AI',
  outbox_failed: 'Mensagens com falha definitiva',
  outbox_cancelled: 'Mensagens canceladas (preferência ou supressão)',
}

/** Rótulo com fallback para o código original (nada é escondido quando o servidor evolui). */
export function label(map: Record<string, string>, code: string | null | undefined): string {
  if (!code) return '—'
  return map[code] ?? code
}

export const sourceLabel = (code: string | null | undefined) => label(SOURCE_NAMES, code)

export function statusMeta<K extends string>(map: Record<K, StatusMeta>, code: string): StatusMeta {
  return (map as Record<string, StatusMeta>)[code] ?? { label: code, tone: 'neutral' }
}
