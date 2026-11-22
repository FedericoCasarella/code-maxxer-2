import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { connect } from 'node:net'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { DevServerApp, DevServerState } from '@shared/design'
import type { EngineEvent } from '@shared/types'
import { shellEnv } from './bins'

/** Project dev servers the app started (one per worktree), stopped when the app quits. */
const servers = new Map<string, { child: ChildProcess | null; state: DevServerState }>()
let emit: ((e: EngineEvent) => void) | null = null
export const setDevEmitter = (e: (e: EngineEvent) => void) => (emit = e)

/*
 * The previews started here, on disk: they run in their own process group and can outlive the app
 * (a crash, a killed dev session). The next start closes those orphans so they don't hold the ports.
 */
const PIDS = join(homedir(), '.code-maxxer-2', 'previews.json')
const readPids = (): Record<string, { pid: number; cwd: string }> => {
  try {
    return JSON.parse(readFileSync(PIDS, 'utf8'))
  } catch {
    return {}
  }
}
const writePids = (m: Record<string, { pid: number; cwd: string }>) => {
  try {
    mkdirSync(join(homedir(), '.code-maxxer-2'), { recursive: true })
    writeFileSync(PIDS, JSON.stringify(m))
  } catch { /* best effort */ }
}
const track = (wsId: string, pid: number | undefined, cwd: string) => {
  const m = readPids()
  if (pid) m[wsId] = { pid, cwd }
  else delete m[wsId]
  writePids(m)
}
/** At start: the previews a previous run left behind are stopped. */
export function stopOrphanPreviews() {
  for (const { pid } of Object.values(readPids())) {
    try {
      process.kill(-pid, 'SIGTERM')
    } catch { /* already gone */ }
  }
  writePids({})
}

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

function run(cwd: string, wsId: string, bin: string, args: string[], env?: NodeJS.ProcessEnv): ChildProcess {
  const child = spawn(bin, args, { cwd, env: { ...(env ?? shellEnv()), FORCE_COLOR: '0', BROWSER: 'none' }, detached: true })
  const onData = (d: Buffer) => plain(String(d)).split('\n').filter((l) => l.trim()).forEach((l) => log(wsId, l))
  child.stdout?.on('data', onData)
  child.stderr?.on('data', onData)
  return child
}

/** Something already answers on this port (IPv4 or IPv6 localhost)? */
function portTaken(port: number): Promise<boolean> {
  const probe = (host: string) =>
    new Promise<boolean>((res) => {
      const s = connect({ port, host })
      const done = (v: boolean) => (s.destroy(), res(v))
      s.setTimeout(400, () => done(false))
      s.once('connect', () => done(true))
      s.once('error', () => done(false))
    })
  return Promise.all([probe('127.0.0.1'), probe('::1')]).then((r) => r.some(Boolean))
}
async function freePort(from: number): Promise<number> {
  for (let p = from; p < from + 50; p++) if (!(await portTaken(p))) return p
  return from
}

/** The port the project's dev server would use: the set URL's, its script's --port, its config's, else its tool's default. */
function wantedPort(cwd: string, pkg: any, script: string | null, fixed: string | null): number | null {
  if (fixed) {
    const m = fixed.match(/:(\d+)/)
    if (m) return Number(m[1])
  }
  const cmd = script ? String(pkg?.scripts?.[script] ?? '') : ''
  const flag = cmd.match(/(?:--port|-p)[= ](\d{2,5})/)
  if (flag) return Number(flag[1])
  for (const f of ['vite.config.ts', 'vite.config.js', 'vite.config.mjs', 'astro.config.mjs', 'astro.config.ts']) {
    try {
      const m = readFileSync(join(cwd, f), 'utf8').match(/port\s*:\s*(\d{2,5})/)
      if (m) return Number(m[1])
    } catch { /* not there */ }
  }
  if (/\bvite\b/.test(cmd)) return 5173
  if (/\bastro\b/.test(cmd)) return 4321
  if (/\bnext\b/.test(cmd)) return 3000
  return null
}

/*
 * Desktop and mobile apps: the preview launches the app itself instead of a page in the panel.
 * Electron and Tauri open their own window; Expo, React Native and Flutter open on the iOS Simulator (Android emulator without Xcode).
 */
type AppKind = 'electron' | 'tauri' | 'expo' | 'react-native' | 'flutter'
function appKind(cwd: string, pkg: any): AppKind | null {
  if (existsSync(join(cwd, 'pubspec.yaml'))) return 'flutter'
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies }
  if (deps.electron) return 'electron'
  if (deps['@tauri-apps/cli'] || existsSync(join(cwd, 'src-tauri'))) return 'tauri'
  if (deps.expo) return 'expo'
  if (deps['react-native']) return 'react-native'
  return null
}
let hasSim: boolean | null = null
const iosSim = () => (hasSim ??= process.platform === 'darwin' && spawnSync('xcrun', ['simctl', 'help'], { stdio: 'ignore', env: shellEnv() }).status === 0)
/** Lines that say the app is up (or being installed on the device). */
const APP_UP = /start(?:ing)? electron app|Opening .* on |Logs for your project|Launching|Installing .* on|success Successfully|Syncing files to device|Running `|Flutter run key commands/i

export type DevOptions = { command?: string; url?: string; install?: boolean; env?: NodeJS.ProcessEnv }

/**
 * Start the project's preview in the worktree: its own command when set, else `npm run dev` (or `start`),
 * installing dependencies first when they're missing.
 */
export async function startDevServer(wsId: string, cwd: string, opts: DevOptions = {}): Promise<DevServerState> {
  const cur = servers.get(wsId)
  if (cur && ['installing', 'starting', 'ready'].includes(cur.state.status)) return cur.state
  let pkg: any = null
  try {
    pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'))
  } catch { /* no package.json: only a custom command can start it */ }
  const command = opts.command?.trim()
  const script = pkg?.scripts?.dev ? 'dev' : pkg?.scripts?.start ? 'start' : null
  // A set URL means a page to show: only then is a desktop/mobile project previewed in the panel.
  const kind = opts.url?.trim() ? null : appKind(cwd, pkg)
  const target: DevServerApp | null = !kind ? null : kind === 'electron' || kind === 'tauri' ? 'window' : iosSim() ? 'ios' : 'android'
  const mobile = kind === 'expo' || kind === 'react-native' || kind === 'flutter'
  if (!command && !pkg && kind !== 'flutter') return publish(wsId, { status: 'error', message: 'No package.json in this project: set a preview command in its settings.' })
  if (!command && !script && !mobile) return publish(wsId, { status: 'error', message: 'package.json has no "dev" or "start" script: set a preview command in the project settings.' })
  publish(wsId, { status: 'installing', message: null, url: null, log: [], app: target })

  if (pkg && opts.install !== false && !existsSync(join(cwd, 'node_modules'))) {
    const ok = await new Promise<boolean>((res) => {
      const c = run(cwd, wsId, 'npm', ['install', '--no-audit', '--no-fund'], opts.env)
      servers.get(wsId)!.child = c
      c.on('close', (code) => res(code === 0))
    })
    if (!ok) return publish(wsId, { status: 'error', message: 'npm install failed. See the log.' })
  }

  publish(wsId, { status: 'starting' })
  let fixed = opts.url?.trim() ? (/^[a-z]+:\/\//i.test(opts.url.trim()) ? opts.url.trim() : `http://${opts.url.trim()}`) : null
  // Another app already on the port (often another project's preview): move to a free one instead of showing that app.
  const wanted = wantedPort(cwd, pkg, command ? null : script, fixed)
  let port: number | null = null
  let moved: string | null = null
  if (wanted && (await portTaken(wanted))) {
    port = await freePort(wanted + 1)
    moved = `Port ${wanted} was taken: the preview runs on ${port}.`
    if (fixed) fixed = fixed.replace(`:${wanted}`, `:${port}`)
  }
  const env = { ...(opts.env ?? shellEnv()), ...(port ? { PORT: String(port) } : {}) }
  const tool = command ? '' : String(pkg?.scripts?.[script!] ?? '')
  // Vite, Astro and Next take --port; vite also --strictPort, so it never drifts to yet another port unnoticed.
  const portArgs = port && /\b(vite|astro|next)\b/.test(tool) ? ['--', '--port', String(port), ...(/\bvite\b/.test(tool) ? ['--strictPort'] : [])] : []
  const os = target === 'ios' ? 'ios' : 'android'
  const child = command
    ? run(cwd, wsId, '/bin/zsh', ['-lc', command], env)
    : kind === 'expo'
      ? run(cwd, wsId, 'npx', ['expo', 'start', `--${os}`, '--port', String(await freePort(8081))], { ...env, CI: '1' })
      : kind === 'react-native'
        ? run(cwd, wsId, 'npx', ['react-native', `run-${os}`], env)
        : kind === 'tauri'
          ? run(cwd, wsId, 'npx', ['tauri', 'dev'], env)
        : kind === 'flutter'
          ? run(cwd, wsId, '/bin/zsh', ['-lc', os === 'ios' ? 'open -a Simulator && sleep 6 && flutter run -d iphone' : 'flutter run -d emulator'], env)
          : run(cwd, wsId, 'npm', ['run', script!, ...(kind ? [] : portArgs)], env)
  servers.get(wsId)!.child = child
  track(wsId, child.pid, cwd)
  if (moved) publish(wsId, { message: moved })
  if (target) {
    // An app: up when its tool says so (or still running after a while); the page URLs it prints are not shown.
    const up = () => devState(wsId).status === 'starting' && servers.get(wsId)?.child === child && publish(wsId, { status: 'ready', url: null })
    const onData = (d: Buffer) => APP_UP.test(plain(String(d))) && up()
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    // Tauri compiles Rust first: no timer, only its "Running" line
    if (kind !== 'tauri') setTimeout(up, kind === 'electron' ? 8000 : 20000)
  } else if (fixed) {
    // A set URL: ready as soon as it answers.
    const poll = setInterval(async () => {
      if (servers.get(wsId)?.child !== child || devState(wsId).status !== 'starting') return clearInterval(poll)
      try {
        await fetch(fixed, { signal: AbortSignal.timeout(1500) })
        clearInterval(poll)
        publish(wsId, { status: 'ready', url: fixed.replace(/\/$/, '') })
      } catch { /* not yet */ }
    }, 800)
  } else {
    const onData = (d: Buffer) => {
      const m = plain(String(d)).match(URL_RE)
      if (m && devState(wsId).status !== 'ready') publish(wsId, { status: 'ready', url: m[0].replace(/\/$/, '').replace('0.0.0.0', 'localhost') })
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
  }
  child.on('close', (code) => {
    if (servers.get(wsId)?.child !== child) return
    track(wsId, undefined, cwd)
    servers.get(wsId)!.child = null
    // Some dev servers exit at once when one already runs (e.g. Astro): its URL was printed, keep it.
    if (code === 0 && devState(wsId).status === 'ready') return publish(wsId, { message: 'Already running outside code-maxxer.' })
    publish(wsId, code === 0 || code === null ? { status: 'off', url: null } : { status: 'error', url: null, message: `The preview stopped (exit ${code}). See the log.` })
  })
  return devState(wsId)
}

export function stopDevServer(wsId: string) {
  const cur = servers.get(wsId)
  if (!cur) return
  if (!cur.child?.pid) return void publish(wsId, { status: 'off', url: null, message: null })
  try {
    process.kill(-cur.child.pid, 'SIGTERM')
  } catch { /* gone */ }
  track(wsId, undefined, '')
  cur.child = null
  publish(wsId, { status: 'off', url: null })
}

export const stopAllDevServers = () => [...servers.keys()].forEach(stopDevServer)
