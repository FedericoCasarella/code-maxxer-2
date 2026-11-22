import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { EngineEvent } from '@shared/types'
import type { AgentSuggestion, GlobalBrain, GlobalRule, LessonKind, ProgressWeek, RecurringWork } from '@shared/learning'
import { db, pool } from '../db'
import { bin, shellEnv } from './bins'
import { reportLanguageRule } from './language'
import { similar } from './learning'
import { slugify } from './skillstore'

/*
 * The brain across every project. Now and then a reviewer reads what every project learned and what kind of work
 * keeps coming back, then proposes:
 *  - rules for every project, when the same lesson showed up in more than one;
 *  - an agent for work done more than once (two landing pages: a landing page expert with the user's own rules).
 * The user keeps or discards each one; kept rules go into every run's system prompt.
 */

export const BRAIN_ALL_SCHEMA = `
create table if not exists global_rules (
  id text primary key, title text not null, body text not null default '', kind text not null default 'always',
  situation text not null default '', status text not null default 'proposed', projects text[] not null default '{}',
  created_at timestamptz not null default now()
);
create table if not exists agent_suggestions (
  id text primary key, handle text not null, name text not null, description text not null default '',
  instructions text not null default '', rules text[] not null default '{}', evidence text[] not null default '{}',
  projects text[] not null default '{}', status text not null default 'proposed', created_at timestamptz not null default now()
);
`

const SWEEP_AT = 'brainAll:sweepAt'
const WORK = 'brainAll:work'
/** A sweep at most this often on its own, and only after this many new runs. */
const EVERY_MS = 6 * 3600_000
const AFTER_RUNS = 4

let emit: ((e: EngineEvent) => void) | null = null
export const setBrainAllEmitter = (e: (e: EngineEvent) => void) => (emit = e)
const changed = () => emit?.({ type: 'global-brain' })
let sweeping = false
let lastError: string | null = null

const ruleRow = (x: any): GlobalRule => ({
  id: x.id, title: x.title, body: x.body, kind: x.kind, situation: x.situation, status: x.status, projects: x.projects, at: x.created_at.getTime()
})
const agentRow = (x: any): AgentSuggestion => ({
  id: x.id, handle: x.handle, name: x.name, description: x.description, instructions: x.instructions, rules: x.rules,
  evidence: x.evidence, projects: x.projects, status: x.status, at: x.created_at.getTime()
})

export async function brainAllState(): Promise<GlobalBrain> {
  const [rules, agents, weeks, projects] = await Promise.all([
    pool.query(`select * from global_rules where status <> 'rejected' order by created_at desc`),
    pool.query(`select * from agent_suggestions where status = 'proposed' order by created_at desc`),
    pool.query(
      `select date_trunc('week', created_at) as week, count(*)::int as runs,
         count(*) filter (where outcome='success')::int as success, count(*) filter (where outcome='partial')::int as partial,
         count(*) filter (where outcome='failed' or status='failed')::int as failed
       from learning_cycles where created_at > now() - interval '12 weeks' group by 1 order by 1`
    ),
    pool.query(
      `select p.id, p.name,
         (select count(*)::int from learning_cycles c where c.project_id=p.id) as runs,
         (select count(*)::int from learning_cycles c where c.project_id=p.id and c.outcome='success') as success,
         (select count(*)::int from learning_lessons l where l.project_id=p.id and l.status='active' and not l.auto) as lessons,
         (select max(c.created_at) from learning_cycles c where c.project_id=p.id) as last
       from projects p order by last desc nulls last, p.name`
    )
  ])
  return {
    rules: rules.rows.map(ruleRow),
    agents: agents.rows.map(agentRow),
    weeks: weeks.rows.map((x): ProgressWeek => ({ week: x.week.getTime(), runs: x.runs, success: x.success, partial: x.partial, failed: x.failed })),
    projects: projects.rows.map((x) => ({ projectId: x.id, name: x.name, runs: x.runs, success: x.success, lessons: x.lessons, last: x.last ? x.last.getTime() : null })),
    work: (await db.getSetting<RecurringWork[]>(WORK)) ?? [],
    sweepAt: (await db.getSetting<number>(SWEEP_AT)) ?? null,
    sweeping,
    error: lastError
  }
}

/** For every run's system prompt: the rules the user kept for all projects. */
export async function globalRulesRule(): Promise<string> {
  const r = await pool.query(`select title, kind, situation from global_rules where status='active' order by created_at limit 12`)
  if (!r.rows.length) return ''
  const word: Record<string, string> = { always: 'ALWAYS: ', never: 'NEVER: ', know: '' }
  return (
    'RULES FOR EVERY PROJECT (the user approved them after they came up in more than one project; follow them here too):\n' +
    r.rows.map((x) => `- ${word[x.kind] ?? ''}${x.title}${x.situation ? ` (when ${x.situation})` : ''}`).join('\n')
  )
}

export async function decideRule(id: string, keep: boolean) {
  await pool.query(`update global_rules set status=$2 where id=$1 and status='proposed'`, [id, keep ? 'active' : 'rejected'])
  changed()
}
export async function setRuleStatus(id: string, status: 'active' | 'retired') {
  await pool.query(`update global_rules set status=$2 where id=$1 and status in ('active','retired')`, [id, status])
  changed()
}
export async function removeRule(id: string) {
  await pool.query(`delete from global_rules where id=$1`, [id])
  changed()
}

/** Kept: the agent is created (or updated, same handle), callable with @handle in any chat. */
export async function decideAgent(id: string, keep: boolean): Promise<string | null> {
  const s = (await pool.query(`select * from agent_suggestions where id=$1 and status='proposed'`, [id])).rows[0]
  if (!s) return null
  await pool.query(`update agent_suggestions set status=$2 where id=$1`, [id, keep ? 'accepted' : 'rejected'])
  if (!keep) return changed(), null
  const prev = (await pool.query('select id from agents where handle=$1', [s.handle])).rows[0]
  const instructions = s.instructions + (s.rules.length ? `\n\nRules:\n${s.rules.map((r: string) => `- ${r}`).join('\n')}` : '')
  await pool.query(
    `insert into agents(id, name, role, description, instructions, built_in, handle, skills, custom)
     values($1,$2,'build',$3,$4,false,$5,'{}',true)
     on conflict (id) do update set name=excluded.name, description=excluded.description, instructions=excluded.instructions`,
    [prev?.id ?? 'ag_' + randomUUID().slice(0, 8), s.name, s.description, instructions, s.handle]
  )
  emit?.({ type: 'agents' })
  changed()
  return s.handle
}

/** Called when a learning review ends: a sweep when enough new runs came in since the last one. */
export async function maybeSweep() {
  if (sweeping) return
  const at = (await db.getSetting<number>(SWEEP_AT)) ?? 0
  if (Date.now() - at < EVERY_MS) return
  const n = Number((await pool.query(`select count(*) from learning_cycles where created_at > to_timestamp($1 / 1000.0) and status <> 'running'`, [at])).rows[0].count)
  if (n < AFTER_RUNS) return
  await sweep().catch(() => {})
}

/** Read the project's CLAUDE.md: where the design system and the house rules usually are. */
function projectNotes(path: string): string {
  try {
    const f = join(path, 'CLAUDE.md')
    return existsSync(f) ? readFileSync(f, 'utf8').slice(0, 900) : ''
  } catch {
    return ''
  }
}

export async function sweep() {
  if (sweeping) return
  sweeping = true
  lastError = null
  changed()
  try {
    const [projects, lessons, cycles, rules, agents, suggestions] = await Promise.all([
      pool.query(`select id, name, path from projects order by name`),
      pool.query(
        `select l.title, l.kind, l.situation, p.name as project from learning_lessons l join projects p on p.id=l.project_id
          where l.status in ('active','proposed') and not l.auto order by l.created_at desc limit 200`
      ),
      pool.query(
        `select c.title, c.outcome, p.name as project from learning_cycles c join projects p on p.id=c.project_id
          where c.status <> 'running' order by c.created_at desc limit 300`
      ),
      pool.query(`select title, status from global_rules`),
      pool.query(`select handle, name, description from agents where custom`),
      pool.query(`select handle, name, status from agent_suggestions`)
    ])
    const notes = projects.rows
      .map((p) => ({ name: p.name, text: projectNotes(p.path) }))
      .filter((p) => p.text)
      .slice(0, 15)
    const lang = await reportLanguageRule()
    const prompt =
      'You look across ALL the projects of one user (a developer who builds sites and apps for clients) to find what they keep doing ' +
      'and what they keep asking for, so the agent stops relearning it in every project. Three outputs:\n\n' +
      'WORK: the kinds of work that came back more than once in the runs below (e.g. "Landing pages", "Login and accounts", "SEO fixes"), ' +
      'with how many runs and in which projects. At most 8, most frequent first. Only kinds seen at least twice.\n\n' +
      'RULES: a rule for every project, only when the same lesson, preference or requirement shows up in AT LEAST TWO different projects ' +
      '(in their lessons or their CLAUDE.md notes): the design system they use, contrast, privacy and cookie consent, how they want answers... ' +
      'Write it as the user would, one sentence, no file names or code. At most 3. Never one already in the existing rules (even in other words).\n\n' +
      'AGENTS: an expert agent for a kind of work done at least twice (e.g. two landing pages: "@landing", a landing page expert), ' +
      'when the user has requirements of their own for it that can be read in the lessons, notes or requests (design system, contrast, GDPR, structure...). ' +
      'It gets a short handle (lowercase, no spaces), a name, one sentence of description, instructions written to the agent ("You build landing pages for ..."), ' +
      'and the user\'s rules for that work as a list of short sentences. At most 2. Never one that an existing agent or an earlier proposal already covers.\n\n' +
      'Empty lists are fine when nothing repeats. Never invent requirements that are not in the material below.\n' +
      `Write the user-facing texts (labels, rules, names, descriptions) for this user. ${lang}\n` +
      'Reply with JSON only, no code fences:\n' +
      '{"work": [{"label": "...", "count": 2, "projects": ["project name"]}], ' +
      '"rules": [{"kind": "always|never|know", "title": "...", "situation": "when it applies, a few words", "body": "where it came up", "projects": ["project name"]}], ' +
      '"agents": [{"handle": "landing", "name": "...", "description": "...", "instructions": "...", "rules": ["..."], "evidence": ["run title"], "projects": ["project name"]}]}\n\n' +
      `Existing rules for every project:\n${rules.rows.map((r) => `- ${r.title} [${r.status}]`).join('\n') || '(none)'}\n\n` +
      `Existing agents:\n${agents.rows.map((a) => `- @${a.handle}: ${a.name} — ${a.description}`).join('\n') || '(none)'}\n\n` +
      `Earlier agent proposals:\n${suggestions.rows.map((a) => `- @${a.handle}: ${a.name} [${a.status}]`).join('\n') || '(none)'}\n\n` +
      `Lessons, by project:\n${lessons.rows.map((l) => `- [${l.project}] ${l.kind}: ${l.title}${l.situation ? ` (when ${l.situation})` : ''}`).join('\n') || '(none)'}\n\n` +
      `Project notes (CLAUDE.md):\n${notes.map((n) => `## ${n.name}\n${n.text}`).join('\n\n') || '(none)'}\n\n` +
      `Runs (newest first):\n${cycles.rows.map((c) => `- [${c.project}] ${c.title} (${c.outcome ?? '?'})`).join('\n') || '(none)'}`
    const out = await new Promise<string>((ok, fail) => {
      const child = execFile(
        bin('claude'),
        ['-p', '--model', 'sonnet', '--output-format', 'text', '--tools', '', '--strict-mcp-config', '--setting-sources', 'project,local', '--disable-slash-commands', '--no-session-persistence'],
        { env: shellEnv(), maxBuffer: 4 * 1024 * 1024, timeout: 240_000 },
        (err, stdout, stderr) => (err ? fail(new Error(String(stderr || stdout || err.message).trim().split('\n').slice(-2).join(' ').slice(0, 220) || 'The review stopped.')) : ok(String(stdout)))
      )
      child.stdin?.end(prompt)
    })
    const v: any = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1))
    const names = (x: unknown) => (Array.isArray(x) ? x.map(String).slice(0, 12) : [])
    const work: RecurringWork[] = (Array.isArray(v.work) ? v.work : [])
      .filter((w: any) => w && typeof w.label === 'string' && Number(w.count) >= 2)
      .slice(0, 8)
      .map((w: any) => ({ label: w.label.slice(0, 60), count: Math.round(Number(w.count)), projects: names(w.projects) }))
    await db.setSetting(WORK, work)

    const known = rules.rows.map((r) => r.title as string)
    for (const r of (Array.isArray(v.rules) ? v.rules : []).slice(0, 3)) {
      if (!r || typeof r.title !== 'string' || !r.title.trim() || names(r.projects).length < 2) continue
      if (known.some((k) => similar(k, r.title))) continue
      known.push(r.title)
      const kind: LessonKind = ['always', 'never', 'know'].includes(r.kind) ? r.kind : 'always'
      await pool.query(`insert into global_rules(id, title, body, kind, situation, projects) values($1,$2,$3,$4,$5,$6)`, [
        randomUUID(), r.title.slice(0, 200), String(r.body ?? '').slice(0, 400), kind, String(r.situation ?? '').slice(0, 200), names(r.projects)
      ])
    }
    const taken = new Set([...agents.rows.map((a) => a.handle as string), ...suggestions.rows.map((a) => a.handle as string)])
    for (const a of (Array.isArray(v.agents) ? v.agents : []).slice(0, 2)) {
      if (!a || typeof a.name !== 'string' || typeof a.instructions !== 'string') continue
      const handle = slugify(String(a.handle || a.name)).replace(/-/g, '_').slice(0, 40)
      if (!handle || taken.has(handle)) continue
      taken.add(handle)
      await pool.query(
        `insert into agent_suggestions(id, handle, name, description, instructions, rules, evidence, projects) values($1,$2,$3,$4,$5,$6,$7,$8)`,
        [randomUUID(), handle, a.name.slice(0, 80), String(a.description ?? '').slice(0, 300), a.instructions.slice(0, 3000), names(a.rules), names(a.evidence), names(a.projects)]
      )
    }
  } catch (e: any) {
    lastError = String(e?.message ?? e).slice(0, 300)
  } finally {
    await db.setSetting(SWEEP_AT, Date.now())
    sweeping = false
    changed()
  }
}
