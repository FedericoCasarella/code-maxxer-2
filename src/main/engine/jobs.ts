import type { ActiveJob } from '@shared/types'
import { db, pool } from '../db'
import { runningAgents } from './orchestrator'

/**
 * Everything working right now, newest first: agents and pipeline runs in the chats, deploys, security scans,
 * Recon checks and automation runs. Read on demand (the panel polls while open).
 */
export async function activeJobs(): Promise<ActiveJob[]> {
  const jobs: ActiveJob[] = []
  const projects = new Map((await pool.query('select id, name from projects')).rows.map((r) => [r.id as string, r.name as string]))
  for (const a of runningAgents()) {
    const ws = await db.workspace(a.workspaceId)
    if (!ws) continue
    const run = (await db.runs(ws.id)).filter((r) => r.status === 'running' || r.status === 'waiting').pop()
    const node = run?.nodes.find((n) => n.id === (run.wait?.node ?? run.current))
    jobs.push({
      id: `ws:${ws.id}`,
      kind: run ? 'pipeline' : 'agent',
      title: run ? `${run.name}${node ? ` · ${node.label}` : ''}` : 'Agent',
      projectId: ws.projectId,
      project: projects.get(ws.projectId) ?? '',
      branch: ws.branch,
      workspaceId: ws.id,
      model: node?.model || a.model,
      since: Date.now()
    })
  }
  const q = async (sql: string) => (await pool.query(sql).catch(() => ({ rows: [] as any[] }))).rows
  for (const d of await q(`select d.id, d.number, d.started_at, e.name env, e.project_id from cicd_deploys d join recon_environments e on e.id=d.env_id where d.status in ('running','queued')`))
    jobs.push({ id: `deploy:${d.id}`, kind: 'deploy', title: `Deploy #${d.number} · ${d.env}`, projectId: d.project_id, project: projects.get(d.project_id) ?? '', since: +new Date(d.started_at) })
  for (const s of await q(`select id, project_id, target, started_at from security_scans where status='running'`))
    jobs.push({ id: `sec:${s.id}`, kind: 'security', title: `Security · ${s.target}`, projectId: s.project_id, project: projects.get(s.project_id) ?? '', since: +new Date(s.started_at) })
  for (const s of await q(`select s.id, s.kind, s.started_at, e.name env, e.project_id from recon_sessions s join recon_environments e on e.id=s.env_id where s.status='running'`))
    jobs.push({ id: `recon:${s.id}`, kind: 'recon', title: `${s.kind} · ${s.env}`, projectId: s.project_id, project: projects.get(s.project_id) ?? '', since: +new Date(s.started_at) })
  for (const r of await q(`select r.id, r.workspace_id, r.branch, r.started_at, a.name, a.project_id from automation_runs r join automations a on a.id=r.automation_id where r.status='running'`))
    if (!jobs.some((j) => j.workspaceId && j.workspaceId === r.workspace_id))
      jobs.push({ id: `auto:${r.id}`, kind: 'automation', title: r.name, projectId: r.project_id, project: projects.get(r.project_id) ?? '', branch: r.branch ?? undefined, workspaceId: r.workspace_id ?? undefined, since: +new Date(r.started_at) })
  return jobs
}
