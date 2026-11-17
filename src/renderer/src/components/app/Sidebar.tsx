import { useEffect, useMemo, useRef, useState } from 'react'
import { Bot, ChevronRight, CircleDot, FolderPlus, GitBranch, Home, Plus, Search, Workflow } from 'lucide-react'
import type { Workspace } from '@shared/types'
import { actions, useStore } from '@/lib/store'
import { cn, timeAgo } from '@/lib/utils'
import { Kbd } from '../affect/kbd'
import { Spinner } from '../affect/spinner'
import { Tooltip } from '../affect/tooltip'
import { NewWorkspaceDialog } from './NewWorkspaceDialog'
import { PaneToggle } from './PaneToggle'
import type { View } from '@/lib/store'

export function Sidebar({ onCollapse }: { onCollapse: () => void }) {
  const projects = useStore((s) => s.projects)
  const workspaces = useStore((s) => s.workspaces)
  const selectedProject = useStore((s) => s.selectedProject)
  const selectedWs = useStore((s) => s.selectedWs)
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [newWsFor, setNewWsFor] = useState<string | null>(null)
  const search = useRef<HTMLInputElement>(null)
  const view = useStore((s) => s.view)
  const [openIssues, setOpenIssues] = useState(0)
  // Refresh the open-issue count whenever a workspace changes state (runs record issues).
  useEffect(() => {
    void window.cm.listIssues().then((l) => setOpenIssues(l.filter((i) => i.status === 'open' || i.status === 'in_progress').length))
  }, [workspaces, view])

  // Quick switch: ⌘1…9 selects a project, ⌘K focuses the jump field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey) return
      if (e.key === 'k') {
        e.preventDefault()
        search.current?.focus()
      }
      const n = Number(e.key)
      if (n >= 1 && n <= 9 && projects[n - 1]) {
        e.preventDefault()
        actions.selectProject(projects[n - 1].id)
        const first = workspaces.find((w) => w.projectId === projects[n - 1].id)
        if (first) void actions.selectWorkspace(first.id)
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

  return (
    <aside className="flex w-full min-w-0 flex-col bg-bg">
      {/* traffic-light lane, then the fold button top-left */}
      <div className="drag flex h-11 items-center gap-1 pl-[78px] pr-3">
        <PaneToggle side="left" onClick={onCollapse} label="Hide sidebar" />
        <div className="flex-1" />
        <Tooltip content="Home" side="bottom">
          <button className="no-drag rounded-md p-1.5 text-mute hover:bg-white/5 hover:text-ink" onClick={actions.goHome}>
            <Home size={14} />
          </button>
        </Tooltip>
        <Tooltip content="Add project" side="bottom">
          <button className="no-drag rounded-md p-1.5 text-mute hover:bg-white/5 hover:text-ink" onClick={actions.addProject}>
            <FolderPlus size={14} />
          </button>
        </Tooltip>
      </div>

      <div className="px-3 pb-2">
        <label className="flex h-8 items-center gap-2 rounded-lg border border-line bg-raised px-2.5 text-dim focus-within:border-line-strong">
          <Search size={13} className="text-mute" />
          <input
            ref={search}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && (setQuery(''), e.currentTarget.blur())}
            placeholder="Jump to branch…"
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-mute"
          />
          <Kbd keys={['⌘', 'K']} />
        </label>
      </div>

      <nav className="flex flex-col gap-px px-2 pb-2">
        <NavItem icon={<CircleDot size={14} />} label="Issues" view="issues" current={view} count={openIssues} />
        <NavItem icon={<Workflow size={14} />} label="Pipelines" view="pipelines" current={view} />
        <NavItem icon={<Bot size={14} />} label="Agents" view="agents" current={view} />
      </nav>

      <div className="flex items-center justify-between border-t border-line px-4 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wider text-mute">
        Projects
        <span className="normal-case tracking-normal">{projects.length}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {projects.length === 0 && (
          <button
            onClick={actions.addProject}
            className="mx-1 mt-2 flex w-[calc(100%-8px)] items-center gap-2 rounded-xl border border-dashed border-line-strong px-3 py-3 text-left text-dim hover:border-white/25 hover:text-ink"
          >
            <FolderPlus size={15} /> Add your first project
          </button>
        )}
        {projects.map((p, i) => {
          const list = byProject.get(p.id) ?? []
          const open = !collapsed.has(p.id)
          const active = p.id === selectedProject
          const runningCount = list.filter((w) => w.status === 'running').length
          return (
            <div key={p.id} className="mb-1">
              <div
                className={cn(
                  'group flex h-8 cursor-default items-center gap-2 rounded-lg px-2 text-[13px]',
                  active ? 'text-ink' : 'text-dim hover:bg-white/[.03] hover:text-ink'
                )}
                onClick={() => {
                  actions.selectProject(p.id)
                  setCollapsed((c) => {
                    const n = new Set(c)
                    n.has(p.id) ? n.delete(p.id) : n.add(p.id)
                    return n
                  })
                }}
              >
                <ChevronRight size={12} className={cn('text-mute transition-transform', open && 'rotate-90')} />
                <span
                  className="grid size-5 place-items-center rounded-md text-[10.5px] font-semibold text-black/80"
                  style={{ background: p.color }}
                >
                  {p.name[0]?.toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                {runningCount > 0 && <Spinner size={12} className="text-accent" />}
                {i < 9 && (
                  <span className="opacity-0 transition-opacity group-hover:opacity-100">
                    <Kbd keys={['⌘', String(i + 1)]} />
                  </span>
                )}
                <button
                  className="rounded p-0.5 text-mute opacity-0 hover:bg-white/10 hover:text-ink group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation()
                    setNewWsFor(p.id)
                  }}
                  aria-label="New workspace"
                >
                  <Plus size={13} />
                </button>
              </div>

              {open && (
                <div className="ml-[18px] mt-1 flex flex-col gap-1.5 border-l border-line pb-1 pl-2.5">
                  {list.map((w) => (
                    <WorkspaceCard key={w.id} ws={w} selected={view === 'chat' && w.id === selectedWs} />
                  ))}
                  <button
                    onClick={() => setNewWsFor(p.id)}
                    className="flex h-8 items-center gap-1.5 rounded-lg border border-dashed border-line px-2.5 text-[12px] text-mute hover:border-line-strong hover:text-dim"
                  >
                    <Plus size={12} /> New workspace
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
      {newWsFor && <NewWorkspaceDialog projectId={newWsFor} onClose={() => setNewWsFor(null)} />}
    </aside>
  )
}

function NavItem({ icon, label, view, current, count }: { icon: React.ReactNode; label: string; view: View; current: View; count?: number }) {
  const active = view === current
  return (
    <button
      onClick={() => actions.setView(view)}
      className={cn(
        'flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-colors',
        active ? 'bg-white/[.06] text-ink' : 'text-dim hover:bg-white/[.03] hover:text-ink'
      )}
    >
      <span className={active ? 'text-accent' : 'text-mute'}>{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {!!count && <span className="rounded-full bg-bad/15 px-1.5 text-[11px] tabular-nums text-bad">{count}</span>}
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
        <span className={cn('min-w-0 flex-1 truncate font-mono text-[11.5px]', selected ? 'text-ink' : 'text-dim')}>{ws.branch}</span>
        {running ? (
          <Spinner size={11} className="text-accent" />
        ) : (
          <span
            className={cn(
              'size-1.5 rounded-full',
              ws.status === 'error' ? 'bg-bad' : ws.status === 'done' ? 'bg-ok' : 'bg-white/20'
            )}
          />
        )}
      </div>
      <div className="flex items-center gap-2 text-[11.5px] text-mute">
        <span className="min-w-0 flex-1 truncate">
          {lastUser && lastUser.role === 'user' ? lastUser.text : ws.name === 'local' ? 'Main checkout' : ws.name}
        </span>
        <span className="shrink-0 tabular-nums">{timeAgo(ws.updatedAt)}</span>
      </div>
    </button>
  )
}
