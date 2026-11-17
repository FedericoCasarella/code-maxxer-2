import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowRight, Check, ChevronDown, ClipboardList, CornerUpLeft, Eye, FileCode2, FlaskConical, GitCommitHorizontal, Hammer, OctagonAlert, Search, ShieldCheck, Workflow
} from 'lucide-react'
import type { Handoff, NodeRole, PipelineRunState } from '@shared/types'
import { cn } from '@/lib/utils'
import { Badge } from '../affect/badge'
import { Spinner } from '../affect/spinner'
import { ShimmerText } from '../affect/shimmer-loader'
import { MODELS } from './Composer'

/*
 * Pipeline relay, modelled on the agent-handoff pattern: the nodes sit in a row as agent cards,
 * rounded lines drop from each one into a column between it and the next, and every handoff lands
 * there as a card saying what went along (files, issues) and what got lost (issues still open).
 * A streak of light runs along the lines when a new handoff arrives. Loop-backs land in the same
 * column, marked as sent back. Own implementation; swap for affectUI Pro's Agent Handoff later.
 */

const ROLE_ICON: Record<NodeRole, typeof Hammer> = {
  plan: ClipboardList, spec: Search, build: Hammer, qa: FlaskConical, review: Eye, security: ShieldCheck, ship: GitCommitHorizontal
}

type Pt = { x: number; y: number }
type Geo = { w: number; h: number; agents: Pt[]; cols: { left: number; right: number; top: number }[] }

const R = 8
/** Down, across, down — with rounded corners. */
function elbow(a: Pt, b: Pt): string {
  const midY = a.y + (b.y - a.y) / 2
  if (Math.abs(a.x - b.x) < 1) return `M ${a.x} ${a.y} V ${b.y}`
  const dir = b.x > a.x ? 1 : -1
  const r = Math.min(R, Math.abs(b.x - a.x) / 2, (b.y - a.y) / 2)
  return [
    `M ${a.x} ${a.y}`, `V ${midY - r}`, `Q ${a.x} ${midY} ${a.x + dir * r} ${midY}`,
    `H ${b.x - dir * r}`, `Q ${b.x} ${midY} ${b.x} ${midY + r}`, `V ${b.y}`
  ].join(' ')
}

const CSS = `
@keyframes cm-ph-streak { from { stroke-dashoffset: 22 } to { stroke-dashoffset: -100 } }
@keyframes cm-ph-drop { from { opacity: 0; transform: translateY(-10px) scale(.98) } to { opacity: 1; transform: none } }
.cm-ph-streak { stroke-dasharray: 22 100; animation: cm-ph-streak .9s cubic-bezier(.45,0,.2,1) both; filter: drop-shadow(0 0 4px rgba(217,119,87,.9)); }
.cm-ph-drop { animation: cm-ph-drop .45s var(--aui-ease) both; }
.cm-ph-fade { -webkit-mask-image: linear-gradient(to bottom, #000 72%, transparent); mask-image: linear-gradient(to bottom, #000 72%, transparent); }
@media (prefers-reduced-motion: reduce) { .cm-ph-streak { display: none } .cm-ph-drop { animation: none } }
`

export function PipelineHandoff({ run }: { run: PipelineRunState }) {
  const wrap = useRef<HTMLDivElement>(null)
  const agentEls = useRef<(HTMLDivElement | null)[]>([])
  const colEls = useRef<(HTMLDivElement | null)[]>([])
  const [geo, setGeo] = useState<Geo | null>(null)
  // Open while it runs; folds itself away when the run ends (reopen any time).
  const [open, setOpen] = useState(run.status === 'running')
  const prevStatus = useRef(run.status)
  useEffect(() => {
    if (prevStatus.current === 'running' && run.status !== 'running') setOpen(false)
    if (prevStatus.current !== 'running' && run.status === 'running') setOpen(true)
    prevStatus.current = run.status
  }, [run.status])
  const n = run.nodes.length
  const idx = (id: string) => run.nodes.findIndex((x) => x.id === id)
  const handoffs = run.handoffs ?? []

  // Column j sits between node j and j+1; a loop-back lands in the column just right of its target.
  const byCol: Handoff[][] = Array.from({ length: Math.max(0, n - 1) }, () => [])
  for (const h of handoffs) {
    const c = Math.min(Math.max(0, h.back ? idx(h.to) : idx(h.from)), n - 2)
    byCol[c]?.unshift(h)
  }
  const latest = handoffs[handoffs.length - 1]

  useLayoutEffect(() => {
    const el = wrap.current
    if (!el || !open) return
    const measure = () => {
      const base = el.getBoundingClientRect()
      const agents = agentEls.current.slice(0, n).map((a) => {
        const r = a!.getBoundingClientRect()
        return { x: r.left - base.left + r.width / 2, y: r.bottom - base.top }
      })
      const cols = colEls.current.slice(0, n - 1).map((c) => {
        const r = c!.getBoundingClientRect()
        return { left: r.left - base.left, right: r.right - base.left, top: r.top - base.top }
      })
      setGeo({ w: base.width, h: base.height, agents, cols })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [n, open])

  const tone = run.status === 'completed' ? 'success' : run.status === 'running' ? 'info' : run.status === 'failed' ? 'danger' : 'neutral'
  const modelLabel = MODELS.find((m) => m.id === run.model)?.label.replace(/^Claude /, '') ?? 'Claude'

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
            <span className="ml-1.5 text-[11.5px] text-mute">{handoffs.length} handoffs</span>
          </span>
        )}
        <span className={cn('ml-2 text-[11.5px] tabular-nums', run.loops ? 'text-warn' : 'text-mute')}>
          Loop {run.loops}/{run.maxLoops}
        </span>
        <ChevronDown size={14} className={cn('text-mute transition-transform', !open && '-rotate-90')} />
      </button>

      {open && (<>
      {/* scrolls sideways when the relay is wider than the chat */}
      <div className="overflow-x-auto">
      <div ref={wrap} className="relative px-3 pb-1 pt-3.5" style={{ minWidth: n * 176 }}>
        {/* agents in relay order */}
        <div className="relative z-[1] grid gap-2.5" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
          {run.nodes.map((node, i) => {
            const Icon = ROLE_ICON[node.role]
            const running = node.status === 'running'
            // Picked as the next node after a loop-back, but not started yet.
            const queued = !running && node.status === 'pending' && run.current === node.id && run.status === 'running'
            const openIssues = run.issues.filter((x) => !x.resolved).length
            const pill =
              running ? { t: 'Working', c: 'bg-[#4d8dff]/15 text-[#8ab4ff]' }
              : queued ? { t: 'Up next', c: 'bg-warn/12 text-warn' }
              : node.status === 'passed' ? { t: 'Passed', c: 'bg-ok/12 text-ok' }
              : node.status === 'failed' ? { t: 'Failed', c: 'bg-bad/12 text-bad' }
              : { t: 'Idle', c: 'bg-white/[.06] text-mute' }
            return (
              <div
                key={node.id}
                ref={(e) => {
                  agentEls.current[i] = e
                }}
                className={cn(
                  'flex min-w-0 flex-col gap-2 rounded-xl border bg-panel p-2.5 transition-[border-color,box-shadow] duration-300',
                  running ? 'border-[#4d8dff]/45 shadow-[0_0_0_3px_rgba(77,141,255,.10)]' : 'border-line'
                )}
              >
                <div className="flex items-start gap-2">
                  <span className={cn('mt-0.5 grid size-6 shrink-0 place-items-center rounded-md border border-line bg-raised', running ? 'text-[#8ab4ff]' : 'text-dim')}>
                    <Icon size={13} />
                  </span>
                  <div className="min-w-0 flex-1 leading-tight">
                    <div className="truncate text-[12.5px] font-medium">{node.label}</div>
                    <div className="truncate text-[11px] text-mute">{modelLabel}</div>
                  </div>
                  <span className={cn('shrink-0 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium', pill.c)}>{pill.t}</span>
                </div>
                <p className="line-clamp-2 min-h-[2lh] text-[11.5px] leading-[1.35] text-dim">{node.instructions}</p>
                <div className="flex h-7 items-center gap-1.5 rounded-lg bg-white/[.03] px-2 text-[11px]">
                  {running ? (
                    <>
                      <Spinner size={10} className="shrink-0 text-[#8ab4ff]" />
                      <span className="min-w-0 truncate text-ink">{run.task ?? 'Task'}</span>
                      <ShimmerText className="shrink-0 text-mute">{node.visits > 1 ? `pass ${node.visits}` : 'working'}</ShimmerText>
                    </>
                  ) : node.status === 'passed' ? (
                    <>
                      <Check size={11} className="shrink-0 text-ok" />
                      <span className="min-w-0 truncate text-dim">{node.note || 'Done'}</span>
                    </>
                  ) : node.status === 'failed' ? (
                    <>
                      <OctagonAlert size={11} className="shrink-0 text-bad" />
                      <span className="min-w-0 truncate text-dim">{node.note || 'Sent back'}</span>
                    </>
                  ) : queued ? (
                    <>
                      <CornerUpLeft size={11} className="shrink-0 text-warn" />
                      <span className="min-w-0 truncate text-dim">
                        {openIssues ? `Fix ${openIssues} open issue${openIssues === 1 ? '' : 's'}` : 'Picking it up'}
                      </span>
                    </>
                  ) : (
                    <span className="truncate text-mute">{i === 0 && run.task ? <>Up next · <span className="text-dim">{run.task}</span></> : 'Ready for a task'}</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* relay lines + light */}
        {geo && (
          <svg className="pointer-events-none absolute inset-0 z-0" width={geo.w} height={geo.h} aria-hidden="true">
            {geo.cols.map((c, j) => {
              const a = geo.agents[j]
              const b = geo.agents[j + 1]
              if (!a || !b) return null
              const inA = { x: c.left + (c.right - c.left) * 0.38, y: c.top }
              const inB = { x: c.left + (c.right - c.left) * 0.62, y: c.top }
              const pA = elbow(a, inA)
              const pB = elbow(b, inB)
              const live = latest && byCol[j]?.[0]?.id === latest.id && latest.status === 'working'
              const active = live || (run.nodes[j].status !== 'pending' && run.nodes[j + 1].status !== 'pending')
              const stroke = active ? 'rgba(138,180,255,.55)' : 'rgba(255,255,255,.12)'
              return (
                <g key={j}>
                  <path d={pA} fill="none" stroke={stroke} strokeWidth={1.5} />
                  <path d={pB} fill="none" stroke={stroke} strokeWidth={1.5} />
                  {live && latest && (
                    <g key={latest.id}>
                      {/* forward: into the column from the left agent, then out to the right one; back: reversed */}
                      <path
                        d={latest.back ? pB : pA} pathLength={100} fill="none" strokeWidth={2.2} strokeLinecap="round"
                        stroke={latest.back ? '#ff7a6b' : '#d97757'} className="cm-ph-streak"
                      />
                      <path
                        d={latest.back ? pA : pB} pathLength={100} fill="none" strokeWidth={2.2} strokeLinecap="round"
                        stroke={latest.back ? '#ff7a6b' : '#d97757'} className="cm-ph-streak"
                        style={{ animationDelay: '.75s', animationDirection: 'reverse' }}
                      />
                    </g>
                  )}
                </g>
              )
            })}
          </svg>
        )}

        {/* handoff columns, centred under the gap between two agents */}
        {n > 1 && (
          <div className="relative z-[1] mt-9 grid gap-2.5" style={{ gridTemplateColumns: `repeat(${n * 2}, minmax(0, 1fr))` }}>
            {Array.from({ length: n - 1 }, (_, j) => {
              const list = byCol[j]
              return (
                <div
                  key={j}
                  ref={(e) => {
                    colEls.current[j] = e
                  }}
                  className="flex min-w-0 flex-col rounded-xl border border-line bg-panel/80"
                  style={{ gridColumn: `${j * 2 + 2} / span 2` }}
                >
                  <div className="flex items-center gap-1.5 border-b border-line px-2.5 py-1.5 text-[11px] text-mute">
                    <span className="truncate">{run.nodes[j].label}</span>
                    <ArrowRight size={11} className="shrink-0" />
                    <span className="truncate">{run.nodes[j + 1].label}</span>
                    <span className="ml-auto tabular-nums">{list.length}</span>
                  </div>
                  <div className="flex max-h-[264px] flex-col gap-1.5 overflow-y-auto overscroll-contain p-1.5">
                    {list.length === 0 ? (
                      <div className="px-1.5 py-3 text-center text-[11px] text-mute">Nothing handed over yet</div>
                    ) : (
                      list.map((h) => <HandoffCard key={h.id} h={h} toLabel={run.nodes[idx(h.to)]?.label ?? h.to} fromLabel={run.nodes[idx(h.from)]?.label ?? h.from} />)
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
      </div>

      {run.issues.length > 0 && (
        <div className="mt-2 border-t border-line px-3.5 py-2.5">
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-mute">
            Brain · {run.issues.filter((i) => !i.resolved).length} open issues
          </div>
          <div className="flex flex-col gap-1">
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
      {run.issues.length === 0 && <div className="h-2" />}
      </>)}
    </div>
  )
}

function HandoffCard({ h, toLabel, fromLabel }: { h: Handoff; toLabel: string; fromLabel: string }) {
  const [open, setOpen] = useState(false)
  const lost = h.items.filter((i) => i.lost)
  const summary = h.items.length ? h.items.map((i) => i.label).join(', ') : 'Context only, no files'
  return (
    <button
      onClick={() => setOpen((o) => !o)}
      aria-expanded={open}
      className={cn(
        'cm-ph-drop flex w-full shrink-0 flex-col gap-1 rounded-lg border px-2 py-1.5 text-left transition-colors hover:bg-white/[.03]',
        h.back ? 'border-bad/25 bg-bad/[.04]' : 'border-line bg-raised'
      )}
    >
      <div className="flex items-center gap-1.5">
        {h.back ? <CornerUpLeft size={12} className="shrink-0 text-bad" /> : <span className="size-2 shrink-0 rounded-[3px] bg-accent" />}
        <span className="min-w-0 truncate text-[12px] font-medium">{h.back ? `${fromLabel} sent back` : h.title}</span>
      </div>
      <div className="truncate text-[11px] text-mute">{h.back ? h.title : summary}</div>
      <div className="flex items-center gap-1.5 text-[11px]">
        {h.status === 'working' ? (
          <>
            <Spinner size={10} className="text-[#8ab4ff]" />
            <span className="text-dim">With {toLabel}</span>
          </>
        ) : h.status === 'done' && lost.length === 0 ? (
          <>
            <span className="size-1.5 rounded-full bg-ok" />
            <span className="text-dim">{h.back ? `Fixed by ${toLabel}` : 'Looks good'}</span>
          </>
        ) : (
          <>
            <span className="size-1.5 rounded-full bg-warn" />
            <span className="text-warn">{lost.length ? `${lost.length} lost on the way` : h.back ? 'Fix attempted' : 'Needs a look'}</span>
          </>
        )}
      </div>
      {open && h.items.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {h.items.map((it) => (
            <span
              key={it.id}
              title={it.why}
              className={cn(
                'flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px]',
                it.lost ? 'border-warn/30 text-warn line-through' : 'border-line text-dim'
              )}
            >
              {it.kind === 'file' ? <FileCode2 size={10} /> : <OctagonAlert size={10} />}
              <span className="truncate">{it.label}</span>
            </span>
          ))}
        </div>
      )}
    </button>
  )
}
