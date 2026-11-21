import { app, shell } from 'electron'
import { createWriteStream } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { UpdateInfo } from '@shared/types'
import { db } from './db'

/**
 * Update check: the latest GitHub release against this build. A newer one shows a popup; "Later" hides it for a
 * day. "Update" downloads the .dmg to Downloads and opens it (drag the app into Applications).
 */
const REPO = 'FedericoCasarella/code-maxxer-2'
const SNOOZE_KEY = 'update.snoozedUntil'
const DAY = 24 * 60 * 60 * 1000

let info: UpdateInfo | null = null
let asset: string | null = null
let notify: (u: UpdateInfo | null) => void = () => {}

const parts = (v: string) => v.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0)
function newer(a: string, b: string) {
  const x = parts(a), y = parts(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0)
  return false
}

function set(next: UpdateInfo | null) {
  info = next
  notify(info)
}

async function check() {
  if (info?.state === 'downloading') return
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
    if (!res.ok) return
    const r = (await res.json()) as { tag_name: string; assets: { name: string; browser_download_url: string }[] }
    const dmg = r.assets.find((a) => a.name.endsWith(`-${process.arch}.dmg`)) ?? r.assets.find((a) => a.name.endsWith('.dmg'))
    if (!dmg || !newer(r.tag_name, app.getVersion())) return set(null)
    asset = dmg.browser_download_url
    const until = (await db.getSetting<number>(SNOOZE_KEY)) ?? 0
    set(Date.now() < until ? null : { version: r.tag_name.replace(/^v/, ''), state: 'available' })
  } catch {
    /* offline: try again later */
  }
}

export function startUpdater(emit: (u: UpdateInfo | null) => void) {
  notify = emit
  void check()
  // Every half hour: new releases, and a snoozed popup comes back once its day is over.
  setInterval(() => void check(), 30 * 60 * 1000)
}

export const updateStatus = () => info

export async function snoozeUpdate() {
  await db.setSetting(SNOOZE_KEY, Date.now() + DAY)
  set(null)
}

export async function installUpdate() {
  if (!info || !asset) return
  const version = info.version
  set({ version, state: 'downloading', progress: 0 })
  try {
    const res = await fetch(asset)
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
    const total = Number(res.headers.get('content-length')) || 0
    const out = join(app.getPath('downloads'), decodeURIComponent(asset.split('/').pop() || `Code-Maxxer-${version}.dmg`))
    let got = 0
    let last = 0
    const body = Readable.fromWeb(res.body as never)
    body.on('data', (c: Buffer) => {
      got += c.length
      const p = total ? Math.floor((got / total) * 100) : 0
      if (p !== last) set({ version, state: 'downloading', progress: (last = p) })
    })
    await pipeline(body, createWriteStream(out))
    await shell.openPath(out)
    set(null)
  } catch {
    set({ version, state: 'available' })
  }
}
