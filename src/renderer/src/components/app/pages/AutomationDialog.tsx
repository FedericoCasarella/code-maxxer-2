import { useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, Check, LayoutTemplate, MessageSquare, MessageSquareText, Plus, SquareTerminal, Trash2, Workflow, Zap } from 'lucide-react'
import { TEMPLATES, type Automation, type AutomationDraft, type ScheduleKind, type Step, type Trigger } from '@shared/automations'
import { useStore } from '@/lib/store'
import { t } from '@/lib/i18n'
import { Dialog } from '../../affect/dialog'
import { Button } from '../../affect/button'
import { IconButton } from '../../affect/icon-button'
import { TextField } from '../../affect/text-field'
import { TextArea } from '../../affect/text-area'
import { Select } from '../../affect/select'
import { SegmentedControl } from '../../affect/segmented-control'
import { Switch } from '../../affect/switch'
import { ToggleGroup } from '../../affect/toggle-group'
import { TimePicker } from '../../affect/time-picker'
import { DropdownMenu } from '../../affect/dropdown-menu'
import { ProjectPicker } from '../ProjectPicker'
import { ModelSelect } from '../ModelSelect'
import { DEFAULT_MODEL, WEEK, dayName, fromTemplate, graceLabel, stepKindLabel, timeoutLabel } from './automationText'

const STEP_ICON: Record<Step['kind'], ReactNode> = {
  prompt: <MessageSquare size={13} />,
  pipeline: <Workflow size={13} />,
  shell: <SquareTerminal size={13} />,
  pr_comment: <MessageSquareText size={13} />
}
const GRACE = [0, 1, 6, 12, 24]
const STEP_TIMEOUTS = [30, 60, 300, 600, 1800, 3600]
const PRECHECK_TIMEOUTS = [15, 30, 60, 120, 300]
const pad = (n: number) => String(n).padStart(2, '0')

type Row = { key: string; step: Step }
let seq = 0
const keyed = (steps: Step[]): Row[] => steps.map((step) => ({ key: `s${++seq}`, step }))

/**
 * Create or edit an automation: title and steps on the left, where / when it runs on the right.
 * "Use template" fills everything from one of the starting points.
 */
export function AutomationDialog({
  initial, editing, onClose, onSaved
}: { initial: AutomationDraft; editing?: Automation; onClose: () => void; onSaved: (a: Automation) => void }) {
  const workspaces = useStore((s) => s.workspaces)
  const [d, setD] = useState<AutomationDraft>(initial)
  const [rows, setRows] = useState<Row[]>(() => keyed(initial.steps))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  const patch = (p: Partial<AutomationDraft>) => setD((x) => ({ ...x, ...p }))
  const branches = workspaces.filter((w) => w.projectId === d.projectId)
  const tr = d.trigger

  const setProject = (projectId: string | null) => {
    if (!projectId) return
    const ws = workspaces.find((w) => w.projectId === projectId)
    patch({ projectId, location: d.location.kind === 'workspace' && ws ? { kind: 'workspace', workspaceId: ws.id } : { kind: 'new' } })
  }
  const setTrigger = (kind: Trigger['kind']) => {
    if (kind === tr.kind) return
    patch({
      trigger: kind === 'schedule' ? { kind, every: 'daily', hour: 9, minute: 0 } : { kind, branches: tr.kind === 'schedule' ? '*' : tr.branches }
    })
  }
  const setSchedule = (p: Partial<Trigger & { kind: 'schedule' }>) => tr.kind === 'schedule' && patch({ trigger: { ...tr, ...p } })

  const applyTemplate = (id: string) => {
    const tpl = TEMPLATES.find((x) => x.id === id)
    if (!tpl || !d.projectId) return
    const next = fromTemplate(tpl, d.projectId, workspaces)
    setD(next)
    setRows(keyed(next.steps))
  }

  const setStep = (key: string, step: Step) => setRows((r) => r.map((x) => (x.key === key ? { ...x, step } : x)))
  const move = (i: number, by: number) =>
    setRows((r) => {
      const next = [...r]
      const [x] = next.splice(i, 1)
      next.splice(i + by, 0, x)
      return next
    })
  const add = (kind: Step['kind']) => {
    const step: Step =
      kind === 'prompt'
        ? { kind, text: '', model: DEFAULT_MODEL, effort: 'medium', fullAccess: true }
        : kind === 'pipeline'
          ? { kind, pipelineId: '', text: '', model: '' }
          : kind === 'shell'
            ? { kind, command: '', timeoutSec: 600 }
            : { kind, text: '' }
    setRows((r) => [...r, ...keyed([step])])
  }

  const problem = useMemo(() => {
    if (!d.name.trim()) return t('Give it a name')
    if (!d.projectId) return t('Pick a project')
    if (d.location.kind === 'workspace' && !branches.some((w) => d.location.kind === 'workspace' && w.id === d.location.workspaceId)) return t('Pick a branch')
    if (!rows.length) return t('Add at least one step')
    for (const { step } of rows) {
      if (step.kind === 'prompt' && !step.text.trim()) return t('A prompt step is empty')
      if (step.kind === 'pipeline' && !step.pipelineId) return t('Pick a pipeline')
      if (step.kind === 'shell' && !step.command.trim()) return t('A shell step has no command')
    }
    if (tr.kind === 'schedule' && tr.every === 'weekly' && !tr.days?.length) return t('Pick at least one day')
    return null
  }, [d, rows, branches, tr])

  const save = async () => {
    if (problem) return
    setSaving(true)
    setError(null)
    try {
      const trigger: Trigger = tr.kind === 'schedule' ? tr : { ...tr, branches: tr.branches.trim() || '*' }
      const saved = await window.cm.automations.save({ ...d, name: d.name.trim(), trigger, steps: rows.map((r) => r.step) }, editing?.id)
      onSaved(saved)
      onClose()
    } catch (e: any) {
      setError(e?.message?.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') ?? t('Failed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      width={980}
      initialFocus={nameRef}
      title={
        <span className="flex items-center gap-2">
          <Zap size={15} className="text-accent" />
          <span className="flex-1">{editing ? t('Edit automation') : t('New automation')}</span>
          <DropdownMenu
            align="end"
            width={280}
            items={TEMPLATES.map((tpl) => ({ label: t(tpl.name), description: t(tpl.description), onSelect: () => applyTemplate(tpl.id) }))}
            trigger={({ triggerProps }) => (
              <Button {...triggerProps} variant="ghost" size="sm" iconRight={<LayoutTemplate size={13} />}>
                {t('Use template')}
              </Button>
            )}
          />
        </span>
      }
      footer={
        <>
          <span className="mr-auto text-[12px] text-mute">{problem ?? t('Once saved, runs automatically until paused.')}</span>
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button size="sm" loading={saving} disabled={!!problem} iconRight={editing ? <Check size={13} /> : <Plus size={13} />} onClick={() => void save()}>
            {editing ? t('Save') : t('Create')}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-[minmax(0,1fr)_280px] gap-6">
        {/* left: title and steps */}
        <div className="min-w-0">
          <TextField ref={nameRef} label={t('Name')} placeholder={t('Weekday repo audit')} value={d.name} onChange={(e) => patch({ name: e.target.value })} />

          <div className="mt-5 flex items-center gap-2">
            <span className="text-[12.5px] font-medium text-dim">{t('Steps')}</span>
            <span className="text-[11.5px] tabular-nums text-mute">{rows.length}</span>
            <div className="flex-1" />
            <DropdownMenu
              align="end"
              width={200}
              items={(['prompt', 'pipeline', 'shell', 'pr_comment'] as Step['kind'][]).map((k) => ({ label: stepKindLabel(k), icon: STEP_ICON[k], onSelect: () => add(k) }))}
              trigger={({ triggerProps }) => (
                <Button {...triggerProps} variant="secondary" size="sm" iconRight={<Plus size={13} />}>
                  {t('Add step|automation')}
                </Button>
              )}
            />
          </div>

          <ol className="mt-2.5 flex flex-col gap-2">
            {rows.map((r, i) => (
              <li key={r.key} className="cm-row-in rounded-xl border border-line bg-panel">
                <div className="flex items-center gap-2 border-b border-line px-3 py-1.5">
                  <span className="grid size-5 place-items-center rounded-md bg-white/[.06] text-[11px] tabular-nums text-dim">{i + 1}</span>
                  <span className="text-accent">{STEP_ICON[r.step.kind]}</span>
                  <span className="flex-1 text-[12.5px] font-medium text-ink">{stepKindLabel(r.step.kind)}</span>
                  <IconButton size="sm" icon={<ArrowUp size={13} />} label={t('Move up')} disabled={i === 0} onClick={() => move(i, -1)} />
                  <IconButton size="sm" icon={<ArrowDown size={13} />} label={t('Move down')} disabled={i === rows.length - 1} onClick={() => move(i, 1)} />
                  <IconButton size="sm" icon={<Trash2 size={13} />} label={t('Remove step|automation')} onClick={() => setRows((x) => x.filter((y) => y.key !== r.key))} />
                </div>
                <div className="p-3">
                  <StepEditor step={r.step} onChange={(s) => setStep(r.key, s)} />
                </div>
              </li>
            ))}
          </ol>
          {rows.length === 0 && <div className="mt-2.5 rounded-xl border border-dashed border-line px-4 py-6 text-center text-[12.5px] text-mute">{t('No steps yet: add one above.')}</div>}
          <p className="mt-2.5 text-[11.5px] text-mute">{t('{{branch}}, {{commit}}, {{output}} are filled in when it runs.')}</p>
        </div>

        {/* right: settings */}
        <div className="flex min-w-0 flex-col gap-4 border-l border-line pl-6">
          <Setting label={t('Project')}>
            <ProjectPicker value={d.projectId || null} onChange={setProject} className="w-full" />
          </Setting>

          <Setting label={t('Where it runs')}>
            <SegmentedControl
              size="sm"
              fullWidth
              value={d.location.kind}
              onChange={(v) => patch({ location: v === 'new' ? { kind: 'new' } : { kind: 'workspace', workspaceId: branches[0]?.id ?? '' } })}
              options={[
                { value: 'workspace', label: t('Branch') },
                { value: 'new', label: t('New branch|each run') }
              ]}
            />
            {d.location.kind === 'workspace' && (
              <Select
                className="mt-2"
                size="sm"
                placeholder={branches.length ? t('Pick a branch') : t('No branches in this project yet')}
                disabled={!branches.length}
                value={d.location.workspaceId || null}
                options={branches.map((w) => ({ value: w.id, label: w.branch, description: w.name }))}
                onChange={(v) => patch({ location: { kind: 'workspace', workspaceId: v } })}
              />
            )}
          </Setting>

          <Setting label={t('Session')}>
            <SegmentedControl
              size="sm"
              fullWidth
              value={d.session}
              onChange={(v) => patch({ session: v })}
              options={[
                { value: 'fresh', label: t('Fresh') },
                { value: 'reuse', label: t('Reuse') }
              ]}
            />
          </Setting>

          <Setting label={t('Trigger')}>
            <SegmentedControl
              size="sm"
              fullWidth
              value={tr.kind}
              onChange={setTrigger}
              options={[
                { value: 'schedule', label: t('Schedule|trigger') },
                { value: 'push', label: t('Push') },
                { value: 'commit', label: t('Commits|trigger') }
              ]}
            />
            {tr.kind === 'schedule' ? (
              <div className="cm-in mt-2 flex flex-col gap-2">
                <div className="grid grid-cols-[1fr_110px] gap-2">
                  <Select
                    size="sm"
                    aria-label={t('Repeats')}
                    value={tr.every}
                    options={[
                      { value: 'hourly', label: t('Hourly') },
                      { value: 'daily', label: t('Daily') },
                      { value: 'weekdays', label: t('Weekdays') },
                      { value: 'weekly', label: t('Weekly') }
                    ]}
                    onChange={(v) => setSchedule({ every: v as ScheduleKind, days: v === 'weekly' ? tr.days?.length ? tr.days : [1] : undefined })}
                  />
                  {tr.every === 'hourly' ? (
                    <Select
                      size="sm"
                      aria-label={t('Minute')}
                      value={String(tr.minute)}
                      options={[0, 15, 30, 45].map((m) => ({ value: String(m), label: `:${pad(m)}` }))}
                      onChange={(v) => setSchedule({ minute: Number(v) })}
                    />
                  ) : (
                    <TimePicker
                      size="sm"
                      hourCycle={24}
                      step={15}
                      value={`${pad(tr.hour)}:${pad(tr.minute)}`}
                      onChange={(v) => {
                        if (!v) return
                        const [h, m] = v.split(':').map(Number)
                        setSchedule({ hour: h, minute: m })
                      }}
                    />
                  )}
                </div>
                {tr.every === 'weekly' && (
                  <ToggleGroup
                    size="sm"
                    items={WEEK.map((n) => ({ value: String(n), label: dayName(n, 'narrow'), ariaLabel: dayName(n) }))}
                    value={(tr.days ?? []).map(String)}
                    onChange={(v) => setSchedule({ days: v.map(Number) })}
                  />
                )}
              </div>
            ) : (
              <TextField
                className="cm-in mt-2"
                size="sm"
                aria-label={t('Branches')}
                inputClassName="font-mono"
                value={tr.branches}
                placeholder="*"
                onChange={(e) => patch({ trigger: { ...tr, branches: e.target.value } })}
                hint={t('* is every branch; separate several with commas.')}
              />
            )}
          </Setting>

          {tr.kind === 'schedule' && (
            <Setting label={t('Missed-run grace')}>
              <Select
                size="sm"
                value={String(d.graceHours)}
                options={GRACE.map((h) => ({ value: String(h), label: graceLabel(h) }))}
                onChange={(v) => patch({ graceHours: Number(v) })}
                hint={t('A run missed while the app was closed still starts within this time.')}
              />
            </Setting>
          )}

          <Setting label={t('Precheck')}>
            <TextField
              size="sm"
              inputClassName="font-mono"
              placeholder={t('None')}
              value={d.precheck.command}
              onChange={(e) => patch({ precheck: { ...d.precheck, command: e.target.value } })}
              hint={t('Runs first; a failure or empty output skips the run.')}
            />
            {d.precheck.command.trim() && (
              <Select
                className="cm-in mt-2"
                size="sm"
                aria-label={t('Precheck timeout')}
                value={String(d.precheck.timeoutSec)}
                options={PRECHECK_TIMEOUTS.map((s) => ({ value: String(s), label: t('Timeout {t}', { t: timeoutLabel(s) }) }))}
                onChange={(v) => patch({ precheck: { ...d.precheck, timeoutSec: Number(v) } })}
              />
            )}
          </Setting>
        </div>
      </div>
      {error && <div className="selectable cm-in mt-4 rounded-lg bg-bad/10 px-3 py-2 text-[12px] text-bad">{error}</div>}
    </Dialog>
  )
}

function Setting({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[12px] font-medium text-dim">{label}</div>
      {children}
    </div>
  )
}

/** The fields of one step. */
function StepEditor({ step, onChange }: { step: Step; onChange: (s: Step) => void }) {
  const pipelines = useStore((s) => s.pipelines)
  if (step.kind === 'prompt')
    return (
      <>
        <TextArea
          aria-label={t('Prompt')}
          minRows={3}
          maxRows={10}
          placeholder={t('What should the agent do?')}
          value={step.text}
          onChange={(e) => onChange({ ...step, text: e.target.value })}
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <ModelSelect trigger="field" side="bottom" align="start" value={step.model} onChange={(m) => onChange({ ...step, model: m ?? DEFAULT_MODEL })} className="w-52" />
          <Select
            size="sm"
            className="w-44"
            aria-label={t('Effort')}
            value={step.effort}
            options={[
              { value: 'low', label: t('Low effort') },
              { value: 'medium', label: t('Medium effort') },
              { value: 'high', label: t('High effort') }
            ]}
            onChange={(v) => onChange({ ...step, effort: v as 'low' | 'medium' | 'high' })}
          />
          <div className="flex-1" />
          <Switch size="sm" label={t('Full access')} checked={step.fullAccess} onChange={(e) => onChange({ ...step, fullAccess: e.target.checked })} />
        </div>
      </>
    )
  if (step.kind === 'pipeline')
    return (
      <>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            size="sm"
            className="min-w-0 flex-1"
            aria-label={t('Pipeline')}
            placeholder={pipelines.length ? t('Pick a pipeline') : t('No pipelines yet')}
            value={step.pipelineId || null}
            options={pipelines.map((p) => ({ value: p.id, label: p.name, description: p.description || undefined }))}
            onChange={(v) => onChange({ ...step, pipelineId: v })}
          />
          <ModelSelect
            trigger="field"
            side="bottom"
            align="start"
            allowInherit
            inheritLabel={t('Pipeline model')}
            value={step.model || null}
            onChange={(m) => onChange({ ...step, model: m ?? '' })}
            className="w-52"
          />
        </div>
        <TextArea
          className="mt-2"
          aria-label={t('Task')}
          minRows={2}
          maxRows={8}
          placeholder={t('The task for the pipeline')}
          value={step.text}
          onChange={(e) => onChange({ ...step, text: e.target.value })}
        />
      </>
    )
  if (step.kind === 'shell')
    return (
      <div className="flex items-start gap-2">
        <TextField
          size="sm"
          className="min-w-0 flex-1"
          inputClassName="font-mono"
          aria-label={t('Command')}
          placeholder="npm test"
          value={step.command}
          onChange={(e) => onChange({ ...step, command: e.target.value })}
        />
        <Select
          size="sm"
          className="w-36"
          aria-label={t('Timeout')}
          value={String(step.timeoutSec)}
          options={STEP_TIMEOUTS.map((s) => ({ value: String(s), label: t('Timeout {t}', { t: timeoutLabel(s) }) }))}
          onChange={(v) => onChange({ ...step, timeoutSec: Number(v) })}
        />
      </div>
    )
  return (
    <>
      <TextArea
        aria-label={t('Comment')}
        minRows={2}
        maxRows={8}
        placeholder={t("Empty: the previous step's output")}
        value={step.text}
        onChange={(e) => onChange({ ...step, text: e.target.value })}
      />
      <p className="mt-1.5 text-[11.5px] text-mute">{t('Posted on the open pull request of the run’s branch.')}</p>
    </>
  )
}
