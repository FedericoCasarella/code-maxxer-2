import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DevServerState } from '@shared/design'
import type { EngineEvent } from '@shared/types'
import { shellEnv } from './bins'

/** Project dev servers the app started (one per worktree), stopped when the app quits. */
const servers = new Map<string, { child: ChildProcess | null; state: DevServerState }>()
let emit: ((e: EngineEvent) => void) | null = null
export const setDevEmitter = (e: (e: EngineEvent) => void) => (emit = e)

const URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0):\d+\/?/
// Strip ANSI colours so the URL regex and the log read cleanly.
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')

function publish(wsId: string, patch: Partial<DevServerState>) {
  const cur = servers.get(wsId) ?? { child: null, state: { workspaceId: wsId, status: 'off', url: null, message: null, log: [] } }
  cur.state = { ...cur.state, ...patch }
  servers.set(wsId, cur)
  emit?.({ type: 'devserver', state: cur.state })
  return cur.state
}

const log = (wsId: string, line: string) => {
  const cur = servers.get(wsId)
  if (!cur) return
  cur.state.log = [...cur.state.log, line].slice(-40)
}

export const devState = (wsId: string): DevServerState =>
  servers.get(wsId)?.state ?? { workspaceId: wsId, status: 'off', url: null, message: null, log: [] }

function run(cwd: string, wsId: string, args: string[]): ChildProcess {
  const child = spawn('npm', args, { cwd, env: { ...shellEnv(), FORCE_COLOR: '0', BROWSER: 'none' }, detached: true })
  const onData = (d: Buffer) => plain(String(d)).split('\n').filter((l) => l.trim()).forEach((l) => log(wsId, l))
  child.stdout?.on('data', onData)
  child.stderr?.on('data', onData)
  return child
}

/** Start `npm run dev` (or `start`) in the worktree, installing dependencies first when they're missing. */
export async function startDevServer(wsId: string, cwd: string): Promise<DevServerState> {
  const cur = servers.get(wsId)
  if (cur && ['installing', 'starting', 'ready'].includes(cur.state.status)) return cur.state
  let pkg: any
  try {
    pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'))
  } catch {
    return publish(wsId, { status: 'error', message: 'No package.json in this project: no dev server to start.' })
  }
  const script = pkg.scripts?.dev ? 'dev' : pkg.scripts?.start ? 'start' : null
  if (!script) return publish(wsId, { status: 'error', message: 'package.json has no "dev" or "start" script.' })
  publish(wsId, { status: 'installing', message: null, url: null, log: [] })

  if (!existsSync(join(cwd, 'node_modules'))) {
    const ok = await new Promise<boolean>((res) => {
      const c = run(cwd, wsId, ['install', '--no-audit', '--no-fund'])
      servers.get(wsId)!.child = c
      c.on('close', (code) => res(code === 0))
    })
    if (!ok) return publish(wsId, { status: 'error', message: 'npm install failed. See the log.' })
  }

  publish(wsId, { status: 'starting' })
  const child = run(cwd, wsId, ['run', script])
  servers.get(wsId)!.child = child
  const onData = (d: Buffer) => {
    const m = plain(String(d)).match(URL_RE)
    if (m && devState(wsId).status !== 'ready') publish(wsId, { status: 'ready', url: m[0].replace(/\/$/, '').replace('0.0.0.0', 'localhost') })
  }
  child.stdout?.on('data', onData)
  child.stderr?.on('data', onData)
  child.on('close', (code) => {
    if (servers.get(wsId)?.child !== child) return
    publish(wsId, code === 0 || code === null ? { status: 'off', url: null } : { status: 'error', url: null, message: `The dev server stopped (exit ${code}). See the log.` })
  })
  return devState(wsId)
}

export function stopDevServer(wsId: string) {
  const cur = servers.get(wsId)
  if (!cur?.child?.pid) return
  try {
    process.kill(-cur.child.pid, 'SIGTERM')
  } catch { /* gone */ }
  cur.child = null
  publish(wsId, { status: 'off', url: null })
}

export const stopAllDevServers = () => [...servers.keys()].forEach(stopDevServer)
