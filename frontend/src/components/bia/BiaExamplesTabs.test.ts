// @vitest-environment jsdom
/**
 * Risco concreto (seção 10 e contrato de eventos): a medição da demonstração da Bia enviar algo fora da
 * lista do contrato. A troca de aba registra só o id fixo do exemplo (bia_example_id), uma vez por
 * exemplo, e nada quando a aba já estava ativa. O envio real depende de configuração e consentimento
 * (conferidos em services/analytics.test.ts).
 */
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import site from '@content/site.yaml'

const trackOnce = vi.fn()
vi.mock('@/services/analytics', () => ({ trackOnce: (...args: unknown[]) => trackOnce(...args) }))

const { default: BiaExamplesTabs } = await import('./BiaExamplesTabs.vue')
const { buildEvent } = await vi.importActual<typeof import('@/services/analytics')>('@/services/analytics')

beforeEach(() => trackOnce.mockClear())

describe('abas de exemplos da Bia', () => {
  it('registra a troca de exemplo com o id do contrato e ignora a aba que já está ativa', async () => {
    const wrapper = mount(BiaExamplesTabs)
    const tabs = wrapper.findAll('[role="tab"]')
    await tabs[0]!.trigger('click')
    expect(trackOnce).not.toHaveBeenCalled()
    await tabs[1]!.trigger('click')
    await tabs[2]!.trigger('keydown', { key: 'ArrowRight' })
    expect(trackOnce.mock.calls).toEqual([
      ['bia_demo_tab', 'prazo-parcela'],
      ['bia_demo_tab', 'cet'],
    ])
    expect(tabs[0]!.attributes('aria-selected')).toBe('true')
    wrapper.unmount()
  })

  it('todo exemplo do conteúdo é uma dimensão aceita pelo contrato de eventos', () => {
    for (const { id } of site.biaExamples as { id: string }[]) {
      expect(buildEvent('bia_demo_tab', id), id).toEqual({ name: 'bia_demo_tab', dimension: id })
    }
  })
})
