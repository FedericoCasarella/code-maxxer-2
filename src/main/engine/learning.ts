import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { LOGIN_NEEDED, type Block, type EngineEvent, type Message, type Workspace } from '@shared/types'
import type { CycleStatus, LearningCycle, LearningState, Lesson, LessonKind, RunSignals } from '@shared/learning'
import { db, pool } from '../db'
import { bin, shellEnv } from './bins'
import { reportLanguageRule } from './language'
import { loopReviews } from './loops'

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
alter table learning_cycles add column if not exists problem text not null default '';
alter table learning_cycles add column if not exists fix text not null default '';
alter table learning_lessons add column if not exists kind text not null default 'know';
alter table learning_lessons add column if not exists situation text not null default '';
alter table learning_lessons add column if not exists auto boolean not null default false;
alter table learning_lessons add column if not exists agent_handle text;
update learning_lessons set kind = case when title ~* '^(never|don''t|do not|avoid|stop|non |mai )' then 'never' else 'always' end
  where kind='know' and situation='' and created_at < '2026-11-19 12:00' and not auto;
update learning_lessons set kind='know' where auto and kind <> 'know';
`

const key = (projectId: string) => `learn:project:${projectId}`
/** Lessons that go into the prompt: few, so the context stays light (and the same across runs, so it caches). */
const MAX_RULES = 8
/** Runs that must confirm a proposed lesson before it's used without the user's ok. */
const AUTO_KEEP = 2

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
  kind: x.kind ?? 'know', situation: x.situation ?? '', auto: !!x.auto,
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
    problem: x.problem ?? '', fix: x.fix ?? '',
    confirmed: x.confirmed, violated: x.violated, at: x.created_at.getTime(),
    lessons: lessons.filter((s) => s.cycleId === x.id)
  }))
  // Discarded lessons still show on their cycle, greyed out.
  const rejected = await pool.query(`${LESSONS} where l.project_id=$1 and l.status='rejected' and l.cycle_id = any($2)`, [
    projectId, cycles.map((x) => x.id)
  ])
  for (const r of rejected.rows.map(lessonRow)) cycles.find((x) => x.id === r.cycleId)?.lessons.push(r)
  return { projectId, enabled: await isEnabled(projectId), cycles, lessons: lessons.filter((s) => s.status === 'active' || s.status === 'retired'), loops: await loopReviews(projectId) }
}

/** For the system prompt of every run in the project: the kept lessons, best first. */
export async function lessonsRule(projectId: string): Promise<string> {
  if (!(await isEnabled(projectId))) return ''
  const r = await pool.query(
    `select title, kind, situation from learning_lessons where project_id=$1 and status='active'
     order by confirmations - violations desc, created_at limit $2`,
    [projectId, MAX_RULES]
  )
  const total = Number((await pool.query(`select count(*) from learning_lessons where project_id=$1 and status='active'`, [projectId])).rows[0].count)
  if (!total) return ''
  // Only the strongest few as one-liners: the rest stays out of the context, behind the search tool.
  return (
    'LESSONS LEARNED in this project from earlier runs (the user approved them; follow them):\n' +
    r.rows.map((x) => `- ${KIND_WORD[x.kind as LessonKind] ?? ''}${x.title}${x.situation ? ` (when ${x.situation})` : ''}`).join('\n') +
    `\n${total > r.rows.length ? `${total - r.rows.length} more lessons are stored. ` : ''}` +
    'Before starting a task, call mcp__cm2__lessons_search with a few words about what you are about to do (area, file, kind of change) ' +
    'to find lessons from similar past work, and follow the ones that apply.'
  )
}

/**
 * What a custom agent learned while it was at work, in any project: it follows the agent wherever it's called.
 * Only the lessons the user approved (not the technical notes, which belong to their project).
 */
export async function agentLessons(handle: string): Promise<string> {
  const r = await pool.query(
    `select l.title, l.kind, l.situation, p.name as project from learning_lessons l join projects p on p.id=l.project_id
      where l.agent_handle=$1 and l.status='active' and not l.auto order by l.confirmations - l.violations desc, l.created_at limit 12`,
    [handle]
  )
  if (!r.rows.length) return ''
  return `What @${handle} learned on earlier work (approved by the user; follow it):\n` +
    r.rows.map((x) => `- ${KIND_WORD[x.kind as LessonKind] ?? ''}${x.title}${x.situation ? ` (when ${x.situation})` : ''} [${x.project}]`).join('\n')
}

const KIND_WORD: Record<LessonKind, string> = { always: 'ALWAYS: ', never: 'NEVER: ', know: '' }

/** Run a failed review again. */
export async function retry(cycleId: string) {
  const r = await pool.query(`select workspace_id, message_id, model as cmodel from learning_cycles where id=$1`, [cycleId])
  const row = r.rows[0]
  if (!row) return
  const ws = await db.workspace(row.workspace_id)
  const msg = ws && (await db.messages(ws.id)).find((m) => m.id === row.message_id)
  if (!ws || !msg || msg.role !== 'assistant') return
  await pool.query('delete from learning_cycles where id=$1', [cycleId])
  changed(ws.projectId)
  await afterRun(ws, msg, row.cmodel ?? '')
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

/** The user writes their own lesson instead of the proposed one: it replaces it and is in use right away. */
export async function custom(lessonId: string, text: string) {
  const r = await pool.query(
    `update learning_lessons set title=$2, body='', kind='always', situation='', status='active' where id=$1 and status='proposed' returning project_id, cycle_id`,
    [lessonId, text.trim().slice(0, 300)]
  )
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
  // Not signed in: nothing ran, and the sign-in starts on its own.
  if (signals.error && LOGIN_NEEDED.test(signals.error)) return
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
    // The custom agent at work in this run (called with @handle): what is learned here becomes its own too
    const mentioned = [...(prompt ? textOf(prompt) : '').matchAll(/(?:^|[\s(])@([a-z0-9_]{2,40})\b/gi)].map((m) => m[1].toLowerCase())
    const agentHandle = mentioned.length
      ? ((await pool.query('select handle from agents where custom and lower(handle) = any($1) limit 1', [mentioned])).rows[0]?.handle ?? null)
      : null
    await pool.query(
      `insert into learning_cycles(id, project_id, workspace_id, message_id, title, signals, model) values($1,$2,$3,$4,$5,$6,$7)`,
      [id, ws.projectId, ws.id, msg.id, title, JSON.stringify(signals), model]
    )
    changed(ws.projectId)

    const active = await pool.query(`select id, title, body, status from learning_lessons where project_id=$1 and status in ('active','proposed')`, [ws.projectId])
    const ids = new Set(active.rows.map((x) => x.id))
    const review = await reflect({
      request: prompt ? textOf(prompt) : '',
      previous: prev ? textOf(prev).slice(-1200) : '',
      reply: textOf(msg).slice(-2500),
      trace: trace(msg),
      signals,
      lessons: active.rows
    }, ws.worktreePath)

    // Discarded ones count too: what the user said no to doesn't come back.
    const known = (await pool.query(`select title from learning_lessons where project_id=$1`, [ws.projectId])).rows.map((a) => a.title as string)
    const fresh: Review['lessons'] = []
    for (const l of review.lessons) {
      if (!l.title || fresh.length >= 1) continue
      // Same lesson in other words, already proposed or kept in an earlier cycle: not again.
      if ([...known, ...fresh.map((f) => f.title)].some((k) => similar(k, l.title))) continue
      fresh.push(l)
    }
    for (const l of fresh)
      await pool.query(`insert into learning_lessons(id, project_id, cycle_id, title, body, kind, situation, agent_handle) values($1,$2,$3,$4,$5,$6,$7,$8)`, [
        randomUUID(), ws.projectId, id, l.title.slice(0, 160), (l.body ?? '').slice(0, 400), l.kind, (l.situation ?? '').slice(0, 200), agentHandle
      ])
    // Technical notes: for the agent, kept without asking (they retire on their own if proved wrong).
    for (const n of review.notes.filter((n) => !known.some((k) => similar(k, n.title))))
      await pool.query(`insert into learning_lessons(id, project_id, cycle_id, title, body, kind, status, auto) values($1,$2,$3,$4,$5,'know','active',true)`, [
        randomUUID(), ws.projectId, id, n.title.slice(0, 160), (n.body ?? '').slice(0, 400)
      ])
    const confirmed = review.confirmed.filter((x) => ids.has(x))
    const violated = review.violated.filter((x) => ids.has(x) && !confirmed.includes(x))
    if (confirmed.length) {
      await pool.query('update learning_lessons set confirmations=confirmations+1 where id = any($1)', [confirmed])
      // A proposed lesson two later runs showed the need for again: in use on its own, the user can still take it out.
      const kept = await pool.query(
        `update learning_lessons set status='active' where id = any($1) and status='proposed' and confirmations >= $2 returning cycle_id`,
        [confirmed, AUTO_KEEP]
      )
      for (const c of new Set(kept.rows.map((x) => x.cycle_id).filter(Boolean)))
        await pool.query(
          `update learning_cycles set status='done' where id=$1 and status='needs_you'
           and not exists (select 1 from learning_lessons where cycle_id=$1 and status='proposed')`,
          [c]
        )
    }
    if (violated.length) {
      await pool.query('update learning_lessons set violations=violations+1 where id = any($1)', [violated])
      // Proved wrong more often than right: out of the prompt.
      await pool.query(`update learning_lessons set status='retired' where id = any($1) and status='active' and violations >= 2 and violations > confirmations`, [violated])
    }
    const status: CycleStatus = fresh.length ? 'needs_you' : 'done'
    await pool.query(
      `update learning_cycles set status=$2, outcome=$3, title=$4, conclusion=$5, confirmed=$6, violated=$7, problem=$8, fix=$9 where id=$1`,
      [id, status, review.outcome, (review.title || title).slice(0, 120), review.conclusion.slice(0, 500), confirmed, violated, review.problem.slice(0, 400), fresh.length ? review.fix.slice(0, 400) : '']
    )
  } catch (e: any) {
    await pool.query(`update learning_cycles set status='failed', conclusion=$2 where id=$1`, [id, String(e?.message ?? e).slice(0, 300)]).catch(() => {})
  } finally {
    running.delete(ws.id)
    changed(ws.projectId)
  }
}

type Review = {
  title: string
  outcome: 'success' | 'partial' | 'failed'
  conclusion: string
  problem: string
  fix: string
  lessons: { title: string; body?: string; kind: LessonKind; situation?: string }[]
  notes: { title: string; body?: string }[]
  confirmed: string[]
  violated: string[]
}

async function reflect(
  r: { request: string; previous: string; reply: string; trace: string; signals: RunSignals; lessons: { id: string; title: string; body: string; status: string }[] },
  cwd: string
): Promise<Review> {
  const lang = await reportLanguageRule()
  const prompt =
    'You review one run of a coding agent so it gets better at this project over time. Two outputs:\n\n' +
    'LESSONS go to the user, who decides to keep or discard each one. The user does not read the code: a lesson must be something ' +
    'they can judge from their own experience of working with the agent. Only three sorts:\n' +
    '1. interaction: how this user wants to work with the agent: what they corrected, repeated, rejected or praised; when to ask them and when not; ' +
    'how they like answers, reports and choices (e.g. "Ask before changing the site menu or removing a page", "Show the result in the browser before saying it is done").\n' +
    '2. context: what the project is, who it is for, what matters to the user in it, decisions they made ' +
    '(e.g. "The portal is for elderly readers: text stays large and simple").\n' +
    '3. operating: a change in HOW the agent works that saves retries, time or money, described by its effect ' +
    '(e.g. "Check the pages on a phone width before closing a layout task", "Sync with the remote main before merging").\n' +
    'Good lessons, in the user\'s own words: "Test every interface at several widths: phone, tablet, laptop, wide screen"; ' +
    '"Stay faithful to the design system when building"; "Before creating a page, reuse the layout of the existing ones". ' +
    'A bad lesson: "That code must move to package.json or it performs badly" (technical: the user can\'t judge it, it is a note). ' +
    'Never a lesson about how a library, a config file, a build tool or the code works: the user cannot judge it. ' +
    'No file names, settings or code in a lesson. Write each as what the agent will do differently, in words the user would use. ' +
    'Zero lessons is the normal, good answer: almost every run ends with none. A run that fixed a bug, investigated a problem, ' +
    'took a few tries or asked the user before a risky step is ordinary work, NOT a lesson. ' +
    'Propose one only when (a) the user corrected the agent, repeated a request or showed they were unhappy with how it worked, ' +
    'or (b) the same mistake already happened in earlier runs (see the existing lessons), and only if it changes how the agent works with this user from now on. ' +
    'Never a lesson that restates a rule the agent already follows (asking before production, merges or deploys). At most 1. ' +
    'Handing a change to a loop (a pipeline with checks) is how the user wants every change done: never propose doing changes directly or skipping loops. ' +
    'Never propose a lesson that says the same thing as an existing one below, even in other words or more precisely: ' +
    'if the run shows it again, list that lesson as confirmed instead.\n\n' +
    'NOTES are for the agent only and are saved without asking: technical facts about this project it had to discover the hard way ' +
    '(commands, paths, config quirks, how a tool behaves here). At most 2, only when they would save real time next run.\n\n' +
    'Also say which of the existing lessons this run confirmed (followed and it helped) or violated (ignored, or proved wrong). ' +
    'A lesson marked [proposed] is still waiting for the user: it counts as confirmed when this run shows the same need again ' +
    '(the same correction, the same mistake, or following it would have saved time).\n\n' +
    'Everything except NOTES is read by the user, who did not watch the run: plain words, no jargon, no ids, no tool names. ' +
    `${lang}\n` +
    'Reply with JSON only, no code fences:\n' +
    '{"title": "what the user asked for, as a short plain phrase (under 10 words)", "outcome": "success|partial|failed", ' +
    '"problem": "what went wrong or cost time in this run, from the user\'s point of view (the first mistake, the wrong assumption, the correction the user had to make). Empty string if nothing went wrong.", ' +
    '"fix": "what will be different in the next runs if the user keeps the lessons below, in one sentence. Empty string if no lessons.", ' +
    '"conclusion": "one plain sentence: how the run went", ' +
    '"lessons": [{"kind": "always|never|know", "title": "the lesson, one full sentence about what the agent will do (always/never) or must keep in mind (know)", ' +
    '"situation": "when it applies, a few words", "body": "why: what happened in this run that shows it, one sentence the user recognizes"}], ' +
    '"notes": [{"title": "the technical fact, one sentence", "body": "where it showed up"}], ' +
    '"confirmed": ["lesson id"], "violated": ["lesson id"]}\n\n' +
    `Existing lessons:\n${r.lessons.map((l) => `${l.id}: ${l.status === 'proposed' ? '[proposed] ' : ''}${l.title}${l.body ? ` (${l.body})` : ''}`).join('\n') || '(none)'}\n\n` +
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
      (err, stdout, stderr) => (err ? fail(new Error(reviewError(err, String(stderr || stdout || '')))) : ok(String(stdout)))
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
    problem: String(v.problem ?? ''),
    fix: String(v.fix ?? ''),
    lessons: Array.isArray(v.lessons)
      ? v.lessons
          .filter((l: any) => l && typeof l.title === 'string')
          .map((l: any) => ({ title: l.title, body: l.body, situation: l.situation, kind: ['always', 'never', 'know'].includes(l.kind) ? l.kind : 'know' }))
      : [],
    notes: Array.isArray(v.notes) ? v.notes.filter((n: any) => n && typeof n.title === 'string' && n.title.trim()).slice(0, 2) : [],
    confirmed: arr(v.confirmed),
    violated: arr(v.violated)
  }
}

/** The reviewer's failure, in words the user can act on. */
function reviewError(err: any, out: string): string {
  if (err?.killed || err?.signal === 'SIGTERM') return 'The review took more than 2 minutes and was stopped.'
  if (LOGIN_NEEDED.test(out)) return "Claude isn't signed in, so the review couldn't run."
  if (err?.code === 'ENOENT') return "The Claude CLI wasn't found."
  const last = out.trim().split('\n').filter(Boolean).slice(-2).join(' ')
  return last ? `The reviewer stopped: ${last.slice(0, 220)}` : `The reviewer stopped with no message (exit code ${err?.code ?? '?'}).`
}

const STOP = new Set('the a an and or of to in on for with is are be it its this that when before after not non il lo la le gli i un una e o di da in su per con che del della dei delle al alla prima dopo sempre mai'.split(' '))
const words = (s: string) => new Set(s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)))
/** Two lessons saying the same thing: most of the meaningful words in common. */
export function similar(a: string, b: string): boolean {
  if (a.trim().toLowerCase() === b.trim().toLowerCase()) return true
  const x = words(a), y = words(b)
  if (!x.size || !y.size) return false
  let common = 0
  for (const w of x) if (y.has(w)) common++
  return common / Math.min(x.size, y.size) >= 0.6
}

/**
 * Once per project, for lessons proposed before the rules above: drop the ones that repeat another lesson,
 * and turn the technical ones (that the user can't judge) into the agent's own notes.
 */
export async function tidyAll() {
  const r = await pool.query(`select distinct project_id from learning_lessons where status='proposed'`)
  for (const { project_id } of r.rows) {
    const flag = `learn:tidy1:${project_id}`
    if (await db.getSetting<boolean>(flag)) continue
    try {
      await tidy(project_id)
      await db.setSetting(flag, true)
    } catch { /* tried again next launch */ }
  }
}

async function tidy(projectId: string) {
  const all = (await pool.query(`select id, title, body, status from learning_lessons where project_id=$1 order by created_at`, [projectId])).rows
  const seen: string[] = all.filter((l) => l.status !== 'proposed').map((l) => l.title)
  const keep: { id: string; title: string; body: string }[] = []
  for (const l of all.filter((x) => x.status === 'proposed')) {
    if (seen.some((s) => similar(s, l.title))) await pool.query('delete from learning_lessons where id=$1', [l.id])
    else (seen.push(l.title), keep.push(l))
  }
  if (keep.length) {
    const prompt =
      'These lessons were proposed to a user who does not read the code. Which ones are technical: about how a library, a config file, ' +
      'a build tool, specific files or the code work, so the user cannot judge them? Lessons about how to work with the user, the project context, ' +
      'or the agent\'s way of working are NOT technical.\n' +
      'Reply with JSON only: {"technical": ["id", ...]}\n\n' +
      keep.map((l) => `${l.id}: ${l.title}${l.body ? ` (${l.body})` : ''}`).join('\n')
    const out = await new Promise<string>((ok, fail) => {
      const child = execFile(
        bin('claude'),
        ['-p', '--model', 'haiku', '--output-format', 'text', '--tools', '', '--strict-mcp-config', '--setting-sources', 'project,local', '--disable-slash-commands', '--no-session-persistence'],
        { env: shellEnv(), maxBuffer: 1024 * 1024, timeout: 120_000 },
        (err, stdout, stderr) => (err ? fail(new Error(reviewError(err, String(stderr || stdout || '')))) : ok(String(stdout)))
      )
      child.stdin?.end(prompt)
    })
    const ids: string[] = (JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)).technical ?? []).map(String)
    const tech = keep.filter((l) => ids.includes(l.id)).map((l) => l.id)
    if (tech.length) await pool.query(`update learning_lessons set status='active', kind='know', auto=true where id = any($1) and status='proposed'`, [tech])
  }
  // Cycles left with nothing to decide are done.
  await pool.query(
    `update learning_cycles c set status='done' where c.project_id=$1 and c.status='needs_you'
     and not exists (select 1 from learning_lessons l where l.cycle_id=c.id and l.status='proposed')`,
    [projectId]
  )
  changed(projectId)
}
