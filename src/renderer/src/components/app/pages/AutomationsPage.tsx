import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Check, ChevronRight, Copy, ListFilter, MoreHorizontal, Pause, Pencil, Play, Plus, RefreshCw, Search, Trash2, X, Zap } from 'lucide-react'
import { TEMPLATES, type Automation, type AutomationDraft, type AutomationRun, type RunStatus, type Step } from '@shared/automations'
import type { Project } from '@shared/types'
import { useStore } from '@/lib/store'
import { usePersisted } from '@/lib/persist'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'
import { Badge } from '../../affect/badge'
import { Button } from '../../affect/button'
import { IconButton } from '../../affect/icon-button'
import { DropdownMenu } from '../../affect/dropdown-menu'
import { EmptyState } from '../../affect/empty-state'
import { TextField } from '../../affect/text-field'
import { Dialog } from '../../affect/dialog'
import { CodeBlock } from '../../affect/code-block'
import { Card, CardContent, CardHeader } from '../../affect/card'
import { PageHeader } from '../PageHeader'
import { ConfirmDialog } from '../ConfirmDialog'
import { usePickedProject } from '../ProjectPicker'
import { Marquee } from '../Marquee'
import { ProviderLogo } from '../Logos'
import { modelLabel, providerOf } from '../ModelSelect'
import { AutomationDialog, STEP_ICON } from './AutomationDialog'
import {
  STATUS_DOT, STATUS_TONE, absolute, ago, blankDraft, duration, fromTemplate, graceLabel, nextRunLabel, projectLabel, repeatsLabel, statusLabel,
  stepKindLabel, timeoutLabel, triggerSummary, usd
} from './automationText'

type Tab = 'automations' | 'runs'
type Props = { leftCollapsed: boolean; onExpandLeft: () => void }
type Editing = { draft: AutomationDraft; automation?: Automation }
type AutoStatus = 'all' | 'active' | 'paused' | 'failing'
type RunFilter = 'all' | RunStatus

const clean = (e: any) => e?.message?.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') ?? t('Failed')
const firstPrompt = (a: { steps: Step[] }) => a.steps.find((s): s is Step & { kind: 'prompt' } => s.kind === 'prompt')

/** The agent's logo when a prompt runs; otherwise the first step's own icon. */
function AgentMark({ a, size = 14 }: { a: Automation; size?: number }) {
  const p = firstPrompt(a)
  if (p) return <ProviderLogo provider={providerOf(p.model)} size={size} />
  return <span className="text-mute">{STEP_ICON[a.steps[0]?.kind ?? 'shell']}</span>
}

/** Automations: things that start on their own (a schedule, a push, new commits) and run a few steps. */
export function AutomationsPage({ leftCollapsed, onExpandLeft }: Props) {
  const projects = useStore((s) => s.projects)
  const workspaces = useStore((s) => s.workspaces)
  const [picked] = usePickedProject()
  const [items, setItems] = useState<Automation[] | null>(null)
  const [runs, setRuns] = useState<AutomationRun[]>([])
  const [tab, setTab] = usePersisted<Tab>('automations.tab', 'automations')
  const [q, setQ] = useState('')
  const [projectFilter, setProjectFilter] = useState<string | null>(null)
  const [autoStatus, setAutoStatus] = useState<AutoStatus>('all')
  const [runStatus, setRunStatus] = useState<RunFilter>('all')
  const [open, setOpen] = useState<string | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [toDelete, setToDelete] = useState<Automation | null>(null)
  const [run, setRun] = useState<AutomationRun | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // If the engine can't answer, the page simply shows no automations.
  const load = () => {
    void window.cm.automations.list().then(setItems, () => setItems((x) => x ?? []))
    void window.cm.automations.runs(undefined, 200).then(setRuns, () => {})
  }
  useEffect(() => {
    load()
    return window.cm.onEvent((e) => e.type === 'automations' && load())
  }, [])

  const list = items ?? []
  const current = list.find((a) => a.id === open) ?? null
  const byId = useMemo(() => new Map(list.map((a) => [a.id, a])), [list])
  const projectOf = (id: string) => projectLabel(projects.find((p) => p.id === id))
  const usedProjects = projects.filter((p) => list.some((a) => a.projectId === p.id))

  const s = q.trim().toLowerCase()
  const rows = list.filter(
    (a) =>
      (!projectFilter || a.projectId === projectFilter) &&
      (autoStatus === 'all' || (autoStatus === 'active' ? a.enabled : autoStatus === 'paused' ? !a.enabled : a.lastRun?.status === 'failed')) &&
      (!s || `${a.name} ${triggerSummary(a.trigger)} ${projectOf(a.projectId)}`.toLowerCase().includes(s))
  )
  const runRows = runs.filter(
    (r) =>
      (!projectFilter || byId.get(r.automationId)?.projectId === projectFilter) &&
      (runStatus === 'all' || r.status === runStatus) &&
      (!s || `${byId.get(r.automationId)?.name ?? ''} ${r.cause} ${r.branch ?? ''}`.toLowerCase().includes(s))
  )
  const filtered = !!projectFilter || (tab === 'automations' ? autoStatus !== 'all' : runStatus !== 'all')

  const setEnabled = async (a: Automation, enabled: boolean) => {
    setItems((x) => x?.map((y) => (y.id === a.id ? { ...y, enabled } : y)) ?? null)
    try {
      await window.cm.automations.setEnabled(a.id, enabled)
    } catch (e) {
      setNotice(clean(e))
      load()
    }
  }
  const runNow = async (a: Automation) => {
    try {
      await window.cm.automations.runNow(a.id)
      load()
    } catch (e) {
      setNotice(clean(e))
    }
  }
  const create = (draft?: AutomationDraft) => setEditing({ draft: draft ?? blankDraft(picked ?? '', workspaces) })
  const edit = (a: Automation) => {
    const { projectId, name, enabled, trigger, steps, location, session, graceHours, precheck } = structuredClone(a)
    setEditing({ automation: a, draft: { projectId, name, enabled, trigger, steps, location, session, graceHours, precheck } })
  }
  const menu = (a: Automation) => [
    { label: t('Run now'), icon: <Play size={14} />, onSelect: () => void runNow(a) },
    a.enabled
      ? { label: t('Pause'), icon: <Pause size={14} />, onSelect: () => void setEnabled(a, false) }
      : { label: t('Resume'), icon: <Play size={14} />, onSelect: () => void setEnabled(a, true) },
    { label: t('Edit'), icon: <Pencil size={14} />, onSelect: () => edit(a) },
    { label: t('Delete'), icon: <Trash2 size={14} />, danger: true, divider: true, onSelect: () => setToDelete(a) }
  ]

  const statusItems =
    tab === 'automations'
      ? (['all', 'active', 'paused', 'failing'] as AutoStatus[]).map((v) => ({
          label: v === 'all' ? t('All') : v === 'active' ? t('Active') : v === 'paused' ? t('Paused') : t('Last run failed'),
          type: 'radio' as const,
          checked: autoStatus === v,
          onSelect: () => setAutoStatus(v)
        }))
      : (['all', 'running', 'success', 'failed', 'skipped'] as RunFilter[]).map((v) => ({
          label: v === 'all' ? t('All') : statusLabel(v),
          type: 'radio' as const,
          checked: runStatus === v,
          onSelect: () => setRunStatus(v)
        }))

  return (
    <>
      <PageHeader leftCollapsed={leftCollapsed} onExpandLeft={onExpandLeft}>
        {current ? (
          <>
            <nav aria-label={t('Breadcrumb')} className="no-drag flex min-w-0 items-center gap-1.5">
              <button onClick={() => setOpen(null)} className="shrink-0 text-dim hover:text-ink">
                {t('Automations')}
              </button>
              <ChevronRight size={12} className="shrink-0 text-mute" />
              <Marquee className="min-w-0 font-medium text-ink" delay={300}>{current.name}</Marquee>
            </nav>
            <div className="flex-1" />
            <div className="no-drag flex shrink-0 items-center gap-1.5">
              <Button variant="secondary" size="sm" iconRight={current.enabled ? <Pause size={13} /> : <Play size={13} />} onClick={() => void setEnabled(current, !current.enabled)}>
                {current.enabled ? t('Pause') : t('Resume')}
              </Button>
              <Button variant="secondary" size="sm" iconRight={<Pencil size={13} />} onClick={() => edit(current)}>
                {t('Edit')}
              </Button>
              <Button size="sm" iconRight={<Play size={13} />} onClick={() => void runNow(current)}>
                {t('Run now')}
              </Button>
              <DropdownMenu
                align="end"
                width={170}
                items={[{ label: t('Delete'), icon: <Trash2 size={14} />, danger: true, onSelect: () => setToDelete(current) }]}
                trigger={({ triggerProps }) => <IconButton {...triggerProps} size="sm" icon={<MoreHorizontal size={14} />} label={t('More actions')} />}
              />
            </div>
          </>
        ) : (
          <>
            <div className="no-drag flex h-full items-stretch gap-5">
              <TabBtn active={tab === 'automations'} onClick={() => setTab('automations')} label={t('Automations')} count={list.length} />
              <TabBtn active={tab === 'runs'} onClick={() => setTab('runs')} label={t('Runs')} count={runs.length} />
            </div>
            <div className="flex-1" />
            <Button className="no-drag" size="sm" iconRight={<Plus size={13} />} onClick={() => create()}>
              {t('New automation')}
            </Button>
          </>
        )}
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={cn('px-6 py-5', current ? 'mx-auto max-w-[1200px]' : '')}>
          {notice && (
            <div role="alert" className="cm-in mb-4 flex items-center gap-2 rounded-lg bg-bad/10 px-3 py-2 text-[12px] text-bad">
              <span className="selectable flex-1">{notice}</span>
              <button onClick={() => setNotice(null)} aria-label={t('Dismiss')} className="grid size-5 place-items-center rounded hover:bg-bad/10">
                <X size={12} />
              </button>
            </div>
          )}

          {current ? (
            <Detail key={current.id} a={current} project={projects.find((p) => p.id === current.projectId)} runs={runs.filter((r) => r.automationId === current.id)} onOpenRun={setRun} />
          ) : items !== null && list.length === 0 && tab === 'automations' ? (
            <Empty onCreate={() => create()} onTemplate={(id) => create(fromTemplate(TEMPLATES.find((x) => x.id === id)!, picked ?? '', workspaces))} />
          ) : (
            <>
              <div className="flex items-center gap-2">
                <TextField
                  size="sm"
                  className="w-80"
                  prefix={<Search size={13} />}
                  clearable
                  aria-label={t('Search')}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={tab === 'automations' ? t('Search automations…') : t('Search runs…')}
                />
                <DropdownMenu
                  width={220}
                  items={[
                    {
                      label: t('Project'),
                      submenu: [
                        { label: t('All projects'), type: 'radio' as const, checked: !projectFilter, onSelect: () => setProjectFilter(null) },
                        ...usedProjects.map((p) => ({ label: projectLabel(p), type: 'radio' as const, checked: projectFilter === p.id, onSelect: () => setProjectFilter(p.id) }))
                      ]
                    },
                    { label: t('Status'), submenu: statusItems }
                  ]}
                  trigger={({ triggerProps }) => (
                    <Button {...triggerProps} variant="secondary" size="sm" iconRight={<ListFilter size={13} />}>
                      {filtered ? t('Filters · on') : t('Filters')}
                    </Button>
                  )}
                />
                <IconButton variant="secondary" size="sm" icon={<RefreshCw size={13} />} label={t('Refresh')} onClick={load} />
              </div>

              <div className="mt-4 overflow-hidden rounded-xl border border-line bg-raised/40">
                {tab === 'automations' ? (
                  <>
                    <table className="w-full text-left text-[13px]">
                      <thead>
                        <tr className="border-b border-line text-[11.5px] text-mute">
                          <Th className="w-[44%]">{t('Name')}</Th>
                          <Th>{t('Project')}</Th>
                          <Th>{t('Next run')}</Th>
                          <Th>{t('Last run')}</Th>
                          <Th className="w-12" />
                        </tr>
                      </thead>
                      {(['active', 'paused'] as const).map((g) => {
                        const group = rows.filter((a) => a.enabled === (g === 'active'))
                        if (!group.length) return null
                        return (
                          <tbody key={g} className="cm-in">
                            <tr className="border-b border-line bg-white/[.015]">
                              <td colSpan={5} className="px-4 py-2 text-[12px] font-medium text-dim">
                                {g === 'active' ? t('Active · {n}', { n: group.length }) : t('Paused · {n}', { n: group.length })}
                              </td>
                            </tr>
                            {group.map((a, i) => (
                              <tr
                                key={a.id}
                                onClick={() => setOpen(a.id)}
                                className="auto-row cm-row-in group cursor-default border-b border-line hover:bg-white/[.025]"
                                style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}
                              >
                                <td className="max-w-0 px-4 py-3.5">
                                  <div className="flex items-center gap-2.5">
                                    <span className={cn('grid size-7 shrink-0 place-items-center rounded-lg border border-line bg-panel', !a.enabled && 'opacity-60')}>
                                      <AgentMark a={a} />
                                    </span>
                                    <div className="min-w-0 flex-1">
                                      <Marquee className="font-medium text-ink" delay={300} hoverTarget=".auto-row">{a.name}</Marquee>
                                      <Marquee className="mt-0.5 text-[11.5px] text-mute" delay={300} hoverTarget=".auto-row">{triggerSummary(a.trigger)}</Marquee>
                                    </div>
                                  </div>
                                </td>
                                <td className="max-w-0 px-4 text-dim">
                                  <Marquee delay={300} hoverTarget=".auto-row">{projectOf(a.projectId)}</Marquee>
                                </td>
                                <td className="whitespace-nowrap px-4 text-dim">{nextRunLabel(a)}</td>
                                <td className="whitespace-nowrap px-4 text-dim">
                                  <LastRun a={a} />
                                </td>
                                <td className="px-2" onClick={(e) => e.stopPropagation()}>
                                  <DropdownMenu
                                    align="end"
                                    width={180}
                                    items={menu(a)}
                                    trigger={({ triggerProps }) => (
                                      <button
                                        {...triggerProps}
                                        aria-label={t('Automation actions')}
                                        className="grid size-7 place-items-center rounded-md text-mute hover:bg-white/[.06] hover:text-ink aria-expanded:bg-white/[.06]"
                                      >
                                        <MoreHorizontal size={14} />
                                      </button>
                                    )}
                                  />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        )
                      })}
                    </table>
                    {items !== null && rows.length === 0 && (
                      <div className="py-16">
                        <EmptyState bare title={t('No automations match')} text={t('Try another search or filter, or create one.')} />
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <RunsTable runs={runRows} names={byId} onOpen={setRun} />
                    {runRows.length === 0 && (
                      <div className="py-16">
                        <EmptyState bare title={t('No runs yet')} text={t('Runs appear here when an automation starts.')} />
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {editing && (
        <AutomationDialog
          initial={editing.draft}
          editing={editing.automation}
          onClose={() => setEditing(null)}
          onSaved={(a) => {
            setItems((x) => (x?.some((y) => y.id === a.id) ? x.map((y) => (y.id === a.id ? a : y)) : [...(x ?? []), a]))
            load()
          }}
        />
      )}

      {toDelete && (
        <ConfirmDialog
          title={t('Delete automation "{name}"?', { name: toDelete.name })}
          danger
          confirmLabel={t('Delete')}
          onClose={() => setToDelete(null)}
          onConfirm={async () => {
            await window.cm.automations.remove(toDelete.id)
            setItems((x) => x?.filter((y) => y.id !== toDelete.id) ?? null)
            if (open === toDelete.id) setOpen(null)
          }}
        >
          {t('It stops running. Its past runs are deleted with it.')}
        </ConfirmDialog>
      )}

      {run && <RunDialog run={run} name={byId.get(run.automationId)?.name ?? t('Automation')} onClose={() => setRun(null)} />}
    </>
  )
}

/** "Never", or how long ago with a status dot. */
function LastRun({ a }: { a: Automation }) {
  if (!a.lastRun) return <span className="text-mute">{t('Never')}</span>
  return (
    <span className="flex items-center gap-1.5" title={statusLabel(a.lastRun.status)}>
      <span className={cn('size-1.5 shrink-0 rounded-full', STATUS_DOT[a.lastRun.status])} />
      {ago(a.lastRun.at)}
    </span>
  )
}

/** No automations: say what they are and offer the starting points. */
function Empty({ onCreate, onTemplate }: { onCreate: () => void; onTemplate: (id: string) => void }) {
  return (
    <div className="cm-in mx-auto max-w-[1100px]">
      <EmptyState
        icon={<Zap size={20} />}
        title={t('No automations yet')}
        text={t('Run a prompt, a pipeline or a command on a schedule, on every push or when new commits land.')}
        action={
          <Button size="sm" iconRight={<Plus size={13} />} onClick={onCreate}>
            {t('New automation')}
          </Button>
        }
      />
      <div className="mt-6 mb-2 px-1 text-[12px] font-medium text-dim">{t('Start from a template')}</div>
      <div className="grid grid-cols-2 gap-2.5">
        {TEMPLATES.map((tpl, i) => (
          <Card key={tpl.id} as="article" interactive className="cm-row-in" style={{ animationDelay: `${i * 40}ms` }}>
            <CardHeader
              icon={<Zap size={15} className="text-accent" />}
              title={
                <button type="button" onClick={() => onTemplate(tpl.id)}>
                  {t(tpl.name)}
                </button>
              }
              description={t(tpl.description)}
            />
            <CardContent>
              <span className="text-[11.5px] text-mute">{triggerSummary(tpl.draft.trigger)}</span>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

/** A bordered box with a small sentence-case label over a hairline, like Orca's cards. */
function Panel({ title, action, children, className }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('cm-in overflow-hidden rounded-xl border border-line bg-raised/40', className)}>
      <header className="flex h-10 items-center gap-2 border-b border-line px-4">
        <span className="flex-1 text-[12px] font-medium text-dim">{title}</span>
        {action}
      </header>
      <div className="px-4 py-3">{children}</div>
    </section>
  )
}

/** One automation: what it does, when, where, and how its runs went. */
function Detail({ a, project, runs, onOpenRun }: { a: Automation; project: Project | undefined; runs: AutomationRun[]; onOpenRun: (r: AutomationRun) => void }) {
  const workspaces = useStore((s) => s.workspaces)
  const models = useStore((s) => s.models)
  const pipelines = useStore((s) => s.pipelines)
  const ws = a.location.kind === 'workspace' ? workspaces.find((w) => a.location.kind === 'workspace' && w.id === a.location.workspaceId) : null
  const tr = a.trigger
  const lead = a.steps[0]?.kind === 'prompt' ? a.steps[0] : null
  const others = lead ? a.steps.slice(1) : a.steps
  const prompt = firstPrompt(a)

  return (
    <div className="cm-in">
      <div className="flex items-center gap-2.5">
        <h1 className="min-w-0 text-[24px] font-semibold tracking-[-0.01em] text-ink">
          <Marquee delay={300}>{a.name}</Marquee>
        </h1>
        <Badge tone={a.enabled ? 'success' : 'neutral'} dot>
          {a.enabled ? t('Active') : t('Paused')}
        </Badge>
      </div>
      <div className="mt-1 text-[12.5px] text-mute">
        <Marquee delay={300}>
          {triggerSummary(tr)} · {projectLabel(project)} · {t('This Mac')}
        </Marquee>
      </div>

      <div className="mt-5 grid grid-cols-3 divide-x divide-line rounded-xl border border-line bg-raised/40">
        <Tile label={t('Last run')} value={a.lastRun ? ago(a.lastRun.at) : t('Never')} sub={a.lastRun ? statusLabel(a.lastRun.status) : t('Not run yet')} dot={a.lastRun ? STATUS_DOT[a.lastRun.status] : undefined} />
        <Tile label={t('Next run')} value={nextRunLabel(a)} sub={tr.kind !== 'schedule' ? t('When it happens') : !a.enabled ? t('Paused') : a.nextRun ? absolute(a.nextRun) : '—'} />
        <Tile label={t('Est. spend')} value={a.spend > 0 ? usd(a.spend) : t('No runs')} sub={t('Model cost of all its runs')} />
      </div>

      <div className="mt-5 grid grid-cols-[minmax(0,1fr)_300px] items-start gap-4">
        <div className="flex min-w-0 flex-col gap-4">
          <Panel title={lead ? t('Prompt') : t('Steps')} action={lead && <CopyButton text={lead.text} />}>
            {lead && <p className="selectable whitespace-pre-wrap font-mono text-[12.5px] leading-5 text-ink/90">{lead.text}</p>}
            {others.length > 0 && (
              <ol className={cn('flex flex-col gap-1.5', lead && 'mt-3 border-t border-line pt-3')}>
                {others.map((st, i) => (
                  <li key={i} className="cm-row-in flex items-center gap-2.5 rounded-lg border border-line bg-panel px-3 py-2 text-[12.5px]" style={{ animationDelay: `${i * 30}ms` }}>
                    <span className="shrink-0 text-accent">{STEP_ICON[st.kind]}</span>
                    <span className="shrink-0 font-medium text-ink">{stepKindLabel(st.kind)}</span>
                    <Marquee className={cn('min-w-0 flex-1 text-dim', st.kind === 'shell' && 'font-mono text-[12px]')} delay={300}>
                      {stepText(st, pipelines)}
                    </Marquee>
                    {st.kind === 'shell' && <span className="shrink-0 text-[11.5px] text-mute">{timeoutLabel(st.timeoutSec)}</span>}
                  </li>
                ))}
              </ol>
            )}
          </Panel>

          <div className="grid grid-cols-2 gap-4">
            <Panel title={t('Schedule|trigger')}>
              <Facts
                rows={[
                  [t('Repeats'), tr.kind === 'schedule' ? repeatsLabel(tr) : triggerSummary(tr)],
                  ...(tr.kind === 'schedule' ? ([[t('Missed-run grace'), graceLabel(a.graceHours)]] as [string, ReactNode][]) : []),
                  [t('Precheck'), a.precheck.command ? <code className="font-mono text-[11.5px]">{a.precheck.command}</code> : t('None')]
                ]}
              />
            </Panel>
            <Panel title={t('Execution')}>
              <Facts
                rows={[
                  [
                    t('Agent'),
                    prompt ? (
                      <span className="flex min-w-0 items-center gap-1.5">
                        <ProviderLogo provider={providerOf(prompt.model)} size={12} />
                        <Marquee className="min-w-0" delay={300}>{modelLabel(prompt.model, models)}</Marquee>
                      </span>
                    ) : (
                      '—'
                    )
                  ],
                  [t('Host'), t('This Mac')],
                  [t('Run location'), a.location.kind === 'new' ? t('New branch each run') : <span className="font-mono text-[11.5px]">{ws?.branch ?? t('Missing branch')}</span>],
                  [t('Session'), a.session === 'fresh' ? t('Fresh each run') : t('Reuses the last one')],
                  [t('Source'), project?.owner ? <span className="font-mono text-[11.5px]">{`${project.owner}/${project.name}`}</span> : '—']
                ]}
              />
            </Panel>
          </div>
        </div>

        <Panel title={t('Recent runs')} action={<span className="text-[11.5px] tabular-nums text-mute">{runs.length}</span>}>
          {runs.length === 0 ? (
            <div className="py-6 text-center text-[12.5px] text-mute">{t('No runs yet')}</div>
          ) : (
            <ul className="-mx-2 flex flex-col">
              {runs.slice(0, 12).map((r, i) => (
                <li key={r.id} className="cm-row-in" style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}>
                  <button onClick={() => onOpenRun(r)} className="recent-run flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-white/[.04]">
                    <span className={cn('size-1.5 shrink-0 rounded-full', STATUS_DOT[r.status])} />
                    <span className="min-w-0 flex-1">
                      <Marquee className="text-[12.5px] text-ink" delay={300} hoverTarget=".recent-run">{r.cause}</Marquee>
                      <span className="mt-0.5 block text-[11.5px] text-mute">
                        {ago(r.startedAt)} · {statusLabel(r.status)}
                      </span>
                    </span>
                    <span className="shrink-0 text-[11.5px] tabular-nums text-mute">{duration(r.startedAt, r.endedAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  )
}

function stepText(st: Step, pipelines: { id: string; name: string }[]): string {
  if (st.kind === 'shell') return st.command
  if (st.kind === 'pipeline') return [pipelines.find((p) => p.id === st.pipelineId)?.name ?? t('Missing pipeline'), st.text].filter(Boolean).join(' · ')
  if (st.kind === 'pr_comment') return st.text.trim() || t('The previous step’s output')
  return st.text
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <IconButton
      size="sm"
      icon={done ? <Check size={13} /> : <Copy size={13} />}
      label={done ? t('Copied') : t('Copy prompt')}
      onClick={() => {
        void navigator.clipboard.writeText(text)
        setDone(true)
        setTimeout(() => setDone(false), 1400)
      }}
    />
  )
}

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="flex flex-col gap-2.5 text-[12.5px]">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-baseline gap-3">
          <dt className="w-28 shrink-0 text-mute">{k}</dt>
          <dd className="min-w-0 flex-1 break-words text-ink/90">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function Tile({ label, value, sub, dot }: { label: string; value: string; sub: string; dot?: string }) {
  return (
    <div className="min-w-0 px-4 py-3.5">
      <div className="text-[11.5px] text-mute">{label}</div>
      <div className="mt-1 flex items-center gap-2 text-[18px] font-semibold tabular-nums text-ink">
        {dot && <span className={cn('size-2 shrink-0 rounded-full', dot)} />}
        {value}
      </div>
      <div className="mt-1 text-[11.5px] text-mute">
        <Marquee delay={300}>{sub}</Marquee>
      </div>
    </div>
  )
}

function RunsTable({ runs, names, onOpen }: { runs: AutomationRun[]; names: Map<string, Automation>; onOpen: (r: AutomationRun) => void }) {
  if (!runs.length) return null
  return (
    <table className="w-full text-left text-[13px]">
      <thead>
        <tr className="border-b border-line text-[11.5px] text-mute">
          <Th className="w-[26%]">{t('Automation')}</Th>
          <Th className="w-[26%]">{t('Cause')}</Th>
          <Th>{t('Status')}</Th>
          <Th>{t('Started')}</Th>
          <Th>{t('Duration')}</Th>
          <Th>{t('Branch')}</Th>
        </tr>
      </thead>
      <tbody>
        {runs.map((r, i) => (
          <tr
            key={r.id}
            onClick={() => onOpen(r)}
            className="run-row cm-row-in cursor-default border-b border-line last:border-0 hover:bg-white/[.025]"
            style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}
          >
            <td className="max-w-0 px-4 py-3.5 font-medium text-ink">
              <Marquee delay={300} hoverTarget=".run-row">{names.get(r.automationId)?.name ?? t('Deleted automation')}</Marquee>
            </td>
            <td className="max-w-0 px-4 text-dim">
              <Marquee delay={300} hoverTarget=".run-row">{r.cause}</Marquee>
            </td>
            <td className="px-4">
              <Badge tone={STATUS_TONE[r.status]} dot live={r.status === 'running'}>
                {statusLabel(r.status)}
              </Badge>
            </td>
            <td className="whitespace-nowrap px-4 text-dim">{ago(r.startedAt)}</td>
            <td className="whitespace-nowrap px-4 tabular-nums text-dim">{duration(r.startedAt, r.endedAt)}</td>
            <td className="max-w-0 px-4 font-mono text-[11.5px] text-dim">
              <Marquee delay={300} hoverTarget=".run-row">{r.branch ?? '—'}</Marquee>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** One run: its steps in order, each with what it printed. */
function RunDialog({ run, name, onClose }: { run: AutomationRun; name: string; onClose: () => void }) {
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title={
        <span className="flex items-center gap-2">
          <span className="min-w-0">{name}</span>
          <Badge tone={STATUS_TONE[run.status]} dot live={run.status === 'running'}>
            {statusLabel(run.status)}
          </Badge>
        </span>
      }
      description={
        <span className="flex flex-wrap items-center gap-x-1.5">
          {run.cause} · {absolute(run.startedAt)} · {duration(run.startedAt, run.endedAt)}
          {run.branch && <span className="font-mono">· {run.branch}</span>}
          {run.cost > 0 && <span>· {usd(run.cost)}</span>}
        </span>
      }
    >
      {run.error && <div className="selectable mb-3 rounded-lg bg-bad/10 px-3 py-2 text-[12px] text-bad">{run.error}</div>}
      {run.steps.length === 0 ? (
        <div className="py-6 text-center text-[12.5px] text-mute">{run.status === 'skipped' ? t('Skipped by the precheck: no step ran.') : t('No step has run yet.')}</div>
      ) : (
        <ol className="flex flex-col gap-3">
          {run.steps.map((st, i) => (
            <li key={i} className="cm-row-in" style={{ animationDelay: `${i * 40}ms` }}>
              <div className="mb-1.5 flex items-center gap-2 text-[12.5px]">
                <span className="grid size-5 place-items-center rounded-md bg-white/[.06] text-[11px] tabular-nums text-dim">{i + 1}</span>
                <span className="text-accent">{STEP_ICON[st.kind]}</span>
                <span className="flex-1 font-medium text-ink">{stepKindLabel(st.kind)}</span>
                <Badge tone={STATUS_TONE[st.status]} dot live={st.status === 'running'}>
                  {statusLabel(st.status)}
                </Badge>
              </div>
              {st.output ? <CodeBlock code={st.output} language="console" wrap maxHeight={260} copyable /> : <div className="pl-7 text-[12px] text-mute">{t('No output')}</div>}
            </li>
          ))}
        </ol>
      )}
    </Dialog>
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

function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={cn('px-4 py-2.5 font-medium', className)}>{children}</th>
}
