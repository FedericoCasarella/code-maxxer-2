import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { Block, EngineEvent, Message, Workspace } from '@shared/types'
import type { CycleStatus, LearningCycle, LearningState, Lesson, RunSignals } from '@shared/learning'
import { db, pool } from '../db'
import { bin, shellEnv } from './bins'

/*
 * The self-improving loop, in three parts:
 *  1. signals: measured from the finished run (errors, failed commands, commits, cost, interruptions);
 *  2. reflection: a small model reads the run, the user's next words and the active lessons, and
 *     proposes at most a few lessons, plus which active ones were confirmed or broken;
 *  3. consolidation: the user keeps or discards proposed lessons; kept ones go into every run's
 *     system prompt; lessons broken more often than confirmed retire on their own.
 */

export const LEARNING_SCHEMA = `
create table if not exists learning_cycles (
  id text primary key, project_id text not null references projects(id) on delete cascade,
  workspace_id text not null references workspaces(id) on delete cascade, message_id text not null,
  status text not null default 'running', outcome text, title text not null, conclusion text not null default '',
  signals jsonb not null default '{}', confirmed text[] not null default '{}', violated text[] not null default '{}',
  created_at timestamptz not null default now()
);
alter table learning_cycles add column if not exists model text;
create index if not exists learning_cycles_project on learning_cycles(project_id, created_at desc);
create table if not exists learning_lessons (
  id text primary key, project_id text not null references projects(id) on delete cascade, cycle_id text,
  title text not null, body text not null default '', status text not null default 'proposed',
  confirmations int not null default 0, violations int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists learning_lessons_project on learning_lessons(project_id, status);
`

const key = (projectId: string) => `learn:project:${projectId}`
/** Lessons that go into the prompt: few, so the context stays light (and the same across runs, so it caches). */
const MAX_RULES = 8

let emit: ((e: EngineEvent) => void) | null = null
export const setLearningEmitter = (e: (e: EngineEvent) => void) => (emit = e)
const changed = (projectId: string) => emit?.({ type: 'learning', projectId })

export const isEnabled = async (projectId: string) => !!(await db.getSetting<boolean>(key(projectId)))
export async function setEnabled(projectId: string, enabled: boolean) {
  await db.setSetting(key(projectId), enabled)
  changed(projectId)
}

const lessonRow = (x: any): Lesson => ({
  id: x.id, projectId: x.project_id, cycleId: x.cycle_id, title: x.title, body: x.body, status: x.status,
  confirmations: x.confirmations, violations: x.violations, at: x.created_at.getTime(),
  origin: x.c_ws ? { workspaceId: x.c_ws, branch: x.c_branch, messageId: x.c_msg, model: x.c_model, run: x.c_title } : null
})
const LESSONS = `select l.*, c.workspace_id as c_ws, c.message_id as c_msg, c.model as c_model, c.title as c_title, w.branch as c_branch
  from learning_lessons l left join learning_cycles c on c.id=l.cycle_id left join workspaces w on w.id=c.workspace_id`

export async function learningState(projectId: string): Promise<LearningState> {
  const [c, l] = await Promise.all([
    pool.query(
      `select c.*, w.branch from learning_cycles c join workspaces w on w.id=c.workspace_id
       where c.project_id=$1 order by c.created_at desc limit 60`,
      [projectId]
    ),
    pool.query(`${LESSONS} where l.project_id=$1 and l.status <> 'rejected' order by l.created_at desc limit 300`, [projectId])
  ])
  const lessons = l.rows.map(lessonRow)
  const cycles: LearningCycle[] = c.rows.map((x) => ({
    id: x.id, projectId: x.project_id, workspaceId: x.workspace_id, branch: x.branch, messageId: x.message_id,
    model: x.model, status: x.status, outcome: x.outcome, title: x.title, conclusion: x.conclusion, signals: x.signals,
    confirmed: x.confirmed, violated: x.violated, at: x.created_at.getTime(),
    lessons: lessons.filter((s) => s.cycleId === x.id)
  }))
  // Discarded lessons still show on their cycle, greyed out.
  const rejected = await pool.query(`${LESSONS} where l.project_id=$1 and l.status='rejected' and l.cycle_id = any($2)`, [
    projectId, cycles.map((x) => x.id)
  ])
  for (const r of rejected.rows.map(lessonRow)) cycles.find((x) => x.id === r.cycleId)?.lessons.push(r)
  return { projectId, enabled: await isEnabled(projectId), cycles, lessons: lessons.filter((s) => s.status === 'active' || s.status === 'retired') }
}

/** For the system prompt of every run in the project: the kept lessons, best first. */
export async function lessonsRule(projectId: string): Promise<string> {
  if (!(await isEnabled(projectId))) return ''
  const r = await pool.query(
    `select title, body from learning_lessons where project_id=$1 and status='active'
     order by confirmations - violations desc, created_at limit $2`,
    [projectId, MAX_RULES]
  )
  if (!r.rows.length) return ''
  return (
    'LESSONS LEARNED in this project from earlier runs (the user approved them; follow them):\n' +
    r.rows.map((x) => `- ${x.title}${x.body ? `: ${x.body}` : ''}`).join('\n')
  )
}

export async function decide(lessonId: string, keep: boolean) {
  const r = await pool.query(`update learning_lessons set status=$2 where id=$1 and status='proposed' returning project_id, cycle_id`, [
    lessonId, keep ? 'active' : 'rejected'
  ])
  const row = r.rows[0]
  if (!row) return
  if (row.cycle_id)
    await pool.query(
      `update learning_cycles set status='done' where id=$1 and status='needs_you'
       and not exists (select 1 from learning_lessons where cycle_id=$1 and status='proposed')`,
      [row.cycle_id]
    )
  changed(row.project_id)
}

export async function setStatus(lessonId: string, status: 'active' | 'retired') {
  const r = await pool.query(`update learning_lessons set status=$2 where id=$1 and status in ('active','retired') returning project_id`, [lessonId, status])
  if (r.rows[0]) changed(r.rows[0].project_id)
}

export async function remove(lessonId: string) {
  const r = await pool.query(`delete from learning_lessons where id=$1 returning project_id`, [lessonId])
  if (r.rows[0]) changed(r.rows[0].project_id)
}

function signalsOf(msg: Extract<Message, { role: 'assistant' }>): RunSignals {
  const tools = msg.blocks.filter((b): b is Extract<Block, { kind: 'tool' }> => b.kind === 'tool')
  const failed = tools.filter((t) => t.status === 'error')
  const cmd = (t: Extract<Block, { kind: 'tool' }>) => String((t.input as any)?.command ?? '')
  const t = msg.tokens
  return {
    tools: tools.length,
    toolErrors: failed.length,
    failedCommands: failed.filter((x) => x.name === 'Bash').map((x) => cmd(x).split('\n')[0].slice(0, 160)).slice(0, 6),
    filesEdited: new Set(tools.map((x) => x.file?.path).filter(Boolean)).size,
    commits: tools.filter((x) => x.name === 'Bash' && x.status === 'success' && /\bgit\s+commit\b/.test(cmd(x))).length,
    ms: Date.now() - msg.at,
    tokens: t ? t.input + t.output + t.cacheRead : 0,
    cost: msg.cost ?? null,
    error: msg.error ?? null,
    interrupted: !!msg.interrupted,
    asked: msg.blocks.some((b) => b.kind === 'ask')
  }
}

const textOf = (m: Message) => (m.role === 'user' ? m.text : m.blocks.filter((b) => b.kind === 'text').map((b: any) => b.text).join('\n'))

/** A short trace of what the agent did: enough for the reviewer, far less than the transcript. */
function trace(msg: Extract<Message, { role: 'assistant' }>): string {
  const out: string[] = []
  for (const b of msg.blocks) {
    if (b.kind !== 'tool') continue
    const i: any = b.input ?? {}
    const what = b.file?.path ?? i.command?.split('\n')[0] ?? i.pattern ?? i.query ?? i.url ?? i.title ?? ''
    const res = b.status === 'error' ? ` → ERROR: ${String(b.result ?? '').slice(0, 200).replace(/\s+/g, ' ')}` : ''
    out.push(`${b.name}${what ? ` ${String(what).slice(0, 140)}` : ''}${res}`)
  }
  return out.slice(-60).join('\n')
}

const running = new Set<string>()

/**
 * Called when a run ends. Skips runs that did nothing (plain answers) and projects with learning off.
 * Runs in the background: never delays or breaks the chat.
 */
export async function afterRun(ws: Workspace, msg: Extract<Message, { role: 'assistant' }>, model: string) {
  if (!(await isEnabled(ws.projectId))) return
  const signals = signalsOf(msg)
  if (signals.tools === 0 && !signals.error) return
  if (running.has(ws.id)) return
  running.add(ws.id)
  const id = randomUUID()
  try {
    const history = await db.messages(ws.id)
    const at = history.findIndex((m) => m.id === msg.id)
    const before = history.slice(0, at < 0 ? history.length : at)
    const prompt = [...before].reverse().find((m) => m.role === 'user')
    const prev = [...before].reverse().find((m) => m.role === 'assistant' && m.id !== msg.id)
    const title = (prompt ? textOf(prompt) : 'Run').replace(/\s+/g, ' ').slice(0, 90)
    await pool.query(
      `insert into learning_cycles(id, project_id, workspace_id, message_id, title, signals, model) values($1,$2,$3,$4,$5,$6,$7)`,
      [id, ws.projectId, ws.id, msg.id, title, JSON.stringify(signals), model]
    )
    changed(ws.projectId)

    const active = await pool.query(`select id, title, body from learning_lessons where project_id=$1 and status in ('active','proposed')`, [ws.projectId])
    const ids = new Set(active.rows.map((x) => x.id))
    const review = await reflect({
      request: prompt ? textOf(prompt) : '',
      previous: prev ? textOf(prev).slice(-1200) : '',
      reply: textOf(msg).slice(-2500),
      trace: trace(msg),
      signals,
      lessons: active.rows
    }, ws.worktreePath)

    const fresh = review.lessons
      .filter((l) => l.title && !active.rows.some((a) => a.title.toLowerCase() === l.title.toLowerCase()))
      .slice(0, 3)
    for (const l of fresh)
      await pool.query(`insert into learning_lessons(id, project_id, cycle_id, title, body) values($1,$2,$3,$4,$5)`, [
        randomUUID(), ws.projectId, id, l.title.slice(0, 140), (l.body ?? '').slice(0, 400)
      ])
    const confirmed = review.confirmed.filter((x) => ids.has(x))
    const violated = review.violated.filter((x) => ids.has(x) && !confirmed.includes(x))
    if (confirmed.length) await pool.query('update learning_lessons set confirmations=confirmations+1 where id = any($1)', [confirmed])
    if (violated.length) {
      await pool.query('update learning_lessons set violations=violations+1 where id = any($1)', [violated])
      // Proved wrong more often than right: out of the prompt.
      await pool.query(`update learning_lessons set status='retired' where id = any($1) and status='active' and violations >= 2 and violations > confirmations`, [violated])
    }
    const status: CycleStatus = fresh.length ? 'needs_you' : 'done'
    await pool.query(
      `update learning_cycles set status=$2, outcome=$3, title=$4, conclusion=$5, confirmed=$6, violated=$7 where id=$1`,
      [id, status, review.outcome, (review.title || title).slice(0, 90), review.conclusion.slice(0, 500), confirmed, violated]
    )
  } catch (e: any) {
    await pool.query(`update learning_cycles set status='failed', conclusion=$2 where id=$1`, [id, `Review failed: ${String(e?.message ?? e).slice(0, 300)}`]).catch(() => {})
  } finally {
    running.delete(ws.id)
    changed(ws.projectId)
  }
}

type Review = {
  title: string
  outcome: 'success' | 'partial' | 'failed'
  conclusion: string
  lessons: { title: string; body?: string }[]
  confirmed: string[]
  violated: string[]
}

async function reflect(
  r: { request: string; previous: string; reply: string; trace: string; signals: RunSignals; lessons: { id: string; title: string; body: string }[] },
  cwd: string
): Promise<Review> {
  const prompt =
    'You review one run of a coding agent so it gets better at this project over time. ' +
    'Find lessons that would make FUTURE runs in this project faster, cheaper or closer to what the user wants: ' +
    'project facts the agent had to discover the hard way (commands, paths, conventions), mistakes that cost retries, ' +
    'and preferences the user expressed (a request that corrects the previous reply is a strong signal). ' +
    'A lesson must be specific to this project or this user, short, and actionable. No generic advice ("write tests", "be careful"). ' +
    'Zero lessons is the normal, good answer when nothing new was learned. At most 3.\n' +
    'Also say which of the existing lessons this run confirmed (followed and it helped) or violated (ignored, or proved wrong).\n\n' +
    'Reply with JSON only, no code fences:\n' +
    '{"title": "what the run did, under 8 words", "outcome": "success|partial|failed", ' +
    '"conclusion": "one or two plain sentences for the user: how it went and what was learned", ' +
    '"lessons": [{"title": "imperative rule, under 12 words", "body": "why, one sentence"}], "confirmed": ["lesson id"], "violated": ["lesson id"]}\n\n' +
    `Existing lessons:\n${r.lessons.map((l) => `${l.id}: ${l.title}${l.body ? ` (${l.body})` : ''}`).join('\n') || '(none)'}\n\n` +
    (r.previous ? `Agent's previous reply (before this request):\n${r.previous}\n\n` : '') +
    `User request:\n${r.request.slice(0, 3000)}\n\n` +
    `Signals: ${JSON.stringify(r.signals)}\n\n` +
    `What the agent did (tool calls):\n${r.trace || '(nothing)'}\n\n` +
    `Agent's final reply:\n${r.reply}`
  const out = await new Promise<string>((ok, fail) => {
    const child = execFile(
      bin('claude'),
      ['-p', '--model', 'haiku', '--output-format', 'text', '--tools', '', '--strict-mcp-config', '--setting-sources', 'project,local', '--disable-slash-commands', '--no-session-persistence'],
      { cwd, env: shellEnv(), maxBuffer: 4 * 1024 * 1024, timeout: 120_000 },
      (err, stdout, stderr) => (err ? fail(new Error(String(stderr || '').trim() || err.message)) : ok(String(stdout)))
    )
    child.stdin?.end(prompt)
  })
  const json = out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)
  const v: any = JSON.parse(json)
  const arr = (x: unknown) => (Array.isArray(x) ? x.map(String) : [])
  return {
    title: String(v.title ?? ''),
    outcome: ['success', 'partial', 'failed'].includes(v.outcome) ? v.outcome : 'partial',
    conclusion: String(v.conclusion ?? ''),
    lessons: Array.isArray(v.lessons) ? v.lessons.filter((l: any) => l && typeof l.title === 'string') : [],
    confirmed: arr(v.confirmed),
    violated: arr(v.violated)
  }
}
