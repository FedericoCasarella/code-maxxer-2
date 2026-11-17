import { useEffect, useState } from 'react'
import { GitCompare, MessageSquare, Plus, X } from 'lucide-react'
import { actions, useStore, type EditorTab } from '@/lib/store'
import { cn } from '@/lib/utils'
import { ConfirmDialog } from '../ConfirmDialog'
import { EditorPane } from './EditorPane'
import { fileIcon } from '../FilesPanel'

const EMPTY = { tabs: [] as EditorTab[], active: null as string | null }
const nameOf = (p: string) => p.slice(p.lastIndexOf('/') + 1)

/** Tab strip over the center: the chat first, then open files and diffs. */
export function EditorTabs({ wsId }: { wsId: string }) {
  const ed = useStore((s) => s.editors[wsId]) ?? EMPTY
  const [closing, setClosing] = useState<EditorTab | null>(null)
  const close = (t: EditorTab) => (t.dirty ? setClosing(t) : actions.closeEditor(wsId, t.id))

  // ⌘W closes the open file (not the window) while one is in front.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!e.metaKey || e.key !== 'w' || !ed.active) return
      e.preventDefault()
      const t = ed.tabs.find((x) => x.id === ed.active)
      if (t) close(t)
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [ed])

  if (ed.tabs.length === 0) return null
  return (
    <div className="flex h-11 shrink-0 items-center gap-1 overflow-x-auto border-b border-line px-2 [scrollbar-width:none]">
      <Tab active={ed.active === null} onClick={() => actions.focusEditor(wsId, null)} icon={<MessageSquare size={14} className="text-dim" />} label="Chat" />
      {ed.tabs.map((t) => (
        <Tab
          key={t.id}
          active={ed.active === t.id}
          onClick={() => actions.focusEditor(wsId, t.id)}
          onClose={() => close(t)}
          dirty={t.dirty}
          title={t.path}
          icon={t.kind === 'diff' ? <GitCompare size={14} className="text-accent" /> : fileIcon(nameOf(t.path))}
          label={nameOf(t.path)}
          italic={t.kind === 'diff'}
        />
      ))}
      <button
        aria-label="Open a file"
        title="Open a file  ⌘P"
        onClick={() => {
          actions.showRight('files')
          setTimeout(() => document.querySelector<HTMLInputElement>('input[placeholder^="Filter files"]')?.focus(), 80)
        }}
        className="grid size-7 shrink-0 place-items-center rounded-md text-mute hover:bg-white/[.06] hover:text-ink"
      >
        <Plus size={15} />
      </button>
      {closing && (
        <ConfirmDialog
          title={`Close ${nameOf(closing.path)}?`}
          confirmLabel="Close without saving"
          danger
          onConfirm={() => {
            actions.closeEditor(wsId, closing.id)
            setClosing(null)
          }}
          onClose={() => setClosing(null)}
        >
          It has changes that aren't saved. Closing throws them away.
        </ConfirmDialog>
      )}
    </div>
  )
}

function Tab(p: {
  active: boolean
  onClick: () => void
  onClose?: () => void
  dirty?: boolean
  title?: string
  icon: React.ReactNode
  label: string
  italic?: boolean
}) {
  return (
    <div
      role="tab"
      aria-selected={p.active}
      title={p.title}
      onClick={p.onClick}
      onAuxClick={(e) => e.button === 1 && p.onClose?.()}
      className={cn(
        'group flex h-8 max-w-[220px] shrink-0 cursor-default items-center gap-2 rounded-lg border pl-2.5 text-[12.5px] transition-colors',
        p.onClose ? 'pr-1' : 'pr-3',
        p.active
          ? 'border-line-strong bg-raised text-ink shadow-[0_1px_2px_rgba(0,0,0,.35)]'
          : 'border-transparent text-dim hover:bg-white/[.04] hover:text-ink'
      )}
    >
      <span className="grid shrink-0 place-items-center">{p.icon}</span>
      <span className={cn('min-w-0 truncate', p.italic && 'italic')}>{p.label}</span>
      {p.onClose && (
        <button
          aria-label={`Close ${p.label}`}
          onClick={(e) => {
            e.stopPropagation()
            p.onClose!()
          }}
          className="group/x grid size-5 place-items-center rounded text-mute hover:bg-white/[.08] hover:text-ink"
        >
          {p.dirty ? (
            <>
              <span className="size-2 rounded-full bg-ink/80 group-hover/x:hidden" />
              <X size={12} className="hidden group-hover/x:block" />
            </>
          ) : (
            <X size={12} className={cn(!p.active && 'opacity-0 group-hover:opacity-100')} />
          )}
        </button>
      )}
    </div>
  )
}

/** Every open file of the branch, mounted, only the active one shown. */
export function EditorPanes({ wsId }: { wsId: string }) {
  const ed = useStore((s) => s.editors[wsId]) ?? EMPTY
  return (
    <>
      {ed.tabs.map((t) => (
        <EditorPane key={t.id} wsId={wsId} tab={t} visible={ed.active === t.id} />
      ))}
    </>
  )
}
