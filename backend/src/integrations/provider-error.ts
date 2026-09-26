/**
 * Falha de entrega a um sistema externo (webhook interno de atendimento, API da Hal-AI).
 * `retryable` decide se a outbox reprograma a tentativa (dentro do limite) ou encerra como `failed`.
 * A mensagem nunca contém destinatário, conteúdo, URL com credencial ou corpo da resposta.
 */
export class ProviderError extends Error {
  readonly retryable: boolean
  constructor(message: string, retryable: boolean) {
    super(message)
    this.name = 'ProviderError'
    this.retryable = retryable
  }
}
