import type { WebchatConfig } from './channels'

/**
 * Carregador do widget de webchat da Hal-AI.
 *
 * PLACEHOLDER: widget da Hal-AI ainda não provisionado. Enquanto a Hal-AI não entregar o widget, o canal
 * fica desligado na configuração pública (`channels.webchat.enabled = false`) e esta função nunca é chamada.
 * Ao provisionar, confirmar com a Hal-AI:
 *   - o endereço do script e como ele recebe o identificador do widget (aqui: atributo `data-widget-id`);
 *   - se há API para abrir/fechar a janela e esconder o lançador próprio do widget (para não duplicar o
 *     botão flutuante do site) e ajustar FloatingContact.vue;
 *   - as origens que a CSP do servidor web precisa liberar (script-src, connect-src, frame-src e, se o
 *     widget usar, style-src/img-src/font-src) — ver deploy/nginx.minhafolga.conf.example;
 *   - o que o widget grava no navegador, para a Política de cookies e o Aviso de Privacidade.
 *
 * Regras que valem desde já:
 *   - o script só é inserido depois do clique da pessoa e da confirmação do aviso de tratamento;
 *   - nenhuma chave de API vai para o navegador: só o endereço público do script e o identificador público;
 *   - nenhum dado da página (formulários, UTM, cookies) é repassado ao widget;
 *   - um único script por carregamento de página; falha ou demora liberam uma nova tentativa, sem reenviar nada.
 */
export const WEBCHAT_SCRIPT_ID = 'mf-halai-webchat'
export const WEBCHAT_TIMEOUT_MS = 15_000

let pending: Promise<void> | null = null
let loaded = false

export function webchatLoaded(): boolean {
  return loaded
}

export function loadWebchatScript(config: WebchatConfig, timeoutMs: number = WEBCHAT_TIMEOUT_MS): Promise<void> {
  if (typeof document === 'undefined') return Promise.reject(new Error('webchat_ssr'))
  if (loaded) return Promise.resolve()
  if (pending) return pending
  pending = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.id = WEBCHAT_SCRIPT_ID
    script.src = config.scriptUrl
    script.async = true
    script.dataset.widgetId = config.widgetId
    // Só a origem do site segue como referência, nunca o caminho com parâmetros.
    script.referrerPolicy = 'strict-origin'

    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      pending = null
      if (ok) {
        loaded = true
        resolve()
      } else {
        script.remove()
        reject(new Error('webchat_unavailable'))
      }
    }
    const timer = setTimeout(() => finish(false), timeoutMs)
    script.addEventListener('load', () => finish(true))
    script.addEventListener('error', () => finish(false))
    document.head.appendChild(script)
  })
  return pending
}

/** Somente para testes: volta ao estado inicial e remove o script inserido. */
export function resetWebchatLoader(): void {
  pending = null
  loaded = false
  if (typeof document !== 'undefined') document.getElementById(WEBCHAT_SCRIPT_ID)?.remove()
}
