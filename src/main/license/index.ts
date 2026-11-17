import { app } from 'electron'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LicenseStatus } from '@shared/types'
import { deviceInfo } from './device'
import { normalizeKey } from './key'
import { LICENSE_PUBLIC_KEY } from './publicKey'
import { parsePublicKey, sha256hex, verifyToken, type LicensePayload } from './token'

/*
 * code-maxxer is free to use; a license (same server and CMX keys as code-maxxer) unlocks Pro.
 * Activation: key → server returns a token signed with Ed25519, bound to this Mac. Verified offline
 * on every start, re-checked online at start and every 24 h.
 */
const SERVER = (process.env.CM2_LICENSE_SERVER || 'https://federicocasarella.com').replace(/\/+$/, '')
const pub = parsePublicKey(LICENSE_PUBLIC_KEY)
const file = () => join(app.getPath('userData'), 'license.json')

type Stored = { token: string | null; lastCheck: number | null; detail: string | null; revoked: boolean }
let stored: Stored = { token: null, lastCheck: null, detail: null, revoked: false }
let listener: ((s: LicenseStatus) => void) | null = null
export const onLicense = (cb: (s: LicenseStatus) => void) => (listener = cb)

function load() {
  try {
    stored = { ...stored, ...JSON.parse(readFileSync(file(), 'utf8')) }
  } catch { /* no license yet */ }
}
function save() {
  try {
    writeFileSync(file(), JSON.stringify(stored), { mode: 0o600 })
  } catch { /* read-only profile: keep in memory */ }
  listener?.(licenseStatus())
}

function payloadOf(token: string | null): LicensePayload | null {
  if (!token) return null
  const v = verifyToken(token, pub)
  if (!v.ok) return null
  if (v.payload.dev.toLowerCase() !== sha256hex(deviceInfo().id)) return null
  return v.payload
}

export function licenseStatus(): LicenseStatus {
  const dev = deviceInfo()
  const p = payloadOf(stored.token)
  const base = { device: dev.name, server: SERVER, lastCheck: stored.lastCheck, detail: stored.detail }
  // Development only: CM2_DEV_PRO=1 previews Pro pages. Ignored in packaged builds.
  if (!app.isPackaged && process.env.CM2_DEV_PRO === '1' && !stored.token)
    return { ...base, state: 'active', license: { id: 'dev', name: 'Developer', email: '', plan: 'Pro (dev)', expiresAt: null, daysLeft: null } }
  if (!stored.token) return { ...base, state: 'free', license: null }
  if (!p) return { ...base, state: 'invalid', license: null, detail: stored.detail ?? 'The saved license is not valid on this Mac' }
  const expired = p.exp !== null && p.exp * 1000 < Date.now()
  const license = {
    id: p.lid, name: p.name, email: p.email, plan: p.plan || 'Pro',
    expiresAt: p.exp ? p.exp * 1000 : null,
    daysLeft: p.exp ? Math.max(0, Math.ceil((p.exp * 1000 - Date.now()) / 86_400_000)) : null
  }
  if (stored.revoked) return { ...base, state: 'invalid', license }
  if (expired) return { ...base, state: 'expired', license }
  return { ...base, state: 'active', license }
}

async function call(path: string, body: object): Promise<{ token?: string; code?: string; message?: string; ok: boolean; reachable: boolean }> {
  try {
    const res = await fetch(`${SERVER}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000)
    })
    const data: any = await res.json().catch(() => null)
    return { ok: res.ok && typeof data?.token === 'string', token: data?.token, code: data?.code, message: data?.message ?? `HTTP ${res.status}`, reachable: true }
  } catch (e: any) {
    return { ok: false, reachable: false, message: e.message }
  }
}

const MESSAGES: Record<string, string> = {
  chiave_non_valida: 'This license key does not exist',
  revocata: 'This license has been revoked',
  scaduta: 'This license has expired',
  altro_dispositivo: 'This license is already active on another Mac',
  troppe_richieste: 'Too many attempts, try again in a few minutes'
}

export async function activate(raw: string): Promise<LicenseStatus> {
  const key = normalizeKey(String(raw ?? ''))
  if (!key) throw new Error('That does not look like a license key (CMX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX)')
  const dev = deviceInfo()
  const r = await call('/api/licenze/attiva', { key, device_id: dev.id, device_name: dev.name, app_version: app.getVersion(), os: dev.os })
  if (!r.reachable) throw new Error(`License server not reachable: ${r.message}`)
  if (!r.ok || !r.token) throw new Error(MESSAGES[r.code ?? ''] ?? r.message ?? 'Activation failed')
  if (!payloadOf(r.token)) throw new Error('The server returned a license that is not valid for this Mac')
  stored = { token: r.token, lastCheck: Date.now(), detail: null, revoked: false }
  save()
  return licenseStatus()
}

export async function recheck(): Promise<LicenseStatus> {
  if (!stored.token) return licenseStatus()
  const r = await call('/api/licenze/verifica', { token: stored.token, device_id: deviceInfo().id, app_version: app.getVersion() })
  if (r.ok && r.token && payloadOf(r.token)) stored = { token: r.token, lastCheck: Date.now(), detail: null, revoked: false }
  else if (r.reachable && r.code && r.code !== 'troppe_richieste') stored = { ...stored, lastCheck: Date.now(), detail: MESSAGES[r.code] ?? r.message ?? null, revoked: true }
  // unreachable: keep the offline-verified token as it is
  save()
  return licenseStatus()
}

/** Remove from this Mac only (the seat on the server is freed by the seller). */
export function deactivate(): LicenseStatus {
  stored = { token: null, lastCheck: null, detail: null, revoked: false }
  try {
    rmSync(file(), { force: true })
  } catch { /* already gone */ }
  listener?.(licenseStatus())
  return licenseStatus()
}

export function startLicense() {
  load()
  void recheck()
  setInterval(() => void recheck(), 24 * 3_600_000)
}
