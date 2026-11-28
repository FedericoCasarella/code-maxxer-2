import { useEffect, useMemo, useState } from 'react'
import { ProjectPicker } from '../ProjectPicker'
import { usePersisted } from '@/lib/persist'
import { Ban, Check, CircleDot, ExternalLink, GitPullRequest, KanbanSquare, ListTodo, RotateCcw, Search, SquareArrowOutUpRight, Wand2 } from 'lucide-react'
import type { BoardTask, BranchPr, Issue, IssueStatus, PlanTaskStatus } from '@shared/types'
import { actions, useStore } from '@/lib/store'
import { EmptyState } from '../../affect/empty-state'
import { SegmentedControl } from '../../affect/segmented-control'
import { AgentInbox, type AgentInboxView, type AgentTask, type AgentTaskStatus } from '../../affect/agent-inbox'
import { PageHeader } from '../PageHeader'
import { jumpToMessage } from '../PlanCard'
import { GithubMirrorButton } from './GithubMirrorButton'
import { TextField } from '../../affect/text-field'
import { t } from '@/lib/i18n'
import { loadPrefs } from '../Composer'

type Col = 'todo' | 'in_progress' | 'done' | 'closed'
const COLUMNS: { id: Col; label: string }[] = [
  { id: 'todo', label: 'To do' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'done', label: 'Done' },
  { id: 'closed', label: "Won't do" }
]

/** A branch's pull request: merged only once its commit is on the base branch. */
const PR_LOOK: Record<BranchPr['state'], string> = {
  open: 'Open|pr',
  draft: 'Draft|pr',
  closed: 'Closed|pr',
  merging: 'Merged on GitHub, not on {base} yet',
  merged: 'Merged into {base}'
}

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
  const [view, setView] = usePersisted<AgentInboxView>('board.view', 'board')

  const [prs, setPrs] = useState<Record<string, BranchPr | null>>({})
  const load = () => {
    void Promise.all([window.cm.listIssues(), window.cm.boardTasks()]).then(([i, tk]) => {
      setIssues(i)
      setTasks(tk)
      // Each branch's pull request, asked once per branch (the main side keeps them a minute)
      const ids = [...new Set([...i.map((x) => x.workspaceId), ...tk.map((x) => x.workspaceId)])]
      if (ids.length) void window.cm.branchPrs(ids).then(setPrs).catch(() => {})
    })
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

  return (
    <>
      <PageHeader leftCollapsed={leftCollapsed} onExpandLeft={onExpandLeft}>
        <KanbanSquare size={14} className="text-accent" />
        <span className="font-medium text-ink">{t('Board')}</span>
      </PageHeader>

      <div className="flex shrink-0 items-center gap-2 px-5 pb-3 pt-4">
<TextField size="sm" className="w-64" prefix={<Search size={13} />} clearable aria-label={t('Search the board…')} placeholder={t('Search the board…')} value={query} onChange={(e) => setQuery(e.target.value)} />
        <SegmentedControl
          size="sm"
          aria-label={t('Type')}
          value={type}
          onChange={setType}
          options={[
            { value: 'all', label: t('All') },
            { value: 'task', label: t('Tasks'), icon: <ListTodo size={12} /> },
            { value: 'issue', label: t('Issues'), icon: <CircleDot size={12} /> }
          ]}
        />
        <ProjectPicker value={project} onChange={setProject} allLabel={t('All projects')} />
        <GithubMirrorButton projects={spaceProjects} onSynced={load} />
      </div>

      <div className={view === 'board' ? 'min-h-0 flex-1 overflow-hidden px-5 pb-5' : 'min-h-0 flex-1 overflow-y-auto px-5 pb-5'}>
        {issues.length + tasks.length === 0 ? (
          <div className="grid h-full place-items-center">
            <EmptyState title={t('Nothing on the board yet')} text={t('Plan tasks land here when the agent plans a big change; QA and review add the issues they find.')} />
          </div>
        ) : (
          <AgentInbox
            title={t('Board')}
            className="cm-board"
            columns={COLUMNS}
            view={view}
            onViewChange={setView}
            tasks={[...cards].sort((a, b) => b.at - a.at).map((c) => inboxTask(c, prs, move))}
          />
        )}
      </div>
    </>
  )
}

/** Where a branch's PR stands, in words. */
const prLine = (pr?: BranchPr | null) => (pr ? `#${pr.number} · ${t(PR_LOOK[pr.state], { base: pr.base })}` : '')

const openTaskChat = async (tk: BoardTask) => {
  const plans = await window.cm.listPlans(tk.workspaceId)
  const mid = plans.find((p) => p.id === tk.planId)?.messageId
  actions.setView('chat')
  if (mid) jumpToMessage(tk.workspaceId, mid)
  else void actions.selectWorkspace(tk.workspaceId)
}
const openBranch = (wsId: string) => {
  actions.setView('chat')
  void actions.selectWorkspace(wsId)
}
/** Risolvi: the issue goes in progress and its branch's agent is asked to fix it. */
const fixIssue = async (i: Issue, move: () => Promise<void>) => {
  await move()
  openBranch(i.workspaceId)
  const text = [t('Fix this issue found on the board:'), '', `**${i.title}**`, i.body].filter((x) => x !== undefined).join('\n').trim()
  void window.cm.send({ ...loadPrefs(), workspaceId: i.workspaceId, text })
  window.dispatchEvent(new CustomEvent('cm-sent', { detail: i.workspaceId }))
}

/** A plan task or an issue as an Agent Inbox card: its column, state, what it is and what you can do with it. */
function inboxTask(c: Card, prs: Record<string, BranchPr | null>, move: (key: string, col: Col) => Promise<void>): AgentTask {
  const label = t(COLUMNS.find((x) => x.id === c.col)!.label)
  const to = (col: Col) => () => void move(c.key, col)
  if (c.kind === 'task') {
    const tk = c.task
    const pr = prs[tk.workspaceId]
    const status: AgentTaskStatus = tk.status === 'failed' ? 'failed' : c.col === 'in_progress' ? 'running' : c.col === 'todo' ? 'waiting' : 'done'
    return {
      id: c.key,
      title: tk.title,
      description: tk.detail || undefined,
      agent: `${t('Plan · {title} ·', { title: tk.planTitle })} ${[tk.projectName, tk.branch, prLine(pr)].filter(Boolean).join(' · ')}`,
      status,
      lane: c.col,
      stateLabel: status === 'running' || status === 'failed' ? undefined : label,
      startedAt: tk.startedAt ?? undefined,
      elapsed: tk.startedAt && tk.finishedAt ? tk.finishedAt - tk.startedAt : undefined,
      tools: tk.steps.length || undefined,
      sources: new Set(tk.steps.map((x) => x.file).filter(Boolean)).size || undefined,
      steps: [...tk.steps.map((x) => ({ label: x.title })), ...tk.commits.map((x) => ({ label: `${x.sha.slice(0, 7)} ${x.subject}` }))],
      actions: [
        ...(tk.status === 'failed' ? [{ label: t('Retry'), primary: true, onClick: to('todo') }] : []),
        ...(c.col === 'done' || c.col === 'closed' ? [{ label: t('Reopen'), onClick: to('todo') }] : []),
        ...(pr ? [{ label: `PR #${pr.number}`, onClick: () => window.open(pr.url, '_blank') }] : []),
        { label: t('Open'), primary: tk.status !== 'failed', onClick: () => void openTaskChat(tk) }
      ]
    }
  }
  const i = c.issue
  const pr = prs[i.workspaceId]
  const status: AgentTaskStatus = c.col === 'in_progress' ? 'running' : c.col === 'todo' ? 'waiting' : 'done'
  return {
    id: c.key,
    title: i.title,
    description: i.body || undefined,
    agent: [t('Issue'), i.projectName, i.branch, i.nodeId ?? '', prLine(pr)].filter(Boolean).join(' · '),
    status,
    lane: c.col,
    stateLabel: status === 'running' ? undefined : label,
    startedAt: c.col === 'todo' || c.col === 'in_progress' ? new Date(i.createdAt).getTime() : undefined,
    actions: [
      { label: t('Open'), start: true, icon: <SquareArrowOutUpRight size={14} />, onClick: () => openBranch(i.workspaceId) },
      ...(i.githubUrl ? [{ label: t('Open on GitHub'), icon: <ExternalLink size={14} />, onClick: () => window.open(i.githubUrl!, '_blank') }] : []),
      ...(pr ? [{ label: `PR #${pr.number}`, icon: <GitPullRequest size={14} />, onClick: () => window.open(pr.url, '_blank') }] : []),
      ...(c.col === 'todo' || c.col === 'in_progress'
        ? [
            {
              label: t('Resolve'),
              primary: true,
              icon: <Wand2 size={14} />,
              onClick: () => void fixIssue(i, () => move(c.key, 'in_progress')),
              menu: [
                { label: t('Mark resolved'), icon: <Check size={14} />, onSelect: to('done') },
                { label: t("Won't do"), icon: <Ban size={14} />, onSelect: to('closed') }
              ]
            }
          ]
        : [{ label: t('Reopen'), icon: <RotateCcw size={14} />, onClick: to('todo') }])
    ]
  }
}
