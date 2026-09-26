// @vitest-environment jsdom
/**
 * Riscos concretos (seções 4, 6.1 e 12): a página de produto ficar sem item ativo na navegação e o
 * menu móvel aberto deixar o conteúdo encoberto disponível para leitor de tela e teclado.
 * A medida do painel (altura da janela, CTA visível) é conferida no e2e (e2e/journeys.spec.ts).
 */
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { createMemoryHistory, createRouter, type RouteRecordRaw } from 'vue-router'
import { routes } from '@/router/routes'
import SiteHeader from './SiteHeader.vue'

const Stub = defineComponent({ render: () => h('div') })

async function mountAt(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: routes.map((r) => ({ path: r.path, name: r.name, meta: r.meta, component: Stub }) as RouteRecordRaw),
  })
  await router.push(path)
  await router.isReady()
  // Mesmo arranjo do DefaultLayout: link de pular, cabeçalho, conteúdo e rodapé como irmãos em #app.
  const App = defineComponent({
    render: () => [h('a', { class: 'skip-link', href: '#conteudo' }, 'Pular'), h(SiteHeader), h('main', { id: 'conteudo' }), h('footer', { class: 'site-footer' })],
  })
  const app = document.createElement('div')
  app.id = 'app'
  document.body.appendChild(app)
  return mount(App, { attachTo: app, global: { plugins: [router] } })
}

let wrapper: VueWrapper | null = null
afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
  document.body.className = ''
})

const activeLabels = (w: VueWrapper) =>
  w.findAll('.site-header__nav .site-header__link.is-active').map((a) => [a.text(), a.attributes('aria-current')])

describe('item ativo da navegação principal', () => {
  it('/consignado-privado deixa "Soluções" ativo (seção declarada na rota), no cabeçalho e no menu', async () => {
    wrapper = await mountAt('/consignado-privado')
    expect(activeLabels(wrapper)).toEqual([['Soluções', 'true']])
    const panel = wrapper.findAll('#menu-principal-movel .site-header__panel-link.is-active').map((a) => a.text())
    expect(panel).toEqual(['Soluções'])
  })

  it('a própria página recebe aria-current="page"; artigos ativam "Conteúdos" como seção', async () => {
    wrapper = await mountAt('/solucoes')
    expect(activeLabels(wrapper)).toEqual([['Soluções', 'page']])
    wrapper.unmount()
    document.body.innerHTML = ''
    wrapper = await mountAt('/conteudos/o-que-e-cet')
    expect(activeLabels(wrapper)).toEqual([['Conteúdos', 'true']])
  })
})

describe('menu móvel aberto', () => {
  it('deixa inertes o link de pular, o conteúdo e o rodapé, e devolve tudo ao fechar com Esc', async () => {
    wrapper = await mountAt('/')
    const toggle = wrapper.get('button[aria-controls="menu-principal-movel"]')
    const background = () => ['.skip-link', '#conteudo', 'footer'].map((s) => document.querySelector(s)!.hasAttribute('inert'))

    await toggle.trigger('click')
    await nextTick()
    expect(toggle.attributes('aria-expanded')).toBe('true')
    expect(background()).toEqual([true, true, true])
    expect(document.querySelector('header')!.hasAttribute('inert')).toBe(false)
    expect(document.body.classList.contains('menu-open')).toBe(true)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(background()).toEqual([false, false, false])
    expect(document.body.classList.contains('menu-open')).toBe(false)
  })

  it('não remove um inert que já existia antes de abrir (ex.: diálogo de cookies)', async () => {
    wrapper = await mountAt('/')
    document.querySelector('footer')!.setAttribute('inert', '')
    const toggle = wrapper.get('button[aria-controls="menu-principal-movel"]')
    await toggle.trigger('click')
    await toggle.trigger('click')
    expect(document.querySelector('#conteudo')!.hasAttribute('inert')).toBe(false)
    expect(document.querySelector('footer')!.hasAttribute('inert')).toBe(true)
  })
})
