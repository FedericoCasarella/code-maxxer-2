import { spawn } from 'node:child_process'
import type { UsageSnapshot, UsageWindow } from '@shared/types'
import { db } from '../db'
import { bin, shellEnv } from './bins'

let snap: UsageSnapshot = {
  claude: { windows: [], updatedAt: null },
  codex: { windows: [], updatedAt: null }
}
let listener: ((u: UsageSnapshot) => void) | null = null
export const onUsage = (cb: (u: UsageSnapshot) => void) => (listener = cb)

export async function loadUsage(): Promise<UsageSnapshot> {
  const saved = await db.getSetting<UsageSnapshot>('usage')
  if (saved) snap = saved
  return snap
}
export const getUsage = () => snap

function publish() {
  void db.setSetting('usage', snap)
  listener?.(snap)
}

const LABEL: Record<string, string> = { five_hour: '5h', seven_day: '7d', seven_day_opus: '7d Opus', seven_day_sonnet: '7d Sonnet' }

/** Claude Code emits `rate_limit_event` in its stream: no credentials read, no extra call. */
export function recordClaudeRateLimit(info: any) {
  const w = info?.unifiedWindows
  if (!w || typeof w !== 'object') return
  const windows = new Map(snap.claude.windows.map((x) => [x.label, x]))
  for (const [k, v] of Object.entries<any>(w)) {
    if (typeof v?.utilization !== 'number') continue
    const label = LABEL[k] ?? k
    windows.set(label, {
      label,
      usedPercent: Math.round(Math.min(1, Math.max(0, v.utilization)) * 100),
      resetsAt: v.resetsAt ? v.resetsAt * 1000 : null
    })
  }
  snap = { ...snap, claude: { windows: [...windows.values()], updatedAt: Date.now() } }
  publish()
}

/** Codex: `codex app-server` JSON-RPC → account/rateLimits/read. */
export function refreshCodexUsage(): Promise<UsageSnapshot> {
  return new Promise((resolve) => {
    const child = spawn(bin('codex'), ['app-server', '--listen', 'stdio://'], { stdio: ['pipe', 'pipe', 'ignore'], env: shellEnv() })
    let buf = ''
    const done = () => {
      clearTimeout(t)
      child.kill()
      resolve(snap)
    }
    const t = setTimeout(done, 8000)
    const send = (m: object) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n')
    child.on('error', done)
    child.stdout.on('data', (d) => {
      buf += d
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        let m: any
        try {
          m = JSON.parse(line)
        } catch {
          continue
        }
        if (m.id === 1) {
          send({ method: 'initialized', params: {} })
          send({ method: 'account/rateLimits/read', id: 2, params: {} })
        } else if (m.id === 2) {
          const s = m.result?.rateLimitsByLimitId?.codex ?? m.result?.rateLimits
          const win = (label: string, w: any): UsageWindow | null =>
            typeof w?.usedPercent === 'number'
              ? { label, usedPercent: Math.round(w.usedPercent), resetsAt: w.resetsAt ? w.resetsAt * 1000 : null }
              : null
          const windows = [win('5h', s?.primary), win('7d', s?.secondary)].filter(Boolean) as UsageWindow[]
          if (windows.length) {
            snap = { ...snap, codex: { windows, updatedAt: Date.now() } }
            publish()
          }
          done()
        }
      }
    })
    send({
      method: 'initialize',
      id: 1,
      params: { clientInfo: { name: 'code-maxxer-2', title: 'code-maxxer-2', version: '0.0.1' }, capabilities: null }
    })
  })
}

/**
 * Claude reports its limits only inside a run (rate_limit_event). When nothing ran for a while,
 * a tiny probe run (Haiku, no tools, one-line system prompt: a few hundred tokens) reads them fresh.
 */
let probing = false
export function refreshClaudeUsage(): Promise<UsageSnapshot> {
  if (probing) return Promise.resolve(snap)
  probing = true
  return new Promise((resolve) => {
    const child = spawn(
      bin('claude'),
      [
        '-p', '--output-format', 'stream-json', '--verbose', '--model', 'claude-haiku-5-5',
        '--tools', '', '--strict-mcp-config', '--setting-sources', 'project', '--disable-slash-commands',
        '--no-session-persistence', '--system-prompt', 'Reply with: ok'
      ],
      { stdio: ['pipe', 'pipe', 'ignore'], env: shellEnv(), cwd: process.env.HOME }
    )
    let buf = ''
    const done = () => {
      clearTimeout(t)
      probing = false
      child.kill()
      resolve(snap)
    }
    const t = setTimeout(done, 45_000)
    child.on('error', done)
    child.on('close', done)
    child.stdout.on('data', (d) => {
      buf += d
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        try {
          const ev = JSON.parse(line)
          if (ev.type === 'rate_limit_event') recordClaudeRateLimit(ev.rate_limit_info)
        } catch { /* not json */ }
      }
    })
    child.stdin.end('ok')
  })
}

/** Keep both fresh: Codex every 5 min (free), Claude when older than 15 min and idle. */
export function startUsageRefresh(isBusy: () => boolean) {
  void refreshCodexUsage()
  setInterval(() => void refreshCodexUsage(), 5 * 60_000)
  const claudeTick = () => {
    const age = Date.now() - (snap.claude.updatedAt ?? 0)
    if (age > 15 * 60_000 && !isBusy()) void refreshClaudeUsage()
  }
  claudeTick()
  setInterval(claudeTick, 5 * 60_000)
}
