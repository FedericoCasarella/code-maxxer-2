import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { autoformat, backspaceInList, enterInList, indentInList, toMarkdown } from '@/lib/listEditing'
import { ArrowUp, CalendarClock, ChevronDown, Clock, Folder, ListTodo, Mic, Plus, Shield, ShieldCheck, Square, Sunrise, Workflow, Zap } from 'lucide-react'
import { Popover } from '../affect/popover'
import { ScheduleDialog } from './ScheduleDialog'
import type { ExecMode, SendOptions, Workspace } from '@shared/types'
import { actions, useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { DropdownMenu } from '../affect/dropdown-menu'
import { Tooltip } from '../affect/tooltip'
import { BranchPicker } from './BranchPicker'
import { ModelSelect, providerOf } from './ModelSelect'
import { QueuePanel } from './QueuePanel'

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

type Prefs = { model: string; effort: SendOptions['effort']; mode: ExecMode; fullAccess: boolean; plan?: boolean }
const PREFS_KEY = 'cm2.composer'
function loadPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '')
    if (p?.model) return p
  } catch { /* defaults */ }
  return { model: MODELS[0].id, effort: 'medium', mode: { kind: 'direct' }, fullAccess: true }
}

export function Composer({ ws, autoFocus, onSent }: { ws: Workspace | null; autoFocus?: boolean; onSent?: (wsId: string) => void }) {
  const pipelines = useStore((s) => s.pipelines)
  const project = useStore((s) => s.projects.find((p) => p.id === ws?.projectId))
  const [text, setText] = useState('')
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs)
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

  useEffect(() => {
    const el = ta.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = Math.min(el.scrollHeight, 240) + 'px'
  }, [text])
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

  const sendBtn = useRef<HTMLButtonElement>(null)
  const [sendMenu, setSendMenu] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const scheduledHere = useStore((s) => s.scheduled.filter((r) => r.status === 'pending' && r.workspaceId === ws?.id).length)
  const scheduleAt = async (at: number) => {
    if (!ws || !text.trim()) return
    await window.cm.schedule({ workspaceId: ws.id, text: toMarkdown(text.trim()), ...prefs }, at)
    setText('')
  }

  const submit = () => {
    if (!ws || !text.trim()) return
    // While the agent works this lands in the queue (shown above the prompt).
    void window.cm.send({ workspaceId: ws.id, text: toMarkdown(text.trim()), ...prefs })
    setText('')
    onSent?.(ws.id)
  }

  const effort = EFFORTS.find((e) => e.id === prefs.effort) ?? EFFORTS[1]
  const pipeline = prefs.mode.kind === 'pipeline' ? pipelines.find((p) => p.id === (prefs.mode as any).pipelineId) : null

  return (
    <div className="w-full">
      {ws && <QueuePanel wsId={ws.id} />}
      <div
        className={cn(
          'rounded-2xl border bg-input transition-colors',
          'border-white/[.09] focus-within:border-white/[.16]',
          !ws && 'opacity-60'
        )}
      >
        <textarea
          ref={ta}
          value={text}
          disabled={!ws}
          onChange={(e) => {
            const el = e.currentTarget
            const f = autoformat(el.value, el.selectionStart)
            if (f) apply(f)
            else setText(el.value)
          }}
          onKeyDown={(e) => {
            const el = e.currentTarget
            if (e.nativeEvent.isComposing) return
            const caret = el.selectionStart
            const collapsed = caret === el.selectionEnd
            // ⇧⇥ toggles plan mode, like Claude Code.
            if (e.key === 'Tab' && e.shiftKey && prefs.mode.kind === 'direct') {
              e.preventDefault()
              return setPrefs({ plan: !prefs.plan })
            }
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
          placeholder={ws ? 'Ask anything, @ to mention files, / for commands' : 'Add a project to start'}
          className="selectable block max-h-60 min-h-[52px] w-full resize-none bg-transparent px-4 pt-3.5 text-[14px] leading-6 text-ink outline-none placeholder:text-mute"
        />
        <div className="flex items-center gap-1 px-2.5 pb-2.5 pt-1">
          <IconBtn label="Attach">
            <Plus size={16} />
          </IconBtn>

          <DropdownMenu
            side="top"
            width={260}
            items={[
              {
                label: 'Full access', description: 'Agent edits and runs commands without asking', type: 'radio',
                checked: prefs.fullAccess, onSelect: () => setPrefs({ fullAccess: true })
              },
              {
                label: 'Accept edits', description: 'Edits files, asks before risky commands', type: 'radio',
                checked: !prefs.fullAccess, onSelect: () => setPrefs({ fullAccess: false })
              }
            ]}
            trigger={({ triggerProps }) => (
              <button
                {...triggerProps}
                className={cn(
                  'flex h-7 items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-medium hover:bg-white/5',
                  prefs.fullAccess ? 'text-warn' : 'text-dim'
                )}
              >
                {prefs.fullAccess ? <Shield size={13} /> : <ShieldCheck size={13} />}
                {prefs.fullAccess ? 'Full access' : 'Accept edits'}
                <ChevronDown size={12} className="opacity-70" />
              </button>
            )}
          />

          {prefs.mode.kind === 'direct' && (
            <Tooltip content={prefs.plan ? 'Plan mode on: it proposes a plan first' : 'Plan first, then build'} shortcut="⇧⇥">
              <button
                onClick={() => setPrefs({ plan: !prefs.plan })}
                aria-pressed={!!prefs.plan}
                className={cn(
                  'flex h-7 items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-medium hover:bg-white/5',
                  prefs.plan ? 'bg-accent/10 text-accent' : 'text-dim'
                )}
              >
                <ListTodo size={13} /> Plan
              </button>
            </Tooltip>
          )}

          <div className="flex-1" />

          {/* The code-maxxer twist: act directly, or hand the request to a pipeline the agent executes. */}
          <DropdownMenu
            side="top"
            align="end"
            width={320}
            title="Execution"
            items={[
              {
                label: 'Direct', description: 'The model acts on the files itself', icon: <Zap size={14} />, type: 'radio',
                checked: prefs.mode.kind === 'direct', onSelect: () => setPrefs({ mode: { kind: 'direct' } })
              },
              ...pipelines.map((p, i) => ({
                divider: i === 0,
                label: `Pipeline · ${p.name}`,
                description: p.description,
                icon: <Workflow size={14} />,
                type: 'radio' as const,
                checked: prefs.mode.kind === 'pipeline' && (prefs.mode as any).pipelineId === p.id,
                onSelect: () => setPrefs({ mode: { kind: 'pipeline', pipelineId: p.id } })
              }))
            ]}
            trigger={({ triggerProps }) => (
              <button
                {...triggerProps}
                className={cn(
                  'flex h-7 items-center gap-1.5 rounded-lg px-2 text-[12.5px] hover:bg-white/5',
                  pipeline ? 'text-accent' : 'text-dim'
                )}
              >
                {pipeline ? <Workflow size={13} /> : <Zap size={13} />}
                {pipeline ? pipeline.name : 'Direct'}
                <ChevronDown size={12} className="opacity-70" />
              </button>
            )}
          />

          <ModelSelect value={prefs.model} onChange={(id) => id && setPrefs({ model: id })} />
          {/* OpenCode models carry their own variant; effort applies to Claude and Codex. */}
          {providerOf(prefs.model) !== 'opencode' && (
            <DropdownMenu
              side="top"
              align="end"
              width={160}
              title="Effort"
              items={EFFORTS.map((e) => ({ label: e.label, type: 'radio' as const, checked: e.id === prefs.effort, onSelect: () => setPrefs({ effort: e.id }) }))}
              trigger={({ triggerProps }) => (
                <button {...triggerProps} className="-ml-1 flex h-7 items-center gap-1 rounded-lg px-1.5 text-[12.5px] text-mute hover:bg-white/5 hover:text-dim">
                  {effort.label}
                  <ChevronDown size={11} />
                </button>
              )}
            />
          )}

          <IconBtn label="Dictate">
            <Mic size={15} />
          </IconBtn>

          {running && !text.trim() ? (
            <button
              onClick={() => ws && void window.cm.stop(ws.id)}
              className="ml-1 grid size-8 place-items-center rounded-full bg-ink text-black"
              aria-label="Stop"
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
              disabled={!text.trim() || !ws}
              className="ml-1 grid size-8 place-items-center rounded-full bg-ink text-black transition-opacity disabled:bg-white/20 disabled:text-black/60"
              aria-label="Send (right-click for more)"
            >
              <ArrowUp size={16} strokeWidth={2.4} />
            </button>
          )}
        </div>
      </div>

      {ws && (
        <div className="mt-2 flex items-center gap-3 px-2 text-[11.5px] text-mute">
          <span className="flex items-center gap-1.5">
            <Folder size={12} />
            <span className="text-dim">{project?.name}</span>
          </span>
          <span>· {ws.name === 'local' ? 'Main checkout' : 'Worktree'}</span>
          <BranchPicker ws={ws} />
          <div className="flex-1" />
          {scheduledHere > 0 && (
            <button
              onClick={() => actions.showRight('schedule')}
              className="flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-accent hover:bg-accent/10"
            >
              <Clock size={12} />
              {scheduledHere} scheduled run{scheduledHere === 1 ? '' : 's'}
            </button>
          )}
        </div>
      )}

      <Popover open={sendMenu} onClose={() => setSendMenu(false)} anchor={sendBtn} side="top" align="end" width={240} offset={8} unstyled>
        <div className="cm-in rounded-xl border border-line-strong bg-raised p-1 shadow-2xl" role="menu">
          <MenuRow icon={<ArrowUp size={14} />} label="Send now" kbd="↵" disabled={!text.trim()} onClick={() => (setSendMenu(false), submit())} />
          <div className="my-1 h-px bg-line" />
          <MenuRow icon={<CalendarClock size={14} />} label="Schedule…" disabled={!text.trim()} onClick={() => (setSendMenu(false), setScheduleOpen(true))} />
          <MenuRow icon={<Clock size={14} />} label="In 1 hour" disabled={!text.trim()} onClick={() => (setSendMenu(false), void scheduleAt(Date.now() + 3_600_000))} />
          <MenuRow
            icon={<Sunrise size={14} />}
            label="Tomorrow at 9:00"
            disabled={!text.trim()}
            onClick={() => {
              const d = new Date(Date.now() + 86_400_000)
              d.setHours(9, 0, 0, 0)
              setSendMenu(false)
              void scheduleAt(d.getTime())
            }}
          />
          <div className="my-1 h-px bg-line" />
          <MenuRow icon={<CalendarClock size={14} />} label="Show scheduled runs" onClick={() => (setSendMenu(false), actions.showRight('schedule'))} />
        </div>
      </Popover>
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

function IconBtn({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <button className="grid size-7 place-items-center rounded-lg text-mute hover:bg-white/5 hover:text-ink" aria-label={label}>
      {children}
    </button>
  )
}
