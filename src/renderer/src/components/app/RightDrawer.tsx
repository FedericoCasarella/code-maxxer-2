import { Bot, Clock, FolderTree } from 'lucide-react'
import { actions, useStore, type RightTab } from '@/lib/store'
import { cn } from '@/lib/utils'
import { Tooltip } from '../affect/tooltip'
import { PaneToggle } from './PaneToggle'
import { FilesPanel } from './FilesPanel'
import { AgentsPanel } from './AgentsPanel'
import { ScheduledPanel } from './ScheduledPanel'

const TABS: { id: RightTab; label: string; icon: typeof Bot }[] = [
  { id: 'files', label: 'Files', icon: FolderTree },
  { id: 'agents', label: 'Agent sessions', icon: Bot },
  { id: 'schedule', label: 'Scheduled runs', icon: Clock }
]

/** Right drawer: a row of tool icons (more will join), the fold button at the far left of that row. */
export function RightDrawer({ workspaceId, onCollapse }: { workspaceId: string | null; onCollapse: () => void }) {
  const tab = useStore((s) => s.rightTab)
  const pending = useStore((s) => s.scheduled.filter((r) => r.status === 'pending').length)
  const pick = actions.setRightTab
  return (
    <aside className="flex w-full min-w-0 flex-col bg-bg">
      <div className="drag flex h-11 shrink-0 items-center gap-0.5 border-b border-line px-2">
        <PaneToggle side="right" onClick={onCollapse} label="Hide panel" />
        <span className="mx-1 h-4 w-px bg-line" />
        {TABS.map(({ id, label, icon: Icon }) => (
          <Tooltip key={id} content={label} side="bottom">
            <button
              onClick={() => pick(id)}
              aria-label={label}
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
              {tab === id && <span className="absolute -bottom-[7px] left-1.5 right-1.5 h-[2px] rounded-full bg-ink" />}
            </button>
          </Tooltip>
        ))}
      </div>
      {tab === 'files' ? <FilesPanel workspaceId={workspaceId} /> : tab === 'agents' ? <AgentsPanel /> : <ScheduledPanel />}
    </aside>
  )
}
