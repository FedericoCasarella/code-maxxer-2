import { useEffect, useMemo, useState } from 'react'
import { usePersisted } from '@/lib/persist'
import { AlignLeft, Boxes, ChevronRight, CircleCheck, CircleDot, Clock, Copy, GitBranch, MoreHorizontal, Play, Plus, RefreshCw, Repeat, Search, Trash2, Workflow } from 'lucide-react'
import type { Pipeline, RunRow } from '@shared/types'
import { actions, useStore } from '@/lib/store'
import { cn, timeAgo } from '@/lib/utils'
import { Badge } from '../../affect/badge'
import { DropdownMenu } from '../../affect/dropdown-menu'
import { EmptyState } from '../../affect/empty-state'
import { ListTable, period } from '../../affect/list-table'
import { PageHeader } from '../PageHeader'
import { ConfirmDialog } from '../ConfirmDialog'
import { PipelineEditor } from './PipelineEditor'
import { ROLE_ICON } from './roles'
import { ProviderLogo } from '../Logos'
import { providerOf } from '../ModelSelect'
import { TextField } from '../../affect/text-field'
import { Marquee } from '../Marquee'
import { t } from '@/lib/i18n'

const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 8)}`
type Tab = 'pipelines' | 'runs'

/** Pipelines: a table of all of them (and of their runs); a row opens its node diagram. */
export function PipelinesPage({ leftCollapsed, onExpandLeft }: { leftCollapsed: boolean; onExpandLeft: () => void }) {
  const pipelines = useStore((s) => s.pipelines)
  const workspaces = useStore((s) => s.workspaces)
  const [open, setOpen] = useState<string | null>(null)
  const [tab, setTab] = usePersisted<Tab>('pipelines.tab', 'pipelines')
  const [runs, setRuns] = useState<RunRow[]>([])
  const [q, setQ] = useState('')
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
    (r) => (!s || `${r.pipelineName} ${r.task ?? ''} ${r.branch} ${r.projectName}`.toLowerCase().includes(s))
  )

  const create = async (from?: Pipeline) => {
    const p: Pipeline = from
      ? { ...structuredClone(from), id: uid('p'), name: t('{name} copy', { name: from.name }), builtIn: false }
      : { id: uid('p'), name: t('New pipeline'), description: '', maxLoops: 3, nodes: [] }
    await window.cm.savePipeline(p)
    await actions.reloadPipelines()
    setOpen(p.id)
  }

  if (open) return <PipelineEditor pipelineId={open} onBack={() => setOpen(null)} onOpen={setOpen} leftCollapsed={leftCollapsed} onExpandLeft={onExpandLeft} />

  return (
    <>
      <PageHeader leftCollapsed={leftCollapsed} onExpandLeft={onExpandLeft}>
        <div className="no-drag flex h-full items-stretch gap-5">
          <TabBtn active={tab === 'pipelines'} onClick={() => setTab('pipelines')} label={t('Pipelines')} count={pipelines.length} />
          <TabBtn active={tab === 'runs'} onClick={() => setTab('runs')} label={t('Runs')} count={runs.length} />
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
              aria-label={t('Search')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={tab === 'pipelines' ? t('Search pipelines…') : t('Search runs…')}
            />
            <button onClick={load} className="grid size-8 place-items-center rounded-lg border border-line text-dim hover:text-ink" aria-label={t('Refresh')}>
              <RefreshCw size={13} />
            </button>
            <div className="flex-1" />
            {tab === 'pipelines' && (
              <button onClick={() => void create()} className="flex h-8 items-center gap-1.5 rounded-lg bg-ink px-3 text-[12.5px] font-medium text-black">
                {t('New pipeline')} <Plus size={13} />
              </button>
            )}
          </div>

          <div className="mt-4 grid grid-cols-4 gap-2.5">
            <Stat label={t('Successful · 24h')} value={stats.ok24} />
            <Stat label={t('Failed · 24h')} value={stats.ko24} bad={stats.ko24 > 0} />
            <Stat label={t('Successful · 7d')} value={stats.ok7} />
            <Stat label={t('Failed · 7d')} value={stats.ko7} bad={stats.ko7 > 0} />
          </div>

          <div className="mt-4">
            {tab === 'pipelines' ? (
              <ListTable<Pipeline>
                key="pipelines"
                rows={pipeRows}
                rowKey={(p) => p.id}
                onRowClick={(p) => setOpen(p.id)}
                rowClassName="group"
                empty={<Empty tab={tab} />}
                columns={[
                  {
                    id: 'name', label: t('Pipeline'), icon: <Workflow />, width: '26%', filter: 'text',
                    value: (p) => p.name,
                    render: (p) => (
                      <div className="min-w-0 py-1">
                        <div className="flex items-center gap-2 font-medium text-ink">
                          <Workflow size={13} className="shrink-0 text-accent" />
                          <Marquee delay={300} hoverTarget="tr">{p.name}</Marquee>
                          {p.builtIn && <span className="shrink-0 rounded bg-white/[.06] px-1 text-[10px] font-normal text-mute">{t('built-in')}</span>}
                        </div>
                        <Marquee delay={300} hoverTarget="tr" className="mt-1 text-[11.5px] text-mute">
                          <span className="flex items-center gap-1">
                            {p.nodes.map((n, i) => {
                              const Icon = ROLE_ICON[n.role]
                              return (
                                <span key={n.id} className="flex items-center gap-1">
                                  {i > 0 && <ChevronRight size={10} />}
                                  {n.model || p.model ? <ProviderLogo provider={providerOf(n.model || p.model!)} size={11} /> : <Icon size={11} />} {n.label}
                                </span>
                              )
                            })}
                            {p.nodes.length === 0 && t('No nodes yet')}
                          </span>
                        </Marquee>
                      </div>
                    )
                  },
                  { id: 'nodes', label: t('Nodes'), icon: <Boxes />, filter: 'options', value: (p) => p.nodes.length },
                  { id: 'loops', label: t('Max loops'), icon: <Repeat />, filter: 'options', value: (p) => p.maxLoops },
                  { id: 'runs', label: t('Runs'), icon: <Play />, filter: 'options', value: (p) => perPipeline.get(p.id)?.runs ?? 0 },
                  {
                    id: 'success', label: t('Success'), icon: <CircleCheck />, filter: 'options',
                    value: (p) => { const st = perPipeline.get(p.id); return st?.runs ? Math.round((st.ok / st.runs) * 100) : null },
                    filterValue: (p) => { const st = perPipeline.get(p.id); return st?.runs ? `${Math.round((st.ok / st.runs) * 100)}%` : null },
                    render: (p) => { const st = perPipeline.get(p.id); return <span className="ui-dt__text">{st?.runs ? `${Math.round((st.ok / st.runs) * 100)}%` : '—'}</span> }
                  },
                  {
                    id: 'last', label: t('Last run'), icon: <Clock />, filter: 'options',
                    value: (p) => perPipeline.get(p.id)?.last ?? null,
                    filterValue: (p) => { const l = perPipeline.get(p.id)?.last; return l ? period(l) : null },
                    render: (p) => { const l = perPipeline.get(p.id)?.last; return <span className="ui-dt__text">{l ? t('{t} ago', { t: timeAgo(l) }) : '—'}</span> }
                  },
                  {
                    id: 'actions', label: '', width: 52, stopRowClick: true,
                    render: (p) => (
                      <DropdownMenu
                        align="end"
                        width={180}
                        items={[
                          { label: t('Open diagram'), icon: <Workflow size={14} />, onSelect: () => setOpen(p.id) },
                          { label: t('Duplicate'), icon: <Copy size={14} />, onSelect: () => void create(p) },
                          ...(p.builtIn ? [] : [{ label: t('Delete'), icon: <Trash2 size={14} />, danger: true, divider: true, onSelect: () => setToDelete(p) }])
                        ]}
                        trigger={({ triggerProps }) => (
                          <button {...triggerProps} aria-label={t('Pipeline actions')} className="grid size-7 place-items-center rounded-md text-mute opacity-0 hover:bg-white/[.06] hover:text-ink group-hover:opacity-100 aria-expanded:opacity-100">
                            <MoreHorizontal size={14} />
                          </button>
                        )}
                      />
                    )
                  }
                ]}
              />
            ) : (
              <ListTable<RunRow>
                key="runs"
                rows={runRows}
                rowKey={(r) => r.runId}
                onRowClick={(r) => void actions.selectWorkspace(r.workspaceId)}
                empty={<Empty tab={tab} />}
                columns={[
                  {
                    id: 'task', label: t('Run'), icon: <AlignLeft />, width: '30%', filter: 'text',
                    value: (r) => r.task ?? '',
                    render: (r) => <Marquee delay={300} hoverTarget="tr" className="text-ink">{r.task ?? '—'}</Marquee>
                  },
                  {
                    id: 'pipeline', label: t('Pipeline'), icon: <Workflow />, width: '15%', filter: 'options', value: (r) => r.pipelineName,
                    render: (r) => <Marquee delay={300} hoverTarget="tr" className="ui-dt__text">{r.pipelineName}</Marquee>
                  },
                  {
                    id: 'status', label: t('Result'), icon: <CircleDot />, width: '16%', filter: 'options', value: (r) => r.status, optionLabel: (v) => t(v),
                    render: (r) => (
                      <Badge
                        tone={r.status === 'completed' ? 'success' : r.status === 'failed' ? 'danger' : r.status === 'running' ? 'info' : 'neutral'}
                        dot
                        live={r.status === 'running'}
                      >
                        {t(r.status)}
                      </Badge>
                    )
                  },
                  {
                    id: 'branch', label: t('Branch'), icon: <GitBranch />, width: '18%', filter: 'options', value: (r) => `${r.projectName} · ${r.branch}`,
                    render: (r) => (
                      <Marquee delay={300} hoverTarget="tr" className="font-mono text-[11.5px] text-dim">
                        <span className="text-mute">{r.projectName} · </span>{r.branch}
                      </Marquee>
                    )
                  },
                  {
                    id: 'loops', label: t('Loops'), icon: <Repeat />, width: '9%', filter: 'options', value: (r) => r.loops,
                    render: (r) => <span className={cn('tabular-nums', r.loops ? 'text-warn' : 'ui-dt__text')}>{r.loops}</span>
                  },
                  {
                    id: 'when', label: t('When'), icon: <Clock />, filter: 'options', value: (r) => r.createdAt, filterValue: (r) => period(r.createdAt),
                    render: (r) => <span className="ui-dt__text">{t('{t} ago', { t: timeAgo(r.createdAt) })}</span>
                  }
                ]}
              />
            )}
          </div>
        </div>
      </div>

      {toDelete && (
        <ConfirmDialog
          title={t('Delete pipeline "{name}"?', { name: toDelete.name })}
          danger
          confirmLabel={t('Delete')}
          onClose={() => setToDelete(null)}
          onConfirm={async () => {
            await window.cm.deletePipeline(toDelete.id)
            await actions.reloadPipelines()
          }}
        >
          {t("Past runs keep their record; this pipeline won't be offered in the composer anymore.")}
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

function Empty({ tab }: { tab: Tab }) {
  return (
    <div className="py-16">
      <EmptyState
        bare
        title={tab === 'pipelines' ? t('No pipelines match') : t('No runs yet')}
        text={tab === 'pipelines' ? t('Try another search, or create one.') : t('Runs appear here after a pipeline is run from a chat.')}
      />
    </div>
  )
}
