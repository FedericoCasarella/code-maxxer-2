import { useEffect, useRef, useState } from 'react'
import { FolderPlus, GitBranchPlus } from 'lucide-react'
import { actions, useStore } from '@/lib/store'
import { Composer } from './Composer'
import { PaneToggle } from './PaneToggle'
import { PageHeader } from './PageHeader'
import { MessageView } from './Message'
import { CmLogo } from './Logos'
import { Kbd } from '../affect/kbd'
import { NewWorkspaceDialog } from './NewWorkspaceDialog'

const EMPTY: never[] = []

export function Center({
  leftCollapsed, rightCollapsed, onExpandLeft, onExpandRight
}: { leftCollapsed: boolean; rightCollapsed: boolean; onExpandLeft: () => void; onExpandRight: () => void }) {
  const selectedWs = useStore((s) => s.selectedWs)
  const workspaces = useStore((s) => s.workspaces)
  const selectedProject = useStore((s) => s.selectedProject)
  const projects = useStore((s) => s.projects)
  const ws = workspaces.find((w) => w.id === selectedWs) ?? null
  const project = projects.find((p) => p.id === (ws?.projectId ?? selectedProject))

  return (
    <>
      <PageHeader leftCollapsed={leftCollapsed} onExpandLeft={onExpandLeft}>
        {ws && (
          <>
            <span className="text-dim">{project?.name}</span>
            <span className="text-mute">/</span>
            <span className="font-mono text-[12px] text-ink">{ws.branch}</span>
          </>
        )}
        <div className="flex-1" />
        {rightCollapsed && <PaneToggle side="right" onClick={onExpandRight} label="Show panel" />}
      </PageHeader>
      {ws ? <Chat wsId={ws.id} /> : <Empty />}
    </>
  )
}

/** Nothing selected: logo, two actions, the shortcuts that matter. */
function Empty() {
  const selectedProject = useStore((s) => s.selectedProject)
  const projects = useStore((s) => s.projects)
  const [newWs, setNewWs] = useState(false)
  const space = useStore((s) => s.space)
  const target = selectedProject ?? projects.find((p) => p.spaceId === space)?.id ?? null

  return (
    <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto px-8">
      <div className="cm-in flex w-[320px] flex-col items-center">
        <CmLogo size={64} />
        <h1 className="mt-5 text-[26px] font-bold tracking-tight">CODE-MAXXER</h1>
        <p className="mt-2 text-[13px] text-dim">Select a branch from the sidebar to begin.</p>
        <div className="mt-6 flex gap-2.5">
          <button
            onClick={actions.addProject}
            className="flex h-9 items-center gap-2 rounded-lg border border-line-strong bg-raised px-3.5 text-[13px] font-medium hover:bg-white/[.06]"
          >
            <FolderPlus size={14} /> Add project
          </button>
          <button
            onClick={() => setNewWs(true)}
            disabled={!target}
            className="flex h-9 items-center gap-2 rounded-lg border border-line-strong bg-raised px-3.5 text-[13px] font-medium hover:bg-white/[.06] disabled:opacity-40"
          >
            <GitBranchPlus size={14} /> Create branch
          </button>
        </div>
        <div className="mt-10 flex w-full flex-col gap-3 text-[12.5px] text-dim">
          <Shortcut label="Create branch" keys={['⌘', 'N']} />
          <Shortcut label="Previous branch" keys={['⌘', '⇧', '↑']} />
          <Shortcut label="Next branch" keys={['⌘', '⇧', '↓']} />
        </div>
      </div>
      {newWs && target && <NewWorkspaceDialog projectId={target} onClose={() => setNewWs(false)} />}
    </div>
  )
}

function Shortcut({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div className="flex items-center justify-between">
      <span>{label}</span>
      <span className="flex gap-1">
        {keys.map((k) => (
          <Kbd key={k} keys={k} />
        ))}
      </span>
    </div>
  )
}

function Chat({ wsId }: { wsId: string }) {
  const messages = useStore((s) => s.messages[wsId]) ?? EMPTY
  const ws = useStore((s) => s.workspaces.find((w) => w.id === wsId)) ?? null
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  useEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [messages])

  return (
    <>
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {messages.length === 0 ? (
          <div className="grid h-full place-items-center text-[13px] text-mute">
            Ask the orchestrator, or pick a pipeline next to the model.
          </div>
        ) : (
          <div className="mx-auto flex max-w-[760px] flex-col gap-6 px-6 pb-8 pt-6">
            {messages.map((m) => (
              <MessageView key={m.id} m={m} />
            ))}
          </div>
        )}
      </div>
      <div className="mx-auto w-full max-w-[760px] px-6 pb-4">
        <Composer ws={ws} autoFocus />
      </div>
    </>
  )
}
