import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { LOGIN_NEEDED, type EngineEvent, type Pipeline, type PipelineRunState, type Workspace } from '@shared/types'
import type { LoopReview, LoopRunStats, LoopTweak, LoopVerdict } from '@shared/learning'
import { db, pool } from '../db'
import { licenseStatus } from '../license'
import { bin, shellEnv } from './bins'
import { languageRule } from './language'
import { DEFAULT_AGENTS } from './pipelines'
import { providerOf } from './models'

/*
 * Loops that improve themselves (the advisor pattern, on the subscription):
 *  - every loop gets a Security node, and the test node only runs with Pro;
 *  - when a loop ends, the strategist (a strong model, used only here) judges it from the numbers
 *    of each node, leaves advice for the nodes and may change the loop: a cheaper model on a node
 *    that always passes, or skipping a node that never finds anything for this kind of work;
 *  - every change is visible and can be undone; a change after which the loop gets worse is undone on its own.
 */

export const LOOPS_SCHEMA = `
create table if not exists loop_reviews (
  id text primary key, project_id text not null references projects(id) on delete cascade,
  workspace_id text not null references workspaces(id) on delete cascade, message_id text not null,
  pipeline_id text not null, pipeline_name text not null, run_id text not null, task text not null default '',
  verdict text not null, summary text not null default '', stats jsonb not null default '{}', advice jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists loop_reviews_pipeline on loop_reviews(project_id, pipeline_id, created_at desc);
create table if not exists loop_tweaks (
  id text primary key, project_id text not null references projects(id) on delete cascade, pipeline_id text not null,
  review_id text, node_id text not null, node_label text not null, kind text not null, value text not null default '',
  reason text not null default '', status text not null default 'active', baseline jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists loop_tweaks_pipeline on loop_tweaks(project_id, pipeline_id, status);
`

const STRATEGIST = 'claude-opus-5-5'
const CLAUDE_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']
/** Runs of a pipeline the strategist needs before it may change it, and the window that tells a change worked. */
const MIN_RUNS = 3
const CHECK_RUNS = 5
const MAX_TWEAKS = 3

let emit: ((e: EngineEvent) => void) | null = null
export const setLoopsEmitter = (e: (e: EngineEvent) => void) => (emit = e)
const changed = (projectId: string) => emit?.({ type: 'learning', projectId })

/**
 * The pipeline as this run plays it: the strategist's changes and advice, a Security node when it has none,
 * and the test nodes skipped without Pro.
 */
export async function effectivePipeline(p: Pipeline, projectId: string): Promise<Pipeline> {
  const out: Pipeline = structuredClone(p)
  const [tw, adv] = await Promise.all([
    pool.query(`select node_id, kind, value, reason from loop_tweaks where project_id=$1 and pipeline_id=$2 and status='active' order by created_at`, [projectId, p.id]),
    pool.query(`select advice from loop_reviews where project_id=$1 and pipeline_id=$2 order by created_at desc limit 1`, [projectId, p.id])
  ])
  const advice: Record<string, string> = adv.rows[0]?.advice ?? {}
  for (const n of out.nodes) {
    if (advice[n.id]) n.instructions += `\n   Advice from earlier runs of this loop: ${advice[n.id]}`
    for (const t of tw.rows.filter((x) => x.node_id === n.id)) {
      if (t.kind === 'model') n.model = t.value
      if (t.kind === 'skip' && n.role !== 'security' && n.role !== 'build') n.skip = t.reason || 'Skipped by the strategist'
    }
  }
  if (!out.nodes.some((n) => n.role === 'security')) {
    const sec = DEFAULT_AGENTS.find((a) => a.role === 'security')!
    const build = out.nodes.find((n) => n.role === 'build')
    const at = out.nodes.findIndex((n) => n.role === 'ship')
    const id = out.nodes.some((n) => n.id === 'security') ? 'security-check' : 'security'
    out.nodes.splice(at < 0 ? out.nodes.length : at, 0, {
      id, role: 'security', agentId: sec.id, label: 'Security',
      instructions: 'Check the diff (git diff) for injection, secrets, unsafe input handling, auth gaps and unsafe dependencies. Record each finding as an issue and fail if any is open.',
      ...(build ? { onFail: build.id } : {})
    })
  }
  if (licenseStatus().state !== 'active') for (const n of out.nodes) if (n.role === 'qa') n.skip = 'Tests need Pro'
  return out
}

function statsOf(run: PipelineRunState): LoopRunStats {
  const nodes = run.nodes.map((n) => ({
    id: n.id, label: n.label, role: n.role, model: n.model ?? run.model ?? '', skipped: n.status === 'skipped',
    status: n.status, visits: n.visits, ms: n.ms ?? 0, tokens: n.tokens ?? 0,
    issues: run.issues.filter((i) => i.nodeId === n.id).length
  }))
  return {
    ok: run.status === 'completed', loops: run.loops, open: run.issues.filter((i) => !i.resolved).length,
    tokens: nodes.reduce((a, n) => a + n.tokens, 0), ms: nodes.reduce((a, n) => a + n.ms, 0), nodes
  }
}

type Rate = { runs: number; ok: number; loops: number; tokens: number }
const rate = (rows: { stats: LoopRunStats }[]): Rate => {
  const n = rows.length || 1
  return {
    runs: rows.length,
    ok: rows.filter((r) => r.stats.ok).length / n,
    loops: rows.reduce((a, r) => a + (r.stats.loops ?? 0), 0) / n,
    tokens: rows.reduce((a, r) => a + (r.stats.tokens ?? 0), 0) / n
  }
}

/** For the orchestrator's routing: how each loop has done in this project. */
export async function loopStatsRule(projectId: string): Promise<string> {
  const r = await pool.query(
    `select pipeline_id, pipeline_name, stats from (
       select *, row_number() over (partition by pipeline_id order by created_at desc) as k from loop_reviews where project_id=$1
     ) x where k <= 20`,
    [projectId]
  )
  if (!r.rows.length) return ''
  const by = new Map<string, { name: string; rows: { stats: LoopRunStats }[] }>()
  for (const x of r.rows) {
    const g = by.get(x.pipeline_id) ?? { name: String(x.pipeline_name), rows: [] as { stats: LoopRunStats }[] }
    g.rows.push({ stats: x.stats })
    by.set(x.pipeline_id, g)
  }
  return (
    'HOW THE LOOPS DID IN THIS PROJECT (recent runs; prefer the one that fits and does best):\n' +
    [...by].map(([id, g]) => {
      const s = rate(g.rows)
      return `- ${id}: ${s.runs} runs, ${Math.round(s.ok * 100)}% finished, ${s.loops.toFixed(1)} loops and ${Math.round(s.tokens / 1000)}k output tokens on average`
    }).join('\n')
  )
}

const running = new Set<string>()

/** A loop ended: the strategist judges it and may change the loop for the next runs. Background, never breaks the chat. */
export async function reviewLoop(ws: Workspace, run: PipelineRunState, p: Pipeline, messageId: string) {
  if (run.status !== 'completed' && run.status !== 'failed') return
  // Part of auto-learning: same switch.
  if (!(await db.getSetting<boolean>(`learn:project:${ws.projectId}`))) return
  if (running.has(run.runId)) return
  running.add(run.runId)
  try {
    const stats = statsOf(run)
    const past = (
      await pool.query(`select id, verdict, stats, created_at from loop_reviews where project_id=$1 and pipeline_id=$2 order by created_at desc limit 12`, [ws.projectId, p.id])
    ).rows as { id: string; verdict: string; stats: LoopRunStats; created_at: Date }[]
    await rollbackWorse(ws.projectId, p.id, [{ stats, created_at: new Date() }, ...past])
    const active = (await pool.query(`select * from loop_tweaks where project_id=$1 and pipeline_id=$2 and status='active'`, [ws.projectId, p.id])).rows
    const review = await strategist({ task: run.task ?? '', pipeline: p, stats, past, active, onClaude: providerOf(run.model ?? '') === 'claude' }, ws.worktreePath)
    const id = randomUUID()
    await pool.query(
      `insert into loop_reviews(id, project_id, workspace_id, message_id, pipeline_id, pipeline_name, run_id, task, verdict, summary, stats, advice)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [id, ws.projectId, ws.id, messageId, p.id, p.name, run.runId, (run.task ?? '').slice(0, 300), review.verdict, review.summary.slice(0, 600), JSON.stringify(stats), JSON.stringify(review.advice)]
    )
    // Changes need a track record, and stay few: never on Security, never twice on the same node.
    const t = review.tweak
    const node = t && p.nodes.find((n) => n.id === t.node)
    const ok =
      t && node && past.length + 1 >= MIN_RUNS && active.length < MAX_TWEAKS && node.role !== 'security' &&
      !active.some((a) => a.node_id === node.id && a.kind === t.kind) &&
      (t.kind === 'skip' ? node.role !== 'build' : CLAUDE_MODELS.includes(t.value) && providerOf(run.model ?? '') === 'claude' && t.value !== (node.model || run.model))
    if (ok && t && node) {
      const base = rate([{ stats }, ...past])
      await pool.query(
        `insert into loop_tweaks(id, project_id, pipeline_id, review_id, node_id, node_label, kind, value, reason, baseline) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [randomUUID(), ws.projectId, p.id, id, node.id, node.label, t.kind, t.kind === 'model' ? t.value : '', t.reason.slice(0, 300), JSON.stringify(base)]
      )
    }
  } catch (e: any) {
    console.warn('[strategist]', e?.message ?? e)
  } finally {
    running.delete(run.runId)
    changed(ws.projectId)
  }
}

/** A change after which the loop finishes less often or loops more: back as it was. */
async function rollbackWorse(projectId: string, pipelineId: string, runs: { stats: LoopRunStats; created_at: Date }[]) {
  const r = await pool.query(`select id, baseline, created_at from loop_tweaks where project_id=$1 and pipeline_id=$2 and status='active'`, [projectId, pipelineId])
  for (const tw of r.rows) {
    const after = runs.filter((x) => x.created_at > tw.created_at)
    if (after.length < MIN_RUNS || after.length > CHECK_RUNS) continue
    const now = rate(after)
    const b = tw.baseline as Rate
    if (now.ok < b.ok - 0.15 || now.loops > b.loops + 0.5)
      await pool.query(`update loop_tweaks set status='rolled_back' where id=$1`, [tw.id])
  }
}

type Strategy = { verdict: LoopVerdict; summary: string; advice: Record<string, string>; tweak: { node: string; kind: 'model' | 'skip'; value: string; reason: string } | null }

async function strategist(
  r: { task: string; pipeline: Pipeline; stats: LoopRunStats; past: { verdict: string; stats: LoopRunStats }[]; active: any[]; onClaude: boolean },
  cwd: string
): Promise<Strategy> {
  const lang = await languageRule()
  const prompt =
    'You are the strategist of a coding app: you never write code, you judge how one run of a loop of agents went and tune the loop so the next runs ' +
    'cost fewer tokens and give better results (fewer loops, fewer issues reaching the end). Be self-critical and concrete.\n\n' +
    'Judge this run: "good" (it finished and each loop back fixed something real), "bad" (it failed, looped without progress, or wasted tokens), ' +
    '"no_effect" (it ran but the checks found nothing and changed nothing: the loop added no value for this kind of task).\n\n' +
    'Advice: for the nodes where it helps, one short instruction the agent playing that node will get next time (what to do differently). Omit the others.\n\n' +
    'At most ONE change to the loop, only when the past runs back it up (otherwise null):\n' +
    `- "model": a node that passes on its first visit run after run, with few issues, can run on a cheaper model (${CLAUDE_MODELS.join(', ')}); ` +
    'a node that keeps failing may need a stronger one.\n' +
    '- "skip": a node that never finds anything for this kind of task. Never Security, never the build node.\n' +
    (r.onClaude ? '' : 'This loop does not run on Claude: no "model" changes.\n') +
    `${lang} (summary, advice and reason are read by the user: plain words, no ids).\n` +
    'Reply with JSON only, no code fences:\n' +
    '{"verdict": "good|bad|no_effect", "summary": "two plain sentences: how it went and why, what to change", ' +
    '"advice": {"node id": "instruction"}, "tweak": null or {"node": "node id", "kind": "model|skip", "value": "model id, empty for skip", "reason": "one plain sentence"}}\n\n' +
    `Loop "${r.pipeline.name}": ${r.pipeline.nodes.map((n) => `[${n.id}] ${n.label} (${n.role}${n.onFail ? `, back to ${n.onFail} on failure` : ''})`).join(' → ')}\n` +
    `Task: ${r.task.slice(0, 1500)}\n\n` +
    `This run: ${JSON.stringify(r.stats)}\n\n` +
    `Past runs of this loop (newest first): ${r.past.length ? JSON.stringify(r.past.map((p) => ({ verdict: p.verdict, ...p.stats }))) : '(none)'}\n\n` +
    `Changes already in place: ${r.active.length ? r.active.map((a) => `${a.kind} ${a.node_id}${a.value ? ` → ${a.value}` : ''}`).join('; ') : '(none)'}`
  const out = await new Promise<string>((ok, fail) => {
    const child = execFile(
      bin('claude'),
      ['-p', '--model', STRATEGIST, '--effort', 'high', '--output-format', 'text', '--tools', '', '--strict-mcp-config', '--setting-sources', 'project,local', '--disable-slash-commands', '--no-session-persistence'],
      { cwd, env: shellEnv(), maxBuffer: 4 * 1024 * 1024, timeout: 240_000 },
      (err, stdout, stderr) => {
        const o = String(stderr || stdout || '')
        if (err) fail(new Error(LOGIN_NEEDED.test(o) ? 'not signed in' : o.trim().split('\n').slice(-2).join(' ') || String(err.message)))
        else ok(String(stdout))
      }
    )
    child.stdin?.end(prompt)
  })
  const v: any = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1))
  const advice: Record<string, string> = {}
  if (v.advice && typeof v.advice === 'object')
    for (const [k, x] of Object.entries(v.advice)) if (typeof x === 'string' && x.trim() && r.pipeline.nodes.some((n) => n.id === k)) advice[k] = x.trim().slice(0, 300)
  const t = v.tweak
  return {
    verdict: ['good', 'bad', 'no_effect'].includes(v.verdict) ? v.verdict : 'no_effect',
    summary: String(v.summary ?? ''),
    advice,
    tweak: t && typeof t.node === 'string' && (t.kind === 'model' || t.kind === 'skip') ? { node: t.node, kind: t.kind, value: String(t.value ?? ''), reason: String(t.reason ?? '') } : null
  }
}

/** For the Learning panel: the latest reviews, each with the change it made. */
export async function loopReviews(projectId: string): Promise<LoopReview[]> {
  const [r, tw] = await Promise.all([
    pool.query(
      `select l.*, w.branch from loop_reviews l join workspaces w on w.id=l.workspace_id where l.project_id=$1 order by l.created_at desc limit 40`,
      [projectId]
    ),
    pool.query(`select * from loop_tweaks where project_id=$1 order by created_at desc`, [projectId])
  ])
  const tweak = (x: any): LoopTweak => ({
    id: x.id, pipelineId: x.pipeline_id, reviewId: x.review_id, nodeId: x.node_id, nodeLabel: x.node_label,
    kind: x.kind, value: x.value, reason: x.reason, status: x.status, at: x.created_at.getTime()
  })
  return r.rows.map((x) => ({
    id: x.id, workspaceId: x.workspace_id, branch: x.branch, messageId: x.message_id, pipelineId: x.pipeline_id, pipelineName: x.pipeline_name,
    task: x.task, verdict: x.verdict, summary: x.summary, stats: x.stats, at: x.created_at.getTime(),
    tweaks: tw.rows.filter((t) => t.review_id === x.id).map(tweak)
  }))
}

export async function undoTweak(id: string) {
  const r = await pool.query(`update loop_tweaks set status='undone' where id=$1 and status='active' returning project_id`, [id])
  if (r.rows[0]) changed(r.rows[0].project_id)
}
