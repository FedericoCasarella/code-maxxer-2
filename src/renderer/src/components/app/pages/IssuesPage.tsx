import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, CircleDot, GitBranch, Search, X } from 'lucide-react'
import { Github } from '../Logos'
import type { Issue, IssueStatus } from '@shared/types'
import { actions, useStore } from '@/lib/store'
import { cn, timeAgo } from '@/lib/utils'
import { DropdownMenu } from '../../affect/dropdown-menu'
import { EmptyState } from '../../affect/empty-state'
import { PageHeader } from '../PageHeader'
import { GithubMirrorButton } from './GithubMirrorButton'

const COLUMNS: { id: IssueStatus; label: string; dot: string }[] = [
  { id: 'open', label: 'Open', dot: 'bg-bad' },
  { id: 'in_progress', label: 'In progress', dot: 'bg-[#8ab4ff]' },
  { id: 'resolved', label: 'Resolved', dot: 'bg-ok' },
  { id: 'wontfix', label: "Won't fix", dot: 'bg-mute' }
]

export function IssuesPage({ leftCollapsed, onExpandLeft }: { leftCollapsed: boolean; onExpandLeft: () => void }) {
  const allProjects = useStore((s) => s.projects)
  const space = useStore((s) => s.space)
  const spaceProjects = allProjects.filter((p) => p.spaceId === space)
  const projects = spaceProjects
  const workspaces = useStore((s) => s.workspaces)
  const [issues, setIssues] = useState<Issue[]>([])
  const [project, setProject] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<IssueStatus | null>(null)
  const [detail, setDetail] = useState<string | null>(null)

  const load = () => void window.cm.listIssues().then(setIssues)
  // Runs record issues as they go: refresh when any workspace changes state.
  useEffect(load, [workspaces])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return issues.filter(
      (i) => spaceProjects.some((p) => p.id === i.projectId) && (!project || i.projectId === project) && (!q || `${i.title} ${i.body} ${i.branch}`.toLowerCase().includes(q))
    )
  }, [issues, project, query])

  const move = async (id: string, status: IssueStatus) => {
    setIssues((l) => l.map((i) => (i.id === id ? { ...i, status } : i)))
    await window.cm.updateIssue(id, { status })
  }
  const current = issues.find((i) => i.id === detail) ?? null

  return (
    <>
      <PageHeader leftCollapsed={leftCollapsed} onExpandLeft={onExpandLeft}>
        <CircleDot size={14} className="text-accent" />
        <span className="font-medium text-ink">Issues</span>
        <span className="text-mute">· everything QA and reviews found, across workspaces</span>
      </PageHeader>

      <div className="flex shrink-0 items-center gap-2 px-5 pb-3 pt-4">
        <label className="flex h-8 w-64 items-center gap-2 rounded-lg border border-line bg-raised px-2.5 focus-within:border-line-strong">
          <Search size={13} className="text-mute" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search issues…"
            className="selectable min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-mute"
          />
        </label>
        <DropdownMenu
          width={240}
          items={[
            { label: 'All projects', type: 'radio', checked: !project, onSelect: () => setProject(null) },
            ...projects.map((p, i) => ({
              label: p.name, type: 'radio' as const, checked: project === p.id, divider: i === 0, onSelect: () => setProject(p.id)
            }))
          ]}
          trigger={({ triggerProps }) => (
            <button {...triggerProps} className="flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[12.5px] text-dim hover:text-ink">
              {projects.find((p) => p.id === project)?.name ?? 'All projects'}
              <ChevronDown size={12} />
            </button>
          )}
        />
        <GithubMirrorButton projects={spaceProjects} onSynced={load} />
        <span className="ml-auto text-[12px] text-mute">{filtered.length} issues · drag cards between columns</span>
      </div>

      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-5 pb-5">
        {COLUMNS.map((col) => {
          const list = filtered.filter((i) => i.status === col.id)
          return (
            <section
              key={col.id}
              onDragOver={(e) => {
                e.preventDefault()
                setOver(col.id)
              }}
              onDragLeave={() => setOver((o) => (o === col.id ? null : o))}
              onDrop={(e) => {
                e.preventDefault()
                setOver(null)
                const id = e.dataTransfer.getData('text/plain')
                if (id) void move(id, col.id)
              }}
              className={cn(
                'flex min-w-[250px] flex-1 flex-col rounded-xl border bg-bg/60 transition-colors',
                over === col.id && dragging ? 'border-accent/50 bg-accent/[.04]' : 'border-line'
              )}
            >
              <header className="flex items-center gap-2 px-3 py-2.5 text-[12.5px]">
                <span className={cn('size-2 rounded-full', col.dot)} />
                <span className="font-medium">{col.label}</span>
                <span className="text-mute tabular-nums">{list.length}</span>
              </header>
              <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
                {list.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-[12px] text-mute">Drop issues here</div>
                ) : (
                  list.map((i) => (
                    <article
                      key={i.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', i.id)
                        setDragging(i.id)
                      }}
                      onDragEnd={() => setDragging(null)}
                      onClick={() => setDetail(i.id)}
                      className={cn(
                        'cm-in cursor-grab rounded-lg border border-line bg-raised p-2.5 transition-[opacity,border-color] hover:border-line-strong active:cursor-grabbing',
                        dragging === i.id && 'opacity-40',
                        detail === i.id && 'border-accent/50'
                      )}
                    >
                      <div className="text-[12.5px] font-medium leading-snug">{i.title}</div>
                      {i.body && <div className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-dim">{i.body}</div>}
                      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-mute">
                        <span className="truncate text-dim">{i.projectName}</span>
                        <GitBranch size={11} className="shrink-0" />
                        <span className="min-w-0 truncate font-mono">{i.branch}</span>
                        {i.nodeId && <span className="shrink-0 rounded bg-white/[.06] px-1 font-mono text-[10px]">{i.nodeId}</span>}
                        {i.githubUrl && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              window.open(i.githubUrl!, '_blank')
                            }}
                            className="ml-auto shrink-0 hover:text-ink"
                            title="Open on GitHub"
                          >
                            <Github size={11} />
                          </button>
                        )}
                        <span className={cn('shrink-0', !i.githubUrl && 'ml-auto')}>{timeAgo(i.createdAt)}</span>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </section>
          )
        })}
        {issues.length === 0 && (
          <div className="grid flex-1 place-items-center">
            <EmptyState title="No issues yet" text="When a pipeline's QA or review finds a problem, it lands here." />
          </div>
        )}
      </div>

      {current && (
        <div className="fixed inset-y-0 right-0 z-40 flex w-[420px] flex-col border-l border-line-strong bg-raised shadow-2xl cm-in">
          <div className="flex h-11 items-center gap-2 border-b border-line px-4">
            <span className="text-[12.5px] text-mute">{current.projectName}</span>
            <span className="font-mono text-[11.5px] text-mute">{current.branch}</span>
            <button onClick={() => setDetail(null)} className="ml-auto text-mute hover:text-ink" aria-label="Close">
              <X size={15} />
            </button>
          </div>
          <div className="selectable min-h-0 flex-1 overflow-y-auto p-4">
            <h2 className="text-[15px] font-semibold leading-snug">{current.title}</h2>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {COLUMNS.map((c) => (
                <button
                  key={c.id}
                  onClick={() => void move(current.id, c.id)}
                  className={cn(
                    'flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[12px]',
                    current.status === c.id ? 'border-line-strong bg-white/[.06] text-ink' : 'border-line text-dim hover:text-ink'
                  )}
                >
                  <span className={cn('size-1.5 rounded-full', c.dot)} />
                  {c.label}
                </button>
              ))}
            </div>
            <pre className="mt-4 whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-dim">{current.body || 'No details recorded.'}</pre>
          </div>
          <div className="border-t border-line p-3">
            <button
              onClick={() => void actions.selectWorkspace(current.workspaceId)}
              className="h-8 w-full rounded-lg bg-ink text-[12.5px] font-medium text-black"
            >
              Open workspace
            </button>
          </div>
        </div>
      )}
    </>
  )
}
