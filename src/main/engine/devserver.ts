import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { connect } from 'node:net'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { DevServerApp, DevServerPage, DevServerState } from '@shared/design'
import type { EngineEvent } from '@shared/types'
import { shellEnv } from './bins'

/** Project dev servers the app started (one per worktree), stopped when the app quits. */
const servers = new Map<string, { child: ChildProcess | null; state: DevServerState; others?: ChildProcess[] }>()
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

const URLS_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0):\d+(?:\/[^\s'"`)\]\\]*)?/g

/** Ports something is already listening on: a page there belongs to another server, not to this preview. */
const listening = (): Set<number> => {
  const out = spawnSync('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fn'], { encoding: 'utf8' }).stdout ?? ''
  return new Set([...out.matchAll(/:(\d+)$/gm)].map((m) => Number(m[1])))
}
const portOf = (url: string) => Number(new URL(url).port)

/** How likely a printed page is the one to show first: the public site over admin, API and database tools. */
const rank = (p: DevServerPage) => {
  const s = `${p.label} ${p.url}`.toLowerCase()
  if (/health|phpmyadmin|\bpma\b|adminer|\bdb\b|database|storybook|inspect|debug|hmr/.test(s)) return 0
  if (/\bapi\b|\/api\b|graphql|backend|server/.test(s)) return 1
  if (/admin|dashboard|backoffice|\bcms\b|studio/.test(s)) return 2
  if (/sito|\bsite\b|\bweb\b|\bwww\b|landing|frontend|public|home|\bapp\b/.test(s)) return 4
  return 3
}
/** The pages in a chunk of log: each URL with the words before it on its line ("Sito", "[admin] Local"). */
function pagesIn(text: string): DevServerPage[] {
  const out: DevServerPage[] = []
  for (const line of text.split(/\r?\n/)) {
    for (const m of line.matchAll(URLS_RE)) {
      const url = m[0].replace(/[.,;:]+$/, '').replace('0.0.0.0', 'localhost').replace(/\/$/, '')
      const tag = line.match(/^\s*\[([^\]]+)\]/)?.[1]
      const before = line.slice(0, m.index).replace(/^\s*\[[^\]]+\]/, '').replace(/[➜→▶>:|•·-]+/g, ' ').replace(/\b(local|network)\b/gi, '').replace(/\s+/g, ' ').trim()
      const label = (tag && !/^dev$/i.test(tag) ? tag : '') || before || new URL(url).host
      out.push({ url, label: label.slice(0, 30) })
    }
  }
  return out
}
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
  publish(wsId, { status: 'installing', message: null, url: null, log: [], app: target, pages: [] })

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
    // Every page it prints is kept; the preview opens the most likely public one, after a moment for the others to show up
    let pages: DevServerPage[] = []
    let settle: NodeJS.Timeout | null = null
    const best = () => [...pages].sort((a, b) => rank(b) - rank(a))
    const onData = (d: Buffer) => {
      const found = pagesIn(plain(String(d)))
      if (!found.length || servers.get(wsId)?.child !== child) return
      for (const p of found) {
        const same = pages.findIndex((x) => x.url === p.url)
        // A named line ("Sito", "Admin") beats the bare host:port it was first seen with
        if (same < 0) pages.push(p)
        else if (pages[same].label.includes(':') && !p.label.includes(':')) pages[same] = p
      }
      if (devState(wsId).status === 'ready') return void publish(wsId, { pages: best() })
      if (settle) return
      settle = setTimeout(() => {
        if (servers.get(wsId)?.child !== child || devState(wsId).status === 'ready') return
        const sorted = best()
        publish(wsId, { status: 'ready', url: sorted[0].url, pages: sorted })
      }, 2500)
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
  // The other services of a launch plan
  for (const [i, c] of (cur.others ?? []).entries()) {
    try {
      if (c.pid) process.kill(-c.pid, 'SIGTERM')
    } catch { /* gone */ }
    track(`${wsId}#${i + 1}`, undefined, '')
  }
  cur.others = []
  if (!cur.child?.pid) return void publish(wsId, { status: 'off', url: null, message: null })
  try {
    process.kill(-cur.child.pid, 'SIGTERM')
  } catch { /* gone */ }
  track(wsId, undefined, '')
  cur.child = null
  publish(wsId, { status: 'off', url: null })
}

/**
 * The port a failed start complains about ("port 8100 is already in use", EADDRINUSE…), freed when what holds it is an
 * old server of one of the user's projects (every process of its group runs in a project folder). The port, or null.
 */
function freeTakenPort(log: string, roots: string[]): number | null {
  const m = log.match(/(?:port[ae]?|porta)\D{0,12}(\d{2,5})[^\n]{0,60}(?:in use|in uso|already|occupat|taken)/i) ?? log.match(/EADDRINUSE[^\n]*?:(\d{2,5})/)
  const port = m ? Number(m[1]) : 0
  if (!port || !roots.length) return null
  const pid = (spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).stdout ?? '').trim().split('\n')[0]
  if (!pid) return null
  const pgid = Number((spawnSync('ps', ['-o', 'pgid=', '-p', pid], { encoding: 'utf8' }).stdout ?? '').trim())
  if (!pgid || pgid === process.pid) return null
  const group = (spawnSync('ps', ['-axo', 'pid=,pgid='], { encoding: 'utf8' }).stdout ?? '')
    .trim()
    .split('\n')
    .map((l) => l.trim().split(/\s+/).map(Number))
    .filter(([, g]) => g === pgid)
    .map(([p]) => p)
  const cwds = (spawnSync('lsof', ['-a', '-d', 'cwd', '-Fn', '-p', group.join(',')], { encoding: 'utf8' }).stdout ?? '')
    .split('\n')
    .filter((l) => l.startsWith('n'))
    .map((l) => l.slice(1))
  // Anything outside the projects (an editor, a terminal of the user's, another app) is left alone
  if (!cwds.length || cwds.some((c) => c !== '/' && !roots.some((r) => c === r || c.startsWith(r + '/')))) return null
  try {
    process.kill(-pgid, 'SIGTERM')
  } catch {
    return null
  }
  return port
}

/** A note on a preview, shown above its page. */
export const publishNote = (wsId: string, message: string) => publish(wsId, { message })

/** The preview of another branch that holds this port (its process or one it started), if any. */
export function previewOnPort(port: number, except: string): string | null {
  const pid = (spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).stdout ?? '').trim().split('\n')[0]
  if (!pid) return null
  const roots = new Map<number, string>()
  for (const [ws, sv] of servers) {
    if (ws === except) continue
    for (const c of [sv.child, ...(sv.others ?? [])]) if (c?.pid) roots.set(c.pid, ws)
  }
  // Up the parents: a dev script starts the server that listens
  let cur = Number(pid)
  for (let i = 0; i < 12 && cur > 1; i++) {
    if (roots.has(cur)) return roots.get(cur)!
    const out = (spawnSync('ps', ['-o', 'ppid=,pgid=', '-p', String(cur)], { encoding: 'utf8' }).stdout ?? '').trim().split(/\s+/).map(Number)
    if (roots.has(out[1])) return roots.get(out[1])!
    cur = out[0]
  }
  return null
}

export const stopAllDevServers = () => [...servers.keys()].forEach(stopDevServer)

export type PlannedService = { name: string; cwd: string; install: string; command: string; pages: DevServerPage[] }

/**
 * Start every service of a launch plan (site, admin, API…), each in its own process group. Ready when the first page
 * answers; every page declared or printed can be opened from the preview.
 */
export async function startServices(wsId: string, services: PlannedService[], env: NodeJS.ProcessEnv, roots: string[] = [], retry = true): Promise<DevServerState> {
  const begun = Date.now()
  const cur = servers.get(wsId)
  if (cur && ['installing', 'starting', 'ready'].includes(cur.state.status) && !cur.state.detecting) return cur.state
  publish(wsId, { status: 'installing', detecting: false, message: null, url: null, app: null, pages: [], services: services.map((x) => x.name) })
  servers.get(wsId)!.others = []
  // Dependencies first, where they're missing
  for (const sv of services) {
    if (!sv.install.trim() || !existsSync(join(sv.cwd, 'package.json')) || existsSync(join(sv.cwd, 'node_modules'))) continue
    const ok = await new Promise<boolean>((res) => {
      const c = run(sv.cwd, wsId, '/bin/zsh', ['-lc', sv.install], env)
      servers.get(wsId)!.child = c
      c.on('close', (code) => res(code === 0))
    })
    if (!ok) return publish(wsId, { status: 'error', message: `${sv.install} failed for ${sv.name}. See the log.` })
  }
  if (devState(wsId).status !== 'installing') return devState(wsId)
  publish(wsId, { status: 'starting' })
  // A declared port already taken (another project, an older run) isn't this preview: its pages come from the log
  const taken = listening()
  const ours = (p: DevServerPage) => !taken.has(portOf(p.url))
  const byRank = (list: DevServerPage[]) => [...list].sort((a, b) => rank(b) - rank(a))
  let pages: DevServerPage[] = byRank(services.flatMap((x) => x.pages).filter(ours))
  const children: ChildProcess[] = []
  for (const [i, sv] of services.entries()) {
    const child = run(sv.cwd, wsId, '/bin/zsh', ['-lc', sv.command], env)
    children.push(child)
    if (i === 0) servers.get(wsId)!.child = child
    else servers.get(wsId)!.others!.push(child)
    track(i === 0 ? wsId : `${wsId}#${i}`, child.pid, sv.cwd)
    // Pages it prints beyond the declared ones
    const onData = (d: Buffer) => {
      const found = pagesIn(plain(String(d))).filter((p) => ours(p) && !pages.some((x) => portOf(x.url) === portOf(p.url)))
      if (!found.length) return
      pages = byRank([...pages, ...found.map((p) => ({ ...p, label: services.length > 1 ? `${sv.name} · ${p.label}` : p.label }))])
      if (devState(wsId).status === 'ready') publish(wsId, { pages })
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.on('close', (code) => {
      if (!children.includes(servers.get(wsId)?.child as ChildProcess) && servers.get(wsId)?.child !== child) return
      log(wsId, `${sv.name} stopped (exit ${code ?? 'signal'})`)
      // All of them gone: the preview is off (or failed when one failed)
      if (children.every((c) => c.exitCode !== null || c.signalCode !== null)) {
        children.forEach((_, j) => track(j === 0 ? wsId : `${wsId}#${j}`, undefined, ''))
        servers.get(wsId)!.child = null
        // It failed at start because a port is taken by a forgotten server of one of the user's projects: that one stops, and it starts again
        const freed = code && retry && Date.now() - begun < 180_000 ? freeTakenPort(devState(wsId).log.slice(-15).join('\n'), roots) : null
        if (freed) {
          log(wsId, `Port ${freed} was held by an old server of the project: stopped it, starting again`)
          publish(wsId, { status: 'off' })
          return void setTimeout(() => void startServices(wsId, services, env, roots, false), 1500)
        }
        publish(wsId, code === 0 || code === null ? { status: 'off', url: null } : { status: 'error', url: null, message: `${sv.name} stopped (exit ${code}). See the log.` })
      }
    })
  }
  // Ready when a page answers: the best-ranked one (the public site) if it does within a minute
  const started = Date.now()
  const poll = setInterval(async () => {
    if (!children.includes(servers.get(wsId)?.child as ChildProcess) || devState(wsId).status !== 'starting') return clearInterval(poll)
    for (const p of pages) {
      try {
        await fetch(p.url, { signal: AbortSignal.timeout(1500) })
        // The first page on the list wins if it answers within a minute; after that, whichever answers
        if (p !== pages[0] && Date.now() - started < 60_000) continue
        clearInterval(poll)
        return void publish(wsId, { status: 'ready', url: p.url, pages })
      } catch { /* not yet */ }
    }
  }, 1200)
  return devState(wsId)
}

/** A launch plan is being worked out: the preview says so. */
export const markDetecting = (wsId: string) => publish(wsId, { status: 'installing', detecting: true, message: null, url: null, app: null, pages: [], services: [] })
/** The plan couldn't be worked out: back to off, so the usual start can run. */
export const clearDetecting = (wsId: string) => publish(wsId, { status: 'off', detecting: false })
/** The desktop app (Electron, Tauri) of a monorepo, in apps/* or packages/*: its folder, or null. */
export function desktopAppDir(root: string): string | null {
  for (const group of ['apps', 'packages']) {
    let names: string[] = []
    try {
      names = readdirSync(join(root, group))
    } catch { /* no such folder */ }
    for (const n of names) {
      const dir = join(root, group, n)
      let pkg: any = null
      try {
        pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
      } catch { continue }
      const k = appKind(dir, pkg)
      if (k === 'electron' || k === 'tauri') return dir
    }
  }
  return null
}

/** A desktop or mobile app: the preview launches the app itself, no launch plan. */
export function isAppProject(cwd: string): boolean {
  let pkg: any = null
  try {
    pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'))
  } catch { /* none */ }
  return !!appKind(cwd, pkg)
}
