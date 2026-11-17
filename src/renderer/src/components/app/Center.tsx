import { useEffect, useMemo, useRef, useState } from 'react'
import type { Workspace } from '@shared/types'
import { FolderPlus, GitBranchPlus, Workflow } from 'lucide-react'
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
  const messages = useStore((s) => (selectedWs ? s.messages[selectedWs] : undefined)) ?? EMPTY
  const ws = workspaces.find((w) => w.id === selectedWs) ?? null
  // On Home, the composer targets the selected project's main checkout.
  const homeWs = useMemo(
    () => workspaces.find((w) => w.projectId === selectedProject && w.name === 'local') ?? workspaces.find((w) => w.projectId === selectedProject) ?? null,
    [workspaces, selectedProject]
  )
  const project = projects.find((p) => p.id === (ws?.projectId ?? selectedProject))

  const showHome = !ws || messages.length === 0
  return (
    <>
      <PageHeader leftCollapsed={leftCollapsed} onExpandLeft={onExpandLeft}>
        <span className="text-dim">{project?.name ?? 'code-maxxer'}</span>
        {ws && (
          <>
            <span className="text-mute">/</span>
            <span className="font-mono text-[12px] text-ink">{ws.branch}</span>
          </>
        )}
        <div className="flex-1" />
        {rightCollapsed && <PaneToggle side="right" onClick={onExpandRight} label="Show files" />}
      </PageHeader>
      {showHome ? (
        <Home onSendWs={ws ?? homeWs} />
      ) : (
        <Chat wsId={ws!.id} />
      )}
    </>
  )
}

function Home({ onSendWs: ws }: { onSendWs: Workspace | null }) {
  const projects = useStore((s) => s.projects)
  const selectedProject = useStore((s) => s.selectedProject)
  const [newWs, setNewWs] = useState(false)

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-8">
      <div className="flex w-full max-w-[720px] flex-1 flex-col justify-center py-10">
        <div className="cm-in flex flex-col items-center text-center">
          <CmLogo size={52} />
          <h1 className="mt-5 text-[22px] font-semibold tracking-tight">What are we shipping?</h1>
          <p className="mt-1.5 text-[13px] text-dim">Talk to the orchestrator. It acts directly or runs a pipeline that loops until QA passes.</p>
        </div>

        <div className="mt-8 grid grid-cols-3 gap-2.5">
          <QuickAction icon={<FolderPlus size={16} />} title="Add project" text="Open a git repository" onClick={actions.addProject} />
          <QuickAction
            icon={<GitBranchPlus size={16} />}
            title="Create workspace"
            text="New branch + worktree"
            disabled={!selectedProject}
            onClick={() => setNewWs(true)}
          />
          <QuickAction
            icon={<Workflow size={16} />}
            title="Run a pipeline"
            text="Plan → build → QA loop"
            disabled={!ws}
            onClick={() => document.querySelector<HTMLTextAreaElement>('textarea')?.focus()}
          />
        </div>

        <div className="mt-8">
          <Composer ws={ws} autoFocus onSent={(id) => void actions.selectWorkspace(id)} />
        </div>

        <div className="mt-8 grid grid-cols-2 gap-x-8 gap-y-2.5 px-2 text-[12px] text-dim">
          <Shortcut keys={['⌘', 'K']} label="Jump to branch" />
          <Shortcut keys={['⌘', '1']} label="Switch project 1…9" />
          <Shortcut keys={['↵']} label="Send" />
          <Shortcut keys={['⇧', '↵']} label="New line" />
        </div>
        {projects.length === 0 && (
          <p className="mt-6 text-center text-[12px] text-mute">Start by adding a project: its checkout becomes your first workspace.</p>
        )}
      </div>
      {newWs && selectedProject && <NewWorkspaceDialog projectId={selectedProject} onClose={() => setNewWs(false)} />}
    </div>
  )
}

function QuickAction(p: { icon: React.ReactNode; title: string; text: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={p.onClick}
      disabled={p.disabled}
      className="group flex flex-col gap-3 rounded-xl border border-line bg-white/[.015] p-3.5 text-left transition-colors hover:border-line-strong hover:bg-white/[.035] disabled:pointer-events-none disabled:opacity-40"
    >
      <span className="grid size-8 place-items-center rounded-lg border border-line bg-raised text-dim group-hover:text-ink">{p.icon}</span>
      <span>
        <span className="block text-[13px] font-medium text-ink">{p.title}</span>
        <span className="block text-[12px] text-mute">{p.text}</span>
      </span>
    </button>
  )
}

function Shortcut({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div className="flex items-center justify-between border-b border-line pb-2">
      <span>{label}</span>
      <Kbd keys={keys} />
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
        <div className="mx-auto flex max-w-[760px] flex-col gap-6 px-6 pb-8 pt-6">
          {messages.map((m) => (
            <MessageView key={m.id} m={m} />
          ))}
        </div>
      </div>
      <div className="mx-auto w-full max-w-[760px] px-6 pb-4">
        <Composer ws={ws} />
      </div>
    </>
  )
}
