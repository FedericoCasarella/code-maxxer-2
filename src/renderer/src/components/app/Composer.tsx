import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Marquee } from './Marquee'
import { autoformat, backspaceInList, enterInList, indentInList, toMarkdown } from '@/lib/listEditing'
import { ArrowUp, BrainCircuit, CalendarClock, ChevronDown, Clock, Ellipsis, Folder, Gauge, GitBranch, Mic, Plus, Shield, ShieldCheck, Square, Sunrise, Workflow, Zap } from 'lucide-react'
import { Popover } from '../affect/popover'
import { ScheduleDialog } from './ScheduleDialog'
import type { Attachment, ExecMode, SendOptions, Workspace } from '@shared/types'
import { actions, useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { DropdownMenu, type DropdownMenuItem } from '../affect/dropdown-menu'
import { IconButton } from '../affect/icon-button'
import { BranchPicker } from './BranchPicker'
import { ModelSelect, providerOf } from './ModelSelect'
import { QueuePanel } from './QueuePanel'
import { AttachmentChips, PickChips, useAttachments } from './Attachments'
import { PICK_EVENT, picksText, type PreviewPick } from '@/lib/pick-element'
import { DictationBar, DictationText, useDictation } from './Dictation'
import { useAgentMention } from './AgentMention'
import { t } from '@/lib/i18n'

export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
  { id: 'claude-fable-5-2', label: 'Claude Fable 5.2' }
]
const EFFORTS = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Med' },
  { id: 'high', label: 'High' }
] as const

type Prefs = { model: string; effort: SendOptions['effort']; mode: ExecMode; fullAccess: boolean }
const PREFS_KEY = 'cm2.composer'
export function loadPrefs(): Prefs {
  const defaults: Prefs = { model: MODELS[0].id, effort: 'medium', mode: { kind: 'direct' }, fullAccess: true }
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '')
    // Settings saves only what it changes (e.g. just the default model): fill in the rest, never a prefs without a mode.
    if (p && typeof p === 'object') {
      delete p.plan
      return {
        ...defaults,
        ...p,
        model: typeof p.model === 'string' && p.model ? p.model : defaults.model,
        mode: p.mode && typeof p.mode.kind === 'string' ? p.mode : defaults.mode,
        effort: ['low', 'medium', 'high'].includes(p.effort) ? p.effort : defaults.effort
      }
    }
  } catch { /* defaults */ }
  return defaults
}

/** What was typed and attached in a chat and not sent yet: it survives a branch switch and a restart. */
type Draft = { text: string; files: Attachment[]; picks?: PreviewPick[] }
const draftKey = (wsId: string) => `cm2.draft.${wsId}`
function readDraft(wsId: string | undefined): Draft {
  if (!wsId) return { text: '', files: [] }
  try {
    const d = JSON.parse(localStorage.getItem(draftKey(wsId)) ?? '')
    return { text: typeof d?.text === 'string' ? d.text : '', files: Array.isArray(d?.files) ? d.files : [], picks: Array.isArray(d?.picks) ? d.picks : [] }
  } catch {
    return { text: '', files: [] }
  }
}

export function Composer({ ws, autoFocus, onSent }: { ws: Workspace | null; autoFocus?: boolean; onSent?: (wsId: string) => void }) {
  const pipelines = useStore((s) => s.pipelines)
  const project = useStore((s) => s.projects.find((p) => p.id === ws?.projectId))
  const projects = useStore((s) => s.projects)
  const allWs = useStore((s) => s.workspaces)
  const twins = useMemo(() => (ws ? allWs.filter((w) => w.linkedTo === ws.id) : []), [allWs, ws?.id])
  // Mounted once per chat (keyed by it): the draft of that chat comes back
  const [draft] = useState(() => readDraft(ws?.id))
  const [text, setText] = useState(draft.text)
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs)
  const att = useAttachments(ws?.id ?? null, draft.files)
  const attKey = att.attachments.map((a) => a.path).join('|')
  // Elements picked in the preview: chips here, their details go with the message
  const [picks, setPicks] = useState<PreviewPick[]>(draft.picks ?? [])
  useEffect(() => {
    if (!ws) return
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ wsId: string; pick: PreviewPick }>).detail
      if (d.wsId !== ws.id) return
      setPicks((l) => [...l.filter((p) => !(p.selector === d.pick.selector && p.url === d.pick.url)), d.pick])
      ta.current?.focus()
    }
    window.addEventListener(PICK_EVENT, on)
    return () => window.removeEventListener(PICK_EVENT, on)
  }, [ws?.id])
  useEffect(() => {
    if (!ws) return
    try {
      if (!text && !att.attachments.length && !picks.length) localStorage.removeItem(draftKey(ws.id))
      else localStorage.setItem(draftKey(ws.id), JSON.stringify({ text, files: att.attachments, picks } satisfies Draft))
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws?.id, text, attKey, picks])
  const fileInput = useRef<HTMLInputElement>(null)
  // Too narrow for every control: access, execution and effort fold into a ⋯ menu instead of squeezing.
  const bar = useRef<HTMLDivElement>(null)
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const el = bar.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setNarrow(e.contentRect.width < 600))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const [dragOver, setDragOver] = useState(false)
  const dict = useDictation((words) => {
    setText((prev) => (prev && !/\s$/.test(prev) ? `${prev} ${words}` : prev + words))
    setFlash(true)
    requestAnimationFrame(() => {
      const el = ta.current
      if (!el) return
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
      el.scrollTop = el.scrollHeight
    })
  })
  const [flash, setFlash] = useState(false)
  useEffect(() => {
    if (!flash) return
    const id = setTimeout(() => setFlash(false), 400)
    return () => clearTimeout(id)
  }, [flash])
  const ta = useRef<HTMLTextAreaElement>(null)
  const running = ws?.status === 'running'

  const setPrefs = (p: Partial<Prefs>) =>
    setPrefsState((cur) => {
      const next = { ...cur, ...p }
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next))
      } catch { /* ignore */ }
      return next
    })
  // Stable, so the model chip doesn't re-render on every keystroke
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const pickModel = useCallback((id: string | null) => id && setPrefs({ model: id }), [])

  useEffect(() => {
    if (autoFocus) ta.current?.focus()
  }, [autoFocus, ws?.id])

  // Set text and caret together after a list edit.
  const pendingCaret = useRef<number | null>(null)
  const apply = (f: { value: string; caret: number }) => {
    pendingCaret.current = f.caret
    setText(f.value)
  }
  useLayoutEffect(() => {
    if (pendingCaret.current !== null && ta.current) {
      ta.current.setSelectionRange(pendingCaret.current, pendingCaret.current)
      pendingCaret.current = null
    }
  }, [text])

  const mention = useAgentMention(ta, text, (value, caret) => apply({ value, caret }))
  const sendBtn = useRef<HTMLButtonElement>(null)
  const [sendMenu, setSendMenu] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const scheduledHere = useStore((s) => s.scheduled.filter((r) => r.status === 'pending' && r.workspaceId === ws?.id).length)
  const scheduleAt = async (at: number) => {
    if (!ws || !text.trim()) return
    await window.cm.schedule({ workspaceId: ws.id, text: toMarkdown(text.trim()), ...prefs }, at)
    setText('')
  }

  const canSend = !!ws && (!!text.trim() || att.attachments.length > 0 || picks.length > 0) && att.ready && !dict.active
  const submit = () => {
    if (!ws || !canSend) return
    const body =
      (text.trim() || (picks.length && !att.attachments.length ? 'Look at these elements.' : att.attachments.length === 1 ? 'See the attached file.' : 'See the attached files.')) + picksText(picks)
    // While the agent works this lands in the queue (shown above the prompt).
    void window.cm.send({ workspaceId: ws.id, text: toMarkdown(body), ...prefs, ...(att.attachments.length ? { attachments: att.attachments } : {}) })
    window.dispatchEvent(new CustomEvent('cm-sent', { detail: ws.id }))
    setText('')
    att.clear()
    setPicks([])
    onSent?.(ws.id)
  }

  const effort = EFFORTS.find((e) => e.id === prefs.effort) ?? EFFORTS[1]
  const pipeline = prefs.mode.kind === 'pipeline' ? pipelines.find((p) => p.id === (prefs.mode as any).pipelineId) : null
  const accessItems: DropdownMenuItem[] = [
              {
                label: t('Full access'), description: t('Agent edits and runs commands without asking'), type: 'radio',
                checked: prefs.fullAccess, onSelect: () => setPrefs({ fullAccess: true })
              },
              {
                label: t('Accept edits'), description: t('Edits files, asks before risky commands'), type: 'radio',
                checked: !prefs.fullAccess, onSelect: () => setPrefs({ fullAccess: false })
              }
            ]
  const modeItems: DropdownMenuItem[] = [
                {
                  label: t('Sentient'), description: t('Decides on its own: acts itself or starts a pipeline'), icon: <BrainCircuit size={14} />, type: 'radio',
                  checked: prefs.mode.kind === 'sentient', onSelect: () => setPrefs({ mode: { kind: 'sentient' } })
                },
                {
                  label: t('Direct'), description: t('The model acts on the files itself'), icon: <Zap size={14} />, type: 'radio',
                  checked: prefs.mode.kind === 'direct', onSelect: () => setPrefs({ mode: { kind: 'direct' } })
                },
                ...pipelines.map((p, i) => ({
                  divider: i === 0,
                  label: t('Pipeline · {name}', { name: p.name }),
                  description: p.description,
                  icon: <Workflow size={14} />,
                  type: 'radio' as const,
                  checked: prefs.mode.kind === 'pipeline' && (prefs.mode as any).pipelineId === p.id,
                  onSelect: () => setPrefs({ mode: { kind: 'pipeline', pipelineId: p.id } })
                }))
              ]
  const effortItems: DropdownMenuItem[] = EFFORTS.map((e) => ({ label: t(e.label), type: 'radio' as const, checked: e.id === prefs.effort, onSelect: () => setPrefs({ effort: e.id }) }))

  return (
    <div className="w-full">
      {ws && <QueuePanel wsId={ws.id} />}
      <div
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDragOver(false)}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return
          e.preventDefault()
          setDragOver(false)
          att.add([...e.dataTransfer.files])
        }}
        className={cn(
          'rounded-2xl border bg-input transition-colors',
          dragOver ? 'border-accent/60 bg-accent/[.04]' : 'border-white/[.09] focus-within:border-white/[.16]',
          !ws && 'opacity-60'
        )}
      >
        <AttachmentChips files={att.files} notice={att.notice} onRemove={att.remove} />
        <PickChips picks={picks} onRemove={(id) => setPicks((l) => l.filter((p) => p.id !== id))} />
        {dict.active && <DictationText text={text} partial={dict.partial} phase={dict.phase as any} status={dict.status} />}
        <textarea
          ref={ta}
          value={text}
          disabled={!ws}
          hidden={dict.active}
          onPaste={(e) => {
            const files = [...e.clipboardData.files]
            if (files.length) {
              e.preventDefault()
              att.add(files)
            }
          }}
          onChange={(e) => {
            const el = e.currentTarget
            const f = autoformat(el.value, el.selectionStart)
            if (f) apply(f)
            else setText(el.value)
          }}
          onSelect={mention.sync}
          onKeyDown={(e) => {
            const el = e.currentTarget
            if (e.nativeEvent.isComposing) return
            if (mention.keys(e)) return
            const caret = el.selectionStart
            const collapsed = caret === el.selectionEnd
            // ⌘↵ always sends; ↵ inside a list adds the next item (empty item leaves the list).
            if (e.key === 'Enter' && e.metaKey) {
              e.preventDefault()
              return submit()
            }
            if (e.key === 'Enter' && collapsed) {
              const f = enterInList(el.value, caret)
              if (f) {
                e.preventDefault()
                return apply(f)
              }
              if (!e.shiftKey) {
                e.preventDefault()
                submit()
              }
              return
            }
            if (e.key === 'Backspace' && collapsed) {
              const f = backspaceInList(el.value, caret)
              if (f) {
                e.preventDefault()
                apply(f)
              }
            }
            if (e.key === 'Tab' && collapsed) {
              const f = indentInList(el.value, caret, e.shiftKey)
              if (f) {
                e.preventDefault()
                apply(f)
              }
            }
          }}
          rows={1}
          placeholder={ws ? t('Ask anything, @ to call an agent') : t('Add a project to start')}
          className={cn(
            'selectable block max-h-60 min-h-[52px] w-full resize-none [field-sizing:content] bg-transparent px-4 pt-3.5 text-[14px] leading-6 text-ink outline-none placeholder:text-mute',
            flash && 'cm-in'
          )}
        />
        <div ref={bar} className="flex items-center gap-1 px-2.5 pb-2.5 pt-1">
          <IconButton label={t('Attach files')} size="sm" icon={<Plus size={16} />} disabled={!ws} onClick={() => fileInput.current?.click()} />
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              att.add([...(e.target.files ?? [])])
              e.target.value = ''
            }}
          />

          {!narrow && (
          <DropdownMenu
              side="top"
              width={260}
              items={accessItems}
              trigger={({ triggerProps }) => (
                <button
                  {...triggerProps}
                  className={cn(
                    'flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-[12.5px] font-medium hover:bg-white/5',
                    prefs.fullAccess ? 'text-warn' : 'text-dim'
                  )}
                >
                  {prefs.fullAccess ? <Shield size={13} /> : <ShieldCheck size={13} />}
                  {prefs.fullAccess ? t('Full access') : t('Accept edits')}
                  <ChevronDown size={12} className="opacity-70" />
                </button>
              )}
            />
          )}

          <div className="flex-1" />

          {dict.active ? (
            <DictationBar levels={dict.levels} onCancel={dict.cancel} onCommit={dict.commit} />
          ) : (
            <>
            {narrow ? (
              <DropdownMenu
                side="top"
                align="end"
                width={240}
                items={[
                  { label: prefs.fullAccess ? t('Full access') : t('Accept edits'), icon: prefs.fullAccess ? <Shield size={14} /> : <ShieldCheck size={14} />, submenu: accessItems },
                  { label: pipeline ? pipeline.name : prefs.mode.kind === 'sentient' ? t('Sentient') : t('Direct'), icon: pipeline ? <Workflow size={14} /> : prefs.mode.kind === 'sentient' ? <BrainCircuit size={14} /> : <Zap size={14} />, submenu: modeItems },
                  ...(providerOf(prefs.model) !== 'opencode' ? [{ label: t('Effort · {level}', { level: t(effort.label) }), icon: <Gauge size={14} />, submenu: effortItems }] : [])
                ]}
                trigger={({ triggerProps }) => <IconButton {...triggerProps} label={t('More options')} size="sm" icon={<Ellipsis size={16} />} />}
              />
            ) : (
              // The code-maxxer twist: act directly, or hand the request to a pipeline the agent executes.
              <DropdownMenu
                side="top"
                align="end"
                width={320}
                title={t('Execution')}
                items={modeItems}
                trigger={({ triggerProps }) => (
                  <button
                    {...triggerProps}
                    className={cn(
                      'flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-[12.5px] hover:bg-white/5',
                      pipeline ? 'text-accent' : 'text-dim'
                    )}
                  >
                    {pipeline ? <Workflow size={13} /> : prefs.mode.kind === 'sentient' ? <BrainCircuit size={13} /> : <Zap size={13} />}
                    {pipeline ? pipeline.name : prefs.mode.kind === 'sentient' ? t('Sentient') : t('Direct')}
                    <ChevronDown size={12} className="opacity-70" />
                  </button>
                )}
              />
            )}

            <ModelSelect value={prefs.model} onChange={pickModel} />
            {/* OpenCode models carry their own variant; effort applies to Claude and Codex. */}
            {!narrow && providerOf(prefs.model) !== 'opencode' && (
              <DropdownMenu
                side="top"
                align="end"
                width={160}
                title={t('Effort')}
                items={effortItems}
                trigger={({ triggerProps }) => (
                  <button {...triggerProps} className="-ml-1 flex h-7 items-center gap-1 rounded-lg px-1.5 text-[12.5px] text-mute hover:bg-white/5 hover:text-dim">
                    {t(effort.label)}
                    <ChevronDown size={11} />
                  </button>
                )}
              />
            )}

            <IconButton label={t('Dictate')} size="sm" icon={<Mic size={15} />} disabled={!ws} onClick={dict.start} />

            {running && !text.trim() ? (
              <button
                onClick={() => ws && void window.cm.stop(ws.id)}
                className="ml-1 grid size-8 place-items-center rounded-full bg-ink text-black"
                aria-label={t('Stop')}
              >
                <Square size={11} fill="currentColor" />
              </button>
            ) : (
              <button
                ref={sendBtn}
                onClick={submit}
                onContextMenu={(e) => {
                  // Right-click: quick commands (send now, schedule…).
                  e.preventDefault()
                  if (ws) setSendMenu(true)
                }}
                disabled={!canSend}
                className="ml-1 grid size-8 place-items-center rounded-full bg-ink text-black transition-opacity disabled:bg-white/20 disabled:text-black/60"
                aria-label={t('Send (right-click for more)')}
              >
                <ArrowUp size={16} strokeWidth={2.4} />
              </button>
            )}
            </>
          )}
        </div>
      </div>

      {dict.error && (
        <button onClick={dict.dismissError} className="cm-in mt-2 block px-2 text-left text-[11.5px] text-bad">
          {dict.error}
        </button>
      )}
      {ws && (
        <div className="mt-2 flex items-center gap-3 px-2 text-[11.5px] text-mute">
          <span className="flex min-w-0 max-w-[40%] items-center gap-1.5">
            <Folder size={12} className="shrink-0" />
            <Marquee className="min-w-0 text-dim" delay={300}>
              {project?.name}
            </Marquee>
          </span>
          <BranchPicker ws={ws} />
          {/* Multi-repo chat: the other repos it works on, each on its twin branch */}
          {twins.map((tw) => (
            <span key={tw.id} className="flex min-w-0 items-center gap-1.5">
              <Plus size={11} className="shrink-0" />
              <Folder size={12} className="shrink-0" />
              <Marquee className="min-w-0 max-w-[160px] text-dim" delay={300}>{projects.find((p) => p.id === tw.projectId)?.name ?? ''}</Marquee>
              <GitBranch size={12} className="shrink-0" />
              <Marquee className="min-w-0 max-w-[160px] font-mono" delay={300}>{tw.branch}</Marquee>
            </span>
          ))}
          <div className="flex-1" />
          {scheduledHere > 0 && (
            <button
              onClick={() => actions.showRight('schedule')}
              className="flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-accent hover:bg-accent/10"
            >
              <Clock size={12} />
              {scheduledHere === 1 ? t('1 scheduled run') : t('{n} scheduled runs', { n: scheduledHere })}
            </button>
          )}
        </div>
      )}

      <Popover open={sendMenu} onClose={() => setSendMenu(false)} anchor={sendBtn} side="top" align="end" width={240} offset={8} unstyled>
        <div className="cm-in rounded-xl border border-line-strong bg-raised p-1 shadow-2xl" role="menu">
          <MenuRow icon={<ArrowUp size={14} />} label={t('Send now')} kbd="↵" disabled={!text.trim()} onClick={() => (setSendMenu(false), submit())} />
          <div className="my-1 h-px bg-line" />
          <MenuRow icon={<CalendarClock size={14} />} label={t('Schedule…')} disabled={!text.trim()} onClick={() => (setSendMenu(false), setScheduleOpen(true))} />
          <MenuRow icon={<Clock size={14} />} label={t('In 1 hour')} disabled={!text.trim()} onClick={() => (setSendMenu(false), void scheduleAt(Date.now() + 3_600_000))} />
          <MenuRow
            icon={<Sunrise size={14} />}
            label={t('Tomorrow at 9:00')}
            disabled={!text.trim()}
            onClick={() => {
              const d = new Date(Date.now() + 86_400_000)
              d.setHours(9, 0, 0, 0)
              setSendMenu(false)
              void scheduleAt(d.getTime())
            }}
          />
          <div className="my-1 h-px bg-line" />
          <MenuRow icon={<CalendarClock size={14} />} label={t('Show scheduled runs')} onClick={() => (setSendMenu(false), actions.showRight('schedule'))} />
        </div>
      </Popover>
      {mention.menu}
      {scheduleOpen && ws && <ScheduleDialog text={text} onSubmit={scheduleAt} onClose={() => setScheduleOpen(false)} />}
    </div>
  )
}

function MenuRow({ icon, label, kbd, onClick, disabled }: { icon: React.ReactNode; label: string; kbd?: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] text-ink hover:bg-white/[.06] disabled:opacity-40 disabled:hover:bg-transparent"
    >
      <span className="text-dim">{icon}</span>
      <span className="flex-1">{label}</span>
      {kbd && <span className="text-[11px] text-mute">{kbd}</span>}
    </button>
  )
}

