import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** AES-256-GCM for server credentials. Master key: ~/.code-maxxer-2/secret.key (32 random bytes, 0600). */
const KEY_FILE = join(homedir(), '.code-maxxer-2', 'secret.key')
let key: Buffer | null = null

function masterKey(): Buffer {
  if (key) return key
  try {
    key = readFileSync(KEY_FILE)
  } catch {
    mkdirSync(join(homedir(), '.code-maxxer-2'), { recursive: true })
    key = randomBytes(32)
    writeFileSync(KEY_FILE, key, { mode: 0o600 })
  }
  return key
}

/** "iv.tag.data", base64. */
export function encrypt(plain: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', masterKey(), iv)
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return [iv, c.getAuthTag(), data].map((b) => b.toString('base64')).join('.')
}

export function decrypt(stored: string | null | undefined): string | null {
  if (!stored) return null
  const [iv, tag, data] = stored.split('.').map((p) => Buffer.from(p, 'base64'))
  const d = createDecipheriv('aes-256-gcm', masterKey(), iv)
  d.setAuthTag(tag)
  return Buffer.concat([d.update(data), d.final()]).toString('utf8')
}
