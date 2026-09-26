import { onMounted } from 'vue'

/**
 * Anúncios de status para leitores de tela (WCAG 2.2, critério 4.1.3), compartilhados pelas telas
 * públicas de relacionamento e pelo painel.
 *
 * Leitores de tela só acompanham regiões vivas que JÁ existem antes da mudança de conteúdo: um bloco
 * `role="status"` criado por `v-if` junto com o texto costuma passar em silêncio. Por isso há uma única
 * região persistente no <body>, fora de qualquer `v-if`, criada ao montar a primeira tela que usa o
 * composable (antes de qualquer ação da pessoa). Só o texto dela muda:
 * - a região é esvaziada e o texto entra depois de um instante, para a mesma mensagem ser anunciada de
 *   novo e para o anúncio não competir com a mudança de foco feita pela tela;
 * - com um <dialog> modal aberto, o resto da página fica inerte (fora da árvore de acessibilidade):
 *   o texto espera o diálogo fechar (por no máximo alguns segundos);
 * - o texto sai da região depois de um tempo, para não sobrar mensagem antiga no fim da página.
 *
 * A tela continua mostrando a confirmação visível no lugar de sempre, SEM `role="status"` (o anúncio
 * é feito aqui; os dois juntos seriam lidos em dobro). Erros continuam com `role="alert"`.
 */
export const ANNOUNCER_ID = 'mf-anuncios'

const DELAY_MS = 150
const MODAL_RETRY_MS = 100
const MODAL_MAX_TRIES = 30
const CLEAR_AFTER_MS = 10_000

let pending: ReturnType<typeof setTimeout> | undefined
let clearing: ReturnType<typeof setTimeout> | undefined

function region(): HTMLElement | null {
  if (typeof document === 'undefined' || !document.body) return null
  const existing = document.getElementById(ANNOUNCER_ID)
  if (existing) return existing
  const el = document.createElement('div')
  el.id = ANNOUNCER_ID
  el.className = 'visually-hidden'
  el.setAttribute('role', 'status')
  el.setAttribute('aria-live', 'polite')
  el.setAttribute('aria-atomic', 'true')
  document.body.appendChild(el)
  return el
}

function modalOpen(): boolean {
  try {
    return Boolean(document.querySelector('dialog:modal'))
  } catch {
    // Navegador (ou ambiente de teste) sem a pseudo-classe :modal.
    return false
  }
}

/** Anuncia `message` na região persistente. Texto vazio só limpa a região. */
export function announce(message: string): void {
  const el = region()
  if (!el) return
  clearTimeout(pending)
  clearTimeout(clearing)
  el.textContent = ''
  const text = message.trim()
  if (!text) return
  let tries = 0
  const put = () => {
    if (modalOpen() && tries++ < MODAL_MAX_TRIES) {
      pending = setTimeout(put, MODAL_RETRY_MS)
      return
    }
    el.textContent = text
    clearing = setTimeout(() => {
      if (el.textContent === text) el.textContent = ''
    }, CLEAR_AFTER_MS)
  }
  pending = setTimeout(put, DELAY_MS)
}

/** Garante a região viva desde a montagem da tela e devolve `announce`. */
export function useAnnouncer() {
  onMounted(() => void region())
  return { announce }
}
