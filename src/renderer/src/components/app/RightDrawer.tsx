import { useEffect } from 'react'
import { BarChart3, Bot, Clock, FolderTree, GitBranch, Globe, GraduationCap, ListTodo, SquareTerminal } from 'lucide-react'
import { actions, useStore, type RightTab } from '@/lib/store'
import { cn } from '@/lib/utils'
import { Tooltip } from '../affect/tooltip'
import { PaneToggle } from './PaneToggle'
import { FilesPanel } from './FilesPanel'
import { ScmPanel } from './ScmPanel'
import { PlansPanel } from './PlansPanel'
import { LearningPanel } from './LearningPanel'
import { ReportPanel } from './ReportPanel'
import { AgentsPanel } from './AgentsPanel'
import { ScheduledPanel } from './ScheduledPanel'
import { BrowserPanel } from './BrowserPanel'
import { TerminalPanel } from './TerminalPanel'
import { t } from '@/lib/i18n'

const TABS: { id: RightTab; label: string; icon: typeof Bot }[] = [
  { id: 'files', label: 'Files', icon: FolderTree },
  { id: 'scm', label: 'Source control', icon: GitBranch },
  { id: 'plans', label: 'Plans', icon: ListTodo },
  { id: 'learning', label: 'Learning', icon: GraduationCap },
  { id: 'report', label: 'Report', icon: BarChart3 },
  { id: 'agents', label: 'Agent sessions', icon: Bot },
  { id: 'schedule', label: 'Scheduled runs', icon: Clock },
  { id: 'browser', label: 'Browser', icon: Globe },
  { id: 'terminal', label: 'Terminal', icon: SquareTerminal }
]

/** Right drawer: a row of tool icons (more will join), the fold button at the far left of that row. */
export function RightDrawer({ workspaceId, onCollapse }: { workspaceId: string | null; onCollapse: () => void }) {
  const tab = useStore((s) => s.rightTab)
  const pending = useStore((s) => s.scheduled.filter((r) => r.status === 'pending').length)
  const proposed = useStore((s) => (workspaceId ? (s.plans[workspaceId] ?? []).filter((p) => p.status === 'proposed').length : 0))
  const projectId = useStore((s) => s.workspaces.find((w) => w.id === workspaceId)?.projectId ?? s.selectedProject)
  const review = useStore((s) => (projectId ? (s.learning[projectId]?.cycles ?? []).some((c) => c.status === 'needs_you') : false))
  // Loaded up front so the tab shows its dot when lessons wait for review.
  useEffect(() => {
    if (projectId) void actions.loadLearning(projectId)
  }, [projectId])
  const pick = actions.setRightTab
  return (
    <aside className="relative isolate flex w-full min-w-0 flex-col bg-bg">
      <div className="drag flex h-11 shrink-0 items-center gap-0.5 border-b border-line px-2">
        <PaneToggle side="right" onClick={onCollapse} label={t('Hide panel')} />
        <span className="mx-1 h-4 w-px bg-line" />
        {TABS.map(({ id, label, icon: Icon }) => (
          <Tooltip key={id} content={t(label)} side="bottom">
            <button
              onClick={() => pick(id)}
              aria-label={t(label)}
              aria-pressed={tab === id}
              className={cn(
                'no-drag relative grid h-8 w-8 place-items-center rounded-md transition-colors',
                tab === id ? 'text-ink' : 'text-mute hover:bg-white/[.05] hover:text-dim'
              )}
            >
              <Icon size={15} />
              {id === 'schedule' && pending > 0 && (
                <span className="absolute right-0.5 top-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-accent px-0.5 text-[9px] font-bold text-black">{pending}</span>
              )}
              {id === 'plans' && proposed > 0 && <span className="absolute right-1 top-1 size-2 rounded-full bg-warn" />}
              {id === 'learning' && review && <span className="absolute right-1 top-1 size-2 rounded-full bg-warn" />}
              {tab === id && <span className="absolute -bottom-[7px] left-1.5 right-1.5 h-[2px] rounded-full bg-ink" />}
            </button>
          </Tooltip>
        ))}
      </div>
      {tab === 'files' ? <FilesPanel workspaceId={workspaceId} /> : tab === 'scm' ? <ScmPanel workspaceId={workspaceId} /> : tab === 'plans' ? <PlansPanel workspaceId={workspaceId} /> : tab === 'learning' ? <LearningPanel workspaceId={workspaceId} /> : tab === 'report' ? <ReportPanel workspaceId={workspaceId} /> :  tab === 'agents' ? <AgentsPanel /> : tab === 'schedule' ? <ScheduledPanel /> : tab === 'terminal' ? <TerminalPanel workspaceId={workspaceId} /> : null}
      {/* The browser stays mounted and drawn (under the other tabs) so its pages keep working for the agents. */}
      <div className={tab === 'browser' ? 'flex min-h-0 flex-1 flex-col' : 'pointer-events-none absolute inset-x-0 bottom-0 top-11 -z-10 flex flex-col opacity-0'} aria-hidden={tab !== 'browser'}>
        <BrowserPanel />
      </div>
    </aside>
  )
}
