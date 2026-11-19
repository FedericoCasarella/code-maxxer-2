import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { EngineEvent, Message, SendOptions, Workspace } from '@shared/types'
import type { Automation, AutomationDraft, AutomationRun, RunStatus, Step, Trigger } from '@shared/automations'
import { db, pool } from '../db'
import { bin, shellEnv } from './bins'
import * as orch from './orchestrator'

/*
 * Automations: a trigger (a schedule, a push, new commits) starts a few steps in a workspace.
 * Schedules are checked every 30s (missed ones still run within their grace period);
 * push and commit triggers come from watching the project's git refs, locally (no GitHub needed).
 */

export const AUTOMATIONS_SCHEMA = `
create table if not exists automations (
  id text primary key, project_id text not null references projects(id) on delete cascade,
  name text not null, enabled boolean not null default true, trigger jsonb not null, steps jsonb not null,
  location jsonb not null, session text not null default 'fresh', grace_hours int not null default 12,
  precheck jsonb not null default '{"command":"","timeoutSec":60}',
  last_fired_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists automation_runs (
  id text primary key, automation_id text not null references automations(id) on delete cascade,
  cause text not null, status text not null, started_at timestamptz not null default now(), ended_at timestamptz,
  workspace_id text, branch text, steps jsonb not null default '[]', error text, cost double precision not null default 0
);
create index if not exists automation_runs_by on automation_runs(automation_id, started_at desc);
`

type Host = {
  emit: (e: EngineEvent) => void
  mcpScript: string
  /** A new branch (worktree) in the project, set up like the ones made from the UI. */
  createWorkspace: (projectId: string, name: string) => Promise<Workspace>
}
let host: Host | null = null
const changed = () => host?.emit({ type: 'automations' })

// ---------- storage ----------

const row = (x: any): Omit<Automation, 'nextRun' | 'lastRun' | 'spend'> & { lastFiredAt: number | null } => ({
  id: x.id, projectId: x.project_id, name: x.name, enabled: x.enabled, trigger: x.trigger, steps: x.steps, location: x.location,
  session: x.session, graceHours: x.grace_hours, precheck: x.precheck, createdAt: x.created_at.getTime(), updatedAt: x.updated_at.getTime(),
  lastFiredAt: x.last_fired_at ? x.last_fired_at.getTime() : null
})

const runRow = (x: any): AutomationRun => ({
  id: x.id, automationId: x.automation_id, cause: x.cause, status: x.status, startedAt: x.started_at.getTime(),
  endedAt: x.ended_at ? x.ended_at.getTime() : null, workspaceId: x.workspace_id, branch: x.branch, steps: x.steps, error: x.error, cost: x.cost
})

export async function list(): Promise<Automation[]> {
  const r = await pool.query(`select a.*,
      (select row_to_json(l) from (select started_at, status from automation_runs where automation_id=a.id order by started_at desc limit 1) l) as last,
      (select coalesce(sum(cost),0) from automation_runs where automation_id=a.id) as spend
    from automations a order by a.created_at`)
  return r.rows.map((x) => {
    const a = row(x)
    const { lastFiredAt, ...rest } = a
    return {
      ...rest,
      nextRun: a.enabled ? nextRun(a.trigger, lastFiredAt ?? a.createdAt) : null,
      lastRun: x.last ? { at: new Date(x.last.started_at).getTime(), status: x.last.status } : null,
      spend: Number(x.spend)
    }
  })
}

export async function runs(automationId?: string, limit = 50): Promise<AutomationRun[]> {
  const r = await pool.query(
    `select * from automation_runs where ($1::text is null or automation_id=$1) order by started_at desc limit $2`,
    [automationId ?? null, limit]
  )
  return r.rows.map(runRow)
}

export async function save(d: AutomationDraft, id?: string): Promise<Automation> {
  const key = id ?? 'au_' + randomUUID().slice(0, 8)
  await pool.query(
    `insert into automations(id, project_id, name, enabled, trigger, steps, location, session, grace_hours, precheck, last_fired_at)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
     on conflict (id) do update set project_id=$2, name=$3, enabled=$4, trigger=$5, steps=$6, location=$7, session=$8,
       grace_hours=$9, precheck=$10, updated_at=now()`,
    [key, d.projectId, d.name.trim() || 'Automation', d.enabled, JSON.stringify(d.trigger), JSON.stringify(d.steps), JSON.stringify(d.location),
      d.session, d.graceHours, JSON.stringify(d.precheck)]
  )
  changed()
  const a = (await list()).find((x) => x.id === key)
  if (!a) throw new Error('Automation not saved')
  return a
}

export async function setEnabled(id: string, enabled: boolean) {
  // Resuming starts counting from now: a paused week doesn't fire a backlog.
  await pool.query(`update automations set enabled=$2, last_fired_at=case when $2 then now() else last_fired_at end, updated_at=now() where id=$1`, [id, enabled])
  changed()
}

export async function remove(id: string) {
  await pool.query('delete from automations where id=$1', [id])
  changed()
}

export async function runNow(id: string) {
  const a = await get(id)
  if (!a) throw new Error('Automation not found')
  void execute(a, 'Run now', {})
}

async function get(id: string) {
  const r = await pool.query('select * from automations where id=$1', [id])
  return r.rows[0] ? row(r.rows[0]) : null
}

// ---------- schedule ----------

/** The first time the schedule fires after `after` (local time). Event triggers have none. */
export function nextRun(t: Trigger, after: number): number | null {
  if (t.kind !== 'schedule') return null
  const d = new Date(after)
  d.setSeconds(0, 0)
  if (t.every === 'hourly') {
    d.setMinutes(t.minute)
    while (d.getTime() <= after) d.setHours(d.getHours() + 1)
    return d.getTime()
  }
  d.setHours(t.hour, t.minute)
  const ok = (x: Date) =>
    t.every === 'daily' ? true : t.every === 'weekdays' ? x.getDay() >= 1 && x.getDay() <= 5 : (t.days ?? [1]).includes(x.getDay())
  for (let i = 0; i < 8; i++) {
    if (d.getTime() > after && ok(d)) return d.getTime()
    d.setDate(d.getDate() + 1)
    d.setHours(t.hour, t.minute)
  }
  return null
}

const two = (n: number) => String(n).padStart(2, '0')
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export function describe(t: Trigger): string {
  if (t.kind === 'push') return `Push to ${t.branches || '*'}`
  if (t.kind === 'commit') return `New commits on ${t.branches || '*'}`
  const at = `${t.hour}:${two(t.minute)}`
  if (t.every === 'hourly') return `Every hour at :${two(t.minute)}`
  if (t.every === 'daily') return `Every day at ${at}`
  if (t.every === 'weekdays') return `Weekdays at ${at}`
  return `${(t.days ?? [1]).map((d) => DAYS[d]).join(', ')} at ${at}`
}

let timer: NodeJS.Timeout | null = null

export function startAutomations(h: Host) {
  host = h
  if (timer) return
  const tick = async () => {
    try {
      await scheduleTick()
      await refsTick()
    } catch { /* db or git hiccup: next tick */ }
  }
  setTimeout(() => void tick(), 8000)
  timer = setInterval(() => void tick(), 30_000)
}

async function scheduleTick() {
  const now = Date.now()
  const r = await pool.query(`select * from automations where enabled and trigger->>'kind'='schedule'`)
  for (const x of r.rows) {
    const a = row(x)
    const due = nextRun(a.trigger, a.lastFiredAt ?? a.createdAt)
    if (!due || due > now) continue
    // Mark it fired first: a slow run never fires twice.
    await pool.query('update automations set last_fired_at=now() where id=$1', [a.id])
    const late = now - due
    if (late > Math.max(a.graceHours, 0) * 3600_000 + 120_000) {
      await record(a, describe(a.trigger), 'skipped', { error: 'Missed while code-maxxer was closed, past the grace period' })
      continue
    }
    void execute(a, describe(a.trigger), {})
  }
  changed()
}

// ---------- push and commit triggers (local git refs) ----------

/** Last seen refs per project folder. */
const seen = new Map<string, Map<string, string>>()
/** Branches an automation run is working on: their own commits don't fire other automations. */
const quiet = new Map<string, number>()

const git = (cwd: string, args: string[]) =>
  new Promise<string>((ok, fail) => execFile(bin('git'), args, { cwd, env: shellEnv(), maxBuffer: 8 * 1024 * 1024 }, (e, out) => (e ? fail(e) : ok(String(out)))))

const match = (patterns: string, branch: string) =>
  (patterns || '*')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .some((p) => new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$').test(branch))

async function refsTick() {
  const r = await pool.query(
    `select a.*, p.path from automations a join projects p on p.id=a.project_id where a.enabled and a.trigger->>'kind' in ('push','commit')`
  )
  const byPath = new Map<string, any[]>()
  for (const x of r.rows) byPath.set(x.path, [...(byPath.get(x.path) ?? []), x])
  for (const [path, rows] of byPath) {
    const out = await git(path, ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/remotes/origin']).catch(() => '')
    const now = new Map(out.split('\n').filter(Boolean).map((l) => l.split(' ') as [string, string]))
    const before = seen.get(path)
    seen.set(path, now)
    if (!before) continue // first look: nothing to compare with
    const events: { kind: 'push' | 'commit'; branch: string; sha: string }[] = []
    for (const [ref, sha] of now) {
      const old = before.get(ref)
      if (!old || old === sha) continue
      // Only new commits: a branch moved back (reset) or rewritten isn't an event.
      if (!(await git(path, ['merge-base', '--is-ancestor', old, sha]).then(() => true, () => false))) continue
      if (ref.startsWith('refs/heads/')) events.push({ kind: 'commit', branch: ref.slice(11), sha })
      else if (ref.startsWith('refs/remotes/origin/')) {
        const branch = ref.slice(20)
        if (branch === 'HEAD') continue
        // The remote caught up with the local branch: a push. Otherwise new commits came from the remote.
        events.push({ kind: now.get(`refs/heads/${branch}`) === sha ? 'push' : 'commit', branch, sha })
      }
    }
    for (const ev of events) {
      if ((quiet.get(`${path}:${ev.branch}`) ?? 0) > Date.now()) continue
      for (const x of rows) {
        const a = row(x)
        if (a.trigger.kind !== ev.kind || !match((a.trigger as any).branches, ev.branch)) continue
        const cause = `${ev.kind === 'push' ? 'Push to' : 'New commits on'} ${ev.branch} · ${ev.sha.slice(0, 7)}`
        void execute(a, cause, { branch: ev.branch, commit: ev.sha })
      }
    }
  }
}

// ---------- running ----------

const busy = new Set<string>()

async function record(a: { id: string }, cause: string, status: RunStatus, extra: Partial<AutomationRun>) {
  await pool.query(
    `insert into automation_runs(id, automation_id, cause, status, ended_at, workspace_id, branch, steps, error, cost)
     values($1,$2,$3,$4,now(),$5,$6,$7,$8,$9)`,
    ['ar_' + randomUUID().slice(0, 8), a.id, cause, status, extra.workspaceId ?? null, extra.branch ?? null, JSON.stringify(extra.steps ?? []), extra.error ?? null, extra.cost ?? 0]
  )
  changed()
}

const sh = (cwd: string, command: string, timeoutSec: number) =>
  new Promise<{ code: number; out: string }>((ok) =>
    execFile('/bin/zsh', ['-lc', command], { cwd, env: shellEnv(), timeout: timeoutSec * 1000, maxBuffer: 16 * 1024 * 1024 }, (e: any, stdout, stderr) =>
      ok({ code: e ? (typeof e.code === 'number' ? e.code : 1) : 0, out: (String(stdout) + (stderr ? `\n${stderr}` : '')).trim() })
    )
  )

const tail = (s: string, n = 4000) => (s.length > n ? '…' + s.slice(-n) : s)
const fill = (text: string, v: { branch?: string; commit?: string; output?: string }) =>
  text.replace(/\{\{(branch|commit|output)\}\}/g, (_m, k: 'branch' | 'commit' | 'output') => v[k] ?? '')

/** Waits for the agent to finish in the workspace (a pipeline included), then returns what it wrote after `since`. */
async function agentDone(wsId: string, since: number): Promise<{ text: string; cost: number; error: string | null }> {
  const limit = Date.now() + 3 * 3600_000
  let idle = 0
  while (Date.now() < limit) {
    await new Promise((r) => setTimeout(r, 2000))
    const ws = await db.workspace(wsId)
    idle = !orch.isRunning(wsId) && ws?.status !== 'running' ? idle + 1 : 0
    if (idle >= 3) break
  }
  const msgs = (await db.messages(wsId)).filter((m): m is Extract<Message, { role: 'assistant' }> => m.role === 'assistant' && m.at >= since)
  const text = msgs.map((m) => m.blocks.filter((b) => b.kind === 'text').map((b: any) => b.text).join('\n')).join('\n\n').trim()
  return { text, cost: msgs.reduce((s, m) => s + (m.cost ?? 0), 0), error: msgs.find((m) => m.error)?.error ?? null }
}

async function execute(a: ReturnType<typeof row>, cause: string, vars: { branch?: string; commit?: string }) {
  if (!host || busy.has(a.id)) return
  busy.add(a.id)
  const id = 'ar_' + randomUUID().slice(0, 8)
  const steps: AutomationRun['steps'] = a.steps.map((s) => ({ kind: s.kind, status: 'skipped' as RunStatus, output: '' }))
  let ws: Workspace | null = null
  let cost = 0
  const save = async (status: RunStatus, error: string | null = null, end = false) => {
    await pool.query(
      `insert into automation_runs(id, automation_id, cause, status, workspace_id, branch, steps, error, cost, ended_at)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9, case when $10 then now() end)
       on conflict (id) do update set status=$4, workspace_id=$5, branch=$6, steps=$7, error=$8, cost=$9, ended_at=case when $10 then now() end`,
      [id, a.id, cause, status, ws?.id ?? null, ws?.branch ?? vars.branch ?? null, JSON.stringify(steps), error, cost, end]
    )
    changed()
  }
  try {
    await save('running')
    if (a.location.kind === 'new') {
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')
      ws = await host.createWorkspace(a.projectId, `${a.name} ${stamp}`)
    } else {
      ws = await db.workspace(a.location.workspaceId)
      if (!ws) throw new Error('The workspace of this automation no longer exists')
    }
    if (orch.isRunning(ws.id)) return void (await save('skipped', 'The agent was busy in that branch', true))
    const quietKey = `${(await db.project(a.projectId))?.path}:${ws.branch}`
    quiet.set(quietKey, Date.now() + 3 * 3600_000)
    const v = { branch: vars.branch ?? ws.branch, commit: vars.commit ?? '', output: '' }

    if (a.precheck.command.trim()) {
      const p = await sh(ws.worktreePath, a.precheck.command, a.precheck.timeoutSec || 60)
      if (p.code !== 0 || !p.out.trim()) return void (await save('skipped', `Precheck: ${p.code !== 0 ? `exited with ${p.code}` : 'no output'}`, true))
    }

    let failed: string | null = null
    for (let i = 0; i < a.steps.length; i++) {
      const s: Step = a.steps[i]
      // After a failure only PR comments still run (to report it).
      if (failed && s.kind !== 'pr_comment') continue
      steps[i].status = 'running'
      await save('running')
      if (s.kind === 'shell') {
        const r = await sh(ws.worktreePath, fill(s.command, v), s.timeoutSec || 600)
        v.output = tail(r.out)
        steps[i] = { kind: s.kind, status: r.code === 0 ? 'success' : 'failed', output: v.output }
        if (r.code !== 0) failed = `${fill(s.command, v)} exited with ${r.code}`
      } else if (s.kind === 'prompt' || s.kind === 'pipeline') {
        if (a.session === 'fresh') await pool.query('update workspaces set session_id=null where id=$1', [ws.id])
        const since = Date.now()
        const opts: SendOptions = {
          workspaceId: ws.id,
          text: fill(s.text, v),
          model: s.model,
          effort: s.kind === 'prompt' ? s.effort : 'medium',
          mode: s.kind === 'pipeline' ? { kind: 'pipeline', pipelineId: s.pipelineId } : { kind: 'direct' },
          fullAccess: s.kind === 'prompt' ? s.fullAccess : true
        } as SendOptions
        await orch.send(opts, host.emit, host.mcpScript)
        const r = await agentDone(ws.id, since)
        cost += r.cost
        v.output = tail(r.text)
        steps[i] = { kind: s.kind, status: r.error ? 'failed' : 'success', output: r.error ?? v.output }
        if (r.error) failed = r.error
      } else {
        const body = fill(s.text, v).trim() || (failed ? `Automation "${a.name}" failed: ${failed}\n\n${v.output}` : v.output) || `Automation "${a.name}" ran.`
        const r = await new Promise<{ ok: boolean; out: string }>((ok) =>
          execFile(bin('gh'), ['pr', 'comment', ws!.branch, '--body', body], { cwd: ws!.worktreePath, env: shellEnv() }, (e, out, err) =>
            ok({ ok: !e, out: String(out || err).trim() })
          )
        )
        // No pull request for the branch isn't a failure of the run: the comment just has nowhere to go.
        steps[i] = { kind: s.kind, status: r.ok ? 'success' : 'skipped', output: r.ok ? r.out : `No comment: ${r.out.split('\n').pop()}` }
      }
      await save('running')
    }
    await save(failed ? 'failed' : 'success', failed, true)
  } catch (e: any) {
    await save('failed', String(e?.message ?? e), true).catch(() => {})
  } finally {
    busy.delete(a.id)
    // Its own commits settle before other automations listen to the branch again.
    if (ws) {
      const key = `${(await db.project(a.projectId))?.path}:${ws.branch}`
      quiet.set(key, Date.now() + 60_000)
    }
  }
}
