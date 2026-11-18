import type { Block, Message, PipelineRunState } from '@shared/types'
import { HUMAN_MINUTES as K, type ProjectReport, type ReportAgent, type ReportDay, type ReportItem, type ReportPeriod } from '@shared/report'
import { db, pool } from '../db'

/** When an issue was resolved: kept by the database itself, whoever changes the status (UI, agent, GitHub sync). */
export const REPORT_SCHEMA = `
alter table brain_entries add column if not exists resolved_at timestamptz;
create or replace function cm2_issue_resolved_at() returns trigger as $$
begin
  if new.status = 'resolved' and (old.status is distinct from 'resolved') then new.resolved_at := now();
  elsif new.status <> 'resolved' then new.resolved_at := null;
  end if;
  return new;
end $$ language plpgsql;
drop trigger if exists cm2_issue_resolved_at on brain_entries;
create trigger cm2_issue_resolved_at before update on brain_entries for each row execute function cm2_issue_resolved_at();
-- Issues resolved before this existed: the best guess is when they were filed.
update brain_entries set resolved_at = created_at where status = 'resolved' and resolved_at is null;
`

const ROLE_LABEL: Record<string, string> = {
  plan: 'Plan', spec: 'Investigate', build: 'Build', qa: 'QA', review: 'Review', security: 'Security', ship: 'Ship'
}
const ORCHESTRATOR = 'Orchestrator'
/** Generated or binary files are not work a person would type. */
const GENERATED = /(^|\/)(node_modules|dist|build|out|\.next|coverage)\/|(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb)$|\.(min\.(js|css)|map|snap|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf|zip|pdf)$/i
const LINES_CAP = 600

type Tool = Extract<Block, { kind: 'tool' }>
type Assistant = Extract<Message, { role: 'assistant' }>

const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10)

export async function projectReport(projectId: string, period: ReportPeriod): Promise<ProjectReport> {
  const from = period ? Date.now() - period * 86_400_000 : 0
  const wsIds = (await db.workspaces()).filter((w) => w.projectId === projectId).map((w) => w.id)
  const agentsById = new Map((await db.agents()).map((a) => [a.id, a]))

  const [msgs, runs, issues, plans] = await Promise.all([
    pool.query('select workspace_id, body from messages where workspace_id = any($1) order by workspace_id, seq', [wsIds]),
    pool.query('select state from pipeline_runs where workspace_id = any($1)', [wsIds]),
    pool.query(
      `select status, created_at, resolved_at from brain_entries where kind='issue' and workspace_id = any($1)`,
      [wsIds]
    ),
    pool.query('select status, created_at from plans where workspace_id = any($1)', [wsIds])
  ])
  const runById = new Map<string, PipelineRunState>(runs.rows.map((r) => [r.state.runId, r.state]))

  const agents = new Map<string, ReportAgent>()
  const agent = (name: string, role: string) => {
    let a = agents.get(name)
    if (!a) agents.set(name, (a = { name, role, ms: 0, tokens: 0, savedMin: 0 }))
    return a
  }
  const items = new Map<string, ReportItem>()
  const item = (key: string, label: string, count: number, min: number) => {
    const it = items.get(key) ?? { key, label, count: 0, min: 0 }
    it.count += count
    it.min += min
    items.set(key, it)
  }
  const days = new Map<string, ReportDay>()
  const day = (t: number) => {
    const k = dayKey(t)
    let d = days.get(k)
    if (!d) days.set(k, (d = { day: k, label: k, byAgent: {}, opened: 0, resolved: 0 }))
    return d
  }
  const work = (t: number, name: string, ms: number) => {
    const d = day(t)
    d.byAgent[name] = (d.byAgent[name] ?? 0) + ms / 60_000
  }

  const k = { runs: 0, runsFailed: 0, files: new Set<string>(), linesAdded: 0, linesRemoved: 0, commits: 0, questions: 0, tokens: 0, costUsd: 0 }
  let agentMs = 0
  let yourMin = 0

  // Messages come ordered per branch: the next one bounds a turn that has no end time recorded.
  const rows = msgs.rows as { workspace_id: string; body: Message }[]
  for (let i = 0; i < rows.length; i++) {
    const m = rows[i].body
    if (m.role !== 'assistant' || m.at < from) continue
    const next = rows[i + 1]?.workspace_id === rows[i].workspace_id ? rows[i + 1].body.at : null
    const tools = m.blocks.filter((b): b is Tool => b.kind === 'tool')
    const toolMs = tools.reduce((a, t) => a + (t.duration ?? 0), 0)
    const ms = (m as Assistant & { endedAt?: number }).endedAt
      ? (m as any).endedAt - m.at
      : next ? Math.min(next - m.at, Math.max(toolMs, 0) + 120_000, 30 * 60_000) : toolMs
    if (tools.length === 0 && !m.error) continue // a plain answer, not a run
    k.runs++
    if (m.error && !m.interrupted) k.runsFailed++
    k.tokens += m.tokens ? m.tokens.input + m.tokens.output + m.tokens.cacheRead : 0
    k.costUsd += m.cost ?? 0
    agentMs += ms

    // Files and lines this turn, generated files left out.
    const perFile = new Map<string, { a: number; r: number }>()
    for (const t of tools) {
      if (!t.file || GENERATED.test(t.file.path)) continue
      const f = perFile.get(t.file.path) ?? { a: 0, r: 0 }
      f.a += t.file.added
      f.r += t.file.removed
      perFile.set(t.file.path, f)
    }
    let adds = 0
    let dels = 0
    for (const [p, f] of perFile) {
      k.files.add(`${rows[i].workspace_id}:${p}`)
      adds += Math.min(f.a, LINES_CAP)
      dels += Math.min(f.r, LINES_CAP)
    }
    k.linesAdded += adds
    k.linesRemoved += dels
    k.commits += tools.filter((t) => t.name === 'Bash' && t.status === 'success' && /\bgit\s+commit\b/.test(String((t.input as any)?.command ?? ''))).length
    const asked = m.blocks.reduce((a, b) => a + (b.kind === 'ask' ? b.questions.length : 0), 0)
    k.questions += asked

    // Who worked: pipeline nodes by their agent, otherwise the orchestrator.
    const pl = m.blocks.find((b) => b.kind === 'pipeline') as { runId: string } | undefined
    const run = pl ? runById.get(pl.runId) : undefined
    const codeMin = perFile.size
      ? Math.min(adds * K.lineAdded + dels * K.lineRemoved + perFile.size * K.file, 480, Math.max((ms / 60_000) * 12, 5))
      : 0
    // Your part: answering its questions, and reviewing runs that changed code or went through a pipeline.
    yourMin += asked * K.yourAnswer + (!m.error && (perFile.size > 0 || run) ? K.yourReview : 0)
    if (run) {
      // Runs from before per-node timing: share the turn's time among the nodes it visited.
      const visited = run.nodes.filter((n) => n.visits || n.ms)
      const timed = visited.some((n) => (n.ms ?? 0) > 0)
      const totalVisits = visited.reduce((a, n) => a + Math.max(1, n.visits), 0) || 1
      const nodeTime = (n: (typeof run.nodes)[number]) => (timed ? n.ms ?? 0 : (ms * Math.max(1, n.visits)) / totalVisits)
      let nodeMs = 0
      for (const n of run.nodes) {
        if (!n.visits && !n.ms) continue
        const name = (n.agentId && agentsById.get(n.agentId)?.name) || ROLE_LABEL[n.role] || n.label
        const a = agent(name, n.role)
        const t = nodeTime(n)
        a.ms += t
        a.tokens += n.tokens ?? 0
        nodeMs += t
        work(m.at, name, t)
        const visits = Math.max(1, n.visits)
        const flat =
          n.role === 'qa' ? ['qa', 'QA passes', K.qaPass]
            : n.role === 'spec' || n.role === 'plan' ? ['spec', 'Specs and plans', K.spec]
              : n.role === 'review' || n.role === 'security' ? ['review', 'Reviews', K.review]
                : n.role === 'ship' ? ['ship', 'Ship steps', K.ship]
                  : null
        if (flat) {
          item(flat[0] as string, flat[1] as string, visits, (flat[2] as number) * visits)
          a.savedMin += (flat[2] as number) * visits
        }
        if (n.role === 'build' && codeMin) a.savedMin += codeMin
      }
      // Time between nodes (handoffs, the orchestrator's own turns).
      if (ms - nodeMs > 1000) {
        agent(ORCHESTRATOR, 'orchestrator').ms += ms - nodeMs
        work(m.at, ORCHESTRATOR, ms - nodeMs)
      }
      if (codeMin && !run.nodes.some((n) => n.role === 'build' && (n.visits || n.ms))) agent(ORCHESTRATOR, 'orchestrator').savedMin += codeMin
    } else {
      const a = agent(ORCHESTRATOR, 'orchestrator')
      a.ms += ms
      a.tokens += m.tokens?.output ?? 0
      work(m.at, ORCHESTRATOR, ms)
      a.savedMin += codeMin || K.other
      if (!codeMin) item('other', 'Other steps', 1, K.other)
    }
    if (codeMin) item('code', 'Code written', perFile.size, codeMin)
  }

  // Issues: found (a bug an agent filed is a QA-hour saved) and resolved, per day.
  let issuesOpen = 0
  let issuesResolved = 0
  for (const r of issues.rows) {
    const created = r.created_at.getTime()
    if (r.status === 'open' || r.status === 'in_progress') issuesOpen++
    if (created >= from) {
      day(created).opened++
      item('bugs', 'Bugs found', 1, K.bug)
    }
    const res = r.resolved_at?.getTime()
    if (r.status === 'resolved' && res && res >= from) {
      day(res).resolved++
      issuesResolved++
    }
  }
  const plansIn = plans.rows.filter((p) => p.created_at.getTime() >= from)

  const list = [...items.values()].filter((x) => x.min > 0).sort((a, b) => b.min - a.min)
  const humanMin = list.reduce((a, x) => a + x.min, 0)

  // Fill the gaps so the chart has every day; long periods go by week.
  const allDays = [...days.values()].sort((a, b) => a.day.localeCompare(b.day))
  const start = period ? Date.now() - (period - 1) * 86_400_000 : allDays[0] ? Date.parse(allDays[0].day) : Date.now()
  const span = Math.max(1, Math.round((Date.now() - start) / 86_400_000) + 1)
  const bucket: 'day' | 'week' = span > 45 ? 'week' : 'day'
  const out: ReportDay[] = []
  for (let t = start; t <= Date.now() + 1; t += (bucket === 'week' ? 7 : 1) * 86_400_000) {
    const b: ReportDay = { day: dayKey(t), label: new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }), byAgent: {}, opened: 0, resolved: 0 }
    const end = t + (bucket === 'week' ? 7 : 1) * 86_400_000
    for (const d of allDays) {
      const dt = Date.parse(d.day)
      if (dt < Date.parse(dayKey(t)) || dt >= Date.parse(dayKey(end))) continue
      b.opened += d.opened
      b.resolved += d.resolved
      for (const [n, v] of Object.entries(d.byAgent)) b.byAgent[n] = (b.byAgent[n] ?? 0) + v
    }
    out.push(b)
  }

  return {
    projectId,
    period,
    agentMs,
    humanMin,
    yourMin,
    savedMin: Math.max(0, humanMin - yourMin),
    items: list,
    agents: [...agents.values()].filter((a) => a.ms >= 30_000 || a.savedMin >= 1).sort((a, b) => b.ms - a.ms),
    days: out,
    bucket,
    kpis: {
      runs: k.runs,
      runsFailed: k.runsFailed,
      issuesResolved,
      issuesOpen,
      files: k.files.size,
      linesAdded: k.linesAdded,
      linesRemoved: k.linesRemoved,
      commits: k.commits,
      plansDone: plansIn.filter((p) => p.status === 'done').length,
      plans: plansIn.length,
      questions: k.questions,
      tokens: k.tokens,
      costUsd: k.costUsd
    }
  }
}
