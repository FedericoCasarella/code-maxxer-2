import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Bot, ChevronDown, ClipboardList, Eye, FileCode2, FilePlus2, FlaskConical, GitCommitHorizontal, Globe, Hammer, OctagonAlert, Search, ShieldCheck,
  SquareTerminal, Workflow
} from 'lucide-react'
import type { ModelInfo, NodeRole, NodeTask, PipelineRunState } from '@shared/types'
import { Marquee } from './Marquee'
import { cn } from '@/lib/utils'
import { Badge } from '../affect/badge'
import { AgentCrew, type CrewAgent } from '../affect/agent-crew'
import { modelLabel as labelOf, providerOf } from './ModelSelect'
import { ProviderLogo } from './Logos'
import { useStore } from '@/lib/store'
import { t } from '@/lib/i18n'

const ROLE_ICON: Record<NodeRole, typeof Hammer> = {
  plan: ClipboardList, spec: Search, build: Hammer, qa: FlaskConical, review: Eye, security: ShieldCheck, ship: GitCommitHorizontal
}

const TASK_ICON: Record<NodeTask['kind'], typeof Hammer> = {
  edit: FileCode2, create: FilePlus2, run: SquareTerminal, commit: GitCommitHorizontal, browse: Globe, issue: OctagonAlert, agent: Bot, web: Search
}

const CSS = `
@keyframes cm-ph-streak { from { stroke-dashoffset: 22 } to { stroke-dashoffset: -100 } }
.cm-ph-streak { stroke-dasharray: 22 100; animation: cm-ph-streak .9s cubic-bezier(.45,0,.2,1) both; filter: drop-shadow(0 0 4px rgba(217,119,87,.9)); }
@keyframes cm-ph-row { from { opacity: 0; transform: translateY(4px) } to { opacity: 1; transform: none } }
.cm-ph-row { animation: cm-ph-row .32s var(--aui-ease) both; }
@media (prefers-reduced-motion: reduce) { .cm-ph-streak { display: none } .cm-ph-row { animation: none } }
`

export const fmtMs = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

type Node = PipelineRunState['nodes'][number]

/*
 * Pipeline run in the chat as an Agent Crew: the lead (the run), one card per node, and under each node the
 * subagents it started in parallel. Handoffs run as a light along the connectors; a click opens a card's details.
 */
export function PipelineHandoff({ run }: { run: PipelineRunState }) {
  // Open while it runs; folds itself away when the run ends (reopen any time).
  const [open, setOpen] = useState(run.status === 'running')
  const prevStatus = useRef(run.status)
  useEffect(() => {
    if (prevStatus.current === 'running' && run.status !== 'running') setOpen(false)
    if (prevStatus.current !== 'running' && run.status === 'running') setOpen(true)
    prevStatus.current = run.status
  }, [run.status])
  // Running timers tick.
  const [, tick] = useState(0)
  useEffect(() => {
    if (run.status !== 'running' || !open) return
    const timer = setInterval(() => tick((x) => x + 1), 1000)
    return () => clearInterval(timer)
  }, [run.status, open])

  const tone = run.status === 'completed' ? 'success' : run.status === 'running' ? 'info' : run.status === 'failed' ? 'danger' : 'neutral'
  const models = useStore((s) => s.models)
  const pipe = useStore((s) => s.pipelines.find((p) => p.id === run.pipelineId))
  // Each node shows the model that plays it (its own, else the run's).
  const nodeModel = (id: string) => pipe?.nodes.find((n) => n.id === id)?.model || run.model || ''
  const msOf = (nd: Node) => (nd.ms ?? 0) + (nd.since && run.status === 'running' ? Date.now() - nd.since : 0)

  return (
    <div className="cm-in overflow-hidden rounded-xl border border-line bg-raised">
      <style>{CSS}</style>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn('flex w-full items-center gap-2 px-3.5 py-2.5 text-left hover:bg-white/[.02]', open && 'border-b border-line')}
      >
        <Workflow size={14} className="text-accent" />
        <span className="text-[13px] font-medium">Pipeline · {run.name}</span>
        <Badge tone={tone} dot live={run.status === 'running'}>
          {t(run.status)}
        </Badge>
        <div className="flex-1" />
        {!open && (
          <span className="flex items-center gap-1" aria-hidden="true">
            {run.nodes.map((nd) => (
              <span
                key={nd.id}
                title={`${nd.label}: ${t(nd.status)}`}
                className={cn(
                  'h-1.5 w-4 rounded-full',
                  nd.status === 'passed' ? 'bg-ok/70' : nd.status === 'failed' ? 'bg-bad/70' : nd.status === 'running' ? 'bg-[#8ab4ff]' : 'bg-white/15'
                )}
              />
            ))}
            <span className="ml-1.5 text-[11.5px] text-mute">{fmtMs(run.nodes.reduce((a, nd) => a + msOf(nd), 0))}</span>
          </span>
        )}
        <span className={cn('ml-2 text-[11.5px] tabular-nums', run.loops ? 'text-warn' : 'text-mute')}>
          Loop {run.loops}/{run.maxLoops}
        </span>
        <ChevronDown size={14} className={cn('text-mute transition-transform', !open && '-rotate-90')} />
      </button>

      {open && (
        <>
          <div className="px-3.5 py-3.5">
            <AgentCrew root={crewOf(run, models, nodeModel, msOf)} handoffs={(run.handoffs ?? []).map((h) => ({ id: h.id, from: h.from, to: h.to, label: h.title, back: h.back }))} />
          </div>

          {run.issues.length > 0 && (
            <div className="border-t border-line px-3.5 py-2.5">
              <div className="mb-1.5 text-[11px] font-medium text-mute">
                {t('Brain · {n} open issues', { n: run.issues.filter((i) => !i.resolved).length })}
              </div>
              <div className="flex max-h-[96px] flex-col gap-1 overflow-y-auto">
                {run.issues.map((iss) => (
                  <div key={iss.id} className="ph-issue-row flex items-center gap-2 text-[12px]">
                    <span className={cn('size-1.5 shrink-0 rounded-full', iss.resolved ? 'bg-ok' : 'bg-bad')} />
                    <Marquee className={cn('min-w-0 flex-1', iss.resolved && 'text-mute')} delay={300} hoverTarget=".ph-issue-row">
                      <span className={cn(iss.resolved && 'line-through')}>{iss.title}</span>
                    </Marquee>
                    <span className="font-mono text-[10.5px] text-mute">{iss.nodeId}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

const CONTEXT_LIMIT = 200_000
const tiny = (s: string) => s.replace(/^Claude /, '') || 'Claude'

/** The run as a crew: the lead (the run itself), one card per pipeline node, and under each node the subagents it started. */
function crewOf(run: PipelineRunState, models: ModelInfo[], nodeModel: (id: string) => string, msOf: (nd: Node) => number): CrewAgent {
  const now = Date.now()
  const live = run.status === 'running'
  const openIssues = run.issues.filter((x) => !x.resolved).length
  const handoffs = run.handoffs ?? []
  const label = (id: string) => (id === 'lead' ? t('Lead') : run.nodes.find((n) => n.id === id)?.label ?? id)
  const nodes: CrewAgent[] = run.nodes.map((node, i) => {
    const running = node.status === 'running'
    const queued = !running && node.status === 'pending' && run.current === node.id && live
    const tasks = node.tasks ?? []
    const nowTask = [...tasks].reverse().find((x) => x.status === 'running' && x.kind !== 'agent')
    const ms = msOf(node)
    const handed = [...handoffs].reverse().find((h) => h.to === node.id)
    const Icon = ROLE_ICON[node.role]
    return {
      id: node.id,
      name: node.label,
      model: tiny(labelOf(nodeModel(node.id), models)),
      modelLogo: nodeModel(node.id) ? <ProviderLogo provider={providerOf(nodeModel(node.id))} size={13} /> : undefined,
      status: running ? 'active' : queued ? 'waiting' : node.status === 'passed' ? 'done' : node.status === 'failed' ? 'failed' : 'idle',
      statusLabel: running ? 'Running' : queued ? 'Up next' : node.status === 'failed' ? 'Sent back' : node.status === 'pending' ? 'Queued' : undefined,
      activity: running
        ? nowTask?.title ?? (node.visits > 1 ? t('Pass {n} · {task}', { n: node.visits, task: run.task ?? node.instructions }) : run.task ?? node.instructions)
        : queued
          ? openIssues ? (openIssues === 1 ? t('Fix 1 open issue') : t('Fix {n} open issues', { n: openIssues })) : t('Picking it up')
          : node.note || (i === 0 && node.status === 'pending' && run.task ? run.task : node.instructions),
      last: handed ? { from: label(handed.from), text: handed.title } : undefined,
      context: (node.context ?? (running ? run.context : undefined) ?? 0) / CONTEXT_LIMIT,
      contextLimit: CONTEXT_LIMIT,
      task: node.instructions,
      started: ms > 0 ? now - ms : undefined,
      ended: ms > 0 ? now : undefined,
      tokens: node.tokens,
      logo: undefined,
      detail: <TaskList tasks={tasks.filter((x) => x.kind !== 'agent')} pending={node.status === 'pending'} icon={<Icon size={12} />} />,
      children: tasks
        .filter((x) => x.kind === 'agent' && x.agent)
        .map((x) => {
          const a = x.agent!
          const done = x.status !== 'running'
          return {
            id: x.id,
            name: x.title,
            model: a.model ? tiny(labelOf(a.model, models)) : t('Subagent'),
            modelLogo: a.model ? <ProviderLogo provider={providerOf(a.model)} size={13} /> : undefined,
            status: x.status === 'running' ? (live ? 'active' : 'paused') : x.status === 'error' ? 'failed' : 'done',
            statusLabel: x.status === 'running' ? (live ? 'Running' : 'Stopped') : undefined,
            activity: !done ? a.last || t('Starting') : a.report || t('{n} steps', { n: a.steps }),
            context: (a.context ?? 0) / CONTEXT_LIMIT,
            contextLimit: CONTEXT_LIMIT,
            last: { from: node.label, text: x.title },
            task: a.prompt,
            started: x.startedAt,
            ended: done ? x.startedAt + (x.ms ?? 0) : undefined,
            detail: a.report ? (
              <div className="ui-crew__drow">
                <span className="ui-crew__k">{t('Report')}</span>
                <p className="ui-crew__task">{a.report}</p>
              </div>
            ) : undefined
          } satisfies CrewAgent
        })
    }
  })
  const ms = run.nodes.reduce((a, nd) => a + msOf(nd), 0)
  return {
    id: 'lead',
    name: t('{name} lead', { name: run.name }),
    model: tiny(labelOf(run.model ?? '', models)),
    modelLogo: run.model ? <ProviderLogo provider={providerOf(run.model)} size={13} /> : undefined,
    status: live ? 'active' : run.status === 'completed' ? 'done' : run.status === 'failed' ? 'failed' : 'paused',
    statusLabel: live ? 'Running' : run.status === 'stopped' ? 'Stopped' : undefined,
    // What the lead is on: the node at work, open issues, or how far it got. The whole request is in the details.
    activity: live
      ? [run.current ? t('{node} at work', { node: label(run.current) }) : t('Pipeline run'), openIssues ? (openIssues === 1 ? t('1 open issue') : t('{n} open issues', { n: openIssues })) : ''].filter(Boolean).join(' · ')
      : t('{done}/{total} done', { done: run.nodes.filter((n) => n.status === 'passed').length, total: run.nodes.length }),
    context: (run.context ?? 0) / CONTEXT_LIMIT,
    contextLimit: CONTEXT_LIMIT,
    task: run.task,
    started: ms > 0 ? now - ms : undefined,
    ended: ms > 0 ? now : undefined,
    tokens: run.nodes.reduce((a, nd) => a + (nd.tokens ?? 0), 0) || undefined,
    children: nodes
  }
}


function TaskList({ tasks, pending, icon }: { tasks: NodeTask[]; pending: boolean; icon: ReactNode }) {
  return (
    <div className="ui-crew__drow">
      <span className="ui-crew__k">{t('Tasks')}</span>
      <div className="max-h-[220px] overflow-y-auto [scrollbar-width:thin]">
        {tasks.length === 0 ? (
          <div className="flex items-center gap-2 py-1 text-[12px] text-mute">{icon} {pending ? t('Not started yet') : t('Nothing but reading so far')}</div>
        ) : (
          tasks.map((tk, k) => {
            const T = TASK_ICON[tk.kind]
            const now = tk.status === 'running'
            return (
              <div key={tk.id} className="cm-ph-row flex items-center gap-2.5 py-1" style={{ animationDelay: `${Math.min(k, 12) * 25}ms` }}>
                <span className={cn('grid size-5 shrink-0 place-items-center rounded-md border border-line', tk.status === 'error' ? 'text-bad' : 'text-dim')}>
                  <T size={11} />
                </span>
                <Marquee className={cn('min-w-0 flex-1 text-[12.5px]', now ? 'font-semibold text-ink' : 'text-dim')} delay={300}>
                  {tk.title}
                  {tk.count && tk.count > 1 ? <span className="text-mute"> ×{tk.count}</span> : null}
                </Marquee>
                <span className={cn('shrink-0 text-[12px] tabular-nums', now ? 'font-semibold text-ink' : tk.status === 'error' ? 'text-bad' : 'text-mute')}>
                  {now ? t('Running') : tk.status === 'error' ? t('Failed') : fmtMs(tk.ms ?? 0)}
                </span>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
