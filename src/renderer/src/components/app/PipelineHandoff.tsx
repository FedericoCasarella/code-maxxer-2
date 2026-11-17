import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  Bot, Check, ChevronDown, Clock3, ClipboardList, CornerUpLeft, Eye, FileCode2, FilePlus2, FlaskConical, GitCommitHorizontal, Globe, Hammer, OctagonAlert, Search, ShieldCheck,
  SquareTerminal, Workflow
} from 'lucide-react'
import type { Handoff, NodeRole, NodeTask, PipelineRunState } from '@shared/types'
import { cn } from '@/lib/utils'
import { Badge } from '../affect/badge'
import { Spinner } from '../affect/spinner'
import { ShimmerText } from '../affect/shimmer-loader'
import { Popover } from '../affect/popover'
import { modelLabel as labelOf, providerOf } from './ModelSelect'
import { ProviderLogo } from './Logos'
import { useStore } from '@/lib/store'

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
const fmtTok = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n))

type Node = PipelineRunState['nodes'][number]
type Box = { l: number; r: number; t: number; b: number }
type Geo = { w: number; h: number; lead: Box; boxes: Box[] }

/*
 * Pipeline run as an agent tree: the run itself is the lead card on the left (task, model, progress); a line
 * leaves its right edge, runs down a spine and branches with rounded corners into each agent card, stacked in
 * relay order on the right. Reached agents get a lit branch, a streak runs along the one that just took over,
 * and loop-backs arc on the right in red. Click an agent for its tasks in an animated popover.
 */
export function PipelineHandoff({ run }: { run: PipelineRunState }) {
  const wrap = useRef<HTMLDivElement>(null)
  const trays = useRef<(HTMLDivElement | null)[]>([])
  const leadEl = useRef<HTMLDivElement | null>(null)
  const [geo, setGeo] = useState<Geo | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
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
    const t = setInterval(() => tick((x) => x + 1), 1000)
    return () => clearInterval(t)
  }, [run.status, open])

  const n = run.nodes.length
  const idx = (id: string) => run.nodes.findIndex((x) => x.id === id)
  const handoffs = run.handoffs ?? []
  const latest = handoffs[handoffs.length - 1]
  // One arc per loop-back pair, newest wins.
  const backs = new Map<string, Handoff>()
  for (const h of handoffs) if (h.back) backs.set(`${h.from}>${h.to}`, h)

  useLayoutEffect(() => {
    const el = wrap.current
    if (!el || !open) return
    const measure = () => {
      const base = el.getBoundingClientRect()
      const box = (a: HTMLElement) => {
        const r = a.getBoundingClientRect()
        return { l: r.left - base.left, r: r.right - base.left, t: r.top - base.top, b: r.bottom - base.top }
      }
      if (!leadEl.current) return
      setGeo({ w: base.width, h: base.height, lead: box(leadEl.current), boxes: trays.current.slice(0, n).map((a) => box(a!)) })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [n, open, backs.size])

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
          {run.status}
        </Badge>
        <div className="flex-1" />
        {!open && (
          <span className="flex items-center gap-1" aria-hidden="true">
            {run.nodes.map((nd) => (
              <span
                key={nd.id}
                title={`${nd.label}: ${nd.status}`}
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
          <div ref={wrap} className={cn('relative px-3.5 py-3.5', backs.size && 'pr-12')}>
            {geo && <Lines geo={geo} run={run} latest={latest} backs={[...backs.values()]} idx={idx} />}
            <div className="relative z-[1] grid grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] items-center gap-x-16">
              <LeadCard
                run={run}
                leadRef={(e) => {
                  leadEl.current = e
                }}
                model={run.model ?? ''}
                modelLabel={labelOf(run.model ?? '', models).replace(/^Claude /, '') || 'Claude'}
                ms={run.nodes.reduce((a, nd) => a + msOf(nd), 0)}
                tokens={run.nodes.reduce((a, nd) => a + (nd.tokens ?? 0), 0)}
              />
              <div className="flex min-w-0 flex-col gap-3">
                {run.nodes.map((node, i) => (
                  <AgentCard
                    key={node.id}
                    run={run}
                    node={node}
                    first={i === 0}
                    model={nodeModel(node.id)}
                    modelLabel={labelOf(nodeModel(node.id), models).replace(/^Claude /, '') || 'Claude'}
                    ms={msOf(node)}
                    open={picked === node.id}
                    onToggle={() => setPicked((p) => (p === node.id ? null : node.id))}
                    onClose={() => setPicked((p) => (p === node.id ? null : p))}
                    trayRef={(e) => {
                      trays.current[i] = e
                    }}
                  />
                ))}
              </div>
            </div>
          </div>

          {run.issues.length > 0 && (
            <div className="border-t border-line px-3.5 py-2.5">
              <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-mute">
                Brain · {run.issues.filter((i) => !i.resolved).length} open issues
              </div>
              <div className="flex max-h-[96px] flex-col gap-1 overflow-y-auto">
                {run.issues.map((iss) => (
                  <div key={iss.id} className="flex items-center gap-2 text-[12px]">
                    <span className={cn('size-1.5 shrink-0 rounded-full', iss.resolved ? 'bg-ok' : 'bg-bad')} />
                    <span className={cn('min-w-0 flex-1 truncate', iss.resolved && 'text-mute line-through')}>{iss.title}</span>
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

/** Right, down the spine, right again: a branch with rounded corners. */
function branch(x0: number, y0: number, sx: number, x1: number, y1: number): string {
  if (Math.abs(y1 - y0) < 1) return `M ${x0} ${y0} H ${x1}`
  const d = y1 > y0 ? 1 : -1
  const r = Math.min(12, Math.abs(y1 - y0) / 2, (sx - x0) / 2, (x1 - sx) / 2)
  return `M ${x0} ${y0} H ${sx - r} Q ${sx} ${y0} ${sx} ${y0 + d * r} V ${y1 - d * r} Q ${sx} ${y1} ${sx + r} ${y1} H ${x1}`
}

// Card centre line: the card sits on the top of its tray.
const CY = 38
const LIT = 'rgba(138,180,255,.7)'
const DIM = 'rgba(255,255,255,.13)'

function Lines({ geo, run, latest, backs, idx }: { geo: Geo; run: PipelineRunState; latest?: Handoff; backs: Handoff[]; idx: (id: string) => number }) {
  const x0 = geo.lead.r
  const y0 = geo.lead.t + CY
  const x1 = Math.min(...geo.boxes.map((b) => b.l))
  const sx = x0 + (x1 - x0) / 2
  const reached = (i: number) => run.nodes[i].status !== 'pending' || run.current === run.nodes[i].id
  const paths = geo.boxes.map((b, i) => ({ i, d: branch(x0, y0, sx, b.l, b.t + CY), lit: reached(i) }))
  const takeover = latest?.status === 'working' ? idx(latest.to) : -1
  return (
    <svg className="pointer-events-none absolute inset-0 z-0" width={geo.w} height={geo.h} aria-hidden="true">
      {/* grey first, lit on top where they share the trunk */}
      {[...paths.filter((p) => !p.lit), ...paths.filter((p) => p.lit)].map((p) => (
        <path key={p.i} d={p.d} fill="none" stroke={p.lit ? LIT : DIM} strokeWidth={1.5} />
      ))}
      {takeover >= 0 && paths[takeover] && (
        <path key={latest!.id} d={paths[takeover].d} pathLength={100} fill="none" strokeWidth={2.2} strokeLinecap="round" stroke={latest!.back ? '#ff7a6b' : '#d97757'} className="cm-ph-streak" />
      )}
      <circle cx={x0} cy={y0} r={4} fill="var(--color-raised, #1a1a1a)" stroke={paths.some((p) => p.lit) ? LIT : 'rgba(255,255,255,.3)'} strokeWidth={1.5} />
      {backs.map((h) => {
        const a = geo.boxes[idx(h.from)]
        const b = geo.boxes[idx(h.to)]
        if (!a || !b) return null
        const ay = a.t + CY
        const by = b.t + CY
        // Out right, up (or down), back left: right angles with rounded corners.
        const bx = Math.max(a.r, b.r) + 22
        const dir = by < ay ? -1 : 1
        const r = Math.min(10, Math.abs(by - ay) / 2)
        const d = `M ${a.r} ${ay} H ${bx - r} Q ${bx} ${ay} ${bx} ${ay + dir * r} V ${by - dir * r} Q ${bx} ${by} ${bx - r} ${by} H ${b.r + 2}`
        const live = latest?.id === h.id && h.status === 'working'
        return (
          <g key={h.id}>
            <path d={d} fill="none" stroke="rgba(255,122,107,.5)" strokeWidth={1.5} strokeDasharray="4 4" />
            <path d={`M ${b.r + 8} ${by - 4} L ${b.r + 3} ${by} L ${b.r + 8} ${by + 4}`} fill="none" stroke="rgba(255,122,107,.8)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
            {live && <path key={'s' + h.id} d={d} pathLength={100} fill="none" strokeWidth={2.2} strokeLinecap="round" stroke="#ff7a6b" className="cm-ph-streak" />}
          </g>
        )
      })}
    </svg>
  )
}

function LeadCard(p: { run: PipelineRunState; model: string; modelLabel: string; ms: number; tokens: number; leadRef: (e: HTMLDivElement | null) => void }) {
  const { run } = p
  const done = run.nodes.filter((n) => n.status === 'passed').length
  const open = run.issues.filter((i) => !i.resolved).length
  const pill =
    run.status === 'running' ? { t: 'Running', c: 'bg-[#4d8dff]/15 text-[#8ab4ff]', i: <Spinner size={10} /> }
    : run.status === 'completed' ? { t: 'Done', c: 'bg-ok/12 text-ok', i: <Check size={11} /> }
    : run.status === 'failed' ? { t: 'Failed', c: 'bg-bad/12 text-bad', i: <OctagonAlert size={11} /> }
    : { t: 'Stopped', c: 'bg-white/[.06] text-mute', i: <span className="size-1.5 rounded-full bg-current" /> }
  return (
    <div ref={p.leadRef} className="min-w-0 self-center rounded-[18px] border border-line bg-white/[.03]">
      <div className="flex flex-col gap-2.5 rounded-[17px] border border-line bg-panel px-3 py-2.5 shadow-[0_1px_2px_rgba(0,0,0,.3)]">
        <div className="flex items-start gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-line bg-raised">
            {p.model ? <ProviderLogo provider={providerOf(p.model)} size={17} /> : <Workflow size={15} className="text-accent" />}
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-ink">{run.name} lead</span>
              <span className={cn('-mr-0.5 flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', pill.c)}>
                {pill.i}
                {pill.t}
              </span>
            </div>
            <div className="mt-0.5 truncate text-[12px] text-mute">{p.modelLabel}</div>
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-6 shrink-0 place-items-center rounded-md border border-line bg-raised text-dim">
            <Workflow size={12} />
          </span>
          <span className="min-w-0 truncate text-[12.5px] text-dim" title={run.task}>{run.task ?? 'Pipeline run'}</span>
        </div>
      </div>
      <div className="flex items-center gap-1.5 whitespace-nowrap px-3 py-2 text-[12px] tabular-nums text-mute">
        <Clock3 size={13} className="shrink-0" />
        <span className={cn('truncate', open && run.status === 'running' && 'text-warn')}>
          {open && run.status === 'running' ? `${open} open issue${open === 1 ? '' : 's'}` : `${done}/${run.nodes.length} done`}
        </span>
        <span className="ml-auto pl-2">
          <span className={cn(p.ms > 0 && 'font-medium text-ink')}>{p.ms > 0 ? fmtMs(p.ms) : '—'}</span>
          {!!p.tokens && <> · {fmtTok(p.tokens)} tok</>}
        </span>
      </div>
    </div>
  )
}

function AgentCard(p: {
  run: PipelineRunState; node: Node; first: boolean; model: string; modelLabel: string; ms: number
  open: boolean; onToggle: () => void; onClose: () => void; trayRef: (e: HTMLDivElement | null) => void
}) {
  const { run, node } = p
  const anchor = useRef<HTMLDivElement | null>(null)
  const Icon = ROLE_ICON[node.role]
  const running = node.status === 'running'
  // Picked as the next node after a loop-back, but not started yet.
  const queued = !running && node.status === 'pending' && run.current === node.id && run.status === 'running'
  const idle = node.status === 'pending' && !queued
  const tasks = node.tasks ?? []
  const doneTasks = tasks.filter((t) => t.status !== 'running').length
  const live = [...tasks].reverse().find((t) => t.status === 'running')
  const openIssues = run.issues.filter((x) => !x.resolved).length
  const pill = running
    ? { t: 'Running', c: 'bg-[#4d8dff]/15 text-[#8ab4ff]', i: <Spinner size={10} /> }
    : queued
      ? { t: 'Up next', c: 'bg-warn/12 text-warn', i: <CornerUpLeft size={11} /> }
      : node.status === 'passed'
        ? { t: 'Done', c: 'bg-ok/12 text-ok', i: <Check size={11} /> }
        : node.status === 'failed'
          ? { t: 'Sent back', c: 'bg-bad/12 text-bad', i: <OctagonAlert size={11} /> }
          : { t: 'Queued', c: 'bg-white/[.06] text-mute', i: <span className="size-1.5 rounded-full bg-current" /> }
  const line = running
    ? live?.title ?? (node.visits > 1 ? `Pass ${node.visits} · ${run.task ?? node.instructions}` : run.task ?? node.instructions)
    : queued
      ? openIssues ? `Fix ${openIssues} open issue${openIssues === 1 ? '' : 's'}` : 'Picking it up'
      : node.note || (p.first && idle && run.task ? run.task : node.instructions)

  return (
    <div
      ref={(e) => {
        anchor.current = e
        p.trayRef(e)
      }}
      className={cn('relative min-w-0 rounded-[18px] border border-line bg-white/[.03] transition-opacity duration-300', idle && run.status === 'running' && 'opacity-55')}
    >
      <button
        onClick={p.onToggle}
        aria-expanded={p.open}
        aria-haspopup="dialog"
        className={cn(
          'flex w-full flex-col gap-2.5 rounded-[17px] border bg-panel px-3 py-2.5 text-left shadow-[0_1px_2px_rgba(0,0,0,.3)] transition-[border-color,box-shadow] duration-300 hover:border-line-strong',
          running ? 'border-[#4d8dff]/45 shadow-[0_0_0_3px_rgba(77,141,255,.10)]' : p.open ? 'border-line-strong' : 'border-line'
        )}
      >
        <div className="flex items-start gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-line bg-raised">
            {p.model ? <ProviderLogo provider={providerOf(p.model)} size={17} /> : <Icon size={15} className="text-dim" />}
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-ink">{node.label}</span>
              <span className={cn('-mr-0.5 flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', pill.c)}>
                {pill.i}
                {pill.t}
              </span>
            </div>
            <div className="mt-0.5 truncate text-[12px] text-mute">{p.modelLabel}</div>
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-6 shrink-0 place-items-center rounded-md border border-line bg-raised text-dim">
            {live ? (() => { const T = TASK_ICON[live.kind]; return <T size={12} /> })() : <Icon size={12} />}
          </span>
          {running ? <ShimmerText className="min-w-0 truncate text-[12.5px]">{line}</ShimmerText> : <span className="min-w-0 truncate text-[12.5px] text-dim">{line}</span>}
        </div>
      </button>
      <div className="flex items-center gap-1.5 whitespace-nowrap px-3 py-2 text-[12px] tabular-nums text-mute">
        <span className={cn(p.ms > 0 && 'font-medium text-ink')}>{p.ms > 0 ? fmtMs(p.ms) : '—'}</span>
        {!!node.tokens && <span>· {fmtTok(node.tokens)} tok</span>}
        <span className="ml-auto pl-2">
          {tasks.length ? `${tasks.length} task${tasks.length === 1 ? '' : 's'}` : 'No tasks'}
        </span>
      </div>

      <Popover open={p.open} onClose={p.onClose} anchor={anchor} side="bottom" align="start" width={360} offset={8} unstyled focusOnOpen={false}>
        <div className="rounded-2xl border border-line-strong bg-raised p-1.5 shadow-2xl">
          <div className="flex items-center justify-between px-2.5 pb-2 pt-1.5">
            <span className="text-[13.5px] font-semibold text-ink">Tasks</span>
            <span className="text-[12px] tabular-nums text-mute">
              {tasks.length ? `${doneTasks}/${tasks.length} done` : node.label}
            </span>
          </div>
          <div className="max-h-[320px] overflow-y-auto rounded-xl bg-white/[.03] p-1 [scrollbar-width:thin]">
            {tasks.length === 0 ? (
              <div className="px-3 py-5 text-center text-[12px] text-mute">
                {node.status === 'pending' ? 'Not started yet' : 'Nothing but reading so far'}
              </div>
            ) : (
              tasks.map((t, k) => {
                const T = TASK_ICON[t.kind]
                const now = t.status === 'running'
                return (
                  <div key={t.id} className="cm-ph-row flex items-center gap-2.5 rounded-lg px-2 py-1.5" style={{ animationDelay: `${Math.min(k, 12) * 25}ms` }}>
                    <span className={cn('grid size-6 shrink-0 place-items-center rounded-md border border-line bg-panel', t.status === 'error' ? 'text-bad' : 'text-dim')}>
                      <T size={12} />
                    </span>
                    <span className={cn('min-w-0 flex-1 truncate text-[12.5px]', now ? 'font-semibold text-ink' : 'text-dim')} title={t.title}>
                      {t.title}
                      {t.count && t.count > 1 ? <span className="text-mute"> ×{t.count}</span> : null}
                    </span>
                    <span className={cn('shrink-0 text-[12px] tabular-nums', now ? 'font-semibold text-ink' : t.status === 'error' ? 'text-bad' : 'text-mute')}>
                      {now ? 'Running' : t.status === 'error' ? 'Failed' : fmtMs(t.ms ?? 0)}
                    </span>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </Popover>
    </div>
  )
}
