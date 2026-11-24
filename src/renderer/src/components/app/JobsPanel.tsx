import { useEffect, useRef, useState } from 'react'
import { Activity, Rocket } from 'lucide-react'
import type { ActiveJob } from '@shared/types'
import { actions, getState, useStore } from '@/lib/store'
import { EmptyState } from '../affect/empty-state'
import { AgentMonitor, type AgentMonitorProps, type AgentRunStep, type AgentStepKind } from '../affect/agent-monitor'
import { DotGlyph } from './pages/RoleGlyph'
import { loadPrefs } from './Composer'
import { toolLabel } from './Timeline'
import { ProviderLogo } from './Logos'
import { modelLabel, providerOf } from './ModelSelect'
import { t } from '@/lib/i18n'

/** Agents and pipelines from the branches' state, deploys from Recon: for when the app's own list isn't there. */
async function fallbackJobs(): Promise<ActiveJob[]> {
  const st = getState()
  const name = (id: string) => st.projects.find((p) => p.id === id)?.name ?? ''
  // At work: marked running, or its latest answer is still streaming (the status can lag behind a model handover)
  const busy = (id: string) => {
    const last = [...(st.messages[id] ?? [])].reverse().find((m) => m.role === 'assistant')
    return !!last && last.role === 'assistant' && !last.done
  }
  const jobs: ActiveJob[] = st.workspaces
    .filter((w) => w.status === 'running' || busy(w.id))
    .map((w) => {
      const blocks = (st.messages[w.id] ?? []).flatMap((m) => (m.role === 'assistant' ? m.blocks : []))
      const runId = [...blocks].reverse().find((b) => b.kind === 'pipeline')?.runId
      const run = runId ? st.runs[runId] : undefined
      const live = run && (run.status === 'running' || run.status === 'waiting') ? run : undefined
      const node = live?.nodes.find((n) => n.id === (live.wait?.node ?? live.current))
      return {
        id: `ws:${w.id}`, kind: live ? 'pipeline' : 'agent', title: live ? `${live.name}${node ? ` · ${node.label}` : ''}` : 'Agent',
        projectId: w.projectId, project: name(w.projectId), branch: w.branch, workspaceId: w.id, model: node?.model || live?.model, since: Date.now()
      } satisfies ActiveJob
    })
  for (const p of st.projects) {
    const envs = await window.cm.recon.envs(p.id).catch(() => [])
    for (const { env: e } of envs) {
      for (const d of (await window.cm.recon.deploys(e.id).catch(() => [])).filter((x) => x.status === 'running' || x.status === 'queued'))
        jobs.push({ id: `deploy:${d.id}`, kind: 'deploy', title: `Deploy #${d.number} · ${e.name}`, projectId: p.id, project: p.name, since: Date.parse(d.started_at) })
    }
  }
  return jobs
}

type Monitor = { job: ActiveJob; props: AgentMonitorProps }

/** What a pipeline node's agent is doing, in plain words */
const ROLE_DOING: Record<string, string> = {
  plan: 'Plans the work', spec: 'Studies the code', build: 'Works on the code', qa: 'Checks that it works', review: 'Reviews the code',
  security: 'Checks security', ship: 'Commits the work', script: 'Runs the script', gate: 'Waits for your approval'
}

/** A tool call as a phase a person understands: consecutive calls of the same kind are one phase */
function phaseOf(name: string, input: any): { key: string; label: string; kind: AgentStepKind } {
  const cmd = String(input?.command ?? '')
  if (name === 'Bash' && /\bgit\b[^|;&]*\bcommit\b/.test(cmd)) return { key: 'commit', label: 'Commits the work', kind: 'run' }
  if (name === 'Bash' && /\b(test|vitest|jest|pytest|lint|typecheck|tsc|build|eslint|cargo (test|check))\b/.test(cmd)) return { key: 'check', label: 'Tests and checks the code', kind: 'run' }
  if (name.startsWith('mcp__cm2__browser')) return { key: 'browser', label: 'Checks the result in the browser', kind: 'web' }
  if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(name)) return { key: 'edit', label: 'Works on the code', kind: 'edit' }
  if (['Read', 'Grep', 'Glob'].includes(name)) return { key: 'read', label: 'Studies the code', kind: 'read' }
  if (name === 'Agent' || name === 'Task') return { key: 'agents', label: 'Hands parts of the work to sub-agents', kind: 'think' }
  if (name === 'WebFetch' || name === 'WebSearch') return { key: 'web', label: 'Looks things up on the web', kind: 'web' }
  if (name.startsWith('mcp__cm2__deploy') || name === 'mcp__cm2__env_exec') return { key: 'deploy', label: 'Publishes to the server', kind: 'run' }
  if (name.startsWith('mcp__cm2__brain')) return { key: 'brain', label: 'Notes what it found', kind: 'think' }
  if (name === 'Bash') return { key: 'run', label: 'Runs commands', kind: 'run' }
  return { key: 'other', label: 'Works on the request', kind: 'think' }
}

/** A tool's result as text (a string, or the content blocks' text), cut to what fits the step's card. */
function resultText(r: unknown): string {
  const text =
    typeof r === 'string'
      ? r
      : Array.isArray(r)
        ? r.map((x: any) => (typeof x === 'string' ? x : typeof x?.text === 'string' ? x.text : '')).join('\n')
        : r && typeof (r as any).text === 'string'
          ? (r as any).text
          : r
            ? JSON.stringify(r)
            : ''
  return text.trim().slice(-1500)
}

/** What each job shows in its Agent Monitor: the pipeline's nodes, the agent's latest tool calls, the deploy's steps. */
async function monitorsOf(jobs: ActiveJob[]): Promise<Monitor[]> {
  const st = getState()
  return Promise.all(
    jobs.map(async (job): Promise<Monitor> => {
      const base: AgentMonitorProps = { state: 'running', agent: { name: job.project || t('Project'), role: [job.branch, t(job.title)].filter(Boolean).join(' · ') } }
      if (job.kind === 'deploy') {
        const d = await window.cm.recon.deployById(job.id.replace(/^deploy:/, '')).catch(() => null)
        if (!d) return { job, props: base }
        return {
          job,
          props: {
            ...base,
            agent: { ...base.agent!, mark: <Rocket size={14} /> },
            since: Date.parse(d.started_at),
            error: d.error ?? undefined,
            steps: d.steps.map((x) => ({
              id: String(x.idx), label: x.name, kind: 'run' as const,
              state: x.status === 'success' || x.status === 'skipped' ? ('done' as const) : x.status === 'running' ? ('running' as const) : x.status === 'failed' ? ('failed' as const) : ('queued' as const),
              took: x.ms ?? undefined, since: x.status === 'running' ? Date.now() - (x.ms ?? 0) : undefined
            }))
          }
        }
      }
      if (!job.workspaceId) return { job, props: base }
      // The chat's latest turn (loaded already, or read now)
      let msgs = st.messages[job.workspaceId]
      if (!msgs?.length) msgs = (await window.cm.getMessagesPage(job.workspaceId, { limit: 3 }).catch(() => ({ messages: [] }))).messages
      const last = [...(msgs ?? [])].reverse().find((m) => m.role === 'assistant')
      const blocks = last && last.role === 'assistant' ? last.blocks : []
      const runId = [...blocks].reverse().find((b) => b.kind === 'pipeline')?.runId
      const run = runId ? st.runs[runId] : undefined
      // Who is at work: the node's or run's model, the last handoff's, else the composer's choice
      const handoffModel = [...blocks].reverse().find((b) => b.kind === 'handoff')
      const model = job.model || (handoffModel && handoffModel.kind === 'handoff' ? handoffModel.model : '') || loadPrefs().model
      const mark = model ? <ProviderLogo provider={providerOf(model)} size={14} /> : undefined
      const role = [job.branch, model ? modelLabel(model, st.models).replace(/^Claude /, '') : ''].filter(Boolean).join(' · ')
      const since = last?.at ?? job.since
      // What it was asked: the user's last request, as two lines (the orchestrator's rewrite or the user's own words)
      const asked = [...(msgs ?? [])].reverse().find((m) => m.role === 'user')
      const brief = asked && asked.role === 'user' ? asked.text.replace(/\s+/g, ' ').trim().slice(0, 240) : undefined
      if (run && (run.status === 'running' || run.status === 'waiting')) {
        return {
          job,
          props: {
            ...base,
            state: run.status === 'waiting' ? 'waiting' : 'running',
            agent: { name: `${job.project} · ${run.name}`, role, mark },
            since,
            brief,
            ask: run.status === 'waiting' ? { title: t('Waiting for your approval') } : undefined,
            steps: run.nodes
              .filter((n) => n.status !== 'skipped')
              .map((n) => {
                const now = [...(n.tasks ?? [])].reverse().find((x) => x.status === 'running')
                // Who plays it and what that means, e.g. "Builder · Works on the code" (a second pass fixes what came back)
                const who = st.agents.find((a) => a.id === n.agentId)?.name ?? n.label
                const doing = n.role === 'build' && n.visits > 1 ? 'Fixes what came back' : ROLE_DOING[n.role] ?? n.label
                void now
                return {
                  id: n.id,
                  label: `${who} · ${t(doing)}`,
                  icon: <DotGlyph role={n.role} size={12} />,
                  tool: n.label,
                  state: n.status === 'passed' ? ('done' as const) : n.status === 'running' ? ('running' as const) : n.status === 'failed' ? ('failed' as const) : ('queued' as const),
                  since: n.since,
                  took: n.ms,
                  output: n.note || undefined
                }
              })
          }
        }
      }
      const tools = blocks.filter((b): b is Extract<typeof b, { kind: 'tool' }> => b.kind === 'tool' && !b.name.startsWith('mcp__cm2__pipeline')).slice(-40)
      return {
        job,
        props: {
          ...base,
          agent: { name: job.project || t('Project'), role, mark },
          since,
          brief,
          // Phases, not commands: consecutive tool calls of one kind read as one step ("Studies the code", "Tests and checks the code")
          steps: tools.reduce<(AgentRunStep & { errors: number })[]>((out, b) => {
            const ph = phaseOf(b.name, b.input)
            const prev = out[out.length - 1]
            const end = b.startedAt + (b.duration ?? (b.status === 'running' ? Date.now() - b.startedAt : 0))
            // A call that errors (a grep with no match, a file not there, a failing test) is part of the work, not the
            // step failing: the agent reads the error and goes on. The step says how many failed and shows the last error.
            const err = b.status === 'error' ? resultText(b.result) : ''
            const step = prev && prev.id.startsWith(ph.key + ':') ? prev : undefined
            if (step) {
              step.state = b.status === 'running' ? 'running' : 'done'
              step.detail = toolLabel(b).text
              step.took = end - (step.since ?? b.startedAt)
            } else
              out.push({ id: `${ph.key}:${b.id}`, label: t(ph.label), kind: ph.kind, tool: t(ph.label), detail: toolLabel(b).text, state: b.status === 'running' ? 'running' : 'done', since: b.startedAt, took: end - b.startedAt, errors: 0 })
            const cur = out[out.length - 1]
            if (err) {
              cur.errors++
              cur.output = `${t('{n} calls returned an error, the agent went on. Last one:', { n: cur.errors })}\n${err}`
            }
            return out
          }, [])
        }
      }
    })
  )
}

/** Everything working right now across projects: an Agent Monitor each; Open chat goes to its branch. */
export function JobsPanel() {
  const [jobs, setJobs] = useState<Monitor[] | null>(null)
  // A job that ended stays a moment, folding away, then goes
  const [leaving, setLeaving] = useState<Monitor[]>([])
  const shown = useRef<Monitor[]>([])
  // Branch states change with every run: read again then, and every few seconds for deploys and scans.
  const tick = useStore((s) => s.workspaces.map((w) => w.status).join())
  useEffect(() => {
    let on = true
    // The app's own list (agents, pipelines, deploys, scans, automations); before the app has it, what the chat knows
    const load = () =>
      void Promise.resolve()
        .then(() => window.cm.activeJobs())
        .catch(() => fallbackJobs())
        .then((j) => monitorsOf(j))
        .then((m) => {
          if (!on) return
          const gone = shown.current.filter((x) => !m.some((y) => y.job.id === x.job.id))
          if (gone.length) {
            setLeaving((l) => [...l, ...gone.map((g) => ({ ...g, props: { ...g.props, state: 'finished' as const, until: Date.now() } }))])
            setTimeout(() => setLeaving((l) => l.filter((x) => !gone.some((g) => g.job.id === x.job.id))), 700)
          }
          shown.current = m
          setJobs(m)
        })
    load()
    const timer = setInterval(load, 4000)
    return () => {
      on = false
      clearInterval(timer)
    }
  }, [tick])

  const open = (j: ActiveJob) => {
    if (j.workspaceId) void actions.selectWorkspace(j.workspaceId)
    else if (j.kind === 'deploy') actions.openReconCicd()
    else if (j.kind === 'security') actions.setView('security')
    else if (j.kind === 'recon') actions.setView('recon')
  }

  if (jobs && !jobs.length && !leaving.length)
    return (
      <div className="grid h-full min-h-0 flex-1 place-items-center px-4">
        <EmptyState bare icon={<Activity size={18} />} title={t('Nothing running')} text={t('Agents, pipelines, deploys and scans show up here while they work.')} />
      </div>
    )
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      {[...(jobs ?? []), ...leaving].map(({ job, props }) => (
        <div key={job.id} className="cm-job-wrap" data-leaving={leaving.some((x) => x.job.id === job.id) ? '' : undefined}>
        <AgentMonitor
          {...props}
          className="cm-in cm-job"
          onOpenLog={() => open(job)}
          onCancel={
            job.workspaceId ? () => void window.cm.stop(job.workspaceId!) : job.kind === 'deploy' ? () => void window.cm.recon.cancelDeploy(job.id.replace(/^deploy:/, '')) : undefined
          }
        />
        </div>
      ))}
    </div>
  )
}
