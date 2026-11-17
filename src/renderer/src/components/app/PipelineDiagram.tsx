import { Check, ClipboardList, Eye, FlaskConical, GitCommitHorizontal, Hammer, Search, ShieldCheck, Workflow, X } from 'lucide-react'
import type { NodeRole, PipelineRunState } from '@shared/types'
import { cn } from '@/lib/utils'
import { Badge } from '../affect/badge'
import { Spinner } from '../affect/spinner'
import { ShimmerText } from '../affect/shimmer-loader'
import { Tooltip } from '../affect/tooltip'

const ROLE_ICON: Record<NodeRole, React.ReactNode> = {
  plan: <ClipboardList size={14} />,
  spec: <Search size={14} />,
  build: <Hammer size={14} />,
  qa: <FlaskConical size={14} />,
  review: <Eye size={14} />,
  security: <ShieldCheck size={14} />,
  ship: <GitCommitHorizontal size={14} />
}

const NODE_H = 64
const LOOP_H = 46

/** Live pipeline run, rendered inside the chat and updated as the agent reports each step. */
export function PipelineDiagram({ run }: { run: PipelineRunState }) {
  const n = run.nodes.length
  const x = (i: number) => ((i + 0.5) / n) * 100
  const loops = run.nodes
    .map((node, i) => ({ from: i, to: run.nodes.findIndex((t) => t.id === node.onFail), node }))
    .filter((l) => l.to >= 0)
  const open = run.issues.filter((i) => !i.resolved)
  const tone = run.status === 'completed' ? 'success' : run.status === 'running' ? 'info' : run.status === 'failed' ? 'danger' : 'neutral'

  return (
    <div className="cm-in overflow-hidden rounded-xl border border-line bg-raised">
      <div className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
        <Workflow size={14} className="text-accent" />
        <span className="text-[13px] font-medium">Pipeline · {run.name}</span>
        <Badge tone={tone} dot live={run.status === 'running'}>
          {run.status}
        </Badge>
        <div className="flex-1" />
        <span className={cn('text-[11.5px] tabular-nums', run.loops ? 'text-warn' : 'text-mute')}>
          Loop {run.loops}/{run.maxLoops}
        </span>
      </div>

      <div className="relative px-3 pt-4" style={{ height: NODE_H + LOOP_H + 22 }}>
        {/* edges */}
        <svg className="pointer-events-none absolute inset-x-3 top-4" style={{ height: NODE_H + LOOP_H, width: 'calc(100% - 24px)' }} preserveAspectRatio="none" viewBox={`0 0 100 ${NODE_H + LOOP_H}`}>
          {run.nodes.slice(0, -1).map((node, i) => {
            const next = run.nodes[i + 1]
            const flowing = node.status === 'passed' && next.status === 'running'
            const done = node.status === 'passed' && (next.status === 'passed' || next.status === 'running' || next.status === 'failed')
            return (
              <line
                key={node.id}
                x1={x(i) + 50 / n - 1.5}
                x2={x(i + 1) - 50 / n + 1.5}
                y1={NODE_H / 2}
                y2={NODE_H / 2}
                vectorEffect="non-scaling-stroke"
                stroke={flowing ? '#d97757' : done ? 'rgba(79,195,138,.6)' : 'rgba(255,255,255,.14)'}
                strokeWidth={1.5}
                strokeDasharray={flowing ? '4 4' : undefined}
                style={flowing ? { animation: 'cm-dash .6s linear infinite' } : undefined}
              />
            )
          })}
          {loops.map(({ from, to, node }) => {
            const hot = run.current === run.nodes[to].id && node.status === 'failed'
            const used = node.visits > 1 || node.status === 'failed'
            const y0 = NODE_H
            const y1 = NODE_H + LOOP_H - 8
            return (
              <path
                key={node.id}
                d={`M ${x(from)} ${y0} C ${x(from)} ${y1}, ${x(to)} ${y1}, ${x(to)} ${y0 + 2}`}
                fill="none"
                vectorEffect="non-scaling-stroke"
                stroke={hot ? '#ff7a6b' : used ? 'rgba(255,122,107,.45)' : 'rgba(255,255,255,.1)'}
                strokeWidth={1.5}
                strokeDasharray="4 4"
                style={hot ? { animation: 'cm-dash .5s linear infinite' } : undefined}
              />
            )
          })}
        </svg>

        {/* loop labels */}
        {loops.map(({ from, to, node }) => (
          <span
            key={node.id + '-l'}
            className={cn(
              'absolute -translate-x-1/2 rounded-full border px-1.5 text-[10.5px] leading-4',
              node.status === 'failed' ? 'border-bad/40 bg-bad/10 text-bad' : 'border-line bg-raised text-mute'
            )}
            style={{ left: `calc(12px + (100% - 24px) * ${(x(from) + x(to)) / 200})`, top: 16 + NODE_H + LOOP_H - 16 }}
          >
            fail → {run.nodes[to].label}
          </span>
        ))}

        {/* nodes */}
        {run.nodes.map((node, i) => {
          const running = node.status === 'running'
          return (
            <Tooltip key={node.id} content={node.note || node.instructions} side="top" disabled={!node.note && !node.instructions}>
              <div
                className={cn(
                  'absolute flex -translate-x-1/2 flex-col justify-center gap-1 rounded-[10px] border bg-panel px-2.5 transition-[border-color,background-color,box-shadow] duration-300',
                  running && 'border-accent/60 bg-accent/[.06]',
                  node.status === 'passed' && 'border-ok/35',
                  node.status === 'failed' && 'border-bad/50 bg-bad/[.06]',
                  node.status === 'pending' && 'border-line opacity-70'
                )}
                style={{
                  left: `calc(12px + (100% - 24px) * ${x(i) / 100})`,
                  top: 16,
                  height: NODE_H,
                  width: `calc((100% - 24px) / ${n} - 18px)`,
                  animation: running ? 'cm-ring 1.6s ease-out infinite' : undefined
                }}
              >
                <div className="flex items-center gap-1.5">
                  <span className={cn(running ? 'text-accent' : node.status === 'passed' ? 'text-ok' : node.status === 'failed' ? 'text-bad' : 'text-mute')}>
                    {ROLE_ICON[node.role]}
                  </span>
                  <span className="truncate text-[12.5px] font-medium">{node.label}</span>
                  {node.visits > 1 && <span className="ml-auto text-[10.5px] tabular-nums text-warn">×{node.visits}</span>}
                </div>
                <div className="flex items-center gap-1 text-[11px] text-mute">
                  {running ? (
                    <>
                      <Spinner size={10} className="text-accent" />
                      <ShimmerText>working</ShimmerText>
                    </>
                  ) : node.status === 'passed' ? (
                    <>
                      <Check size={11} className="text-ok" /> passed
                    </>
                  ) : node.status === 'failed' ? (
                    <>
                      <X size={11} className="text-bad" /> failed
                    </>
                  ) : (
                    'waiting'
                  )}
                </div>
              </div>
            </Tooltip>
          )
        })}
      </div>

      {run.issues.length > 0 && (
        <div className="border-t border-line px-3.5 py-2.5">
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-mute">
            Issues · {open.length} open
          </div>
          <div className="flex flex-col gap-1">
            {run.issues.map((iss) => (
              <div key={iss.id} className="cm-in flex items-center gap-2 text-[12.5px]">
                <span className={cn('size-1.5 shrink-0 rounded-full', iss.resolved ? 'bg-ok' : 'bg-bad')} />
                <span className={cn('min-w-0 flex-1 truncate', iss.resolved && 'text-mute line-through')}>{iss.title}</span>
                <span className="font-mono text-[10.5px] text-mute">{iss.nodeId}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
