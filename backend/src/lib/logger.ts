import { pino, type Logger } from 'pino'

export type { Logger }

/**
 * Logger estruturado com redação de dados sensíveis.
 * Regra do projeto: nunca registrar corpo de requisição, telefone, CPF, e-mail, nome, empregador,
 * mensagem de atendimento, cookies, chaves ou tokens. A redação abaixo é uma segunda barreira.
 */
export function createLogger(level: string, base: Record<string, unknown> = {}): Logger {
  return pino({
    level,
    base: { app: 'minhafolga', ...base },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        'req.headers.cookie',
        'req.headers.authorization',
        'req.headers["x-csrf-token"]',
        'req.headers["x-mf-signature"]',
        'req.headers["x-readiness-token"]',
        'req.headers["x-api-key"]',
        'res.headers["set-cookie"]',
        '*.phone',
        '*.code',
        '*.token',
        '*.password',
        '*.message',
        '*.contact',
        '*.cpf',
        '*.email',
        '*.fullName',
        '*.employerName',
        '*.nonce',
        '*.endpoint',
        '*.unsubscribeToken',
        '*.privateKey',
        '*.subscription',
        'body',
      ],
      censor: '[redacted]',
    },
  })
}
