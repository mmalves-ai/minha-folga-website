import { randomBytes, randomInt, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto'

/**
 * Senhas da área administrativa com scrypt (N=32768, r=8, p=1), sal aleatório de 16 bytes e
 * saída de 64 bytes. Formato versionado, para permitir trocar parâmetros sem invalidar hashes antigos:
 *   scrypt$v1$32768$8$1$<sal base64url>$<hash base64url>
 */
const VERSION = 'v1'
const PARAMS = { N: 32768, r: 8, p: 1 } as const
const KEY_LENGTH = 64
const SALT_BYTES = 16

export const PASSWORD_MIN_LENGTH = 12
export const PASSWORD_MAX_LENGTH = 200

function derive(password: string, salt: Buffer, N: number, r: number, p: number): Promise<Buffer> {
  // maxmem acima do padrão (32 MiB): scrypt usa 128 * N * r bytes.
  const options: ScryptOptions = { N, r, p, maxmem: 256 * N * r }
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, options, (err, key) => (err ? reject(err) : resolve(key)))
  })
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES)
  const key = await derive(password, salt, PARAMS.N, PARAMS.r, PARAMS.p)
  return ['scrypt', VERSION, PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64url'), key.toString('base64url')].join('$')
}

interface ParsedHash {
  N: number
  r: number
  p: number
  salt: Buffer
  key: Buffer
}

function parseHash(stored: string): ParsedHash | null {
  const parts = stored.split('$')
  if (parts.length !== 7 || parts[0] !== 'scrypt' || parts[1] !== VERSION) return null
  const [N, r, p] = [Number(parts[2]), Number(parts[3]), Number(parts[4])]
  // Limites evitam que um hash adulterado force custo de memória/CPU abusivo.
  if (!Number.isInteger(N) || N < 16384 || N > 1_048_576 || (N & (N - 1)) !== 0) return null
  if (!Number.isInteger(r) || r < 1 || r > 16 || !Number.isInteger(p) || p < 1 || p > 4) return null
  const salt = Buffer.from(parts[5] ?? '', 'base64url')
  const key = Buffer.from(parts[6] ?? '', 'base64url')
  if (salt.length < 16 || key.length !== KEY_LENGTH) return null
  return { N, r, p, salt, key }
}

/** Compara em tempo constante. Hash desconhecido ou malformado nunca confere. */
export async function verifyPassword(stored: string, candidate: string): Promise<boolean> {
  const parsed = parseHash(stored)
  if (!parsed) {
    // Mantém o custo equivalente mesmo com hash inválido.
    await verifyAgainstDummy(candidate)
    return false
  }
  const key = await derive(candidate, parsed.salt, parsed.N, parsed.r, parsed.p)
  return timingSafeEqual(key, parsed.key)
}

let dummyHash: Promise<string> | null = null

/**
 * Hash fictício com o mesmo custo, usado quando o e-mail não existe: o tempo de resposta
 * não revela se a conta existe.
 */
export async function verifyAgainstDummy(candidate: string): Promise<false> {
  dummyHash ??= hashPassword(randomBytes(24).toString('base64url'))
  const parsed = parseHash(await dummyHash)!
  const key = await derive(candidate, parsed.salt, parsed.N, parsed.r, parsed.p)
  timingSafeEqual(key, parsed.key)
  return false
}

/** Regras da senha escolhida pela pessoa. Retorna a mensagem de erro ou null. */
export function passwordPolicyError(password: string, email: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Use pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`
  if (password.length > PASSWORD_MAX_LENGTH) return `Use no máximo ${PASSWORD_MAX_LENGTH} caracteres.`
  const lower = password.toLowerCase()
  const normalizedEmail = email.trim().toLowerCase()
  const localPart = normalizedEmail.split('@')[0] ?? ''
  if (lower.includes(normalizedEmail) || (localPart.length >= 4 && lower.includes(localPart))) {
    return 'A senha não pode conter o seu e-mail.'
  }
  if (/^(.)\1+$/.test(password)) return 'Evite repetir um único caractere.'
  return null
}

// Sem caracteres ambíguos (0/O, 1/l/I) para facilitar a digitação da senha temporária.
const TEMP_ALPHABET = 'abcdefghjkmnpqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ23456789'

/** Senha temporária aleatória (~110 bits), exibida uma única vez e trocada no primeiro acesso. */
export function generateTemporaryPassword(): string {
  const groups: string[] = []
  for (let g = 0; g < 4; g++) {
    let chunk = ''
    for (let i = 0; i < 5; i++) chunk += TEMP_ALPHABET[randomInt(0, TEMP_ALPHABET.length)]
    groups.push(chunk)
  }
  return groups.join('-')
}
