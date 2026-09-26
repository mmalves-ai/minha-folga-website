/**
 * Prova de trabalho do formulário (decisão D1): o SHA-256 em JavaScript puro precisa bater com a
 * referência (vetores do FIPS 180-4 e Web Crypto) e a prova encontrada precisa ser a que o servidor
 * aceita: SHA-256(UTF-8("<challenge>:<nonce>")) com pelo menos `difficultyBits` bits zero à esquerda.
 */
import { describe, expect, it } from 'vitest'
import validation from '@contracts/validation.json'
import { leadingZeroBits, PowSearch, sha256, sha256Hex, solveProof, verifyProof } from './pow'

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

async function reference(text: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))))
}

describe('SHA-256 em JavaScript puro', () => {
  it('vetores do FIPS 180-4', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    )
  })

  it('bate com o Web Crypto em tamanhos na fronteira do bloco e com acentos', async () => {
    for (const n of [1, 54, 55, 56, 63, 64, 65, 119, 120, 200]) {
      const text = 'x'.repeat(n)
      expect(sha256Hex(text), `tamanho ${n}`).toBe(await reference(text))
    }
    expect(sha256Hex('Minha Folga: ação, ônus e crédito')).toBe(await reference('Minha Folga: ação, ônus e crédito'))
  })

  it('conta bits zero à esquerda a partir do primeiro byte', () => {
    expect(leadingZeroBits(new Uint8Array([0x00, 0x00, 0x80]))).toBe(16)
    expect(leadingZeroBits(new Uint8Array([0x00, 0x0f]))).toBe(12)
    expect(leadingZeroBits(new Uint8Array([0x80]))).toBe(0)
    expect(leadingZeroBits(new Uint8Array([0x01]))).toBe(7)
    expect(leadingZeroBits(new Uint8Array(4))).toBe(32)
  })
})

describe('busca da prova', () => {
  const challenge = 'q7Xw3c2ZkPpV9mT1bY0aHg' // 16 bytes em base64url, como no contrato

  it('encontra o MENOR nonce que atende à dificuldade, igual à verificação genérica', () => {
    for (const bits of [0, 1, 4, 8, 12]) {
      const nonce = solveProof(challenge, bits)!
      expect(nonce, `dificuldade ${bits}`).toMatch(/^\d+$/)
      expect(verifyProof(challenge, nonce, bits)).toBe(true)
      for (let n = 0; n < Number(nonce); n++) expect(verifyProof(challenge, String(n), bits)).toBe(false)
    }
  })

  it('a dificuldade do contrato é resolvida e conferida pelo mesmo critério do servidor', async () => {
    const bits = validation.waitlist.antiBot.difficultyBits
    const nonce = solveProof(challenge, bits)!
    expect(verifyProof(challenge, nonce, bits)).toBe(true)
    const digest = await reference(`${challenge}:${nonce}`)
    expect(leadingZeroBits(Uint8Array.from(digest.match(/../g)!.map((b) => parseInt(b, 16))))).toBeGreaterThanOrEqual(bits)
  })

  it('a busca em fatias continua de onde parou e chega ao mesmo resultado', () => {
    const search = new PowSearch(challenge, 10)
    let found: string | null = null
    while (found === null) found = search.run(97)
    expect(found).toBe(solveProof(challenge, 10))
  })

  it('desafio longo (fora de um bloco) usa o caminho genérico e continua correto', () => {
    const long = 'a'.repeat(80)
    const nonce = solveProof(long, 6)!
    expect(verifyProof(long, nonce, 6)).toBe(true)
  })

  it('nonce fora do formato decimal nunca é aceito', () => {
    expect(verifyProof(challenge, '-1', 0)).toBe(false)
    expect(verifyProof(challenge, '1e3', 0)).toBe(false)
    expect(verifyProof(challenge, '', 0)).toBe(false)
  })

  it('SHA-256 de bytes arbitrários (não só texto)', async () => {
    const bytes = Uint8Array.from({ length: 300 }, (_, i) => (i * 37) % 256)
    const expected = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    expect(hex(sha256(bytes))).toBe(expected)
  })
})
