import { useEffect, useState } from 'react'
import { AtSign, BarChart3, Bot, Check, CircleDot, Clock, FolderGit2, Hash, Repeat, RotateCw, Scale, Trash2, Type, X } from 'lucide-react'
import type { AgentSuggestion, GlobalBrain, GlobalRule, ProgressWeek, ProjectProgress, RecurringWork } from '@shared/learning'
import { cn, timeAgoLabel } from '@/lib/utils'
import { t } from '@/lib/i18n'
import { SegmentedControl } from '../../affect/segmented-control'
import { Button } from '../../affect/button'
import { EmptyState } from '../../affect/empty-state'
import { DataTable } from '../../affect/data-table'
import { NoteTray } from '../../affect/decision-inbox'
import { Spinner } from '../../affect/spinner'
import { ConfirmDialog } from '../ConfirmDialog'
import { KindIcon } from '../LearningPanel'
import { usePersisted } from '@/lib/persist'

type Tab = 'rules' | 'agents' | 'progress'

/** The brain across every project: rules for all of them, agents for work that comes back, progress over time. */
export function BrainAll({ toolbar }: { toolbar: (right: React.ReactNode, tabs: React.ReactNode) => React.ReactNode }) {
  const [state, setState] = useState<GlobalBrain | null>(null)
  const [tab, setTab] = usePersisted<Tab>('brain.allTab', 'rules')
  const [removing, setRemoving] = useState<GlobalRule | null>(null)
  const load = () => void window.cm.brainAll.state().then(setState)
  useEffect(() => {
    load()
    return window.cm.onEvent((e) => e.type === 'global-brain' && load())
  }, [])

  const proposedRules = state?.rules.filter((r) => r.status === 'proposed') ?? []
  const rules = state?.rules.filter((r) => r.status !== 'proposed') ?? []
  const agents = state?.agents ?? []

  const tabs = (
    <SegmentedControl
      size="sm"
      value={tab}
      onChange={setTab}
      aria-label={t('Section')}
      options={[
        { value: 'rules', label: t('Rules'), count: state?.rules.length ?? 0 },
        { value: 'agents', label: t('Agents'), count: agents.length },
        { value: 'progress', label: t('Progress') }
      ]}
    />
  )
  const right = (
    <>
      {state?.sweepAt && !state.sweeping && <span className="text-[12px] text-mute">{t('Last look: {t}', { t: timeAgoLabel(new Date(state.sweepAt).toISOString()) })}</span>}
      <Button size="sm" variant="secondary" loading={!!state?.sweeping} iconRight={<RotateCw size={13} />} onClick={() => void window.cm.brainAll.sweep()}>
        {t('Look across projects')}
      </Button>
    </>
  )

  return (
    <>
      {toolbar(right, tabs)}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        {!state ? (
          <div className="grid place-items-center py-14"><Spinner size={16} /></div>
        ) : (
          <>
            {state.error && <p className="mb-3 text-[12.5px] text-bad">{t("The last look didn't finish: {error}", { error: state.error })}</p>}
            {tab === 'rules' && (
              <>
                {proposedRules.length > 0 && (
                  <div className="mb-4 grid gap-3 md:grid-cols-2">
                    {proposedRules.map((r) => <RuleProposal key={r.id} r={r} />)}
                  </div>
                )}
                <RulesTable rules={rules} onRemove={setRemoving} />
              </>
            )}
            {tab === 'agents' &&
              (agents.length ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {agents.map((a) => <AgentProposal key={a.id} a={a} />)}
                </div>
              ) : (
                <div className="py-14">
                  <EmptyState bare icon={<Bot size={16} />} title={t('No agents to propose')} text={t('When the same kind of work comes back (two landing pages, say), an expert agent with your rules for it shows up here.')} />
                </div>
              ))}
            {tab === 'progress' && <Progress weeks={state.weeks} projects={state.projects} work={state.work} />}
          </>
        )}
      </div>
      {removing && (
        <ConfirmDialog
          title={t('Delete this rule?')}
          confirmLabel={t('Delete')}
          danger
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await window.cm.brainAll.removeRule(removing.id)
            setRemoving(null)
          }}
        >
          {t('“{title}” stops guiding the agent in every project and is removed for good.', { title: removing.title })}
        </ConfirmDialog>
      )}
    </>
  )
}

function RuleProposal({ r }: { r: GlobalRule }) {
  return (
    <NoteTray
      icon={<Scale size={16} />}
      label={t('A rule for every project?')}
      color="#60a5fa"
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <span className="mr-auto min-w-0 truncate text-[11.5px] text-mute">{r.projects.join(' · ')}</span>
          <Button size="sm" variant="secondary" iconRight={<X size={13} />} onClick={() => void window.cm.brainAll.decideRule(r.id, false)}>
            {t('Discard')}
          </Button>
          <Button size="sm" iconRight={<Check size={13} />} onClick={() => void window.cm.brainAll.decideRule(r.id, true)}>
            {t('Keep')}
          </Button>
        </div>
      }
    >
      {r.title}
    </NoteTray>
  )
}

function AgentProposal({ a }: { a: AgentSuggestion }) {
  const [busy, setBusy] = useState(false)
  const decide = async (keep: boolean) => {
    setBusy(true)
    await window.cm.brainAll.decideAgent(a.id, keep).finally(() => setBusy(false))
  }
  return (
    <NoteTray
      icon={<Bot size={16} />}
      label={t('Create @{handle}?', { handle: a.handle })}
      color="#c4b5fd"
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <span className="mr-auto min-w-0 truncate text-[11.5px] text-mute">{a.projects.join(' · ')}</span>
          <Button size="sm" variant="secondary" iconRight={<X size={13} />} disabled={busy} onClick={() => void decide(false)}>
            {t('Discard')}
          </Button>
          <Button size="sm" iconRight={<Check size={13} />} loading={busy} onClick={() => void decide(true)}>
            {t('Create agent')}
          </Button>
        </div>
      }
    >
      <div className="font-medium text-ink">{a.name}</div>
      {a.description && <p className="mt-1 text-dim">{a.description}</p>}
      {a.rules.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-4 text-dim">
          {a.rules.map((r) => <li key={r}>{r}</li>)}
        </ul>
      )}
      {a.evidence.length > 0 && <p className="mt-2 text-[11.5px] text-mute">{a.evidence.join(' · ')}</p>}
    </NoteTray>
  )
}

function RulesTable({ rules, onRemove }: { rules: GlobalRule[]; onRemove: (r: GlobalRule) => void }) {
  return (
    <DataTable<GlobalRule>
      rows={rules}
      rowKey={(r) => r.id}
      rowClassName="group"
      empty={
        <div className="py-14">
          <EmptyState bare title={t('No rules for every project yet')} text={t('When the same lesson comes up in two projects, it is proposed here as a rule for all of them.')} />
        </div>
      }
      columns={[
        {
          id: 'title', label: t('Rule'), icon: <Type />, filter: 'text', wrap: true, value: (r) => r.title,
          render: (r) => (
            <div className={cn('flex items-start gap-2', r.status === 'retired' ? 'text-mute' : 'text-ink')}>
              <span className="mt-px"><KindIcon kind={r.kind} /></span>
              <span className="line-clamp-2 font-medium">{r.title}</span>
            </div>
          )
        },
        {
          id: 'projects', label: t('Projects'), icon: <FolderGit2 />, width: 220, filter: 'text', wrap: true, value: (r) => r.projects.join(', '),
          render: (r) => <span className="line-clamp-2 text-dim">{r.projects.join(' · ') || '—'}</span>
        },
        {
          id: 'status', label: t('Status'), icon: <CircleDot />, width: 120, filter: 'options', value: (r) => (r.status === 'retired' ? t('Retired') : t('In use')),
          render: (r) => <span className={cn('rounded-md px-1.5 py-0.5 text-[11px]', r.status === 'retired' ? 'bg-white/[.06] text-mute' : 'bg-ok/12 text-ok')}>{r.status === 'retired' ? t('Retired') : t('In use')}</span>
        },
        {
          id: 'added', label: t('Added'), icon: <Clock />, width: 120, value: (r) => r.at,
          render: (r) => <span className="text-mute">{timeAgoLabel(new Date(r.at).toISOString())}</span>
        },
        {
          id: 'actions', label: '', width: 84, stopRowClick: true,
          render: (r) => (
            <div className="flex justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                onClick={() => void window.cm.brainAll.setRuleStatus(r.id, r.status === 'retired' ? 'active' : 'retired')}
                aria-label={r.status === 'retired' ? t('Use again') : t('Stop using')}
                title={r.status === 'retired' ? t('Use again') : t('Stop using')}
                className="grid size-7 place-items-center rounded-md text-mute hover:bg-white/[.06] hover:text-ink"
              >
                <Repeat size={13} />
              </button>
              <button onClick={() => onRemove(r)} aria-label={t('Delete')} className="grid size-7 place-items-center rounded-md text-mute hover:bg-bad/10 hover:text-bad">
                <Trash2 size={13} />
              </button>
            </div>
          )
        }
      ]}
    />
  )
}

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—')

function Progress({ weeks, projects, work }: { weeks: ProgressWeek[]; projects: ProjectProgress[]; work: RecurringWork[] }) {
  const fmtWeek = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-2 text-[12.5px] font-medium text-ink">{t('Work that comes back')}</h3>
        <DataTable<RecurringWork>
          rows={work}
          rowKey={(w) => w.label}
          empty={<div className="py-8"><EmptyState bare title={t('Nothing repeats yet')} text={t('Look across projects to find the work you do again and again.')} /></div>}
          columns={[
            { id: 'label', label: t('Work'), icon: <Type />, value: (w) => w.label, render: (w) => <span className="font-medium text-ink">{w.label}</span> },
            { id: 'count', label: t('Times'), icon: <Hash />, width: 100, value: (w) => w.count, render: (w) => <span className="text-dim">{w.count}</span> },
            { id: 'projects', label: t('Projects'), icon: <FolderGit2 />, wrap: true, value: (w) => w.projects.join(', '), render: (w) => <span className="text-dim">{w.projects.join(' · ')}</span> }
          ]}
        />
      </section>
      <section>
        <h3 className="mb-2 text-[12.5px] font-medium text-ink">{t('Week by week')}</h3>
        <DataTable<ProgressWeek>
          rows={[...weeks].reverse()}
          rowKey={(w) => String(w.week)}
          empty={<div className="py-8"><EmptyState bare icon={<BarChart3 size={16} />} title={t('No runs reviewed yet')} text={t('Turn on auto-learning in your projects: every run reviewed counts here.')} /></div>}
          columns={[
            { id: 'week', label: t('Week of'), icon: <Clock />, width: 140, value: (w) => w.week, render: (w) => <span className="text-ink">{fmtWeek(w.week)}</span> },
            { id: 'runs', label: t('Runs'), icon: <Hash />, value: (w) => w.runs, render: (w) => <span className="text-dim">{w.runs}</span> },
            { id: 'success', label: t('Went well'), icon: <Check />, value: (w) => w.success, render: (w) => <span className="text-ok">{w.success} <span className="text-mute">({pct(w.success, w.runs)})</span></span> },
            { id: 'partial', label: t('Partly'), icon: <CircleDot />, value: (w) => w.partial, render: (w) => <span className="text-warn">{w.partial}</span> },
            { id: 'failed', label: t('Failed'), icon: <X />, value: (w) => w.failed, render: (w) => <span className="text-bad">{w.failed}</span> }
          ]}
        />
      </section>
      <section>
        <h3 className="mb-2 text-[12.5px] font-medium text-ink">{t('By project')}</h3>
        <DataTable<ProjectProgress>
          rows={projects.filter((p) => p.runs > 0)}
          rowKey={(p) => p.projectId}
          empty={<div className="py-8"><EmptyState bare title={t('No runs reviewed yet')} text={t('Turn on auto-learning in your projects: every run reviewed counts here.')} /></div>}
          columns={[
            { id: 'name', label: t('Project'), icon: <AtSign />, filter: 'text', value: (p) => p.name, render: (p) => <span className="font-medium text-ink">{p.name}</span> },
            { id: 'runs', label: t('Runs'), icon: <Hash />, width: 110, value: (p) => p.runs, render: (p) => <span className="text-dim">{p.runs}</span> },
            { id: 'success', label: t('Went well'), icon: <Check />, width: 130, value: (p) => (p.runs ? p.success / p.runs : 0), render: (p) => <span className="text-ok">{pct(p.success, p.runs)}</span> },
            { id: 'lessons', label: t('Lessons'), icon: <Repeat />, width: 110, value: (p) => p.lessons, render: (p) => <span className="text-dim">{p.lessons}</span> },
            { id: 'last', label: t('Last run'), icon: <Clock />, width: 140, value: (p) => p.last ?? 0, render: (p) => <span className="text-mute">{p.last ? timeAgoLabel(new Date(p.last).toISOString()) : '—'}</span> }
          ]}
        />
      </section>
    </div>
  )
}
