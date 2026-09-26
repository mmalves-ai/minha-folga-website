// @vitest-environment jsdom
/**
 * Risco concreto (seção 12, WCAG 4.1.3): confirmação que aparece na tela sem ser anunciada. Leitores de
 * tela só acompanham regiões vivas que já existiam antes da mudança; por isso a região é única, criada
 * ao montar a tela (vazia) e só o texto muda. Mensagem repetida precisa ser anunciada de novo, e com um
 * diálogo modal aberto (resto da página inerte) o texto espera o diálogo fechar.
 */
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { ANNOUNCER_ID, announce, useAnnouncer } from './useAnnouncer'

const Screen = defineComponent({
  setup() {
    useAnnouncer()
    return () => h('p', 'tela')
  },
})

const region = () => document.getElementById(ANNOUNCER_ID)

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('useAnnouncer', () => {
  it('cria uma única região viva, vazia, já ao montar a tela (antes de qualquer ação)', () => {
    const a = mount(Screen, { attachTo: document.body })
    const b = mount(Screen, { attachTo: document.body })
    const el = region()
    expect(el).not.toBeNull()
    expect(document.querySelectorAll(`#${ANNOUNCER_ID}`)).toHaveLength(1)
    expect(el!.getAttribute('role')).toBe('status')
    expect(el!.getAttribute('aria-live')).toBe('polite')
    expect(el!.textContent).toBe('')
    a.unmount()
    b.unmount()
    // A região não depende da tela montada: continua no <body> para o próximo anúncio.
    expect(region()).not.toBeNull()
  })

  it('muda só o texto, depois de um instante, e anuncia de novo a mesma mensagem', () => {
    mount(Screen, { attachTo: document.body })
    const el = region()!
    announce('Suas preferências foram salvas.')
    expect(el.textContent).toBe('')
    vi.advanceTimersByTime(200)
    expect(el.textContent).toBe('Suas preferências foram salvas.')

    // Mesma mensagem: a região esvazia e volta a ser preenchida (é uma mudança para o leitor de tela).
    announce('Suas preferências foram salvas.')
    expect(el.textContent).toBe('')
    vi.advanceTimersByTime(200)
    expect(el.textContent).toBe('Suas preferências foram salvas.')
    expect(region()).toBe(el)
  })

  it('espera o diálogo modal fechar antes de pôr o texto (fundo inerte não é lido)', () => {
    mount(Screen, { attachTo: document.body })
    let modal = true
    const original = document.querySelector.bind(document)
    const spy = vi.spyOn(document, 'querySelector').mockImplementation(((sel: string) =>
      sel === 'dialog:modal' ? (modal ? document.body : null) : original(sel)) as typeof document.querySelector)
    announce('Exportação gerada.')
    vi.advanceTimersByTime(600)
    expect(region()!.textContent).toBe('')
    modal = false
    vi.advanceTimersByTime(200)
    expect(region()!.textContent).toBe('Exportação gerada.')
    spy.mockRestore()
  })

  it('limpa o texto depois de um tempo e aceita texto vazio para só limpar', () => {
    mount(Screen, { attachTo: document.body })
    announce('Status alterado para “Em andamento”.')
    vi.advanceTimersByTime(200)
    expect(region()!.textContent).not.toBe('')
    vi.advanceTimersByTime(11_000)
    expect(region()!.textContent).toBe('')
    announce('Algo')
    announce('')
    vi.advanceTimersByTime(500)
    expect(region()!.textContent).toBe('')
  })
})
