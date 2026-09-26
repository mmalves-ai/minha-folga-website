/**
 * Riscos concretos das jornadas de relacionamento: UTM nunca carregar dado pessoal nem chave fora da
 * lista do contrato; o link de acompanhamento só abrir consulta com protocolo E token válidos (o
 * protocolo sozinho não basta); o token de preferências respeitar o contrato; número colado com +55
 * ou 0 chegar ao formato que o servidor aceita.
 */
import { afterEach, describe, expect, it } from 'vitest'
import validation from '@contracts/validation.json'
import { captureUtm, readUtm, resetUtm, sanitizeUtm } from '@/composables/useUtm'
import { normalizeBrazilianMobile } from '@/lib/phone'
import {
  looksLikeCity,
  looksLikeEmployer,
  looksLikeFullName,
  parsePreferencesToken,
  parseTrackingRef,
  PROTOCOL_PATTERN,
  stripCountryPrefix,
  trackingPath,
} from './form-helpers'

const PROTOCOL = 'MF-7K3P-9QXA-2M'
const TOKEN = 'Q2hhdmVEZVRlc3RlU2VndXJhMTIzNDU2Nzg5MEFCQ0RF'

/** Armazenamento que falha se alguém tentar gravar: a campanha fica só na memória da página. */
function installWriteGuardStorage() {
  const writes: string[] = []
  const storage = {
    getItem: () => null,
    setItem: (k: string) => void writes.push(k),
    removeItem: () => undefined,
    clear: () => undefined,
    key: () => null,
    length: 0,
  } as unknown as Storage
  ;(globalThis as { sessionStorage?: Storage }).sessionStorage = storage
  ;(globalThis as { localStorage?: Storage }).localStorage = storage
  return writes
}

afterEach(() => {
  resetUtm()
  delete (globalThis as { sessionStorage?: Storage }).sessionStorage
  delete (globalThis as { localStorage?: Storage }).localStorage
})

describe('UTM', () => {
  it('guarda só chaves permitidas pelo contrato, normalizadas', () => {
    const out = sanitizeUtm(new URLSearchParams('utm_source=Instagram&utm_medium=social&gclid=abc&utm_id=9&nome=ana'))
    expect(out).toEqual({ utm_source: 'instagram', utm_medium: 'social' })
    for (const key of Object.keys(out)) expect(validation.utm.allowedParams).toContain(key)
  })

  it('descarta valores que parecem telefone/documento ou fogem do padrão', () => {
    const out = sanitizeUtm(
      new URLSearchParams('utm_term=11912345678&utm_content=12345678901&utm_campaign=ana%40email.com&utm_source=com espaco&utm_medium=ok-1'),
    )
    expect(out).toEqual({ utm_medium: 'ok-1' })
  })

  it('o cadastro leva só o que foi validado, e nada é gravado no navegador', () => {
    const writes = installWriteGuardStorage()
    captureUtm('?utm_source=news&utm_term=11912345678&email=a%40b.com')
    expect(readUtm()).toEqual({ utm_source: 'news' })
    expect(writes).toEqual([])
  })

  it('sem campanha (ou sem armazenamento no navegador) o cadastro segue sem UTM', () => {
    expect(readUtm()).toBeUndefined()
    expect(() => captureUtm('?utm_source=x')).not.toThrow()
    expect(readUtm()).toEqual({ utm_source: 'x' })
  })

  it('URL sem UTM válida não apaga a campanha já capturada na página', () => {
    captureUtm('?utm_source=parceiro&utm_campaign=lancamento')
    captureUtm('?utm_term=11912345678')
    captureUtm('')
    expect(readUtm()).toEqual({ utm_source: 'parceiro', utm_campaign: 'lancamento' })
  })
})

describe('link seguro de acompanhamento', () => {
  it('aceita a URL completa, só o fragmento e texto colado com quebras de linha', () => {
    const expected = { protocol: PROTOCOL, token: TOKEN }
    expect(parseTrackingRef(`https://www.minhafolga.com.br${trackingPath(expected)}`)).toEqual(expected)
    expect(parseTrackingRef(`#p=${PROTOCOL}&t=${TOKEN}`)).toEqual(expected)
    expect(parseTrackingRef(`  https://www.minhafolga.com.br/atendimento/acompanhar#p=${PROTOCOL}&t=${TOKEN.slice(0, 20)}\n${TOKEN.slice(20)} `)).toEqual(
      expected,
    )
    expect(parseTrackingRef(`p=${PROTOCOL.toLowerCase()}&t=${TOKEN}`)).toEqual(expected)
  })

  it('protocolo sozinho, token curto ou protocolo fora do padrão não abrem consulta', () => {
    expect(parseTrackingRef(PROTOCOL)).toBeNull()
    expect(parseTrackingRef(`#p=${PROTOCOL}`)).toBeNull()
    expect(parseTrackingRef(`#p=${PROTOCOL}&t=curto`)).toBeNull()
    expect(parseTrackingRef(`#p=MF-7K3P-9QXA&t=${TOKEN}`)).toBeNull()
    expect(parseTrackingRef(`#p=${PROTOCOL}&t=${TOKEN}<script>`)).toBeNull()
  })

  it('protocolo e token ficam no fragmento (não vão ao servidor web nem ao Referer)', () => {
    const path = trackingPath({ protocol: PROTOCOL, token: TOKEN })
    expect(path.split('#')[0]).toBe('/atendimento/acompanhar')
    expect(path).not.toContain('?')
    expect(PROTOCOL_PATTERN.test(PROTOCOL)).toBe(true)
  })
})

describe('token de preferências', () => {
  it('respeita o tamanho do contrato (20 a 100) e o alfabeto de URL', () => {
    expect(parsePreferencesToken(`#token=${'a'.repeat(20)}`)).toBe('a'.repeat(20))
    expect(parsePreferencesToken(`#token=${'a'.repeat(19)}`)).toBeNull()
    expect(parsePreferencesToken(`#token=${'a'.repeat(101)}`)).toBeNull()
    expect(parsePreferencesToken(`#token=${'a'.repeat(25)}"><img>`)).toBeNull()
    expect(parsePreferencesToken('#outra=coisa')).toBeNull()
  })
})

describe('número colado pelo autopreenchimento', () => {
  it('+55 e 0 na frente chegam ao formato aceito', () => {
    for (const raw of ['+55 (11) 91234-5678', '5511912345678', '011912345678', '(11) 91234-5678']) {
      expect(normalizeBrazilianMobile(stripCountryPrefix(raw))).toBe(normalizeBrazilianMobile('11912345678'))
    }
    expect(normalizeBrazilianMobile('11912345678')).toBeTruthy()
  })
})

describe('campos do cadastro (mesmas regras do servidor)', () => {
  it('nome completo: letras de nomes e ao menos duas palavras; CPF, telefone e e-mail não passam', () => {
    expect(looksLikeFullName('Ana Maria de Souza')).toEqual({ chars: true, words: true })
    expect(looksLikeFullName("Joana D'Arc Conceição-Lima")).toEqual({ chars: true, words: true })
    expect(looksLikeFullName('Ana').words).toBe(false)
    expect(looksLikeFullName('Ana 52998224725').chars).toBe(false)
    expect(looksLikeFullName('ana@exemplo.com Souza').chars).toBe(false)
  })

  it('empresa: aceita números curtos no nome, recusa e-mail e número de documento', () => {
    expect(looksLikeEmployer('Padaria 2 Irmãos Ltda')).toBe(true)
    expect(looksLikeEmployer('Maria Helena Costa')).toBe(true)
    expect(looksLikeEmployer('12.345.678/0001-90')).toBe(false)
    expect(looksLikeEmployer('rh@empresa.com.br')).toBe(false)
  })

  it('cidade: nomes com acento, apóstrofo e hífen', () => {
    expect(looksLikeCity("São João d'Aliança")).toBe(true)
    expect(looksLikeCity('Embu-Guaçu')).toBe(true)
    expect(looksLikeCity('Cidade 123')).toBe(false)
  })
})
