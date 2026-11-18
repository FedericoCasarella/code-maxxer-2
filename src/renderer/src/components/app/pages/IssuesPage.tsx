import { useEffect, useMemo, useState } from 'react'
import { ProjectPicker } from '../ProjectPicker'
import { usePersisted } from '@/lib/persist'
import { ChevronDown, CircleDot, GitBranch, GitCommitHorizontal, KanbanSquare, ListTodo, MessageSquare, Search, X } from 'lucide-react'
import { Github } from '../Logos'
import type { BoardTask, Issue, IssueStatus, PlanTaskStatus } from '@shared/types'
import { actions, useStore } from '@/lib/store'
import { cn, timeAgo } from '@/lib/utils'
import { DropdownMenu } from '../../affect/dropdown-menu'
import { EmptyState } from '../../affect/empty-state'
import { SegmentedControl } from '../../affect/segmented-control'
import { Dialog } from '../../affect/dialog'
import { Button } from '../../affect/button'
import { PageHeader } from '../PageHeader'
import { jumpToMessage, TaskDetail, TaskIcon } from '../PlanCard'
import { GithubMirrorButton } from './GithubMirrorButton'
import { TextField } from '../../affect/text-field'

type Col = 'todo' | 'in_progress' | 'done' | 'closed'
const COLUMNS: { id: Col; label: string; dot: string }[] = [
  { id: 'todo', label: 'To do', dot: 'bg-bad' },
  { id: 'in_progress', label: 'In progress', dot: 'bg-[#8ab4ff]' },
  { id: 'done', label: 'Done', dot: 'bg-ok' },
  { id: 'closed', label: "Won't do", dot: 'bg-mute' }
]

type Card = { kind: 'issue'; key: string; col: Col; at: number; issue: Issue } | { kind: 'task'; key: string; col: Col; at: number; task: BoardTask }

const ISSUE_COL: Record<IssueStatus, Col> = { open: 'todo', in_progress: 'in_progress', resolved: 'done', wontfix: 'closed' }
const COL_ISSUE: Record<Col, IssueStatus> = { todo: 'open', in_progress: 'in_progress', done: 'resolved', closed: 'wontfix' }
const TASK_COL: Record<PlanTaskStatus, Col> = { todo: 'todo', failed: 'todo', in_progress: 'in_progress', done: 'done', skipped: 'closed' }
const COL_TASK: Record<Col, PlanTaskStatus> = { todo: 'todo', in_progress: 'in_progress', done: 'done', closed: 'skipped' }

/** The project board: plan tasks and the issues QA/review found, in one kanban. */
export function IssuesPage({ leftCollapsed, onExpandLeft }: { leftCollapsed: boolean; onExpandLeft: () => void }) {
  const allProjects = useStore((s) => s.projects)
  const space = useStore((s) => s.space)
  const spaceProjects = allProjects.filter((p) => p.spaceId === space)
  const workspaces = useStore((s) => s.workspaces)
  const [issues, setIssues] = useState<Issue[]>([])
  const [tasks, setTasks] = useState<BoardTask[]>([])
  const [project, setProject] = useState<string | null>(null)
  const [type, setType] = usePersisted<'all' | 'task' | 'issue'>('board.type', 'all')
  const [query, setQuery] = useState('')
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<Col | null>(null)
  const [detail, setDetail] = useState<string | null>(null)

  const load = () => {
    void window.cm.listIssues().then(setIssues)
    void window.cm.boardTasks().then(setTasks)
  }
  // Runs record issues as they go: refresh when any workspace changes state, and on every plan change.
  useEffect(load, [workspaces])
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null
    return window.cm.onEvent((e) => {
      if (e.type === 'plan' && !t) t = setTimeout(() => ((t = null), void window.cm.boardTasks().then(setTasks)), 300)
    })
  }, [])

  const cards = useMemo(() => {
    const q = query.trim().toLowerCase()
    const inScope = (pid: string) => spaceProjects.some((p) => p.id === pid) && (!project || pid === project)
    const out: Card[] = []
    if (type !== 'task')
      for (const i of issues)
        if (inScope(i.projectId) && (!q || `${i.title} ${i.body} ${i.branch}`.toLowerCase().includes(q)))
          out.push({ kind: 'issue', key: 'i:' + i.id, col: ISSUE_COL[i.status], at: new Date(i.createdAt).getTime(), issue: i })
    if (type !== 'issue')
      for (const t of tasks)
        if (inScope(t.projectId) && (!q || `${t.title} ${t.detail} ${t.planTitle} ${t.branch}`.toLowerCase().includes(q)))
          out.push({ kind: 'task', key: 't:' + t.id, col: TASK_COL[t.status], at: t.startedAt ?? 0, task: t })
    return out
  }, [issues, tasks, project, query, type, space])

  const move = async (key: string, col: Col) => {
    const c = cards.find((x) => x.key === key)
    if (!c || c.col === col) return
    if (c.kind === 'issue') {
      setIssues((l) => l.map((i) => (i.id === c.issue.id ? { ...i, status: COL_ISSUE[col] } : i)))
      await window.cm.updateIssue(c.issue.id, { status: COL_ISSUE[col] })
    } else {
      setTasks((l) => l.map((t) => (t.id === c.task.id ? { ...t, status: COL_TASK[col] } : t)))
      await window.cm.updatePlanTask(c.task.id, { status: COL_TASK[col] })
    }
  }
  const current = cards.find((c) => c.key === detail) ?? null

  return (
    <>
      <PageHeader leftCollapsed={leftCollapsed} onExpandLeft={onExpandLeft}>
        <KanbanSquare size={14} className="text-accent" />
        <span className="font-medium text-ink">Board</span>
        <span className="text-mute">· plan tasks and issues, across branches</span>
      </PageHeader>

      <div className="flex shrink-0 items-center gap-2 px-5 pb-3 pt-4">
<TextField size="sm" className="w-64" prefix={<Search size={13} />} clearable aria-label="Search the board…" placeholder="Search the board…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <SegmentedControl
          size="sm"
          aria-label="Type"
          value={type}
          onChange={setType}
          options={[
            { value: 'all', label: 'All' },
            { value: 'task', label: 'Tasks', icon: <ListTodo size={12} /> },
            { value: 'issue', label: 'Issues', icon: <CircleDot size={12} /> }
          ]}
        />
        <ProjectPicker value={project} onChange={setProject} allLabel="All projects" />
        <GithubMirrorButton projects={spaceProjects} onSynced={load} />
        <span className="ml-auto text-[12px] text-mute">{cards.length} cards · drag between columns</span>
      </div>

      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-5 pb-5">
        {COLUMNS.map((col) => {
          const list = cards.filter((c) => c.col === col.id).sort((a, b) => b.at - a.at)
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
                const key = e.dataTransfer.getData('text/plain')
                if (key) void move(key, col.id)
              }}
              className={cn(
                'flex min-w-[260px] flex-1 flex-col rounded-xl border bg-bg/60 transition-colors',
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
                  <div className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-[12px] text-mute">Drop cards here</div>
                ) : (
                  list.map((c) => (
                    <article
                      key={c.key}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', c.key)
                        setDragging(c.key)
                      }}
                      onDragEnd={() => setDragging(null)}
                      onClick={() => setDetail(c.key)}
                      className={cn(
                        'cm-in cursor-grab rounded-lg border border-line bg-raised p-2.5 transition-[opacity,border-color] hover:border-line-strong active:cursor-grabbing',
                        dragging === c.key && 'opacity-40',
                        detail === c.key && 'border-accent/50'
                      )}
                    >
                      {c.kind === 'task' ? <TaskCard t={c.task} /> : <IssueCard i={c.issue} />}
                    </article>
                  ))
                )}
              </div>
            </section>
          )
        })}
        {cards.length === 0 && issues.length + tasks.length === 0 && (
          <div className="grid flex-1 place-items-center">
            <EmptyState title="Nothing on the board yet" text="Plan tasks land here when the agent plans a big change; QA and review add the issues they find." />
          </div>
        )}
      </div>

      {current && (
        <Dialog
          open
          onOpenChange={(o) => !o && setDetail(null)}
          size="lg"
          title={
            <span className="flex items-center gap-2">
              {current.kind === 'task' ? <ListTodo size={15} className="shrink-0 text-accent" /> : <CircleDot size={15} className="shrink-0 text-bad" />}
              <span className="min-w-0">{current.kind === 'task' ? current.task.title : current.issue.title}</span>
            </span>
          }
          description={
            <span className="flex items-center gap-1.5">
              {current.kind === 'task' && <span className="text-accent">Plan · {current.task.planTitle} ·</span>}
              {current.kind === 'task' ? current.task.projectName : current.issue.projectName}
              <GitBranch size={11} />
              <span className="font-mono">{current.kind === 'task' ? current.task.branch : current.issue.branch}</span>
            </span>
          }
          footer={
            <>
              <Button
                variant="secondary"
                size="sm"
                icon={<GitBranch size={13} />}
                onClick={() => {
                  setDetail(null)
                  actions.setView('chat')
                  void actions.selectWorkspace(current.kind === 'task' ? current.task.workspaceId : current.issue.workspaceId)
                  if (current.kind === 'task' && current.task.commits.length) actions.showRight('scm')
                }}
              >
                {current.kind === 'task' && current.task.commits.length ? 'Commits' : 'Open branch'}
              </Button>
              {current.kind === 'task' && (
                <Button
                  size="sm"
                  icon={<MessageSquare size={13} />}
                  onClick={async () => {
                    const t = current.task
                    setDetail(null)
                    const plans = await window.cm.listPlans(t.workspaceId)
                    const mid = plans.find((p) => p.id === t.planId)?.messageId
                    actions.setView('chat')
                    if (mid) jumpToMessage(t.workspaceId, mid)
                    else void actions.selectWorkspace(t.workspaceId)
                  }}
                >
                  Open chat
                </Button>
              )}
            </>
          }
        >
          <SegmentedControl
            size="sm"
            aria-label="Column"
            value={current.col}
            onChange={(c) => void move(current.key, c)}
            options={COLUMNS.map((c) => ({ value: c.id, label: c.label }))}
          />
          {current.kind === 'task' ? (
            <div className="-mx-1 mt-3 [&>div]:pl-1">
              <TaskDetail t={current.task} wsId={current.task.workspaceId} now={Date.now()} />
            </div>
          ) : (
            <pre className="selectable mt-4 whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-dim">{current.issue.body || 'No details recorded.'}</pre>
          )}
        </Dialog>
      )}
    </>
  )
}

function TaskCard({ t }: { t: BoardTask }) {
  const files = new Set(t.steps.map((s) => s.file).filter(Boolean)).size
  return (
    <>
      <div className="mb-1 flex items-center gap-1.5 text-[10.5px] text-accent">
        <ListTodo size={11} />
        <span className="truncate">{t.planTitle}</span>
      </div>
      <div className="flex items-start gap-2">
        <span className="mt-[2px]">
          <TaskIcon s={t.status} size={13} />
        </span>
        <div className="min-w-0 text-[12.5px] font-medium leading-snug">{t.title}</div>
      </div>
      {t.detail && <div className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-dim">{t.detail}</div>}
      {t.commits.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {t.commits.slice(0, 3).map((c) => (
            <span key={c.sha} title={c.subject} className="flex items-center gap-1 rounded-full border border-line-strong px-1.5 text-[10.5px] text-dim">
              <GitCommitHorizontal size={10} />
              <span className="font-mono">{c.sha.slice(0, 7)}</span>
            </span>
          ))}
        </div>
      )}
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-mute">
        <span className="truncate text-dim">{t.projectName}</span>
        <GitBranch size={11} className="shrink-0" />
        <span className="min-w-0 truncate font-mono">{t.branch}</span>
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {files > 0 && <span>{files} files</span>}
          <MessageSquare size={11} />
        </span>
      </div>
    </>
  )
}

function IssueCard({ i }: { i: Issue }) {
  return (
    <>
      <div className="mb-1 flex items-center gap-1.5 text-[10.5px] text-bad/90">
        <CircleDot size={11} /> Issue
      </div>
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
    </>
  )
}
