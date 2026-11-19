import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, Info, MessageSquare, MessageSquareText, Pencil, Plus, Sparkles, SquareTerminal, Trash2, Workflow } from 'lucide-react'
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
import { Tooltip } from '../../affect/tooltip'
import { ProjectPicker } from '../ProjectPicker'
import { ModelSelect } from '../ModelSelect'
import { DEFAULT_MODEL, WEEK, dayName, fromTemplate, graceLabel, stepKindLabel, timeoutLabel } from './automationText'

export const STEP_ICON: Record<Step['kind'], ReactNode> = {
  prompt: <MessageSquare size={13} />,
  pipeline: <Workflow size={13} />,
  shell: <SquareTerminal size={13} />,
  pr_comment: <MessageSquareText size={13} />
}
const GRACE = [0, 1, 6, 12, 24]
const STEP_TIMEOUTS = [30, 60, 300, 600, 1800, 3600]
const PRECHECK_TIMEOUTS = [15, 30, 60, 120, 300]
const pad = (n: number) => String(n).padStart(2, '0')
/** Line height of the big prompt (leading-5) and the textarea's vertical padding, to fill the column. */
const LINE = 20
const AREA_PAD = 44

type Row = { key: string; step: Step }
let seq = 0
const keyed = (steps: Step[]): Row[] => steps.map((step) => ({ key: `s${++seq}`, step }))
type PromptStep = Step & { kind: 'prompt' }

/**
 * Create or edit an automation, laid out like Orca: the name as a heading and the prompt filling the left column,
 * agent / host / project / workspace / session / trigger / grace / precheck in the right one.
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
  const fill = useRef<HTMLDivElement>(null)
  const [promptRows, setPromptRows] = useState(12)

  // The big prompt takes whatever height the column leaves it.
  useEffect(() => {
    const el = fill.current
    if (!el) return
    const ro = new ResizeObserver(() => setPromptRows(Math.max(4, Math.floor((el.clientHeight - AREA_PAD) / LINE))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [rows[0]?.step.kind])

  const patch = (p: Partial<AutomationDraft>) => setD((x) => ({ ...x, ...p }))
  const branches = workspaces.filter((w) => w.projectId === d.projectId)
  const tr = d.trigger
  const lead = rows[0]?.step.kind === 'prompt' ? rows[0] : null
  const rest = lead ? rows.slice(1) : rows
  const agent = rows.find((r) => r.step.kind === 'prompt')?.step as PromptStep | undefined

  const setProject = (projectId: string | null) => {
    if (!projectId) return
    const ws = workspaces.find((w) => w.projectId === projectId)
    patch({ projectId, location: d.location.kind === 'workspace' && ws ? { kind: 'workspace', workspaceId: ws.id } : { kind: 'new' } })
  }
  const setTrigger = (kind: Trigger['kind']) => {
    if (kind === tr.kind) return
    patch({ trigger: kind === 'schedule' ? { kind, every: 'daily', hour: 9, minute: 0 } : { kind, branches: tr.kind === 'schedule' ? '*' : tr.branches } })
  }
  const setSchedule = (p: Partial<Trigger & { kind: 'schedule' }>) => tr.kind === 'schedule' && patch({ trigger: { ...tr, ...p } })
  const applyTemplate = (id: string) => {
    const tpl = TEMPLATES.find((x) => x.id === id)
    if (!tpl) return
    const next = fromTemplate(tpl, d.projectId, workspaces)
    setD(next)
    setRows(keyed(next.steps))
  }

  const setStep = (key: string, step: Step) => setRows((r) => r.map((x) => (x.key === key ? { ...x, step } : x)))
  /** Agent, effort and access apply to every prompt step. */
  const setAgent = (p: Partial<PromptStep>) => setRows((r) => r.map((x) => (x.step.kind === 'prompt' ? { ...x, step: { ...x.step, ...p } } : x)))
  const add = (kind: Step['kind']) => {
    const step: Step =
      kind === 'prompt'
        ? { kind, text: '', model: agent?.model ?? DEFAULT_MODEL, effort: agent?.effort ?? 'medium', fullAccess: agent?.fullAccess ?? true }
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

  const addMenu = (
    <DropdownMenu
      align="start"
      width={200}
      items={(['pipeline', 'shell', 'pr_comment', 'prompt'] as Step['kind'][]).map((k) => ({
        label: k === 'prompt' && lead ? t('Another prompt') : stepKindLabel(k),
        icon: STEP_ICON[k],
        onSelect: () => add(k)
      }))}
      trigger={({ triggerProps }) => (
        <Button {...triggerProps} variant="ghost" size="sm" iconRight={<Plus size={13} />}>
          {t('Add a step')}
        </Button>
      )}
    />
  )

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      width={1000}
      initialFocus={nameRef}
      title={
        <span className="flex items-center gap-2">
          <span className="flex-1">{editing ? t('Edit automation') : t('Create automation')}</span>
          <DropdownMenu
            align="end"
            width={300}
            items={TEMPLATES.map((tpl) => ({ label: t(tpl.name), description: t(tpl.description), onSelect: () => applyTemplate(tpl.id) }))}
            trigger={({ triggerProps }) => (
              <Button {...triggerProps} variant="ghost" size="sm" iconRight={<Sparkles size={13} />}>
                {t('Use template')}
              </Button>
            )}
          />
        </span>
      }
    >
      {/* the body's own padding is cancelled so the columns and the footer reach the edges */}
      <div className="-mx-5 -mt-3 -mb-5 flex h-[78vh] max-h-[820px] flex-col">
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_320px]">
          {/* left: name, prompt, extra steps */}
          <div className="flex min-h-0 min-w-0 flex-col px-6 pt-3 pb-4">
            <label className="flex min-w-0 items-center gap-2">
              <input
                ref={nameRef}
                aria-label={t('Name')}
                value={d.name}
                placeholder={t('Untitled automation')}
                onChange={(e) => patch({ name: e.target.value })}
                className="min-w-[6ch] max-w-full bg-transparent text-[28px] font-semibold leading-tight tracking-[-0.01em] text-ink outline-none [field-sizing:content] placeholder:text-mute"
              />
              <Pencil size={14} className="shrink-0 text-mute" />
            </label>

            {lead ? (
              <>
                <div className="mt-5 mb-1.5 text-[12px] font-medium text-dim">{t('Prompt')}</div>
                <div ref={fill} className="min-h-0 flex-1">
                  <TextArea
                    aria-label={t('Prompt')}
                    minRows={promptRows}
                    maxRows={promptRows}
                    inputClassName="!font-mono !text-[12.5px] !leading-5"
                    placeholder={t('What should the agent do?')}
                    value={(lead.step as PromptStep).text}
                    onChange={(e) => setStep(lead.key, { ...(lead.step as PromptStep), text: e.target.value })}
                  />
                </div>
                <p className="mt-2 text-[11.5px] text-mute">{t('{{branch}}, {{commit}} and {{output}} are filled in when it runs.')}</p>
                {rest.length > 0 && (
                  <ol className="mt-3 flex shrink-0 flex-col gap-1.5">
                    {rest.map((r) => (
                      <StepRow key={r.key} step={r.step} onChange={(s) => setStep(r.key, s)} onRemove={() => setRows((x) => x.filter((y) => y.key !== r.key))} />
                    ))}
                  </ol>
                )}
                <div className="mt-2 shrink-0">{addMenu}</div>
              </>
            ) : (
              <>
                <div className="mt-5 mb-1.5 text-[12px] font-medium text-dim">{t('Steps')}</div>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <ol className="flex flex-col gap-1.5">
                    {rest.map((r) => (
                      <StepRow key={r.key} step={r.step} onChange={(s) => setStep(r.key, s)} onRemove={() => setRows((x) => x.filter((y) => y.key !== r.key))} />
                    ))}
                  </ol>
                  {rest.length === 0 && <div className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-[12.5px] text-mute">{t('No steps yet: add one below.')}</div>}
                  <div className="mt-2">{addMenu}</div>
                </div>
                <p className="mt-2 text-[11.5px] text-mute">{t('{{branch}}, {{commit}} and {{output}} are filled in when it runs.')}</p>
              </>
            )}
          </div>

          {/* right: settings */}
          <div className="flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto border-l border-line px-5 pt-3 pb-5">
            <Setting label={t('Agent')}>
              {agent ? (
                <>
                  <ModelSelect trigger="field" side="bottom" align="start" value={agent.model} onChange={(m) => setAgent({ model: m ?? DEFAULT_MODEL })} className="w-full" />
                  <div className="mt-2 flex flex-col gap-2.5">
                    <Select
                      size="sm"
                      className="w-full"
                      aria-label={t('Effort')}
                      value={agent.effort}
                      options={[
                        { value: 'low', label: t('Low effort') },
                        { value: 'medium', label: t('Medium effort') },
                        { value: 'high', label: t('High effort') }
                      ]}
                      onChange={(v) => setAgent({ effort: v as PromptStep['effort'] })}
                    />
                    <Switch size="sm" label={t('Full access')} checked={agent.fullAccess} onChange={(e) => setAgent({ fullAccess: e.target.checked })} />
                  </div>
                </>
              ) : (
                <p className="text-[12px] text-mute">{t('No prompt step: no agent needed.')}</p>
              )}
            </Setting>

            <Setting label={t('Host')}>
              <Select size="sm" value="local" options={[{ value: 'local', label: t('This Mac') }]} hint={t('Stored and run by this Mac.')} />
            </Setting>

            <Setting label={t('Project')}>
              <ProjectPicker value={d.projectId || null} onChange={setProject} className="w-full" />
            </Setting>

            <Setting label={t('Workspace')} info={t('Worktree runs in a branch you already have; New run makes a new branch (worktree) each time.')}>
              <SegmentedControl
                size="sm"
                fullWidth
                value={d.location.kind}
                onChange={(v) => patch({ location: v === 'new' ? { kind: 'new' } : { kind: 'workspace', workspaceId: branches[0]?.id ?? '' } })}
                options={[
                  { value: 'workspace', label: t('Worktree') },
                  { value: 'new', label: t('New run') }
                ]}
              />
              {d.location.kind === 'workspace' && (
                <Select
                  className="cm-in mt-2"
                  size="sm"
                  aria-label={t('Branch')}
                  placeholder={branches.length ? t('Pick a branch') : t('No branches in this project yet')}
                  disabled={!branches.length}
                  value={d.location.workspaceId || null}
                  options={branches.map((w) => ({ value: w.id, label: w.branch, description: w.name }))}
                  onChange={(v) => patch({ location: { kind: 'workspace', workspaceId: v } })}
                />
              )}
            </Setting>

            <Setting label={t('Session')} info={t('Fresh starts a new conversation each run; Reuse continues the one from the last run.')}>
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
              <Select
                size="sm"
                value={tr.kind}
                options={[
                  { value: 'schedule', label: t('Schedule|trigger') },
                  { value: 'push', label: t('On push') },
                  { value: 'commit', label: t('On new commits') }
                ]}
                onChange={(v) => setTrigger(v as Trigger['kind'])}
              />
            </Setting>

            {tr.kind === 'schedule' ? (
              <div className="cm-in flex flex-col gap-2">
                <div className="grid grid-cols-2 gap-2">
                  <Setting label={t('Schedule|trigger')}>
                    <Select
                      size="sm"
                      value={tr.every}
                      options={[
                        { value: 'hourly', label: t('Hourly') },
                        { value: 'daily', label: t('Daily') },
                        { value: 'weekdays', label: t('Weekdays') },
                        { value: 'weekly', label: t('Weekly') }
                      ]}
                      onChange={(v) => setSchedule({ every: v as ScheduleKind, days: v === 'weekly' ? (tr.days?.length ? tr.days : [1]) : undefined })}
                    />
                  </Setting>
                  <Setting label={t('Time')}>
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
                  </Setting>
                </div>
                {tr.every === 'weekly' && (
                  <ToggleGroup
                    className="cm-in"
                    size="sm"
                    items={WEEK.map((n) => ({ value: String(n), label: dayName(n, 'narrow'), ariaLabel: dayName(n) }))}
                    value={(tr.days ?? []).map(String)}
                    onChange={(v) => setSchedule({ days: v.map(Number) })}
                  />
                )}
              </div>
            ) : (
              <Setting label={t('Branches')}>
                <TextField
                  className="cm-in"
                  size="sm"
                  inputClassName="font-mono"
                  value={tr.branches}
                  placeholder="*"
                  onChange={(e) => patch({ trigger: { ...tr, branches: e.target.value } })}
                  hint={t('* means every branch; separate several with commas.')}
                />
              </Setting>
            )}

            {tr.kind === 'schedule' && (
              <Setting label={t('Grace')} info={t('A run missed while the app was closed still starts if the app opens within this time.')}>
                <Select size="sm" value={String(d.graceHours)} options={GRACE.map((h) => ({ value: String(h), label: graceLabel(h) }))} onChange={(v) => patch({ graceHours: Number(v) })} />
              </Setting>
            )}

            <div>
              <div className="mb-1.5 flex items-center gap-2">
                <span className="flex-1 text-[12px] font-medium text-dim">{t('Precheck')}</span>
                <span className="text-[11.5px] text-mute">{t('Timeout')}</span>
                <Select
                  size="sm"
                  className="w-24"
                  aria-label={t('Precheck timeout')}
                  value={String(d.precheck.timeoutSec)}
                  options={PRECHECK_TIMEOUTS.map((s) => ({ value: String(s), label: timeoutLabel(s) }))}
                  onChange={(v) => patch({ precheck: { ...d.precheck, timeoutSec: Number(v) } })}
                />
              </div>
              <TextArea
                aria-label={t('Precheck')}
                minRows={2}
                maxRows={6}
                inputClassName="font-mono text-[12px]"
                placeholder="gh pr list --json number -q '.[0].number'"
                value={d.precheck.command}
                onChange={(e) => patch({ precheck: { ...d.precheck, command: e.target.value } })}
                hint={t('Runs first; a failure or empty output skips the run.')}
              />
            </div>
          </div>
        </div>

        {error && <div className="selectable cm-in mx-6 mb-3 rounded-lg bg-bad/10 px-3 py-2 text-[12px] text-bad">{error}</div>}

        <footer className="flex shrink-0 items-center gap-2 border-t border-line px-5 py-3">
          <Sparkles size={13} className={problem ? 'shrink-0 text-warn' : 'shrink-0 text-accent'} />
          <span className={problem ? 'flex-1 text-[12px] text-warn' : 'flex-1 text-[12px] text-mute'}>{problem ?? t('Once saved, runs automatically until paused.')}</span>
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button size="sm" loading={saving} disabled={!!problem} iconRight={editing ? <Check size={13} /> : <Plus size={13} />} onClick={() => void save()}>
            {editing ? t('Save') : t('Create')}
          </Button>
        </footer>
      </div>
    </Dialog>
  )
}

function Setting({ label, info, children }: { label: string; info?: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-dim">
        {label}
        {info && (
          <Tooltip content={<span className="block max-w-[240px] whitespace-normal">{info}</span>} side="top">
            <span tabIndex={0} aria-label={info} className="grid place-items-center text-mute hover:text-ink">
              <Info size={12} />
            </span>
          </Tooltip>
        )}
      </div>
      {children}
    </div>
  )
}

/** A step other than the big prompt: one line, its kind's icon in front, remove at the end. */
function StepRow({ step, onChange, onRemove }: { step: Step; onChange: (s: Step) => void; onRemove: () => void }) {
  const pipelines = useStore((s) => s.pipelines)
  return (
    <li className="cm-row-in flex items-center gap-2 rounded-lg border border-line bg-panel py-1 pr-1 pl-2.5">
      <Tooltip content={stepKindLabel(step.kind)} side="top">
        <span tabIndex={0} aria-label={stepKindLabel(step.kind)} className="shrink-0 text-accent">
          {STEP_ICON[step.kind]}
        </span>
      </Tooltip>
      {step.kind === 'prompt' ? (
        <TextField size="sm" className="min-w-0 flex-1" aria-label={t('Prompt')} placeholder={t('What should the agent do?')} value={step.text} onChange={(e) => onChange({ ...step, text: e.target.value })} />
      ) : step.kind === 'pipeline' ? (
        <>
          <Select
            size="sm"
            className="w-44 shrink-0"
            aria-label={t('Pipeline')}
            placeholder={pipelines.length ? t('Pick a pipeline') : t('No pipelines yet')}
            value={step.pipelineId || null}
            options={pipelines.map((p) => ({ value: p.id, label: p.name, description: p.description || undefined }))}
            onChange={(v) => onChange({ ...step, pipelineId: v })}
          />
          <TextField size="sm" className="min-w-0 flex-1" aria-label={t('Task')} placeholder={t('The task for the pipeline')} value={step.text} onChange={(e) => onChange({ ...step, text: e.target.value })} />
        </>
      ) : step.kind === 'shell' ? (
        <>
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
            className="w-24 shrink-0"
            aria-label={t('Timeout')}
            value={String(step.timeoutSec)}
            options={STEP_TIMEOUTS.map((s) => ({ value: String(s), label: timeoutLabel(s) }))}
            onChange={(v) => onChange({ ...step, timeoutSec: Number(v) })}
          />
        </>
      ) : (
        <TextField
          size="sm"
          className="min-w-0 flex-1"
          aria-label={t('Comment on PR')}
          placeholder={t("Comment on PR · empty: the previous step's output")}
          value={step.text}
          onChange={(e) => onChange({ ...step, text: e.target.value })}
        />
      )}
      <IconButton size="sm" icon={<Trash2 size={13} />} label={t('Remove step|automation')} onClick={onRemove} />
    </li>
  )
}
