import { randomUUID } from 'node:crypto'
import type { BoardTask, EngineEvent, Plan, PlanStep, PlanTask, PlanTaskStatus } from '@shared/types'
import { pool } from '../db'

const ms = (d: Date | null) => (d ? d.getTime() : null)

const taskRow = (x: any): PlanTask => ({
  id: x.id, planId: x.plan_id, position: x.position, title: x.title, detail: x.detail, files: x.files ?? [],
  status: x.status, startedAt: ms(x.started_at), finishedAt: ms(x.finished_at), note: x.note,
  steps: x.steps ?? [], commits: x.commits ?? []
})

async function tasksOf(planIds: string[]): Promise<Map<string, PlanTask[]>> {
  const out = new Map<string, PlanTask[]>()
  if (!planIds.length) return out
  const r = await pool.query('select * from plan_tasks where plan_id = any($1) order by position', [planIds])
  for (const x of r.rows) {
    const l = out.get(x.plan_id) ?? []
    l.push(taskRow(x))
    out.set(x.plan_id, l)
  }
  return out
}

const planRow = (x: any, tasks: PlanTask[]): Plan => ({
  id: x.id, workspaceId: x.workspace_id, title: x.title, summary: x.summary, status: x.status,
  messageId: x.message_id, createdAt: x.created_at.getTime(), tasks
})

export async function listPlans(workspaceId: string): Promise<Plan[]> {
  const r = await pool.query('select * from plans where workspace_id=$1 order by created_at desc limit 30', [workspaceId])
  const t = await tasksOf(r.rows.map((x) => x.id))
  return r.rows.map((x) => planRow(x, t.get(x.id) ?? []))
}

export async function getPlan(id: string): Promise<Plan | null> {
  const r = await pool.query('select * from plans where id=$1', [id])
  if (!r.rows[0]) return null
  return planRow(r.rows[0], (await tasksOf([id])).get(id) ?? [])
}

export async function boardTasks(): Promise<BoardTask[]> {
  const r = await pool.query(
    `select t.*, pl.title as plan_title, w.id as ws_id, w.branch, p.id as project_id, p.name as project_name
     from plan_tasks t join plans pl on pl.id=t.plan_id join workspaces w on w.id=pl.workspace_id join projects p on p.id=w.project_id
     where pl.status <> 'cancelled' order by pl.created_at desc, t.position limit 1000`
  )
  return r.rows.map((x) => ({
    ...taskRow(x), planTitle: x.plan_title, workspaceId: x.ws_id, branch: x.branch, projectId: x.project_id, projectName: x.project_name
  }))
}

let emitter: ((e: EngineEvent) => void) | null = null
export const setPlanEmitter = (e: (e: EngineEvent) => void) => (emitter = e)

/** Re-read a plan and tell the UI. */
export async function publishPlan(id: string): Promise<void> {
  const p = await getPlan(id)
  if (p) emitter?.({ type: 'plan', plan: p })
}

export async function setMessage(planId: string, messageId: string) {
  await pool.query('update plans set message_id=$2 where id=$1 and message_id is null', [planId, messageId])
}

/** The task the agent is on in this branch, if any. */
export async function activeTask(workspaceId: string): Promise<{ id: string; planId: string } | null> {
  const r = await pool.query(
    `select t.id, t.plan_id from plan_tasks t join plans p on p.id=t.plan_id
     where p.workspace_id=$1 and p.status='running' and t.status='in_progress' order by t.started_at desc limit 1`,
    [workspaceId]
  )
  return r.rows[0] ? { id: r.rows[0].id, planId: r.rows[0].plan_id } : null
}

// Steps are read-modify-write on one jsonb: one change at a time per task.
const chains = new Map<string, Promise<unknown>>()
function locked<T>(taskId: string, fn: () => Promise<T>): Promise<T> {
  const next = (chains.get(taskId) ?? Promise.resolve()).then(fn, fn)
  chains.set(taskId, next.catch(() => {}))
  return next
}

/** Record a step on a task (same title right after → one row with a count). Returns the step id. */
export const addStep = (taskId: string, s: Omit<PlanStep, 'id' | 'status' | 'startedAt'>) => locked(taskId, () => addStep_(taskId, s))
async function addStep_(taskId: string, s: Omit<PlanStep, 'id' | 'status' | 'startedAt'>): Promise<string> {
  const r = await pool.query('select steps from plan_tasks where id=$1', [taskId])
  const steps: PlanStep[] = r.rows[0]?.steps ?? []
  const last = steps[steps.length - 1]
  let id: string
  if (last && last.title === s.title && last.kind === s.kind && last.status !== 'running') {
    last.count = (last.count ?? 1) + 1
    last.status = 'running'
    id = last.id
  } else {
    id = randomUUID()
    steps.push({ id, ...s, status: 'running', startedAt: Date.now() })
  }
  await pool.query('update plan_tasks set steps=$2 where id=$1', [taskId, JSON.stringify(steps.slice(-60))])
  return id
}

export const finishStep = (taskId: string, stepId: string, took: number, error: boolean) => locked(taskId, () => finishStep_(taskId, stepId, took, error))
async function finishStep_(taskId: string, stepId: string, took: number, error: boolean) {
  const r = await pool.query('select steps from plan_tasks where id=$1', [taskId])
  const steps: PlanStep[] = r.rows[0]?.steps ?? []
  const s = steps.find((x) => x.id === stepId)
  if (!s) return
  s.status = error ? 'error' : 'done'
  s.ms = (s.ms ?? 0) + took
  await pool.query('update plan_tasks set steps=$2 where id=$1', [taskId, JSON.stringify(steps)])
}

export async function addCommit(taskId: string, c: { sha: string; subject: string }) {
  await pool.query(
    `update plan_tasks set commits = commits || $2::jsonb where id=$1 and not commits @> $3::jsonb`,
    [taskId, JSON.stringify([c]), JSON.stringify([{ sha: c.sha }])]
  )
}

/** Apply the user's edits to a proposed plan (order, titles, removals) and mark it running. */
export async function approve(planId: string, tasks?: { id: string; title: string }[]): Promise<Plan> {
  const p = await getPlan(planId)
  if (!p) throw new Error('Plan not found')
  if (tasks) {
    const keep = new Set(tasks.map((t) => t.id))
    await pool.query('delete from plan_tasks where plan_id=$1 and not (id = any($2))', [planId, [...keep]])
    for (const [i, t] of tasks.entries()) {
      const title = t.title.trim() || 'Untitled task'
      // Steps the user added in the card have ids the database hasn't seen yet.
      await pool.query(
        `insert into plan_tasks(id, plan_id, position, title) values($1,$2,$3,$4)
         on conflict (id) do update set position=excluded.position, title=excluded.title where plan_tasks.plan_id=$2`,
        [t.id, planId, i, title]
      )
    }
  }
  await pool.query("update plans set status='running' where id=$1", [planId])
  await publishPlan(planId)
  return (await getPlan(planId))!
}

export async function cancel(planId: string) {
  await pool.query("update plans set status='cancelled' where id=$1", [planId])
  await pool.query("update plan_tasks set status='skipped' where plan_id=$1 and status in ('todo','in_progress')", [planId])
  await publishPlan(planId)
}

export async function updateTask(id: string, patch: { status?: PlanTaskStatus; title?: string }) {
  const r = await pool.query(
    `update plan_tasks set status=coalesce($2,status), title=coalesce($3,title),
     started_at = case when $2='in_progress' and started_at is null then now() else started_at end,
     finished_at = case when $2 in ('done','skipped','failed') then coalesce(finished_at, now()) when $2 in ('todo','in_progress') then null else finished_at end
     where id=$1 returning plan_id`,
    [id, patch.status ?? null, patch.title ?? null]
  )
  const planId = r.rows[0]?.plan_id
  if (!planId) return
  await settle(planId)
  await publishPlan(planId)
}

/** A running plan whose tasks are all finished is done. */
export async function settle(planId: string) {
  await pool.query(
    `update plans set status='done' where id=$1 and status='running'
     and not exists (select 1 from plan_tasks where plan_id=$1 and status in ('todo','in_progress'))`,
    [planId]
  )
}
