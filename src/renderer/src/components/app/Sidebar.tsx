import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, ArrowRight, Brain, GitPullRequestArrow, ChevronRight, Palette, Radar, ShieldHalf, ChevronsUpDown, CircleDot, KanbanSquare, CircleHelp, Plug, Settings, Folder, FolderInput, FolderOpen, FolderPlus, FolderSearch, GitBranch, Home, MoreHorizontal,
  Pencil, Plus, Search, Trash2, Unlink, Workflow
} from 'lucide-react'
import type { Project, ProjectFolder, Workspace } from '@shared/types'
import { actions, getState as useStoreSnapshot, useStore } from '@/lib/store'
import { Marquee } from './Marquee'
import { cn, timeAgo } from '@/lib/utils'
import { Kbd } from '../affect/kbd'
import { Spinner } from '../affect/spinner'
import { Tooltip } from '../affect/tooltip'
import { DropdownMenu } from '../affect/dropdown-menu'
import { NewWorkspaceDialog } from './NewWorkspaceDialog'
import { PaneToggle } from './PaneToggle'
import { ConfirmDialog } from './ConfirmDialog'
import { PromptDialog } from './PromptDialog'
import { ProBadge } from './ProGate'
import type { View } from '@/lib/store'
import { TextField } from '../affect/text-field'

const DND = 'application/x-cm-project'
const FOLDED_KEY = 'cm2.foldedProjects'
const readFolded = (): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(FOLDED_KEY) ?? '[]'))
  } catch {
    return new Set()
  }
}

export function Sidebar({ onCollapse }: { onCollapse: () => void }) {
  const nav = useStore((s) => s.nav)
  const space = useStore((s) => s.space)
  const allProjects = useStore((s) => s.projects)
  const allFolders = useStore((s) => s.folders)
  // Only the current workspace's projects and folders.
  const projects = useMemo(() => allProjects.filter((p) => p.spaceId === space), [allProjects, space])
  const folders = useMemo(() => allFolders.filter((f) => f.spaceId === space), [allFolders, space])
  const workspaces = useStore((s) => s.workspaces)
  const view = useStore((s) => s.view)
  const [query, setQuery] = useState('')
  const [newWsFor, setNewWsFor] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ project: Project; mode: 'forget' | 'delete' } | null>(null)
  const search = useRef<HTMLInputElement>(null)
  const [openIssues, setOpenIssues] = useState(0)

  useEffect(() => {
    void window.cm.listIssues().then((l) => setOpenIssues(l.filter((i) => i.status === 'open' || i.status === 'in_progress').length))
  }, [workspaces, view])

  // ⌘K jump, ⌘1…9 project, ⌘N new workspace, ⌘⇧↑/↓ previous/next workspace.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey) return
      if (e.key === 'k') {
        e.preventDefault()
        search.current?.focus()
      } else if (e.key === ',') {
        e.preventDefault()
        actions.openSettings()
      } else if (e.key === 'n' && !e.shiftKey) {
        const pid = useStoreSnapshot().selectedProject ?? projects[0]?.id
        if (pid) {
          e.preventDefault()
          setNewWsFor(pid)
        }
      } else if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault()
        actions.stepWorkspace(e.key === 'ArrowUp' ? -1 : 1)
      } else {
        const n = Number(e.key)
        if (n >= 1 && n <= 9 && projects[n - 1]) {
          e.preventDefault()
          actions.selectProject(projects[n - 1].id)
          const first = workspaces.find((w) => w.projectId === projects[n - 1].id)
          if (first) void actions.selectWorkspace(first.id)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [projects, workspaces])

  const byProject = useMemo(() => {
    const q = query.trim().toLowerCase()
    const m = new Map<string, Workspace[]>()
    for (const w of workspaces) {
      if (q && !`${w.name} ${w.branch}`.toLowerCase().includes(q)) continue
      m.set(w.projectId, [...(m.get(w.projectId) ?? []), w])
    }
    return m
  }, [workspaces, query])

  const dropProps = (folderId: string | null) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(DND)) return
      e.preventDefault()
      setDropTarget(folderId ?? 'root')
    },
    onDragLeave: () => setDropTarget((t) => (t === (folderId ?? 'root') ? null : t)),
    onDrop: (e: React.DragEvent) => {
      const id = e.dataTransfer.getData(DND)
      setDropTarget(null)
      if (id) void actions.moveProject(id, folderId)
    }
  })

  const loose = projects.filter((p) => !p.folderId || !folders.some((f) => f.id === p.folderId))
  const index = new Map(projects.map((p, i) => [p.id, i]))

  const renderProject = (p: Project) => (
    <ProjectRow
      key={p.id}
      p={p}
      index={index.get(p.id) ?? 99}
      list={byProject.get(p.id) ?? []}
      folders={folders}
      onNewWorkspace={() => setNewWsFor(p.id)}
      onRemove={(mode) => setConfirm({ project: p, mode })}
    />
  )

  return (
    <aside className="flex w-full min-w-0 flex-col bg-bg">
      {/* traffic-light lane, then the fold button */}
      <div className="drag flex h-11 shrink-0 items-center gap-1 pl-[78px] pr-3">
        <PaneToggle side="left" onClick={onCollapse} label="Hide sidebar" />
        <div className="flex-1" />
        <Tooltip content="Back" side="bottom">
          <button className="no-drag rounded-md p-1.5 text-mute hover:bg-white/5 hover:text-ink disabled:opacity-35 disabled:hover:bg-transparent" disabled={!nav.back} onClick={actions.back} aria-label="Back">
            <ArrowLeft size={14} />
          </button>
        </Tooltip>
        <Tooltip content="Forward" side="bottom">
          <button className="no-drag rounded-md p-1.5 text-mute hover:bg-white/5 hover:text-ink disabled:opacity-35 disabled:hover:bg-transparent" disabled={!nav.forward} onClick={actions.forward} aria-label="Forward">
            <ArrowRight size={14} />
          </button>
        </Tooltip>
        <Tooltip content="Home" side="bottom">
          <button className="no-drag rounded-md p-1.5 text-mute hover:bg-white/5 hover:text-ink" onClick={actions.goHome}>
            <Home size={14} />
          </button>
        </Tooltip>
      </div>

      <div className="px-3 pb-2">
        <TextField
          size="sm"
          prefix={<Search size={13} />}
          suffix={<Kbd keys={['⌘', 'K']} />}
          aria-label="Jump to branch"
          ref={search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && (setQuery(''), e.currentTarget.blur())}
          placeholder="Jump to branch…"
        />
      </div>

      {/* Fixed height (six rows): more pages scroll here instead of pushing the projects down */}
      <nav className="cm-thin-scroll flex h-[205px] shrink-0 flex-col gap-px overflow-y-auto px-2 pb-2 [&>*]:shrink-0">
        <NavItem icon={<KanbanSquare size={14} />} label="Board" view="issues" current={view} count={openIssues} />
        <NavItem icon={<Workflow size={14} />} label="Pipelines" view="pipelines" current={view} />
        <NavItem icon={<Brain size={14} />} label="Brain" view="brain" current={view} />
        <NavItem icon={<Palette size={14} />} label="Design System" view="design" current={view} badge={<ProBadge />} />
        <NavItem icon={<Radar size={14} />} label="Recon" view="recon" current={view} badge={<ProBadge />} />
        <NavItem icon={<ShieldHalf size={14} />} label="Cyber Security" view="security" current={view} badge={<ProBadge />} />
        <NavItem icon={<GitPullRequestArrow size={14} />} label="Code Review" view="review" current={view} badge={<ProBadge />} />
      </nav>

      <div
        {...dropProps(null)}
        className={cn(
          'flex items-center gap-1 border-t border-line pb-1 pl-4 pr-2 pt-2.5 text-[11px] font-medium text-mute',
          dropTarget === 'root' && 'text-accent'
        )}
      >
        <span className="flex-1">Projects</span>
        <Tooltip content="New folder" side="bottom">
          <button
            onClick={() => void actions.newFolder('New folder')}
            className="grid size-6 place-items-center rounded-md hover:bg-white/[.06] hover:text-ink"
            aria-label="New folder"
          >
            <FolderPlus size={13} />
          </button>
        </Tooltip>
        <Tooltip content="Add project" side="bottom">
          <button onClick={actions.addProject} className="grid size-6 place-items-center rounded-md hover:bg-white/[.06] hover:text-ink" aria-label="Add project">
            <Plus size={14} />
          </button>
        </Tooltip>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4" {...dropProps(null)}>
        {projects.length === 0 && (
          <button
            onClick={actions.addProject}
            className="mx-1 mt-2 flex w-[calc(100%-8px)] items-center gap-2 rounded-xl border border-dashed border-line-strong px-3 py-3 text-left text-dim hover:border-white/25 hover:text-ink"
          >
            <FolderPlus size={15} /> Add your first project
          </button>
        )}
        {folders.map((f) => (
          <FolderRow
            key={f.id}
            f={f}
            count={projects.filter((p) => p.folderId === f.id).length}
            highlight={dropTarget === f.id}
            dropProps={dropProps(f.id)}
          >
            {projects.filter((p) => p.folderId === f.id).map(renderProject)}
          </FolderRow>
        ))}
        {loose.map(renderProject)}
      </div>

      {/* footer, like a desktop app: settings and help */}
      <div className="flex h-10 shrink-0 items-center gap-0.5 border-t border-line px-2">
        <Tooltip content="Settings  ⌘," side="top">
          <button onClick={() => actions.openSettings()} aria-label="Settings" className="grid size-7 place-items-center rounded-md text-mute hover:bg-white/[.06] hover:text-ink">
            <Settings size={15} />
          </button>
        </Tooltip>
        <Tooltip content="Help" side="top">
          <button onClick={() => window.open('https://github.com/FedericoCasarella/code-maxxer-2#readme', '_blank')} aria-label="Help" className="grid size-7 place-items-center rounded-md text-mute hover:bg-white/[.06] hover:text-ink">
            <CircleHelp size={15} />
          </button>
        </Tooltip>
        <div className="flex-1" />
        <Tooltip content="MCP server" side="top">
          <button onClick={() => actions.openSettings('mcp')} aria-label="MCP server settings" className="grid size-7 place-items-center rounded-md text-mute hover:bg-white/[.06] hover:text-ink">
            <Plug size={14} />
          </button>
        </Tooltip>
      </div>
      {newWsFor && <NewWorkspaceDialog projectId={newWsFor} onClose={() => setNewWsFor(null)} />}
      {confirm && (
        <RemoveProjectDialog
          project={confirm.project}
          mode={confirm.mode}
          worktrees={workspaces.filter((w) => w.projectId === confirm.project.id && w.worktreePath !== confirm.project.path).length}
          onClose={() => setConfirm(null)}
        />
      )}
    </aside>
  )
}

function FolderRow({
  f, count, highlight, dropProps, children
}: { f: ProjectFolder; count: number; highlight: boolean; dropProps: object; children: React.ReactNode }) {
  const [renaming, setRenaming] = useState(f.name === 'New folder')
  const [name, setName] = useState(f.name)
  const commit = () => {
    setRenaming(false)
    const n = name.trim() || 'Folder'
    if (n !== f.name) void actions.saveFolder({ ...f, name: n })
  }
  return (
    <div className="mb-1" {...dropProps}>
      <div
        className={cn(
          'group flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] text-dim',
          highlight ? 'bg-accent/10 text-ink ring-1 ring-accent/40' : 'hover:bg-white/[.03] hover:text-ink'
        )}
        onClick={() => !renaming && void actions.saveFolder({ ...f, collapsed: !f.collapsed })}
        onDoubleClick={() => setRenaming(true)}
      >
        <ChevronRight size={12} className={cn('text-mute transition-transform', !f.collapsed && 'rotate-90')} />
        {f.collapsed ? <Folder size={14} className="text-[#c9a86a]" /> : <FolderOpen size={14} className="text-[#c9a86a]" />}
        {renaming ? (
          <TextField
            size="sm"
            className="min-w-0 flex-1"
            aria-label="Folder name"
            autoFocus
            value={name}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setName(e.target.value)}
            onBlur={commit}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') (setName(f.name), setRenaming(false))
            }}
          />
        ) : (
          <span className="min-w-0 flex-1 truncate font-medium">{f.name}</span>
        )}
        <span className="text-[11px] tabular-nums text-mute">{count}</span>
        <span onClick={(e) => e.stopPropagation()}>
          <DropdownMenu
            align="end"
            width={200}
            items={[
              { label: 'Rename', icon: <Pencil size={14} />, onSelect: () => setRenaming(true) },
              { label: 'Delete folder', description: 'Projects move out, nothing is deleted', icon: <Trash2 size={14} />, danger: true, divider: true, onSelect: () => void actions.deleteFolder(f.id) }
            ]}
            trigger={({ triggerProps }) => (
              <button {...triggerProps} aria-label="Folder menu" className="grid size-6 place-items-center rounded-md text-mute opacity-0 hover:bg-white/10 hover:text-ink group-hover:opacity-100 aria-expanded:opacity-100">
                <MoreHorizontal size={14} />
              </button>
            )}
          />
        </span>
      </div>
      {!f.collapsed && (
        <div className="ml-[13px] border-l border-line pl-1.5 pt-0.5">
          {count === 0 ? <div className="px-2 py-1.5 text-[11.5px] text-mute">Drag projects here</div> : children}
        </div>
      )}
    </div>
  )
}

export function ProjectAvatar({ p }: { p: Project }) {
  const [broken, setBroken] = useState(false)
  if (p.avatarUrl && !broken)
    return (
      <img
        src={p.avatarUrl}
        alt=""
        title={p.owner ?? undefined}
        onError={() => setBroken(true)}
        className="size-5 shrink-0 rounded-md bg-raised object-cover ring-1 ring-white/10"
        draggable={false}
      />
    )
  return (
    <span className="grid size-5 shrink-0 place-items-center rounded-md text-[10.5px] font-semibold text-black/80" style={{ background: p.color }}>
      {p.name[0]?.toUpperCase()}
    </span>
  )
}

function ProjectRow({
  p, index, list, folders, onNewWorkspace, onRemove
}: {
  p: Project; index: number; list: Workspace[]; folders: ProjectFolder[]
  onNewWorkspace: () => void; onRemove: (mode: 'forget' | 'delete') => void
}) {
  const selectedProject = useStore((s) => s.selectedProject)
  const selectedWs = useStore((s) => s.selectedWs)
  const view = useStore((s) => s.view)
  // Folded projects are remembered across restarts.
  const [open, setOpenState] = useState(() => !readFolded().has(p.id))
  const setOpen = (f: (o: boolean) => boolean) =>
    setOpenState((o) => {
      const next = f(o)
      const set = readFolded()
      next ? set.delete(p.id) : set.add(p.id)
      try {
        localStorage.setItem(FOLDED_KEY, JSON.stringify([...set]))
      } catch { /* ignore */ }
      return next
    })
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(p.name)
  const active = p.id === selectedProject
  const runningCount = list.filter((w) => w.status === 'running').length
  const commit = () => {
    setRenaming(false)
    const n = name.trim()
    if (n && n !== p.name) void actions.renameProject(p.id, n)
    else setName(p.name)
  }

  return (
    <div className="mb-1">
      <div
        draggable={!renaming}
        onDragStart={(e) => {
          e.dataTransfer.setData(DND, p.id)
          e.dataTransfer.effectAllowed = 'move'
        }}
        className={cn(
          'group flex h-8 cursor-default items-center gap-2 rounded-lg px-2 text-[13px]',
          active ? 'text-ink' : 'text-dim hover:bg-white/[.03] hover:text-ink'
        )}
        onClick={() => {
          if (renaming) return
          actions.selectProject(p.id)
          setOpen((o) => !o)
        }}
      >
        <ChevronRight size={12} className={cn('shrink-0 text-mute transition-transform', open && 'rotate-90')} />
        <ProjectAvatar p={p} />
        {renaming ? (
          <TextField
            size="sm"
            className="min-w-0 flex-1"
            aria-label="Project name"
            autoFocus
            value={name}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setName(e.target.value)}
            onBlur={commit}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') (setName(p.name), setRenaming(false))
            }}
          />
        ) : (
          <span className="min-w-0 flex-1 truncate font-medium">
            {p.name}
          </span>
        )}
        {/* At rest only the spinner, at the far right; on hover the options slide in and push it left. */}
        {runningCount > 0 && <Spinner size={12} className="shrink-0 text-accent" />}
        <span
          onClick={(e) => e.stopPropagation()}
          className="flex max-w-0 shrink-0 items-center gap-0.5 overflow-hidden opacity-0 transition-[max-width,opacity] duration-300 ease-[cubic-bezier(.22,1,.36,1)] group-hover:max-w-[150px] group-hover:opacity-100 has-[[aria-expanded=true]]:max-w-[150px] has-[[aria-expanded=true]]:opacity-100"
        >
          {index < 9 && <Kbd keys={['⌘', String(index + 1)]} className="mr-0.5" />}
          <button
            className="grid size-6 shrink-0 place-items-center rounded-md text-mute hover:bg-white/10 hover:text-ink"
            onClick={onNewWorkspace}
            aria-label="New branch"
          >
            <Plus size={13} />
          </button>
          <DropdownMenu
            align="end"
            width={280}
            items={[
              { label: 'New branch', icon: <GitBranch size={14} />, shortcut: '⌘N', onSelect: onNewWorkspace },
              { label: 'Rename', icon: <Pencil size={14} />, onSelect: () => setRenaming(true) },
              {
                label: 'Move to folder',
                icon: <FolderInput size={14} />,
                submenu: [
                  { label: 'No folder', type: 'radio', checked: !p.folderId, onSelect: () => void actions.moveProject(p.id, null) },
                  ...folders.map((f, i) => ({
                    label: f.name, type: 'radio' as const, checked: p.folderId === f.id, divider: i === 0,
                    onSelect: () => void actions.moveProject(p.id, f.id)
                  })),
                  { label: 'New folder…', icon: <FolderPlus size={14} />, divider: true, onSelect: () => void actions.newFolder('New folder') }
                ]
              },
              { label: 'Reveal in Finder', icon: <FolderSearch size={14} />, onSelect: () => void window.cm.revealPath(p.path) },
              { label: 'Remove from workspace', description: 'Forget it here, keep everything on disk', icon: <Unlink size={14} />, divider: true, onSelect: () => onRemove('forget') },
              { label: 'Delete project', description: 'Also delete its worktrees and cm/ branches', icon: <Trash2 size={14} />, danger: true, onSelect: () => onRemove('delete') }
            ]}
            trigger={({ triggerProps }) => (
              <button {...triggerProps} aria-label="Project menu" className="grid size-6 shrink-0 place-items-center rounded-md text-mute hover:bg-white/10 hover:text-ink">
                <MoreHorizontal size={14} />
              </button>
            )}
          />
        </span>
      </div>

      {open && (
        <div className="ml-[18px] mt-1 flex flex-col gap-1.5 border-l border-line pb-1 pl-2.5">
          {list.map((w) => (
            <WorkspaceCard key={w.id} ws={w} selected={view === 'chat' && w.id === selectedWs} />
          ))}
          <button
            onClick={onNewWorkspace}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-dashed border-line px-2.5 text-[12px] text-mute hover:border-line-strong hover:text-dim"
          >
            <Plus size={12} /> New branch
          </button>
        </div>
      )}
    </div>
  )
}

function RemoveProjectDialog({ project, mode, worktrees, onClose }: { project: Project; mode: 'forget' | 'delete'; worktrees: number; onClose: () => void }) {
  const del = mode === 'delete'
  return (
    <ConfirmDialog
      title={del ? `Delete ${project.name}?` : `Remove ${project.name} from the workspace?`}
      danger={del}
      confirmLabel={del ? 'Delete project' : 'Remove'}
      onClose={onClose}
      onConfirm={() => actions.removeProject(project.id, mode)}
    >
      {del ? (
        <>
          <p>
            This deletes the project's chat history, pipeline runs and brain from code-maxxer, and{' '}
            <b className="text-ink">{worktrees} worktree{worktrees === 1 ? '' : 's'}</b> with their <span className="font-mono">cm/</span> branches.
            Uncommitted changes inside those worktrees are lost. This can't be undone.
          </p>
          <p className="mt-2">
            The repository at <span className="font-mono text-ink">{project.path}</span> itself is not touched.
          </p>
        </>
      ) : (
        <p>
          It disappears from the sidebar with its chats and brain. Nothing on disk changes: the repository, its worktrees and
          branches stay where they are. You can add it again any time.
        </p>
      )}
    </ConfirmDialog>
  )
}

function NavItem({ icon, label, view, current, count, badge }: { icon: React.ReactNode; label: string; view: View; current: View; count?: number; badge?: React.ReactNode }) {
  const active = view === current
  const ref = useRef<HTMLButtonElement>(null)
  // The pages list has a fixed height: the open page scrolls into view.
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [active])
  return (
    <button
      ref={ref}
      onClick={() => actions.setView(view)}
      className={cn(
        'flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-colors',
        active ? 'bg-white/[.06] text-ink' : 'text-dim hover:bg-white/[.03] hover:text-ink'
      )}
    >
      <span className={active ? 'text-accent' : 'text-mute'}>{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {!!count && <span className="rounded-full bg-bad/15 px-1.5 text-[11px] tabular-nums text-bad">{count}</span>}
      {badge}
    </button>
  )
}

function WorkspaceCard({ ws, selected }: { ws: Workspace; selected: boolean }) {
  const msgs = useStore((s) => s.messages[ws.id])
  const lastUser = msgs?.findLast((m) => m.role === 'user')
  const running = ws.status === 'running'
  return (
    <button
      onClick={() => void actions.selectWorkspace(ws.id)}
      className={cn(
        'cm-in group relative flex flex-col gap-1 overflow-hidden rounded-[10px] border px-2.5 py-2 text-left transition-colors',
        selected
          ? 'border-line-strong bg-raised shadow-[0_1px_0_rgba(255,255,255,.04)_inset,0_6px_16px_-8px_rgba(0,0,0,.6)]'
          : 'border-line bg-white/[.015] hover:border-line-strong hover:bg-white/[.03]'
      )}
    >
      {running && <span className="absolute inset-y-0 left-0 w-[2px] bg-accent" style={{ animation: 'cm-pulse 1.4s ease-in-out infinite' }} />}
      <div className="flex items-center gap-1.5">
        <GitBranch size={12} className={selected ? 'text-ink' : 'text-mute'} />
        <Marquee className={cn('min-w-0 flex-1 font-mono text-[11.5px]', selected ? 'text-ink' : 'text-dim')} delay={300}>{ws.branch}</Marquee>
        {running ? (
          <Spinner size={11} className="text-accent" />
        ) : (
          <span className={cn('size-1.5 rounded-full', ws.status === 'error' ? 'bg-bad' : ws.status === 'done' ? 'bg-ok' : 'bg-white/20')} />
        )}
      </div>
      <div className="flex items-center gap-2 text-[11.5px] text-mute">
        <Marquee className="min-w-0 flex-1" delay={300}>
          {lastUser && lastUser.role === 'user' ? lastUser.text.replace(/\s+/g, ' ') : ws.name === 'local' ? 'Main checkout' : ws.name}
        </Marquee>
        <span className="shrink-0 tabular-nums">{timeAgo(ws.updatedAt)}</span>
      </div>
    </button>
  )
}
