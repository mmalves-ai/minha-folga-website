/**
 * Navegação do painel e permissão exigida por tela. A interface só esconde o que o perfil não
 * pode usar; quem nega de fato é o backend (403 em qualquer chamada sem permissão).
 */
import type { AdminPermission } from './types'

export type AdminIcon = 'layers' | 'list' | 'chat' | 'shield' | 'book' | 'user' | 'lock' | 'bell'

export interface AdminNavItem {
  name: string
  label: string
  icon: AdminIcon
  permission: AdminPermission | null
  /** Rotas de detalhe que mantêm o item ativo. */
  children?: string[]
}

export const ADMIN_NAV: AdminNavItem[] = [
  { name: 'admin-painel', label: 'Painel', icon: 'layers', permission: 'metrics:read' },
  { name: 'admin-leads', label: 'Cadastros', icon: 'list', permission: 'leads:read', children: ['admin-lead'] },
  {
    name: 'admin-atendimentos',
    label: 'Atendimentos',
    icon: 'chat',
    permission: 'support:read',
    children: ['admin-atendimento'],
  },
  { name: 'admin-notificacoes', label: 'Notificações', icon: 'bell', permission: 'notifications:send' },
  { name: 'admin-privacidade', label: 'Privacidade', icon: 'shield', permission: 'privacy:manage' },
  { name: 'admin-auditoria', label: 'Auditoria', icon: 'book', permission: 'audit:read' },
  { name: 'admin-usuarios', label: 'Usuários', icon: 'user', permission: 'users:manage' },
  { name: 'admin-conta', label: 'Minha conta', icon: 'lock', permission: null },
]

/** Permissão exigida por rota nomeada do painel (null = qualquer sessão completa). */
export const ROUTE_PERMISSIONS: Record<string, AdminPermission | null> = Object.fromEntries(
  ADMIN_NAV.flatMap((item) => [
    [item.name, item.permission] as const,
    ...(item.children ?? []).map((child) => [child, item.permission] as const),
  ]),
)

/** Primeira tela disponível para o perfil (destino depois de entrar). */
export function defaultAdminRoute(can: (p: AdminPermission) => boolean): string {
  const first = ADMIN_NAV.find((item) => item.permission && can(item.permission))
  return first?.name ?? 'admin-conta'
}
