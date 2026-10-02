import { describe, expect, it } from 'vitest'
import { renderRobots, seoBuildConfig } from './seo-config'

const production = { siteUrl: 'https://www.minhafolga.com.br', environment: 'production' }

describe('indexação do build', () => {
  it('usa o domínio configurado no backend quando não há override', () => {
    expect(seoBuildConfig({}, { ...production, siteUrl: 'https://site.example/' }).siteUrl).toBe('https://site.example')
  })
  it('produção só é indexável quando explicitamente habilitada', () => {
    expect(seoBuildConfig({}, production).indexable).toBe(false)
    expect(seoBuildConfig({ MF_INDEXABLE: '0' }, production).indexable).toBe(false)
    expect(seoBuildConfig({ MF_INDEXABLE: '1' }, production).indexable).toBe(true)
  })
  it.each(['development', 'staging'])('impede indexação de %s mesmo com a flag ativa', (environment) => {
    expect(() => seoBuildConfig({ MF_INDEXABLE: '1' }, { ...production, environment })).toThrow('produção')
  })
  it('impede sitemap e canonical de produção em um domínio diferente do backend', () => {
    expect(() => seoBuildConfig({ MF_INDEXABLE: '1', VITE_SITE_URL: 'https://outro.example' }, production)).toThrow('PUBLIC_SITE_URL')
  })
  it('permite rastrear HTML privado para reconhecer noindex e anuncia o sitemap', () => {
    const robots = renderRobots(production.siteUrl, true)
    expect(robots).toContain('Allow: /')
    expect(robots).toContain('Sitemap: https://www.minhafolga.com.br/sitemap.xml')
    expect(robots).not.toMatch(/Disallow: \/(?:admin|preferencias|cadastro-confirmado|atendimento)/)
    expect(renderRobots(production.siteUrl, false)).toBe('User-agent: *\nDisallow: /\n')
  })
})
