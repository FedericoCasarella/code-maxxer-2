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
 * Plus `diagnose` for incidents. The agent never gets a shell: it reads output we collected with
 * read-only commands, so it cannot change the server.
 */

type Emit = (e: { type: 'recon:session-log'; sessionId: string; log: SessionLog } | { type: 'recon:changed'; projectId: string }) => void
export const SCAN_MODEL = 'sonnet'

const SURVEY: [string, string][] = [
  ['System', 'uname -a; cat /etc/os-release 2>/dev/null | head -4; uptime; nproc 2>/dev/null'],
  ['Memory & disk', 'free -h 2>/dev/null; df -hT -x tmpfs -x devtmpfs 2>/dev/null | head -20'],
  ['Listening ports', 'ss -tlnp 2>/dev/null | head -40 || netstat -tlnp 2>/dev/null | head -40'],
  ['Services', 'systemctl list-units --type=service --state=running --no-pager --no-legend 2>/dev/null | head -60'],
  ['Failed units', 'systemctl --failed --no-pager --no-legend 2>/dev/null | head -20'],
  ['Containers', 'docker ps --format "{{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.Ports}}" 2>/dev/null | head -40'],
  ['Node / PM2', 'node -v 2>/dev/null; pm2 jlist 2>/dev/null | head -c 6000'],
  ['Web server', 'nginx -T 2>/dev/null | grep -E "server_name|root|proxy_pass|listen" | head -60; ls /etc/nginx/sites-enabled 2>/dev/null; apache2ctl -S 2>/dev/null | head -30'],
  ['Runtimes', 'for b in python3 php ruby go java psql mysql redis-cli; do command -v $b >/dev/null && echo "$b: $($b --version 2>&1 | head -1)"; done'],
  ['Workdir', 'cd "$WD" 2>/dev/null && pwd && ls -la | head -50 && (git log -3 --oneline 2>/dev/null; ls -la current releases 2>/dev/null | head -20)'],
  ['Cron', 'crontab -l 2>/dev/null | grep -v "^#" | head -20']
]
const DIAG: [string, string][] = [
  ['Load & memory', 'uptime; free -h 2>/dev/null; df -h / 2>/dev/null'],
  ['Failed units', 'systemctl --failed --no-pager --no-legend 2>/dev/null | head -20'],
  ['Recent errors', 'journalctl -p err -n 80 --no-pager 2>/dev/null | tail -80'],
  ['Containers', 'docker ps -a --format "{{.Names}}\\t{{.Status}}" 2>/dev/null | head -30'],
  ['PM2', 'pm2 jlist 2>/dev/null | head -c 4000'],
  ['Nginx errors', 'tail -n 60 /var/log/nginx/error.log 2>/dev/null'],
  ['Kernel', 'dmesg 2>/dev/null | tail -20']
]

/** One-shot, tool-less Claude call: the prompt in, plain text out. */
export function claudeText(system: string, prompt: string, model = SCAN_MODEL, timeoutMs = 240_000): Promise<{ ok: boolean; text: string; cost: number | null }> {
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

async function collect(env: EnvRow, list: [string, string][], log: Log): Promise<string> {
  let out = ''
  for (const [title, cmd] of list) {
    log('cmd', `${title}`)
    const r = await sshExec(env, `WD=${JSON.stringify(env.workdir || '~')}; ${cmd}`, { readOnly: true, timeoutMs: 45_000 })
    const text = `${r.stdout}${r.stderr}`.trim() || '(nothing)'
    log('out', text.slice(0, 4000))
    out += `\n## ${title}\n$ ${cmd}\n${text.slice(0, 12_000)}\n`
  }
  return out
}

const STEPS: Record<SessionKind, (env: EnvRow, log: Log, incidentId?: string) => Promise<StepResult>> = {
  async connection(env, log) {
    log('info', `${env.protocol.toUpperCase()} ${env.username}@${env.host}:${env.port}`)
    const r = await testConnection(env)
    log(r.ok ? 'out' : 'err', `${r.stdout}${r.stderr}`.trim() || `exit ${r.code}`)
    if (r.ok) await rstore.setConnection(env.id, env.connection_status === 'profiled' ? 'profiled' : 'verified')
    return r.ok
      ? { ok: true, summary: `Connected in ${r.ms} ms` }
      : { ok: false, summary: /Permission denied/i.test(r.stderr) ? 'Permission denied: check user and key' : (r.stderr.trim().split('\n').pop() ?? 'Connection failed') }
  },
  async agent_test(_env, log) {
    log('info', `Asking ${SCAN_MODEL} for a reply`)
    const r = await claudeText('Reply with exactly: ready', 'ping', SCAN_MODEL, 90_000)
    log(r.ok ? 'text' : 'err', r.text)
    return { ok: r.ok && /ready/i.test(r.text), summary: r.ok ? 'The agent answers' : r.text, cost: r.cost }
  },
  async recon(env, log) {
    if (env.protocol !== 'ssh') {
      await rstore.setConnection(env.id, 'profiled', { md: 'SFTP only: no shell survey.', summary: 'SFTP file access' })
      return { ok: true, summary: 'SFTP: file access only' }
    }
    const survey = await collect(env, SURVEY, log)
    log('info', 'Writing the server profile')
    const r = await claudeText(
      'You are a senior SRE. From a read-only survey of a server, write a concise Markdown profile: what runs there (apps, ports, web server routes, containers, process managers), where the app lives, how it is deployed today, risks (disk, failed units, outdated runtimes), and how a zero-downtime deploy to <path>/current could fit. End with one line "SUMMARY: <max 12 words>". Facts only from the survey.',
      `Environment: ${env.name} (${env.kind}), workdir ${env.workdir || 'unknown'}.\nUser rules: ${env.rules || 'none'}\n\nSurvey:\n${survey}`
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
      const r = await sshExec(env, "uptime; df -P / | awk 'NR==2{print $5}'; free | awk '/Mem:/{printf \"%d%%\\n\", $3/$2*100}'", { readOnly: true })
      log(r.ok ? 'out' : 'err', `${r.stdout}${r.stderr}`.trim())
      const [, disk, mem] = r.stdout.trim().split('\n')
      if (disk) parts.push(`disk ${disk}`)
      if (mem) parts.push(`mem ${mem}`)
      if (parseInt(disk ?? '0') > 90) ok = false
    }
    return { ok, summary: parts.join(' · ') || 'Checked' }
  },
  async diagnose(env, log, incidentId) {
    const inc = incidentId ? await rstore.incident(incidentId) : null
    if (inc) await rstore.updateIncident(inc.id, { status: 'diagnosing' })
    const diag = env.protocol === 'ssh' ? await collect(env, DIAG, log) : '(SFTP: no shell diagnostics)'
    const h = env.health_url ? await httpCheck(env.health_url, env.expected_status) : null
    log('info', 'Analysing')
    const r = await claudeText(
      'You are an on-call SRE. Diagnose the incident from read-only diagnostics. Markdown: likely cause, evidence (quote log lines), exact fix commands for a human to run, and how to verify. If the evidence is not enough, say what to check. First line: "STATUS: resolved|needs_info|open" (resolved only if the service is healthy now).',
      `Server profile:\n${env.profile_md ?? '(none)'}\n\nIncident: ${inc ? `#${inc.number} ${inc.title}\n${inc.details}` : 'health check'}\nHealth now: ${h ? `${h.ok ? 'OK' : 'FAIL'} ${h.status ?? h.error}` : 'n/a'}\n\nDiagnostics:\n${diag}`
    )
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
