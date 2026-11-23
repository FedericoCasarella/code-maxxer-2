import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ErrorBoundary } from './components/app/ErrorBoundary'
import { actions, useStore } from './lib/store'
import { usePane } from './lib/panes'
import { useUiLang } from './lib/i18n'
import { cn } from './lib/utils'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from './components/affect/resizable'
import { Sidebar } from './components/app/Sidebar'
import { Center } from './components/app/Center'
import { RightDrawer } from './components/app/RightDrawer'
import { BottomBar } from './components/app/BottomBar'
import { LicenseDialog } from './components/app/License'
import { UpdatePopup } from './components/app/UpdatePopup'
import { QuitDialog } from './components/app/QuitDialog'
import { SettingsPage } from './components/app/pages/SettingsPage'
import { IssuesPage } from './components/app/pages/IssuesPage'
import { PipelinesPage } from './components/app/pages/PipelinesPage'
import { AgentsPage } from './components/app/pages/AgentsPage'
import { BrainPage } from './components/app/pages/BrainPage'
import { ReconPage } from './components/app/pages/recon/ReconPage'
import { DesignPage } from './components/app/pages/DesignPage'
import { SecurityPage } from './components/app/pages/SecurityPage'
import { DocsPage } from './components/app/pages/DocsPage'
import { AutomationsPage } from './components/app/pages/AutomationsPage'
import { Toaster } from './components/affect/toaster'
import { CodeReviewPage } from './components/app/pages/CodeReviewPage'

export function App() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    void actions.init().then(() => setReady(true))
  }, [])
  const selectedWs = useStore((s) => s.selectedWs)
  // A new interface language redraws everything below (the app's state lives in the store, so nothing is lost).
  const lang = useUiLang()
  const view = useStore((s) => s.view)
  const left = usePane('left', { initial: 264, min: 200, max: 440 })
  // The right drawer can grow as long as the chat keeps 440px: on a wide screen that's a lot of room.
  const right = usePane('right', { initial: 280, min: 200, max: () => window.innerWidth - (left.collapsed ? 0 : left.width) - 440 })
  // Re-clamp the drawer when the window shrinks.
  const [winW, setWinW] = useState(0)
  useEffect(() => {
    const on = () => setWinW(window.innerWidth)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  const showRight = view === 'chat'
  // Something asked for the right drawer (e.g. "2 scheduled runs"): unfold it.
  const rightOpenTick = useStore((s) => s.rightOpenTick)
  useEffect(() => {
    if (rightOpenTick) right.setCollapsed(false)
  }, [rightOpenTick])

  /*
   * The affect Resizable works in % of the group, the drawers here in px (and they must not scale with the window).
   * So the drawers' widths stay ours (an inline flex basis on each pane) and the group's % are only the drag's
   * channel: they start equal to the real widths (re-synced by giving the panes new ids, which makes the group take
   * their defaultSize again), and onLayout turns them back into px for usePane, which clamps and folds as before.
   */
  const [dragSide, setDragSide] = useState<'left' | 'right' | null>(null)
  const activeSide = useRef<'left' | 'right' | null>(null)
  const leftEl = useRef<HTMLDivElement | null>(null)
  const mainEl = useRef<HTMLDivElement | null>(null)
  const rightEl = useRef<HTMLDivElement | null>(null)
  const panesPx = () => [leftEl, mainEl, rightEl].reduce((s, r) => s + (r.current?.offsetWidth ?? 0), 0)
  const total = useRef(0)
  const [gen, setGen] = useState(0)
  useLayoutEffect(() => {
    if (dragSide) return
    total.current = panesPx()
    setGen((g) => g + 1)
  }, [dragSide, left.width, left.collapsed, right.width, right.collapsed, showRight, winW, view, ready])

  // A drawer folded by the drag stays on screen (at 0) until the pointer lets go, so the handle can finish its drag.
  const leftShown = !left.collapsed || dragSide === 'left'
  const rightShown = showRight && (!right.collapsed || dragSide === 'right')
  const leftW = left.collapsed ? 0 : left.width
  const rightW = right.collapsed ? 0 : right.width
  const T = total.current || Math.max(1, window.innerWidth - (leftShown ? 1 : 0) - (rightShown ? 1 : 0))
  const pct = (px: number) => (px * 100) / T
  const mainPct = 100 - (leftShown ? pct(leftW) : 0) - (rightShown ? pct(rightW) : 0)

  const onLayout = (sizes: number[]) => {
    const side = activeSide.current
    if (!side || !sizes.length) return
    const raw = (sizes[side === 'left' ? 0 : sizes.length - 1] * panesPx()) / 100
    if (side === 'left') left.drag(raw)
    else right.drag(raw)
    // Keyboard steps: back in sync right away (a drag syncs when it ends).
    if (!dragSide) setGen((g) => g + 1)
  }
  // Grabbing one handle must leave the other drawer as it is on screen: if the max clamp is holding it narrower than
  // its stored width, pin it there, so it doesn't take the room this drag frees up.
  const grab = (side: 'left' | 'right') => {
    activeSide.current = side
    if (side === 'left') right.hold()
    else left.hold()
  }
  const handleProps = (side: 'left' | 'right', pane: typeof left) => ({
    withHandle: true,
    onPointerDownCapture: (e: React.PointerEvent) => {
      if (e.button !== 0) return
      grab(side)
      setDragSide(side)
    },
    onPointerUpCapture: (e: React.PointerEvent) => {
      setDragSide(null)
      // The component focuses the handle on press; after a mouse drag that would leave the keyboard focus ring on it.
      const el = e.currentTarget as HTMLElement
      requestAnimationFrame(() => el.blur())
    },
    onPointerCancelCapture: () => setDragSide(null),
    onKeyDownCapture: () => grab(side),
    // The group's own reset would go back to the synced size, i.e. nowhere: back to the drawer's initial width instead.
    onDoubleClick: () => pane.reset()
  })

  if (!ready) return <div className="h-full bg-bg" />
  if (view === 'settings')
    return (
      <div key={lang} className="flex h-full flex-col bg-bg">
        <SettingsPage leftCollapsed={false} onExpandLeft={() => {}} />
        <BottomBar />
        <LicenseDialog />
        <UpdatePopup />
        <QuitDialog />
      <Toaster position="bottom-right" />
      </div>
    )
  return (
    <div key={lang} className={cn('flex h-full flex-col bg-bg', dragSide && 'cursor-col-resize select-none')}>
      <ResizablePanelGroup direction="horizontal" onLayout={onLayout} className="min-h-0 flex-1">
        {leftShown && (
          <>
            <ResizablePanel ref={leftEl} id={`pane-left-${gen}`} defaultSize={pct(leftW)} style={{ flex: `0 0 ${leftW}px` }} className="flex">
              <ErrorBoundary where="sidebar">
                <Sidebar onCollapse={() => left.setCollapsed(true)} />
              </ErrorBoundary>
            </ResizablePanel>
            <ResizableHandle {...handleProps('left', left)} />
          </>
        )}
        <ResizablePanel ref={mainEl} id={`pane-main-${gen}`} defaultSize={mainPct} style={{ flex: '1 1 0px' }} className="flex">
          <main className="flex min-w-0 flex-1 flex-col bg-panel">
            <ErrorBoundary where={view} resetKey={`${view}:${selectedWs}`}>
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
            ) : view === 'docs' ? (
              <DocsPage leftCollapsed={left.collapsed} onExpandLeft={() => left.setCollapsed(false)} />
            ) : view === 'security' ? (
              <SecurityPage leftCollapsed={left.collapsed} onExpandLeft={() => left.setCollapsed(false)} />
            ) : view === 'automations' ? (
              <AutomationsPage leftCollapsed={left.collapsed} onExpandLeft={() => left.setCollapsed(false)} />
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
            </ErrorBoundary>
          </main>
        </ResizablePanel>
        {rightShown && (
          <>
            <ResizableHandle {...handleProps('right', right)} />
            <ResizablePanel ref={rightEl} id={`pane-right-${gen}`} defaultSize={pct(rightW)} style={{ flex: `0 0 ${rightW}px` }} className="flex">
              <ErrorBoundary where="drawer" resetKey={selectedWs}>
                <RightDrawer workspaceId={selectedWs} onCollapse={() => right.setCollapsed(true)} />
              </ErrorBoundary>
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
      <BottomBar />
      <LicenseDialog />
      <UpdatePopup />
      <QuitDialog />
      <Toaster position="bottom-right" />
    </div>
  )
}

