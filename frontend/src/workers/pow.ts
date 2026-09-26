/**
 * Prova de trabalho do formulário (decisão D1, docs/DECISOES.md → Anti-robô), em JavaScript puro,
 * sem dependência: procurar o menor `nonce` (inteiro decimal a partir de 0) tal que
 * SHA-256(UTF-8("<challenge>:<nonce>")) tenha pelo menos `difficultyBits` bits zero à esquerda.
 * Usado pelo Web Worker (pow.worker.ts) e, sem Worker disponível, em fatias na página.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be,
  0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa,
  0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85,
  0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f,
  0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

const H0 = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]

const encoder = new TextEncoder()

/** Compressão de um bloco de 64 bytes (a partir de `offset`) sobre o estado `h`. */
function compress(h: Uint32Array, w: Uint32Array, block: Uint8Array, offset: number): void {
  for (let i = 0; i < 16; i++) {
    const j = offset + i * 4
    w[i] = (block[j]! << 24) | (block[j + 1]! << 16) | (block[j + 2]! << 8) | block[j + 3]!
  }
  for (let i = 16; i < 64; i++) {
    const x = w[i - 15]!
    const y = w[i - 2]!
    const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)
    const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10)
    w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) | 0
  }
  let a = h[0]!
  let b = h[1]!
  let c = h[2]!
  let d = h[3]!
  let e = h[4]!
  let f = h[5]!
  let g = h[6]!
  let hh = h[7]!
  for (let i = 0; i < 64; i++) {
    const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))
    const ch = (e & f) ^ (~e & g)
    const t1 = (hh + S1 + ch + K[i]! + w[i]!) | 0
    const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))
    const maj = (a & b) ^ (a & c) ^ (b & c)
    const t2 = (S0 + maj) | 0
    hh = g
    g = f
    f = e
    e = (d + t1) | 0
    d = c
    c = b
    b = a
    a = (t1 + t2) | 0
  }
  h[0] = (h[0]! + a) | 0
  h[1] = (h[1]! + b) | 0
  h[2] = (h[2]! + c) | 0
  h[3] = (h[3]! + d) | 0
  h[4] = (h[4]! + e) | 0
  h[5] = (h[5]! + f) | 0
  h[6] = (h[6]! + g) | 0
  h[7] = (h[7]! + hh) | 0
}

/** SHA-256 (FIPS 180-4) de bytes quaisquer. */
export function sha256(data: Uint8Array): Uint8Array {
  const length = Math.ceil((data.length + 9) / 64) * 64
  const padded = new Uint8Array(length)
  padded.set(data)
  padded[data.length] = 0x80
  const bits = data.length * 8
  const view = new DataView(padded.buffer)
  view.setUint32(length - 8, Math.floor(bits / 0x100000000))
  view.setUint32(length - 4, bits >>> 0)
  const h = new Uint32Array(H0)
  const w = new Uint32Array(64)
  for (let offset = 0; offset < length; offset += 64) compress(h, w, padded, offset)
  const out = new Uint8Array(32)
  const outView = new DataView(out.buffer)
  for (let i = 0; i < 8; i++) outView.setUint32(i * 4, h[i]!)
  return out
}

export function sha256Hex(text: string): string {
  return Array.from(sha256(encoder.encode(text)), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Bits zero à esquerda de um resumo (do bit mais significativo do primeiro byte em diante). */
export function leadingZeroBits(digest: Uint8Array): number {
  let n = 0
  for (const byte of digest) {
    if (byte === 0) {
      n += 8
      continue
    }
    return n + Math.clz32(byte) - 24
  }
  return n
}

/** Confere uma prova com o SHA-256 genérico (mesma regra do servidor). */
export function verifyProof(challenge: string, nonce: string, difficultyBits: number): boolean {
  if (!/^\d{1,16}$/.test(nonce)) return false
  return leadingZeroBits(sha256(encoder.encode(`${challenge}:${nonce}`))) >= difficultyBits
}

function hasLeadingZeros(h: Uint32Array, bits: number): boolean {
  let remaining = bits
  for (let i = 0; i < 8 && remaining > 0; i++) {
    const word = h[i]! >>> 0
    if (remaining >= 32) {
      if (word !== 0) return false
      remaining -= 32
    } else {
      return Math.clz32(word) >= remaining
    }
  }
  return remaining <= 0
}

/**
 * Busca incremental da prova. `run(count)` testa os próximos `count` nonces e devolve o primeiro que
 * atende à dificuldade (como texto decimal) ou null; `next` indica de onde a busca continua.
 * Mensagens de um bloco (o caso do contrato: desafio de 22 caracteres) reaproveitam os buffers.
 */
export class PowSearch {
  next = 0
  private readonly prefix: Uint8Array
  private readonly bits: number
  private readonly block = new Uint8Array(64)
  private readonly h = new Uint32Array(8)
  private readonly w = new Uint32Array(64)

  constructor(
    private readonly challenge: string,
    difficultyBits: number,
  ) {
    if (!Number.isInteger(difficultyBits) || difficultyBits < 0 || difficultyBits > 256) throw new RangeError('difficultyBits')
    this.prefix = encoder.encode(`${challenge}:`)
    this.bits = difficultyBits
    // Prefixo que cabe num bloco (o caso do contrato): fica gravado no buffer reaproveitado.
    if (this.prefix.length <= 55) this.block.set(this.prefix)
  }

  run(count: number): string | null {
    const end = this.next + count
    for (let nonce = this.next; nonce < end; nonce++) {
      const text = String(nonce)
      if (this.test(text)) {
        this.next = nonce + 1
        return text
      }
    }
    this.next = end
    return null
  }

  private test(nonce: string): boolean {
    const length = this.prefix.length + nonce.length
    // Fora de um bloco (desafio longo fora do contrato): caminho genérico, mais lento, mesmo resultado.
    if (length > 55) return verifyProof(this.challenge, nonce, this.bits)
    const block = this.block
    let p = this.prefix.length
    for (let i = 0; i < nonce.length; i++) block[p++] = nonce.charCodeAt(i)
    block[p++] = 0x80
    block.fill(0, p, 60)
    const bits = length * 8
    block[60] = (bits >>> 24) & 0xff
    block[61] = (bits >>> 16) & 0xff
    block[62] = (bits >>> 8) & 0xff
    block[63] = bits & 0xff
    this.h.set(H0)
    compress(this.h, this.w, block, 0)
    return hasLeadingZeros(this.h, this.bits)
  }
}

/** Resolve de uma vez (worker ou testes). `maxTries` evita laço sem fim com dificuldade absurda. */
export function solveProof(challenge: string, difficultyBits: number, maxTries = 2 ** Math.min(difficultyBits + 8, 40)): string | null {
  const search = new PowSearch(challenge, difficultyBits)
  const step = 50_000
  while (search.next < maxTries) {
    const found = search.run(Math.min(step, maxTries - search.next))
    if (found !== null) return found
  }
  return null
}
