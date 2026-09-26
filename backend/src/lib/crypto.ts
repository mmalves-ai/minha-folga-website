import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto'

/**
 * Chaveiro de cifragem de campos (AES-256-GCM).
 * Formato da variável: `base64` (chave única, id "k1") ou `id:base64,id:base64` (a primeira é a ativa;
 * as demais só decifram, permitindo rotação). Cada chave precisa ter 32 bytes.
 */
export interface Keyring {
  activeId: string
  keys: Map<string, Buffer>
}

export function parseKeyring(value: string): Keyring {
  const entries = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const keys = new Map<string, Buffer>()
  let activeId = ''
  entries.forEach((entry, index) => {
    const sep = entry.indexOf(':')
    const id = sep > 0 ? entry.slice(0, sep) : 'k1'
    const material = sep > 0 ? entry.slice(sep + 1) : entry
    const key = Buffer.from(material, 'base64')
    if (key.length !== 32) throw new Error(`chave "${id}" precisa ter 32 bytes em base64`)
    if (!/^[a-z0-9]{1,8}$/i.test(id)) throw new Error('id de chave inválido')
    keys.set(id, key)
    if (index === 0) activeId = id
  })
  if (!activeId) throw new Error('nenhuma chave informada')
  return { activeId, keys }
}

const b64u = (buf: Buffer) => buf.toString('base64url')

/** Cifra um valor. `context` entra como dado autenticado (AAD) e impede trocar cifras entre campos. */
export function encryptField(plaintext: string, keyring: Keyring, context: string): string {
  const key = keyring.keys.get(keyring.activeId)!
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(context))
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${keyring.activeId}.${b64u(iv)}.${b64u(tag)}.${b64u(ct)}`
}

export function decryptField(token: string, keyring: Keyring, context: string): string {
  const [id, iv, tag, ct] = token.split('.')
  if (!id || !iv || !tag || ct === undefined) throw new Error('cifra malformada')
  const key = keyring.keys.get(id)
  if (!key) throw new Error('chave de cifragem indisponível para este registro')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'))
  decipher.setAAD(Buffer.from(context))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8')
}

/** Chave de deduplicação (HMAC-SHA256). Não é anonimização: continua sendo dado pessoal pseudonimizado. */
export function hmacHex(value: string, key: Buffer | string, domain: string): string {
  return createHmac('sha256', key).update(`${domain}\u0000${value}`).digest('hex')
}

/** Hash para armazenar tokens aleatórios de alta entropia (sessões, links, protocolos de acompanhamento). */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

/** Código numérico de uso único, com distribuição uniforme. */
export function randomNumericCode(length = 6): string {
  let out = ''
  for (let i = 0; i < length; i++) out += String(randomInt(0, 10))
  return out
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** Protocolo aleatório legível (ex.: MF-7K3P-9QXA-2M). Não é sequencial nem deriva de dados pessoais. */
export function randomProtocol(): string {
  let raw = ''
  for (let i = 0; i < 10; i++) raw += CROCKFORD[randomInt(0, CROCKFORD.length)]
  return `MF-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`
}
