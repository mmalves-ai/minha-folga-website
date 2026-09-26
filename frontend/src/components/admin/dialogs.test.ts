// @vitest-environment jsdom
/**
 * Riscos concretos do painel (seção 12, WCAG 2.4.3): durante o envio os botões do diálogo ficarem
 * `disabled` e o foco cair no <body>; com erro do servidor, o diálogo continuar aberto sem foco dentro
 * dele; ao fechar depois de uma ação cujo botão de origem sumiu, o foco se perder e o próximo Tab
 * voltar ao topo da página. O jsdom não implementa <dialog> modal: o stub abaixo só abre, fecha e
 * dispara `close` como o navegador (o comportamento real é conferido no navegador).
 */
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import AdminDialog from './AdminDialog.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import ReasonDialog from './ReasonDialog.vue'

beforeAll(() => {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & { showModal: () => void; close: () => void }
  proto.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  proto.close = function (this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return
    this.removeAttribute('open')
    setTimeout(() => this.dispatchEvent(new Event('close')), 0)
  }
  if (!('open' in proto)) {
    Object.defineProperty(proto, 'open', {
      get(this: HTMLDialogElement) {
        return this.hasAttribute('open')
      },
    })
  }
  // Sem layout no jsdom: todo elemento conectado conta como visível para o retorno do foco.
  Element.prototype.getClientRects = function () {
    return (this.isConnected ? [{}] : []) as unknown as DOMRectList
  }
})

let wrapper: VueWrapper | null = null
afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

const tick = () => new Promise((r) => setTimeout(r, 5))

describe('diálogo de justificativa (revelar contato, exportar)', () => {
  it('envio: botões com aria-disabled (o foco fica no botão); erro do servidor recebe o foco dentro do diálogo', async () => {
    const Host = defineComponent({
      setup() {
        const busy = ref(false)
        const error = ref<string | null>(null)
        return { busy, error }
      },
      render() {
        return h(ReasonDialog, { open: true, title: 'Revelar o contato', confirmLabel: 'Revelar contato', busy: this.busy, error: this.error })
      },
    })
    wrapper = mount(Host, { attachTo: document.body })
    await flushPromises()
    const dialog = document.querySelector('dialog')!
    const submit = [...dialog.querySelectorAll('button')].find((b) => b.textContent?.includes('Revelar contato'))!
    submit.focus()
    ;(wrapper.vm as unknown as { busy: boolean }).busy = true
    await nextTick()
    for (const b of dialog.querySelectorAll('button')) expect(b.disabled, b.textContent ?? '').toBe(false)
    expect(submit.getAttribute('aria-disabled')).toBe('true')
    expect(document.activeElement).toBe(submit)

    ;(wrapper.vm as unknown as { busy: boolean; error: string | null }).busy = false
    ;(wrapper.vm as unknown as { error: string | null }).error = 'Não foi possível concluir agora.'
    await flushPromises()
    const alert = dialog.querySelector('[role="alert"]') as HTMLElement
    expect(alert?.textContent).toContain('Não foi possível concluir agora.')
    expect(document.activeElement).toBe(alert)
    expect(dialog.contains(document.activeElement)).toBe(true)
  })
})

describe('retorno do foco ao fechar', () => {
  it('botão de origem sumiu com a ação: o foco vai para o alvo indicado (e não para o <body>)', async () => {
    const Host = defineComponent({
      setup() {
        const open = ref(false)
        const done = ref(false)
        const result = ref<HTMLElement | null>(null)
        return { open, done, result }
      },
      render() {
        return h('div', [
          this.done
            ? h('p', { ref: 'result', tabindex: '-1', id: 'resultado' }, 'Telefone revelado')
            : h('button', { id: 'origem', onClick: () => (this.open = true) }, 'Revelar contato'),
          h(AdminDialog, { open: this.open, title: 'Revelar', returnFocus: () => this.result, 'onUpdate:open': (v: boolean) => (this.open = v) }, () =>
            h('button', { id: 'confirmar', onClick: () => ((this.done = true), (this.open = false)) }, 'Confirmar'),
          ),
        ])
      },
    })
    wrapper = mount(Host, { attachTo: document.body })
    const origin = document.getElementById('origem') as HTMLButtonElement
    origin.focus()
    origin.click()
    await flushPromises()
    expect(document.activeElement?.id).toBe('confirmar')
    ;(document.getElementById('confirmar') as HTMLButtonElement).click()
    await flushPromises()
    await tick()
    expect(document.getElementById('origem')).toBeNull()
    expect(document.activeElement?.id).toBe('resultado')
  })

  it('confirmação com caixa obrigatória: "Confirmar" só habilita marcada; durante o envio usa aria-disabled', async () => {
    const Host = defineComponent({
      setup() {
        return { busy: ref(false) }
      },
      render() {
        return h(ConfirmDialog, { open: true, title: 'Anonimizar?', confirmLabel: 'Anonimizar definitivamente', acknowledge: 'Entendo que é irreversível.', busy: this.busy })
      },
    })
    wrapper = mount(Host, { attachTo: document.body })
    await flushPromises()
    const dialog = document.querySelector('dialog')!
    const confirm = () => [...dialog.querySelectorAll('button')].find((b) => b.textContent?.includes('Anonimizar') || b.textContent?.includes('Salvando'))!
    expect(confirm().disabled).toBe(true)
    const box = dialog.querySelector('input[type="checkbox"]') as HTMLInputElement
    box.click()
    await nextTick()
    expect(confirm().disabled).toBe(false)
    confirm().focus()
    ;(wrapper.vm as unknown as { busy: boolean }).busy = true
    await nextTick()
    expect(confirm().disabled).toBe(false)
    expect(confirm().getAttribute('aria-disabled')).toBe('true')
    expect(document.activeElement).toBe(confirm())
  })
})
