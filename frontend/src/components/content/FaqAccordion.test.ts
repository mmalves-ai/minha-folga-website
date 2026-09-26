// @vitest-environment jsdom
/**
 * Risco concreto (seções 4 e 6.11): no resumo de dúvidas da página de produto, um link relacionado
 * levar ao topo da própria página. Links para a própria página somem; âncora da mesma página vira
 * link nativo para a seção; nas outras páginas (ex.: /ajuda) todos os links continuam.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import type { FaqItem } from '@/types/content'
import FaqAccordion from './FaqAccordion.vue'

const Stub = defineComponent({ render: () => h('div') })
const items = [
  {
    id: 'mei',
    category: 'consignado',
    showOn: ['consignado'],
    question: 'Sou MEI?',
    answer_md: '<p>Resposta.</p>',
    related: [
      { label: 'Consignado privado', to: '/consignado-privado' },
      { label: 'Para quem estamos preparando', to: '/consignado-privado#para-quem' },
      { label: 'Quero ser avisado', to: '/avise-me' },
    ],
  },
] as unknown as FaqItem[]

async function linksAt(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: ['/consignado-privado', '/ajuda', '/avise-me'].map((p) => ({ path: p, component: Stub })),
  })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(FaqAccordion, { props: { items }, global: { plugins: [router] } })
  const links = wrapper.findAll('.faq-related a').map((a) => [a.text(), a.attributes('href')])
  wrapper.unmount()
  return links
}

describe('links relacionados do acordeão de dúvidas', () => {
  it('na página de produto, omite o link para a própria página e usa âncora nativa para a seção', async () => {
    expect(await linksAt('/consignado-privado')).toEqual([
      ['Para quem estamos preparando', '#para-quem'],
      ['Quero ser avisado', '/avise-me'],
    ])
  })

  it('na central de ajuda, mantém todos os links, inclusive a âncora da página de produto', async () => {
    expect(await linksAt('/ajuda')).toEqual([
      ['Consignado privado', '/consignado-privado'],
      ['Para quem estamos preparando', '/consignado-privado#para-quem'],
      ['Quero ser avisado', '/avise-me'],
    ])
  })
})
