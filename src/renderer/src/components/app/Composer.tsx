import { useEffect, useRef, useState } from 'react'
import { ArrowUp, ChevronDown, Folder, GitBranch, Mic, Plus, Shield, ShieldCheck, Square, Workflow, Zap } from 'lucide-react'
import type { ExecMode, SendOptions, Workspace } from '@shared/types'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { DropdownMenu } from '../affect/dropdown-menu'

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

  const submit = () => {
    if (!ws || !text.trim() || running) return
    void window.cm.send({ workspaceId: ws.id, text: text.trim(), ...prefs })
    setText('')
    onSent?.(ws.id)
  }

  const model = MODELS.find((m) => m.id === prefs.model) ?? MODELS[0]
  const effort = EFFORTS.find((e) => e.id === prefs.effort) ?? EFFORTS[1]
  const pipeline = prefs.mode.kind === 'pipeline' ? pipelines.find((p) => p.id === (prefs.mode as any).pipelineId) : null

  return (
    <div className="w-full">
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
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
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

          <div className="flex-1" />

          {/* The code-maxxer twist: act directly, or hand the request to a pipeline the agent executes. */}
          <DropdownMenu
            side="top"
            align="end"
            width={290}
            title="Execution"
            items={[
              {
                label: 'Direct', description: 'The model acts on the files itself', icon: <Zap size={14} />, type: 'radio',
                checked: prefs.mode.kind === 'direct', onSelect: () => setPrefs({ mode: { kind: 'direct' } })
              },
              { label: '', divider: true },
              ...pipelines.map((p) => ({
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

          <DropdownMenu
            side="top"
            align="end"
            width={240}
            items={[
              ...MODELS.map((m) => ({
                label: m.label, type: 'radio' as const, checked: m.id === prefs.model,
                onSelect: () => setPrefs({ model: m.id })
              })),
              { label: '', divider: true },
              {
                label: 'Effort',
                submenu: EFFORTS.map((e) => ({
                  label: e.label, type: 'radio' as const, checked: e.id === prefs.effort,
                  onSelect: () => setPrefs({ effort: e.id })
                }))
              }
            ]}
            trigger={({ triggerProps }) => (
              <button {...triggerProps} className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-[12.5px] hover:bg-white/5">
                <span className="text-ink">{model.label}</span>
                <span className="text-mute">{effort.label}</span>
                <ChevronDown size={12} className="text-mute" />
              </button>
            )}
          />

          <IconBtn label="Dictate">
            <Mic size={15} />
          </IconBtn>

          {running ? (
            <button
              onClick={() => ws && void window.cm.stop(ws.id)}
              className="ml-1 grid size-8 place-items-center rounded-full bg-ink text-black"
              aria-label="Stop"
            >
              <Square size={11} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={!text.trim() || !ws}
              className="ml-1 grid size-8 place-items-center rounded-full bg-ink text-black transition-opacity disabled:bg-white/20 disabled:text-black/60"
              aria-label="Send"
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
          <span className="flex items-center gap-1.5 font-mono">
            <GitBranch size={12} />
            {ws.branch}
          </span>
        </div>
      )}
    </div>
  )
}

function IconBtn({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <button className="grid size-7 place-items-center rounded-lg text-mute hover:bg-white/5 hover:text-ink" aria-label={label}>
      {children}
    </button>
  )
}
