import { useEffect, useMemo, useState } from 'react'
import { usePersisted } from '@/lib/persist'
import { ChevronRight, Copy, MoreHorizontal, Plus, RefreshCw, Search, Trash2, Workflow } from 'lucide-react'
import type { Pipeline, RunRow } from '@shared/types'
import { actions, useStore } from '@/lib/store'
import { cn, timeAgo } from '@/lib/utils'
import { Badge } from '../../affect/badge'
import { DropdownMenu } from '../../affect/dropdown-menu'
import { EmptyState } from '../../affect/empty-state'
import { PageHeader } from '../PageHeader'
import { ConfirmDialog } from '../ConfirmDialog'
import { PipelineEditor } from './PipelineEditor'
import { ROLE_ICON } from './roles'
import { ProviderLogo } from '../Logos'
import { providerOf } from '../ModelSelect'
import { TextField } from '../../affect/text-field'

const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 8)}`
type Tab = 'pipelines' | 'runs'
type StatusFilter = 'all' | 'completed' | 'failed' | 'running' | 'stopped'

/** Pipelines: a table of all of them (and of their runs); a row opens its node diagram. */
export function PipelinesPage({ leftCollapsed, onExpandLeft }: { leftCollapsed: boolean; onExpandLeft: () => void }) {
  const pipelines = useStore((s) => s.pipelines)
  const workspaces = useStore((s) => s.workspaces)
  const [open, setOpen] = useState<string | null>(null)
  const [tab, setTab] = usePersisted<Tab>('pipelines.tab', 'pipelines')
  const [runs, setRuns] = useState<RunRow[]>([])
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [toDelete, setToDelete] = useState<Pipeline | null>(null)

  const load = () => void window.cm.listRuns().then(setRuns)
  useEffect(load, [workspaces.map((w) => w.status).join()])

  const stats = useMemo(() => {
    const now = Date.now()
    const within = (ms: number) => runs.filter((r) => now - r.createdAt < ms)
    const day = within(86_400_000)
    const week = within(7 * 86_400_000)
    return {
      ok24: day.filter((r) => r.status === 'completed').length,
      ko24: day.filter((r) => r.status === 'failed').length,
      ok7: week.filter((r) => r.status === 'completed').length,
      ko7: week.filter((r) => r.status === 'failed').length
    }
  }, [runs])

  const perPipeline = useMemo(() => {
    const m = new Map<string, { runs: number; ok: number; last: number | null }>()
    for (const r of runs) {
      const x = m.get(r.pipelineId) ?? { runs: 0, ok: 0, last: null }
      x.runs++
      if (r.status === 'completed') x.ok++
      x.last = Math.max(x.last ?? 0, r.createdAt)
      m.set(r.pipelineId, x)
    }
    return m
  }, [runs])

  const s = q.trim().toLowerCase()
  const pipeRows = pipelines.filter((p) => !s || `${p.name} ${p.description} ${p.nodes.map((n) => n.label).join(' ')}`.toLowerCase().includes(s))
  const runRows = runs.filter(
    (r) => (status === 'all' || r.status === status) && (!s || `${r.pipelineName} ${r.task ?? ''} ${r.branch} ${r.projectName}`.toLowerCase().includes(s))
  )

  const create = async (from?: Pipeline) => {
    const p: Pipeline = from
      ? { ...structuredClone(from), id: uid('p'), name: `${from.name} copy`, builtIn: false }
      : { id: uid('p'), name: 'New pipeline', description: '', maxLoops: 3, nodes: [] }
    await window.cm.savePipeline(p)
    await actions.reloadPipelines()
    setOpen(p.id)
  }

  if (open) return <PipelineEditor pipelineId={open} onBack={() => setOpen(null)} onOpen={setOpen} leftCollapsed={leftCollapsed} onExpandLeft={onExpandLeft} />

  return (
    <>
      <PageHeader leftCollapsed={leftCollapsed} onExpandLeft={onExpandLeft}>
        <div className="no-drag flex h-full items-stretch gap-5">
          <TabBtn active={tab === 'pipelines'} onClick={() => setTab('pipelines')} label="Pipelines" count={pipelines.length} />
          <TabBtn active={tab === 'runs'} onClick={() => setTab('runs')} label="Runs" count={runs.length} />
        </div>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1100px] px-6 py-5">
          <div className="flex items-center gap-2">
<TextField
              size="sm"
              className="w-80"
              prefix={<Search size={13} />}
              clearable
              aria-label="Search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={tab === 'pipelines' ? 'Search pipelines…' : 'Search runs…'}
            />
            {tab === 'runs' && (
              <DropdownMenu
                width={180}
                items={(['all', 'completed', 'failed', 'running', 'stopped'] as StatusFilter[]).map((v) => ({
                  label: v === 'all' ? 'All results' : v[0].toUpperCase() + v.slice(1), type: 'radio' as const, checked: status === v, onSelect: () => setStatus(v)
                }))}
                trigger={({ triggerProps }) => (
                  <button {...triggerProps} className="flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[12.5px] text-dim hover:text-ink">
                    Filters{status !== 'all' && <span className="text-accent">· {status}</span>}
                  </button>
                )}
              />
            )}
            <button onClick={load} className="grid size-8 place-items-center rounded-lg border border-line text-dim hover:text-ink" aria-label="Refresh">
              <RefreshCw size={13} />
            </button>
            <div className="flex-1" />
            {tab === 'pipelines' && (
              <button onClick={() => void create()} className="flex h-8 items-center gap-1.5 rounded-lg bg-ink px-3 text-[12.5px] font-medium text-black">
                New pipeline <Plus size={13} />
              </button>
            )}
          </div>

          <div className="mt-4 grid grid-cols-4 gap-2.5">
            <Stat label="Successful · 24h" value={stats.ok24} />
            <Stat label="Failed · 24h" value={stats.ko24} bad={stats.ko24 > 0} />
            <Stat label="Successful · 7d" value={stats.ok7} />
            <Stat label="Failed · 7d" value={stats.ko7} bad={stats.ko7 > 0} />
          </div>

          <div className="mt-4 overflow-hidden rounded-xl border border-line bg-raised/40">
            {tab === 'pipelines' ? (
              <table className="w-full text-left text-[12.5px]">
                <thead>
                  <tr className="border-b border-line text-[11px] text-mute">
                    <Th className="w-[42%]">Pipeline</Th>
                    <Th>Nodes</Th>
                    <Th>Max loops</Th>
                    <Th>Runs</Th>
                    <Th>Success</Th>
                    <Th>Last run</Th>
                    <Th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {pipeRows.map((p) => {
                    const st = perPipeline.get(p.id)
                    return (
                      <tr key={p.id} onClick={() => setOpen(p.id)} className="group cursor-default border-b border-line last:border-0 hover:bg-white/[.025]">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2 font-medium text-ink">
                            <Workflow size={13} className="text-accent" />
                            {p.name}
                            {p.builtIn && <span className="rounded bg-white/[.06] px-1 text-[10px] font-normal text-mute">built-in</span>}
                          </div>
                          <div className="mt-1 flex items-center gap-1 text-[11.5px] text-mute">
                            {p.nodes.map((n, i) => {
                              const Icon = ROLE_ICON[n.role]
                              return (
                                <span key={n.id} className="flex items-center gap-1">
                                  {i > 0 && <ChevronRight size={10} />}
                                  {n.model || p.model ? <ProviderLogo provider={providerOf(n.model || p.model!)} size={11} /> : <Icon size={11} />} {n.label}
                                </span>
                              )
                            })}
                            {p.nodes.length === 0 && 'No nodes yet'}
                          </div>
                        </td>
                        <td className="px-4 tabular-nums text-dim">{p.nodes.length}</td>
                        <td className="px-4 tabular-nums text-dim">{p.maxLoops}</td>
                        <td className="px-4 tabular-nums text-dim">{st?.runs ?? 0}</td>
                        <td className="px-4 tabular-nums text-dim">{st?.runs ? `${Math.round((st.ok / st.runs) * 100)}%` : '—'}</td>
                        <td className="px-4 text-dim">{st?.last ? `${timeAgo(st.last)} ago` : '—'}</td>
                        <td className="px-2" onClick={(e) => e.stopPropagation()}>
                          <DropdownMenu
                            align="end"
                            width={180}
                            items={[
                              { label: 'Open diagram', icon: <Workflow size={14} />, onSelect: () => setOpen(p.id) },
                              { label: 'Duplicate', icon: <Copy size={14} />, onSelect: () => void create(p) },
                              ...(p.builtIn ? [] : [{ label: 'Delete', icon: <Trash2 size={14} />, danger: true, divider: true, onSelect: () => setToDelete(p) }])
                            ]}
                            trigger={({ triggerProps }) => (
                              <button {...triggerProps} aria-label="Pipeline actions" className="grid size-7 place-items-center rounded-md text-mute opacity-0 hover:bg-white/[.06] hover:text-ink group-hover:opacity-100 aria-expanded:opacity-100">
                                <MoreHorizontal size={14} />
                              </button>
                            )}
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            ) : (
              <table className="w-full text-left text-[12.5px]">
                <thead>
                  <tr className="border-b border-line text-[11px] text-mute">
                    <Th className="w-[38%]">Run</Th>
                    <Th>Pipeline</Th>
                    <Th>Result</Th>
                    <Th>Branch</Th>
                    <Th>Loops</Th>
                    <Th>When</Th>
                  </tr>
                </thead>
                <tbody>
                  {runRows.map((r) => (
                    <tr key={r.runId} onClick={() => void actions.selectWorkspace(r.workspaceId)} className="cursor-default border-b border-line last:border-0 hover:bg-white/[.025]">
                      <td className="max-w-0 truncate px-4 py-3 text-ink" title={r.task ?? ''}>{r.task ?? '—'}</td>
                      <td className="px-4 text-dim">{r.pipelineName}</td>
                      <td className="px-4">
                        <Badge
                          tone={r.status === 'completed' ? 'success' : r.status === 'failed' ? 'danger' : r.status === 'running' ? 'info' : 'neutral'}
                          dot
                          live={r.status === 'running'}
                        >
                          {r.status}
                        </Badge>
                      </td>
                      <td className="max-w-0 truncate px-4 font-mono text-[11.5px] text-dim">
                        <span className="text-mute">{r.projectName} · </span>{r.branch}
                      </td>
                      <td className={cn('px-4 tabular-nums', r.loops ? 'text-warn' : 'text-dim')}>{r.loops}</td>
                      <td className="px-4 text-dim">{timeAgo(r.createdAt)} ago</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {(tab === 'pipelines' ? pipeRows.length : runRows.length) === 0 && (
              <div className="py-16">
                <EmptyState
                  bare
                  title={tab === 'pipelines' ? 'No pipelines match' : 'No runs yet'}
                  text={tab === 'pipelines' ? 'Try another search, or create one.' : 'Runs appear here after a pipeline is run from a chat.'}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {toDelete && (
        <ConfirmDialog
          title={`Delete pipeline "${toDelete.name}"?`}
          danger
          confirmLabel="Delete"
          onClose={() => setToDelete(null)}
          onConfirm={async () => {
            await window.cm.deletePipeline(toDelete.id)
            await actions.reloadPipelines()
          }}
        >
          Past runs keep their record; this pipeline won't be offered in the composer anymore.
        </ConfirmDialog>
      )}
    </>
  )
}

function TabBtn({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button onClick={onClick} className={cn('relative flex items-center gap-1.5 text-[13px]', active ? 'font-medium text-ink' : 'text-dim hover:text-ink')}>
      {label}
      <span className="text-[11.5px] tabular-nums text-mute">{count}</span>
      {active && <span className="absolute inset-x-0 -bottom-px h-[2px] rounded-full bg-ink" />}
    </button>
  )
}

function Stat({ label, value, bad }: { label: string; value: number; bad?: boolean }) {
  return (
    <div className="rounded-xl border border-line bg-raised/40 px-3.5 py-3">
      <div className="text-[11.5px] text-mute">{label}</div>
      <div className={cn('mt-1 text-[18px] font-semibold tabular-nums', bad ? 'text-bad' : 'text-ink')}>{value}</div>
    </div>
  )
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={cn('px-4 py-2.5 font-medium', className)}>{children}</th>
}
