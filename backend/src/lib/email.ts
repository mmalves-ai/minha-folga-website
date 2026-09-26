/** Dica mascarada do e-mail: primeira letra do usuário e do domínio, e o sufixo. Ex.: "m•••@e•••.com.br". */
export function emailHint(email: string): string {
  const at = email.lastIndexOf('@')
  const local = email.slice(0, at)
  const domain = email.slice(at + 1)
  const dot = domain.indexOf('.')
  const suffix = dot > 0 ? domain.slice(dot) : ''
  return `${local.slice(0, 1)}•••@${domain.slice(0, 1)}•••${suffix}`
}
