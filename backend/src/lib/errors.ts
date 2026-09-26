/**
 * Erros de aplicação com código estável (contrato da API) e mensagem em português
 * que pode ser exibida ao usuário. Detalhes internos nunca vão para `message`.
 */
export class AppError extends Error {
  readonly status: number
  readonly code: string
  readonly fields: Record<string, string> | undefined
  readonly expose: boolean
  readonly extra: Record<string, unknown> | undefined

  constructor(
    status: number,
    code: string,
    message: string,
    options: { fields?: Record<string, string>; extra?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause })
    this.name = 'AppError'
    this.status = status
    this.code = code
    this.fields = options.fields
    this.extra = options.extra
    this.expose = status < 500
  }
}

export const Errors = {
  validation: (fields: Record<string, string>, message = 'Confira os campos destacados.') =>
    new AppError(400, 'validation_error', message, { fields }),
  badRequest: (code: string, message: string) => new AppError(400, code, message),
  unauthorized: (message = 'É preciso entrar para continuar.') => new AppError(401, 'unauthorized', message),
  forbidden: (message = 'Você não tem permissão para esta ação.') => new AppError(403, 'forbidden', message),
  notFound: (message = 'Não encontramos o que você procurou.') => new AppError(404, 'not_found', message),
  conflict: (code: string, message: string) => new AppError(409, code, message),
  tooMany: (message = 'Muitas tentativas. Aguarde alguns minutos e tente novamente.') =>
    new AppError(429, 'rate_limited', message),
  unavailable: (code: string, message: string) => new AppError(503, code, message),
  creditPhaseLocked: () =>
    new AppError(
      403,
      'credit_phase_locked',
      'A operação de crédito da Minha Folga está em estruturação. Consultas, propostas e contratação ainda não estão disponíveis.',
    ),
}
