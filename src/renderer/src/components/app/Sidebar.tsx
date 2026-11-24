import { useEffect, useMemo, useRef, useState } from 'react'
import { ApprovalsInbox } from './ApprovalsInbox'
import {
  ArrowLeft, ArrowRight, BookOpen, Brain, GitPullRequestArrow, ChevronRight, Palette, Radar, ShieldHalf, ChevronsUpDown, CircleDot, KanbanSquare, CircleHelp, Plug, Settings, Folder, FolderInput, FolderOpen, FolderPlus, FolderSearch, GitBranch, Home, MoreHorizontal,
  Pencil, Plus, Search, Trash2, Unlink, Workflow, Zap
, Link2 } from 'lucide-react'
import type { Project, ProjectFolder, Workspace } from '@shared/types'
import { actions, getState as useStoreSnapshot, useStore } from '@/lib/store'
import { Marquee } from './Marquee'
import { cn, timeAgo, timeAgoLabel } from '@/lib/utils'
import { Kbd } from '../affect/kbd'
import { Spinner } from '../affect/spinner'
import { ShimmerText } from '../affect/shimmer-loader'
import { Tooltip } from '../affect/tooltip'
import { DropdownMenu } from '../affect/dropdown-menu'
import { NewWorkspaceDialog } from './NewWorkspaceDialog'
import { PaneToggle } from './PaneToggle'
import { ConfirmDialog } from './ConfirmDialog'
import { PromptDialog } from './PromptDialog'
import { ProBadge } from './ProGate'
import type { View } from '@/lib/store'
import { TextField } from '../affect/text-field'
import { t } from '@/lib/i18n'
import { Github } from './Logos'
import { CloneRepoDialog } from './CloneRepoDialog'
import { ProjectPicker } from './ProjectPicker'
import { SetupGuideCard, useSetupGuide } from './SetupGuideCard'

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
  const [cloning, setCloning] = useState(false)
  const [newWsFor, setNewWsFor] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ project: Project; mode: 'forget' | 'delete' } | null>(null)
  const search = useRef<HTMLInputElement>(null)
  const [openIssues, setOpenIssues] = useState(0)
  const guide = useSetupGuide()

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

  // The innermost target wins: a folder inside the list must not hand the drop on to the list (that put the project back out).
  const dropProps = (folderId: string | null) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(DND)) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'move'
      setDropTarget(folderId ?? 'root')
    },
    onDragLeave: (e: React.DragEvent) => {
      // Moving over the target's own children is not leaving it
      if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return
      setDropTarget((cur) => (cur === (folderId ?? 'root') ? null : cur))
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
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
      <div className="lights-lane drag flex h-11 shrink-0 items-center gap-1 pr-3">
        <PaneToggle side="left" onClick={onCollapse} label={t('Hide sidebar')} />
        <div className="flex-1" />
        <Tooltip content={t('Back')} side="bottom">
          <button className="no-drag rounded-md p-1.5 text-mute hover:bg-white/5 hover:text-ink disabled:opacity-35 disabled:hover:bg-transparent" disabled={!nav.back} onClick={actions.back} aria-label={t('Back')}>
            <ArrowLeft size={14} />
          </button>
        </Tooltip>
        <Tooltip content={t('Forward')} side="bottom">
          <button className="no-drag rounded-md p-1.5 text-mute hover:bg-white/5 hover:text-ink disabled:opacity-35 disabled:hover:bg-transparent" disabled={!nav.forward} onClick={actions.forward} aria-label={t('Forward')}>
            <ArrowRight size={14} />
          </button>
        </Tooltip>
        <Tooltip content={t('Home')} side="bottom">
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
          aria-label={t('Jump to branch')}
          ref={search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && (setQuery(''), e.currentTarget.blur())}
          placeholder={t('Jump to branch…')}
        />
      </div>

      {/* Fixed height (six rows): more pages scroll here instead of pushing the projects down */}
      <nav className="cm-thin-scroll flex h-[205px] shrink-0 flex-col gap-px overflow-y-auto px-2 pb-2 [&>*]:shrink-0">
        <ApprovalsInbox />
        <NavItem icon={<KanbanSquare size={14} />} label="Board" view="issues" current={view} count={openIssues} />
        <NavItem icon={<Workflow size={14} />} label="Pipelines" view="pipelines" current={view} />
        <NavItem icon={<Zap size={14} />} label="Automations" view="automations" current={view} />
        <NavItem icon={<Brain size={14} />} label="Brain" view="brain" current={view} />
        <NavItem icon={<Palette size={14} />} label="Design System" view="design" current={view} badge={<ProBadge />} />
        <NavItem icon={<Radar size={14} />} label="Recon" view="recon" current={view} badge={<ProBadge />} />
        <NavItem icon={<ShieldHalf size={14} />} label="Cyber Security" view="security" current={view} badge={<ProBadge />} />
        <NavItem icon={<GitPullRequestArrow size={14} />} label="Code Review" view="review" current={view} badge={<ProBadge />} />
        <NavItem icon={<BookOpen size={14} />} label="Documentation" view="docs" current={view} badge={<ProBadge />} />
      </nav>

      <div
        {...dropProps(null)}
        className={cn(
          'flex items-center gap-1 border-t border-line pb-1 pl-4 pr-2 pt-2.5 text-[11px] font-medium text-mute',
          dropTarget === 'root' && 'text-accent'
        )}
      >
        <span className="flex-1">{t('Projects')}</span>
        <Tooltip content={t('New folder')} side="bottom">
          <button
            onClick={() => void actions.newFolder(t('New folder'))}
            className="grid size-6 place-items-center rounded-md hover:bg-white/[.06] hover:text-ink"
            aria-label={t('New folder')}
          >
            <FolderPlus size={13} />
          </button>
        </Tooltip>
        <Tooltip content={t('Add project')} side="bottom">
          <button onClick={() => void actions.addProject()} className="grid size-6 place-items-center rounded-md hover:bg-white/[.06] hover:text-ink" aria-label={t('Add project')}>
            <Plus size={14} />
          </button>
        </Tooltip>
        <Tooltip content={t('Clone from GitHub')} side="bottom">
          <button onClick={() => setCloning(true)} className="grid size-6 place-items-center rounded-md hover:bg-white/[.06] hover:text-ink" aria-label={t('Clone from GitHub')}>
            <Github size={13} />
          </button>
        </Tooltip>
        {cloning && <CloneRepoDialog onClose={() => setCloning(false)} />}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4" {...dropProps(null)}>
        {projects.length === 0 && (
          <button
            onClick={() => void actions.addProject()}
            className="mx-1 mt-2 flex w-[calc(100%-8px)] items-center gap-2 rounded-xl border border-dashed border-line-strong px-3 py-3 text-left text-dim hover:border-white/25 hover:text-ink"
          >
            {t('Add your first project')} <FolderPlus size={15} />
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

      <SetupGuideCard guide={guide} />
      {/* footer, like a desktop app: settings and help */}
      <div className="flex h-10 shrink-0 items-center gap-0.5 border-t border-line px-2">
        <Tooltip content={t('Settings') + '  ⌘,'} side="top">
          <button onClick={() => actions.openSettings()} aria-label={t('Settings')} className="grid size-7 place-items-center rounded-md text-mute hover:bg-white/[.06] hover:text-ink">
            <Settings size={15} />
          </button>
        </Tooltip>
        <Tooltip content={t('Setup guide')} side="top">
          <button onClick={guide.reopen} aria-label={t('Setup guide')} className="grid size-7 place-items-center rounded-md text-mute hover:bg-white/[.06] hover:text-ink">
            <CircleHelp size={15} />
          </button>
        </Tooltip>
        <div className="flex-1" />
        <Tooltip content={t('MCP server')} side="top">
          <button onClick={() => actions.openSettings('mcp')} aria-label={t('MCP server settings')} className="grid size-7 place-items-center rounded-md text-mute hover:bg-white/[.06] hover:text-ink">
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
  const [renaming, setRenaming] = useState(f.name === 'New folder' || f.name === t('New folder'))
  const [cloning, setCloning] = useState(false)
  const [name, setName] = useState(f.name)
  const commit = () => {
    setRenaming(false)
    const n = name.trim() || 'Folder'
    if (n !== f.name) void actions.saveFolder({ ...f, name: n })
  }
  return (
    <div
      className={cn('mb-1 rounded-lg transition-[background-color,box-shadow] duration-150', highlight && 'bg-accent/[.08] ring-1 ring-inset ring-accent/50')}
      {...dropProps}
    >
      <div
        className={cn(
          'group flex items-center gap-2 rounded-lg px-2 text-[13px] text-dim',
          renaming ? 'py-1' : 'h-8',
          highlight ? 'text-ink' : 'hover:bg-white/[.03] hover:text-ink'
        )}
        onClick={() => !renaming && void actions.saveFolder({ ...f, collapsed: !f.collapsed })}
        onDoubleClick={() => setRenaming(true)}
      >
        <ChevronRight size={12} className={cn('shrink-0 text-mute transition-transform', !f.collapsed && 'rotate-90')} />
        {/* As big as a project's avatar, no tile */}
        {f.collapsed && !highlight ? (
          <Folder size={20} strokeWidth={1.6} className="shrink-0 text-mute" />
        ) : (
          <FolderOpen size={20} strokeWidth={1.6} className={cn('shrink-0', highlight ? 'text-accent' : 'text-mute')} />
        )}
        {renaming ? (
          <TextField
            size="sm"
            className="min-w-0 flex-1"
            aria-label={t('Folder name')}
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
          <Marquee className="min-w-0 flex-1 font-medium" delay={300}>{f.name}</Marquee>
        )}
        <span onClick={(e) => e.stopPropagation()} className={cn(renaming && 'hidden')}>
          <DropdownMenu
            align="end"
            width={200}
            items={[
              {
                label: t('Add project'), icon: <FolderPlus size={14} />,
                submenu: [
                  { label: t('Local folder'), icon: <FolderInput size={14} />, onSelect: () => void actions.addProject(f.id) },
                  { label: 'GitHub', icon: <Github size={14} />, onSelect: () => setCloning(true) }
                ]
              },
              { label: t('Rename'), icon: <Pencil size={14} />, divider: true, onSelect: () => setRenaming(true) },
              { label: t('Delete folder'), description: t('Projects move out, nothing is deleted'), icon: <Trash2 size={14} />, danger: true, divider: true, onSelect: () => void actions.deleteFolder(f.id) }
            ]}
            trigger={({ triggerProps }) => (
              <button {...triggerProps} aria-label={t('Folder menu')} className="grid size-6 place-items-center rounded-md text-mute opacity-0 hover:bg-white/10 hover:text-ink group-hover:opacity-100 aria-expanded:opacity-100">
                <MoreHorizontal size={14} />
              </button>
            )}
          />
        </span>
      </div>
      {cloning && <CloneRepoDialog folderId={f.id} onClose={() => setCloning(false)} />}
      {(!f.collapsed || highlight) && (
        <div className={cn('ml-[13px] border-l pl-1.5 pt-0.5', highlight ? 'border-accent/50' : 'border-line')}>
          {!f.collapsed && count > 0 && children}
          {(count === 0 || highlight) && (
            <div className={cn('px-2 py-1.5 text-[11.5px]', highlight ? 'font-medium text-accent' : 'text-mute')}>
              {highlight ? t('Drop to move it here') : t('Drag projects here')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function ProjectAvatar({ p, className }: { p: Project; className?: string }) {
  const [broken, setBroken] = useState(false)
  if (p.avatarUrl && !broken)
    return (
      <img
        src={p.avatarUrl}
        alt=""
        title={p.owner ?? undefined}
        onError={() => setBroken(true)}
        className={cn('size-5 shrink-0 rounded-md bg-raised object-cover ring-1 ring-white/10', className)}
        draggable={false}
      />
    )
  return (
    <span className={cn('grid size-5 shrink-0 place-items-center rounded-md text-[10.5px] font-semibold text-black/80', className)} style={{ background: p.color }}>
      {p.name[0]?.toUpperCase()}
    </span>
  )
}

/** The project's branches merged into its main branch, when its settings hide them: read now, every two minutes and on a settings change. */
function useMergedBranches(projectId: string): Set<string> {
  const [ids, setIds] = useState<Set<string>>(() => new Set())
  useEffect(() => {
    let on = true
    const load = () => void window.cm.project.merged?.(projectId).then((x) => on && setIds(new Set(x))).catch(() => {})
    load()
    const timer = setInterval(load, 120_000)
    const changed = (e: Event) => (e as CustomEvent).detail === projectId && load()
    window.addEventListener('cm-project-settings', changed)
    return () => {
      on = false
      clearInterval(timer)
      window.removeEventListener('cm-project-settings', changed)
    }
  }, [projectId])
  return ids
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
  const allProjects = useStore((s) => s.projects)
  const [name, setName] = useState(p.name)
  const active = p.id === selectedProject
  const runningCount = list.filter((w) => w.status === 'running').length
  // "Hide merged branches" (project settings): merged ones leave the list – the open one stays until you leave it
  const merged = useMergedBranches(p.id)
  const shown = list.filter((w) => !merged.has(w.id) || (view === 'chat' && w.id === selectedWs))
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
          const row = e.currentTarget
          requestAnimationFrame(() => (row.style.opacity = '0.4'))
        }}
        onDragEnd={(e) => (e.currentTarget.style.opacity = '')}
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
            aria-label={t('Project name')}
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
          <Marquee className="min-w-0 flex-1 font-medium" delay={300}>
            {runningCount > 0 ? <ShimmerText>{p.name}</ShimmerText> : p.name}
          </Marquee>
        )}
        {!renaming && (p.linked?.length ?? 0) > 0 && (
          <Tooltip content={t('Works with {names}', { names: p.linked!.map((id) => allProjects.find((x) => x.id === id)?.name).filter(Boolean).join(', ') })} side="right">
            <Link2 size={12} className="shrink-0 text-mute" aria-label={t('Linked projects')} />
          </Tooltip>
        )}
        <span
          onClick={(e) => e.stopPropagation()}
          className="flex max-w-0 shrink-0 items-center gap-0.5 overflow-hidden opacity-0 transition-[max-width,opacity] duration-300 ease-[cubic-bezier(.22,1,.36,1)] group-hover:max-w-[150px] group-hover:opacity-100 has-[[aria-expanded=true]]:max-w-[150px] has-[[aria-expanded=true]]:opacity-100"
        >
          {index < 9 && <Kbd keys={['⌘', String(index + 1)]} className="mr-0.5" />}
          <button
            className="grid size-6 shrink-0 place-items-center rounded-md text-mute hover:bg-white/10 hover:text-ink"
            onClick={onNewWorkspace}
            aria-label={t('New branch')}
          >
            <Plus size={13} />
          </button>
          <DropdownMenu
            align="end"
            width={280}
            items={[
              { label: t('New branch'), icon: <GitBranch size={14} />, shortcut: '⌘N', onSelect: onNewWorkspace },
              { label: t('Rename'), icon: <Pencil size={14} />, onSelect: () => setRenaming(true) },
              {
                label: t('Move to folder'),
                icon: <FolderInput size={14} />,
                submenu: [
                  { label: t('No folder'), type: 'radio', checked: !p.folderId, onSelect: () => void actions.moveProject(p.id, null) },
                  ...folders.map((f, i) => ({
                    label: f.name, type: 'radio' as const, checked: p.folderId === f.id, divider: i === 0,
                    onSelect: () => void actions.moveProject(p.id, f.id)
                  })),
                  { label: t('New folder…'), icon: <FolderPlus size={14} />, divider: true, onSelect: () => void actions.newFolder(t('New folder')) }
                ]
              },
              {
                label: t('Link project'),
                icon: <Link2 size={14} />,
                // The searchable project picker, with checkboxes, opens beside it like a submenu
                panel: (
                  <ProjectPicker
                    inline
                    value={p.id}
                    multiple={{ values: p.linked ?? [], locked: [p.id], onToggle: (id, on) => void actions.linkProjects(p.id, id, on) }}
                  />
                )
              },
              { label: t('Reveal in Finder'), icon: <FolderSearch size={14} />, onSelect: () => void window.cm.revealPath(p.path) },
              { label: t('Settings'), icon: <Settings size={14} />, divider: true, onSelect: () => actions.openSettings(`project:${p.id}`) },
              { label: t('Remove from workspace'), icon: <Unlink size={14} />, divider: true, onSelect: () => onRemove('forget') },
              { label: t('Delete project'), icon: <Trash2 size={14} />, danger: true, onSelect: () => onRemove('delete') }
            ]}
            trigger={({ triggerProps }) => (
              <button {...triggerProps} aria-label={t('Project menu')} className="grid size-6 shrink-0 place-items-center rounded-md text-mute hover:bg-white/10 hover:text-ink">
                <MoreHorizontal size={14} />
              </button>
            )}
          />
        </span>
      </div>

      {open && (
        <div className="ml-[18px] mt-1 flex flex-col gap-1.5 border-l border-line pb-1 pl-2.5">
          {shown.map((w) => (
            <WorkspaceCard key={w.id} ws={w} selected={view === 'chat' && w.id === selectedWs} />
          ))}
          <button
            onClick={onNewWorkspace}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-dashed border-line px-2.5 text-[12px] text-mute hover:border-line-strong hover:text-dim"
          >
            {t('New branch')} <Plus size={12} />
          </button>
        </div>
      )}
    </div>
  )
}

export function RemoveProjectDialog({ project, mode, worktrees, onClose }: { project: Project; mode: 'forget' | 'delete'; worktrees: number; onClose: () => void }) {
  const del = mode === 'delete'
  return (
    <ConfirmDialog
      title={del ? t('Delete {name}?', { name: project.name }) : t('Remove {name} from the workspace?', { name: project.name })}
      danger={del}
      confirmLabel={del ? t('Delete project') : t('Remove')}
      onClose={onClose}
      onConfirm={() => actions.removeProject(project.id, mode)}
    >
      {del ? (
        <>
          <p>
            {t("This deletes the project's chat history, pipeline runs and brain from code-maxxer, and")}{' '}
            <b className="text-ink">{worktrees === 1 ? t('1 worktree') : t('{n} worktrees', { n: worktrees })}</b> {t('with their')} <span className="font-mono">cm/</span>{' '}
            {t("branches. Uncommitted changes inside those worktrees are lost. This can't be undone.")}
          </p>
          <p className="mt-2">
            {t('The repository at')} <span className="font-mono text-ink">{project.path}</span> {t('itself is not touched.')}
          </p>
        </>
      ) : (
        <p>
          {t('It disappears from the sidebar with its chats and brain. Nothing on disk changes: the repository, its worktrees and branches stay where they are. You can add it again any time.')}
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
      <span className="flex-1 text-left">{t(label)}</span>
      {!!count && <span className="rounded-full bg-bad/15 px-1.5 text-[11px] tabular-nums text-bad">{count}</span>}
      {badge}
    </button>
  )
}

function WorkspaceCard({ ws, selected }: { ws: Workspace; selected: boolean }) {
  // A twin branch (work across linked projects) shows like any other branch of its project.
  const status = ws.status
  const running = status === 'running'
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
        <span className="shrink-0 text-[11.5px] tabular-nums text-mute">{timeAgoLabel(ws.updatedAt)}</span>
        {running ? (
          <Spinner size={11} className="text-accent" />
        ) : (
          <span className={cn('size-1.5 rounded-full', status === 'error' ? 'bg-bad' : status === 'done' ? 'bg-ok' : 'bg-white/20')} />
        )}
      </div>
    </button>
  )
}
