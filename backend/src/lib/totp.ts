import { createHmac, randomBytes } from 'node:crypto'
import { safeEqual } from './crypto.js'

/**
 * TOTP (RFC 6238) compatível com aplicativos autenticadores: HMAC-SHA-1, passo de 30 s, 6 dígitos,
 * tolerância de ±1 passo para diferença de relógio. O último passo aceito fica gravado para impedir
 * que o mesmo código seja usado duas vezes.
 */
export const TOTP_PERIOD_SECONDS = 30
export const TOTP_DIGITS = 6
export const TOTP_WINDOW = 1
export const TOTP_ISSUER = 'Minha Folga'

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(buf: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, '')
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const char of clean) {
    const idx = BASE32.indexOf(char)
    if (idx < 0) throw new Error('base32 inválido')
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

/** Segredo novo: 20 bytes aleatórios (160 bits, recomendado pela RFC 4226), em base32. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20))
}

export function totpStep(now: Date): number {
  return Math.floor(now.getTime() / 1000 / TOTP_PERIOD_SECONDS)
}

/** HOTP (RFC 4226) com truncamento dinâmico. */
export function hotp(key: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(counter))
  const mac = createHmac('sha1', key).update(msg).digest()
  const offset = mac[mac.length - 1]! & 0x0f
  const binary =
    ((mac[offset]! & 0x7f) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!
  return String(binary % 10 ** digits).padStart(digits, '0')
}

export function totpCode(secretBase32: string, now: Date): string {
  return hotp(base32Decode(secretBase32), totpStep(now))
}

/**
 * Confere o código na janela ±1. Passos iguais ou anteriores a `lastStep` são recusados (reuso).
 * Retorna o passo aceito, que deve ser gravado como novo `lastStep`, ou null.
 */
export function verifyTotp(secretBase32: string, code: string, now: Date, lastStep: number | null): number | null {
  if (!/^\d{6}$/.test(code)) return null
  const key = base32Decode(secretBase32)
  const current = totpStep(now)
  let accepted: number | null = null
  // Percorre toda a janela (sem sair cedo) para não variar o tempo conforme o passo.
  for (let offset = -TOTP_WINDOW; offset <= TOTP_WINDOW; offset++) {
    const step = current + offset
    const matches = safeEqual(hotp(key, step), code)
    if (matches && accepted === null && (lastStep === null || step > lastStep)) accepted = step
  }
  return accepted
}

/** URL otpauth:// para o aplicativo autenticador (conta = e-mail da pessoa). */
export function otpauthUrl(secretBase32: string, accountName: string): string {
  const label = `${encodeURIComponent(TOTP_ISSUER)}:${encodeURIComponent(accountName)}`
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer: TOTP_ISSUER,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  })
  return `otpauth://totp/${label}?${params.toString().replace(/\+/g, '%20')}`
}
