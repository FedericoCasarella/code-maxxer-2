import { languageRule } from '../engine/language'
import type { SessionKind, SessionLog } from '@shared/recon'
import { bin, shellEnv } from '../engine/bins'
import { httpCheck } from './cicd'
import { run, sshExec, testConnection, type EnvRow } from './ssh'
import { rstore } from './store'

/*
 * Pre-connection scan, in gated steps (each needs the previous one):
 *   1. connection   – deterministic SSH/SFTP login test → environment "verified"
 *   2. agent_test   – the local Claude CLI answers (the agent that will read the survey)
 *   3. recon        – read-only survey of the server, summarised by the agent into a profile → "profiled"
 *   4. health_check – HTTP health URL + load/disk/memory
 * Plus `diagnose` for incidents. Recon and diagnose are driven by the agent: it first finds out which
 * system and shell it's on (Linux, macOS, Windows cmd or PowerShell), then decides each round what to
 * read next from what it saw. Every command goes through the read-only guard, so it cannot change the server.
 */

type Emit = (e: { type: 'recon:session-log'; sessionId: string; log: SessionLog } | { type: 'recon:changed'; projectId: string }) => void
export const SCAN_MODEL = 'sonnet'

/** One-shot, tool-less Claude call: the prompt in, plain text out. */
export async function claudeText(system: string, prompt: string, model = SCAN_MODEL, timeoutMs = 240_000): Promise<{ ok: boolean; text: string; cost: number | null }> {
  // What these calls write reaches the user: in their language (the readiness ping excepted).
  if (prompt !== 'ping') system = `${system}\n\n${await languageRule()}`
  return new Promise((resolve) => {
    run(
      bin('claude'),
      ['-p', '--output-format', 'json', '--model', model, '--tools', '', '--strict-mcp-config', '--setting-sources', 'project',
        '--disable-slash-commands', '--no-session-persistence', '--system-prompt', system],
      { input: prompt, timeoutMs, env: shellEnv(), cwd: process.env.HOME }
    ).then((r) => {
      try {
        const j = JSON.parse(r.stdout)
        resolve({ ok: !j.is_error, text: String(j.result ?? ''), cost: j.total_cost_usd ?? null })
      } catch {
        resolve({ ok: false, text: (r.stderr || r.stdout).trim().slice(0, 600) || 'The Claude CLI did not answer', cost: null })
      }
    })
  })
}

const REQUIRES: Partial<Record<SessionKind, SessionKind>> = { agent_test: 'connection', recon: 'agent_test', health_check: 'recon' }
const running = new Set<string>()

/** Which steps are done (last session of each kind succeeded). */
export async function stepState(envId: string): Promise<Record<SessionKind, boolean>> {
  const ses = await rstore.sessions(envId)
  const ok = (k: SessionKind) => ses.find((s) => s.kind === k && s.status !== 'running')?.ok === true
  return { connection: ok('connection'), agent_test: ok('agent_test'), recon: ok('recon'), health_check: ok('health_check'), diagnose: ok('diagnose') }
}

export async function startSession(envId: string, kind: SessionKind, emit: Emit, incidentId?: string): Promise<string> {
  const env = await rstore.envRow(envId)
  if (!env) throw new Error('Environment not found')
  if (!env.host || !env.username) throw new Error('Set host and user first')
  if (running.has(envId)) throw new Error('A scan step is already running on this environment')
  const need = REQUIRES[kind]
  if (need && !(await stepState(envId))[need]) throw new Error(`Run "${need.replace('_', ' ')}" first`)
  const id = await rstore.newSession(envId, kind)
  running.add(envId)
  emit({ type: 'recon:changed', projectId: env.project_id })
  void (async () => {
    const pending: SessionLog[] = []
    const log = (type: SessionLog['type'], content: string) => {
      const l = { at: Date.now(), type, content: content.slice(0, 20_000) }
      pending.push(l)
      emit({ type: 'recon:session-log', sessionId: id, log: l })
    }
    try {
      const r = await STEPS[kind](env, log, incidentId)
      await rstore.appendLogs(id, pending)
      await rstore.finishSession(id, { status: r.ok ? 'done' : 'failed', ok: r.ok, summary: r.summary, result_md: r.md, cost: r.cost ?? undefined })
    } catch (e) {
      log('err', (e as Error).message)
      await rstore.appendLogs(id, pending)
      await rstore.finishSession(id, { status: 'failed', ok: false, summary: (e as Error).message })
    } finally {
      running.delete(envId)
      emit({ type: 'recon:changed', projectId: env.project_id })
    }
  })()
  return id
}

type StepResult = { ok: boolean; summary: string; md?: string; cost?: number | null }
type Log = (type: SessionLog['type'], content: string) => void

/**
 * The agent explores the server: each round it says which read-only commands to run next (or that it's done),
 * we run them and show it the output. It starts by identifying the system and shell, so it never runs
 * Linux commands on Windows or the other way round.
 */
async function explore(env: EnvRow, goal: string, log: Log, rounds = 6): Promise<{ ok: boolean; text: string; cost: number; os: string }> {
  const system =
    'You are a senior SRE exploring a server over SSH, READ-ONLY: never change anything (no writes, restarts, installs, deploys, kills). ' +
    'Commands that would change the server are blocked anyway. Work in rounds: each round reply with JSON only, no code fences:\n' +
    '{"os": "linux|macos|windows|unknown", "shell": "bash|sh|zsh|cmd|powershell|unknown", "commands": [{"title": "what you check", "cmd": "the command"}]}\n' +
    'or, when you know enough: {"os": "...", "shell": "...", "done": true, "report": "the Markdown answer"}.\n' +
    'Round 1: identify the system and the shell with commands that work on any of them (e.g. `uname -s` and `ver`; on Windows the SSH shell is often cmd, ' +
    'run PowerShell as powershell -NoProfile -Command "..."). From then on use only commands for that system. ' +
    'At most 8 commands per round, short output (limit lines: head / Select-Object -First). Don\'t repeat a command; if one fails, try the equivalent, don\'t insist. ' +
    'Respect the user rules: never touch what they forbid.'
  let transcript = ''
  let cost = 0
  let os = 'unknown'
  for (let round = 1; round <= rounds; round++) {
    const last = round === rounds
    const r = await claudeText(
      system,
      `Goal: ${goal}\nEnvironment: ${env.name} (${env.kind}), ${env.host}, workdir ${env.workdir || 'unknown'}.\nUser rules: ${env.rules || 'none'}\n\n` +
        `What you ran so far:\n${transcript || '(nothing yet)'}\n\nRound ${round} of ${rounds}.${last ? ' This is the last round: reply with done and the report.' : ''}`
    )
    cost += r.cost ?? 0
    if (!r.ok) return { ok: false, text: r.text, cost, os }
    let v: any
    try {
      v = JSON.parse(r.text.slice(r.text.indexOf('{'), r.text.lastIndexOf('}') + 1))
    } catch {
      return { ok: true, text: r.text, cost, os }
    }
    if (v.os && v.os !== 'unknown') os = String(v.os)
    if (v.done || last || !Array.isArray(v.commands) || !v.commands.length) return { ok: true, text: String(v.report ?? r.text), cost, os }
    if (round === 1 || v.os) log('info', `System: ${os}${v.shell && v.shell !== 'unknown' ? ` · ${v.shell}` : ''}`)
    for (const c of v.commands.slice(0, 8)) {
      const cmd = String(c.cmd ?? '').trim()
      if (!cmd) continue
      log('cmd', `${c.title ?? cmd}\n$ ${cmd}`)
      const x = await sshExec(env, cmd, { readOnly: true, timeoutMs: 45_000 })
      const text = `${x.stdout}${x.stderr}`.trim() || (x.ok ? '(no output)' : `(failed, exit ${x.code})`)
      log(x.ok ? 'out' : 'err', text.slice(0, 4000))
      transcript += `\n## ${c.title ?? ''}\n$ ${cmd}\n${text.slice(0, 6000)}\n`
    }
    // Keep the transcript bounded: the latest output matters most.
    if (transcript.length > 60_000) transcript = '…\n' + transcript.slice(-60_000)
  }
  return { ok: true, text: transcript, cost, os }
}

const STEPS: Record<SessionKind, (env: EnvRow, log: Log, incidentId?: string) => Promise<StepResult>> = {
  async connection(env, log) {
    log('info', `${env.protocol.toUpperCase()} ${env.username}@${env.host}:${env.port}`)
    const r = await testConnection(env)
    log(r.ok ? 'out' : 'err', `${r.stdout}${r.stderr}`.replace(/^Warning: --ssl is an insecure.*\n?/m, '').trim() || `exit ${r.code}`)
    if (r.ok) await rstore.setConnection(env.id, env.connection_status === 'profiled' ? 'profiled' : 'verified')
    return r.ok
      ? { ok: true, summary: `Connected in ${r.ms} ms` }
      : { ok: false, summary: /Permission denied|Access denied: 530/i.test(r.stderr) ? 'Login refused: check user and credentials' : (r.stderr.trim().split('\n').pop() ?? 'Connection failed') }
  },
  async agent_test(_env, log) {
    log('info', `Asking ${SCAN_MODEL} for a reply`)
    const r = await claudeText('Reply with exactly: ready', 'ping', SCAN_MODEL, 90_000)
    log(r.ok ? 'text' : 'err', r.text)
    return { ok: r.ok && /ready/i.test(r.text), summary: r.ok ? 'The agent answers' : r.text, cost: r.cost }
  },
  async recon(env, log) {
    if (env.protocol !== 'ssh') {
      const P = env.protocol.toUpperCase()
      await rstore.setConnection(env.id, 'profiled', { md: `${P} only: no shell survey.`, summary: `${P} file access` })
      return { ok: true, summary: `${P}: file access only` }
    }
    const r = await explore(
      env,
      'Build the profile of this server so an agent can intervene on it later: system and versions, what runs there (apps, ports, web server and routes, ' +
        'containers, services or process managers, scheduled tasks), where the app lives and how it is deployed today, disk / memory, failed services, ' +
        'outdated runtimes, risks, and how a zero-downtime deploy could fit. The report is a concise Markdown profile with facts you saw ' +
        '(mark guesses as such), and its last line is "SUMMARY: <max 12 words>".',
      log
    )
    if (!r.ok) return { ok: false, summary: r.text }
    const summary = r.text.match(/SUMMARY:\s*(.+)/)?.[1]?.trim() ?? 'Profiled'
    const md = r.text.replace(/\n?SUMMARY:.*$/m, '').trim()
    log('text', md)
    await rstore.setConnection(env.id, 'profiled', { md, summary })
    return { ok: true, summary, md, cost: r.cost }
  },
  async health_check(env, log) {
    const parts: string[] = []
    let ok = true
    if (env.health_url) {
      const h = await httpCheck(env.health_url, env.expected_status)
      log(h.ok ? 'out' : 'err', `${env.health_url} → ${h.status ?? h.error} in ${h.ms} ms`)
      parts.push(h.ok ? `HTTP ${h.status} in ${h.ms} ms` : `HTTP check failed (${h.error})`)
      ok = h.ok
    } else log('info', 'No health URL set: HTTP check skipped')
    if (env.protocol === 'ssh') {
      let r = await sshExec(env, "uptime; df -P / | awk 'NR==2{print $5}'; free | awk '/Mem:/{printf \"%d%%\\n\", $3/$2*100}'", { readOnly: true })
      // Not a Unix shell (Windows): the same three numbers from PowerShell.
      if (!/load average|up /i.test(r.stdout))
        r = await sshExec(
          env,
          'powershell -NoProfile -Command "$o=Get-CimInstance Win32_OperatingSystem; \'up \' + [int]((Get-Date)-$o.LastBootUpTime).TotalHours + \'h\'; $d=Get-PSDrive C; [string][int]($d.Used/($d.Used+$d.Free)*100)+\'%\'; [string][int](($o.TotalVisibleMemorySize-$o.FreePhysicalMemory)/$o.TotalVisibleMemorySize*100)+\'%\'"',
          { readOnly: true }
        )
      log(r.ok ? 'out' : 'err', `${r.stdout}${r.stderr}`.trim())
      const [, disk, mem] = r.stdout.trim().split(/\r?\n/)
      if (disk) parts.push(`disk ${disk}`)
      if (mem) parts.push(`mem ${mem}`)
      if (parseInt(disk ?? '0') > 90) ok = false
    }
    return { ok, summary: parts.join(' · ') || 'Checked' }
  },
  async diagnose(env, log, incidentId) {
    const inc = incidentId ? await rstore.incident(incidentId) : null
    if (inc) await rstore.updateIncident(inc.id, { status: 'diagnosing' })
    const h = env.health_url ? await httpCheck(env.health_url, env.expected_status) : null
    const goal =
      'Diagnose this incident on-call. ' +
      `Incident: ${inc ? `#${inc.number} ${inc.title}\n${inc.details}` : 'health check'}\nHealth now: ${h ? `${h.ok ? 'OK' : 'FAIL'} ${h.status ?? h.error}` : 'n/a'}\n` +
      `What we know of the server:\n${env.profile_md ?? '(no profile yet)'}\n` +
      'Look where the evidence leads (logs, services, containers, disk, the app). The report is Markdown: likely cause, evidence (quote log lines), ' +
      'exact fix commands for a human to run, how to verify; if the evidence is not enough, what to check. ' +
      'Its first line is "STATUS: resolved|needs_info|open" (resolved only if the service is healthy now).'
    const r =
      env.protocol === 'ssh'
        ? await explore(env, goal, log)
        : { ...(await claudeText('You are an on-call SRE. ' + goal, `(${env.protocol.toUpperCase()}: no shell, only this information)`)), os: 'unknown', cost: 0 }
    if (!r.ok) {
      if (inc) await rstore.updateIncident(inc.id, { status: 'failed', summary: r.text })
      return { ok: false, summary: r.text }
    }
    const status = (r.text.match(/STATUS:\s*(resolved|needs_info|open)/)?.[1] ?? 'open') as 'resolved' | 'needs_info' | 'open'
    const md = r.text.replace(/^STATUS:.*\n?/m, '').trim()
    const summary = md.split('\n').find((l) => l.trim() && !l.startsWith('#'))?.replace(/[*_`]/g, '').slice(0, 160) ?? 'Diagnosed'
    log('text', md)
    if (inc) await rstore.updateIncident(inc.id, { status, diagnosis: md, summary })
    return { ok: true, summary, md, cost: r.cost }
  }
}
