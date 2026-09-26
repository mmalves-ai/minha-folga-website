// @vitest-environment jsdom
/**
 * Risco concreto (seções 5, 6.16 e 9): a atribuição de campanha gravar algo no navegador sem constar da
 * Política de cookies e sem escolha do visitante. A campanha fica só na memória da página, segue com o
 * cadastro e nunca carrega chave fora do contrato nem valor que pareça dado pessoal.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { captureUtm, readUtm, resetUtm } from './useUtm'

function storageSnapshot() {
  return { local: localStorage.length, session: sessionStorage.length, cookie: document.cookie }
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  resetUtm()
})

afterEach(() => resetUtm())

describe('UTM na memória da página', () => {
  it('captura só as chaves permitidas e não grava nada no navegador', () => {
    const before = storageSnapshot()
    expect(captureUtm('?utm_source=Instagram&utm_campaign=lancamento&gclid=abc&nome=ana')).toEqual({
      utm_source: 'instagram',
      utm_campaign: 'lancamento',
    })
    expect(readUtm()).toEqual({ utm_source: 'instagram', utm_campaign: 'lancamento' })
    expect(storageSnapshot()).toEqual(before)
    expect(sessionStorage.getItem('mf_utm')).toBeNull()
  })

  it('navegação interna sem UTM válida não apaga a campanha já capturada', () => {
    captureUtm('?utm_source=parceiro&utm_campaign=lancamento')
    captureUtm('')
    captureUtm('?utm_term=11912345678')
    expect(readUtm()).toEqual({ utm_source: 'parceiro', utm_campaign: 'lancamento' })
  })

  it('nova campanha válida substitui a anterior; sem campanha, nada segue no cadastro', () => {
    expect(readUtm()).toBeUndefined()
    captureUtm('?utm_source=news')
    captureUtm('?utm_source=parceiro&utm_medium=social')
    expect(readUtm()).toEqual({ utm_source: 'parceiro', utm_medium: 'social' })
  })

  it('valor guardado não pode ser alterado por quem o leu', () => {
    captureUtm('?utm_source=news')
    const utm = readUtm()!
    utm.utm_source = 'adulterado'
    expect(readUtm()).toEqual({ utm_source: 'news' })
  })

  it('valor antigo deixado no sessionStorage por uma versão anterior é ignorado', () => {
    sessionStorage.setItem('mf_utm', JSON.stringify({ utm_source: 'antigo' }))
    expect(readUtm()).toBeUndefined()
  })
})
