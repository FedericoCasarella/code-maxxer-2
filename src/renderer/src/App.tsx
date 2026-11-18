import { useEffect, useState } from 'react'
import { actions, useStore } from './lib/store'
import { usePane } from './lib/panes'
import { cn } from './lib/utils'
import { Sidebar } from './components/app/Sidebar'
import { Center } from './components/app/Center'
import { RightDrawer } from './components/app/RightDrawer'
import { BottomBar } from './components/app/BottomBar'
import { LicenseDialog } from './components/app/License'
import { SettingsPage } from './components/app/pages/SettingsPage'
import { IssuesPage } from './components/app/pages/IssuesPage'
import { PipelinesPage } from './components/app/pages/PipelinesPage'
import { AgentsPage } from './components/app/pages/AgentsPage'
import { BrainPage } from './components/app/pages/BrainPage'
import { ReconPage } from './components/app/pages/recon/ReconPage'
import { DesignPage } from './components/app/pages/DesignPage'
import { SecurityPage } from './components/app/pages/SecurityPage'
import { CodeReviewPage } from './components/app/pages/CodeReviewPage'

export function App() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    void actions.init().then(() => setReady(true))
  }, [])
  const selectedWs = useStore((s) => s.selectedWs)
  const view = useStore((s) => s.view)
  const left = usePane('left', { initial: 264, min: 200, max: 440, edge: 'right' })
  const right = usePane('right', { initial: 280, min: 200, max: 520, edge: 'left' })
  const showRight = view === 'chat'
  // Something asked for the right drawer (e.g. "2 scheduled runs"): unfold it.
  const rightOpenTick = useStore((s) => s.rightOpenTick)
  useEffect(() => {
    if (rightOpenTick) right.setCollapsed(false)
  }, [rightOpenTick])

  if (!ready) return <div className="h-full bg-bg" />
  if (view === 'settings')
    return (
      <div className="flex h-full flex-col bg-bg">
        <SettingsPage leftCollapsed={false} onExpandLeft={() => {}} />
        <BottomBar />
        <LicenseDialog />
      </div>
    )
  return (
    <div className={cn('flex h-full flex-col bg-bg', (left.dragging || right.dragging) && 'cursor-col-resize select-none')}>
      <div className="flex min-h-0 flex-1">
        {!left.collapsed && (
          <>
            <div style={{ width: left.width }} className="flex shrink-0">
              <Sidebar onCollapse={() => left.setCollapsed(true)} />
            </div>
            <ResizeHandle {...left.handle} active={left.dragging} />
          </>
        )}
        <main className="flex min-w-0 flex-1 flex-col bg-panel">
          {view === 'issues' ? (
            <IssuesPage leftCollapsed={left.collapsed} onExpandLeft={() => left.setCollapsed(false)} />
          ) : view === 'pipelines' ? (
            <PipelinesPage leftCollapsed={left.collapsed} onExpandLeft={() => left.setCollapsed(false)} />
          ) : view === 'brain' ? (
            <BrainPage leftCollapsed={left.collapsed} onExpandLeft={() => left.setCollapsed(false)} />
          ) : view === 'recon' ? (
            <ReconPage leftCollapsed={left.collapsed} onExpandLeft={() => left.setCollapsed(false)} />
          ) : view === 'design' ? (
            <DesignPage leftCollapsed={left.collapsed} onExpandLeft={() => left.setCollapsed(false)} />
          ) : view === 'review' ? (
            <CodeReviewPage leftCollapsed={left.collapsed} onExpandLeft={() => left.setCollapsed(false)} />
          ) : view === 'security' ? (
            <SecurityPage leftCollapsed={left.collapsed} onExpandLeft={() => left.setCollapsed(false)} />
          ) : view === 'agents' ? (
            <AgentsPage leftCollapsed={left.collapsed} onExpandLeft={() => left.setCollapsed(false)} />
          ) : (
            <Center
              leftCollapsed={left.collapsed}
              rightCollapsed={right.collapsed}
              onExpandLeft={() => left.setCollapsed(false)}
              onExpandRight={() => right.setCollapsed(false)}
            />
          )}
        </main>
        {showRight && !right.collapsed && (
          <>
            <ResizeHandle {...right.handle} active={right.dragging} />
            <div style={{ width: right.width }} className="flex shrink-0">
              <RightDrawer workspaceId={selectedWs} onCollapse={() => right.setCollapsed(true)} />
            </div>
          </>
        )}
      </div>
      <BottomBar />
      <LicenseDialog />
    </div>
  )
}

/** 1px hairline with a wide invisible grab area; lights up while hovered or dragged. */
function ResizeHandle({ active, ...handlers }: { active: boolean } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...handlers}
      role="separator"
      aria-orientation="vertical"
      className="group relative z-10 w-px shrink-0 cursor-col-resize bg-line"
    >
      <div className="absolute inset-y-0 -left-[3px] -right-[3px]" />
      <div
        className={cn(
          'absolute inset-y-0 -left-px -right-px transition-colors delay-150 duration-150',
          active ? 'bg-accent/70 delay-0' : 'group-hover:bg-accent/50'
        )}
      />
    </div>
  )
}
