/**
 * Papéis e permissões da área administrativa. A decisão é sempre do backend; o frontend apenas
 * reflete a lista devolvida em /api/admin/auth/me para esconder o que a pessoa não pode usar.
 */
export const ADMIN_ROLES = ['admin', 'support', 'privacy', 'marketing'] as const
export type AdminRole = (typeof ADMIN_ROLES)[number]

export const ADMIN_PERMISSIONS = [
  'leads:read',
  'leads:read_contact',
  'leads:export',
  'support:read',
  'support:update',
  'privacy:manage',
  'metrics:read',
  'audit:read',
  'users:manage',
  'team:read',
  /** Pausar/reabrir o formulário de cadastro do site (só admin). */
  'collection:manage',
  /** Admin ou concessão nominal explícita. Nenhum outro papel recebe por padrão. */
  'notifications:send',
  /** Somente admin autoriza/revoga usuários. */
  'notifications:manage',
] as const
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number]

export const ROLE_PERMISSIONS: Record<AdminRole, readonly AdminPermission[]> = {
  admin: ADMIN_PERMISSIONS,
  // Atendimento: fila e cadastros com contato mascarado; não revela contato nem exporta.
  support: ['support:read', 'support:update', 'leads:read', 'team:read'],
  // Privacidade: pedidos de titulares, contato sob justificativa, exportação e auditoria.
  privacy: ['privacy:manage', 'leads:read', 'leads:read_contact', 'leads:export', 'support:read', 'audit:read', 'team:read'],
  // Marketing: somente números agregados, sem conversas, nomes ou contatos.
  marketing: ['metrics:read'],
}

export function permissionsFor(role: AdminRole): AdminPermission[] {
  return [...(ROLE_PERMISSIONS[role] ?? [])]
}

/** Papéis que podem ser responsáveis por um atendimento (têm support:update). */
export const ASSIGNABLE_ROLES: AdminRole[] = ADMIN_ROLES.filter((role) => ROLE_PERMISSIONS[role].includes('support:update'))
