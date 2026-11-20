import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowDown, FolderPlus, GitBranchPlus, MessageSquare } from 'lucide-react'
import { EmptyState } from '../affect/empty-state'
import { Spinner } from '../affect/spinner'
import { ChatIndex } from './ChatIndex'
import { actions, getState, useStore } from '@/lib/store'
import { Composer } from './Composer'
import { PaneToggle } from './PaneToggle'
import { PageHeader } from './PageHeader'
import { MessageView } from './Message'
import { CmLogo } from './Logos'
import { Kbd } from '../affect/kbd'
import { NewWorkspaceDialog } from './NewWorkspaceDialog'
import { EditorPanes, EditorTabs } from './editor/EditorTabs'
import { t } from '@/lib/i18n'

const EMPTY: never[] = []

export function Center({
  leftCollapsed, rightCollapsed, onExpandLeft, onExpandRight
}: { leftCollapsed: boolean; rightCollapsed: boolean; onExpandLeft: () => void; onExpandRight: () => void }) {
  const selectedWs = useStore((s) => s.selectedWs)
  const workspaces = useStore((s) => s.workspaces)
  const selectedProject = useStore((s) => s.selectedProject)
  const projects = useStore((s) => s.projects)
  const ws = workspaces.find((w) => w.id === selectedWs) ?? null
  const project = projects.find((p) => p.id === (ws?.projectId ?? selectedProject))

  return (
    <>
      <PageHeader leftCollapsed={leftCollapsed} onExpandLeft={onExpandLeft}>
        {ws && (
          <>
            <span className="text-dim">{project?.name}</span>
            <span className="text-mute">/</span>
            <span className="font-mono text-[12px] text-ink">{ws.branch}</span>
          </>
        )}
        <div className="flex-1" />
        {rightCollapsed && <PaneToggle side="right" onClick={onExpandRight} label={t('Show panel')} />}
      </PageHeader>
      {ws ? (
        <>
          <EditorTabs wsId={ws.id} />
          <ChatSlot wsId={ws.id} />
          <EditorPanes wsId={ws.id} />
        </>
      ) : (
        <Empty />
      )}
    </>
  )
}

/** The chat stays mounted under open files, hidden while one is in front. */
function ChatSlot({ wsId }: { wsId: string }) {
  const hidden = useStore((s) => !!s.editors[wsId]?.active)
  return (
    <div className={hidden ? 'hidden' : 'flex min-h-0 flex-1 flex-col'}>
      <Chat key={wsId} wsId={wsId} />
    </div>
  )
}

/** Nothing selected: logo, two actions, the shortcuts that matter. */
function Empty() {
  const selectedProject = useStore((s) => s.selectedProject)
  const projects = useStore((s) => s.projects)
  const [newWs, setNewWs] = useState(false)
  const space = useStore((s) => s.space)
  const target = selectedProject ?? projects.find((p) => p.spaceId === space)?.id ?? null

  return (
    <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto px-8">
      <div className="cm-in flex w-[320px] flex-col items-center">
        <CmLogo size={64} />
        <h1 className="mt-5 text-[26px] font-bold tracking-tight">CODE-MAXXER</h1>
        <p className="mt-2 text-[13px] text-dim">{t('Select a branch from the sidebar to begin.')}</p>
        <div className="mt-6 flex gap-2.5">
          <button
            onClick={actions.addProject}
            className="flex h-9 items-center gap-2 rounded-lg border border-line-strong bg-raised px-3.5 text-[13px] font-medium hover:bg-white/[.06]"
          >
            {t('Add project')} <FolderPlus size={14} />
          </button>
          <button
            onClick={() => setNewWs(true)}
            disabled={!target}
            className="flex h-9 items-center gap-2 rounded-lg border border-line-strong bg-raised px-3.5 text-[13px] font-medium hover:bg-white/[.06] disabled:opacity-40"
          >
            {t('Create branch')} <GitBranchPlus size={14} />
          </button>
        </div>
        <div className="mt-10 flex w-full flex-col gap-3 text-[12.5px] text-dim">
          <Shortcut label={t('Create branch')} keys={['⌘', 'N']} />
          <Shortcut label={t('Previous branch')} keys={['⌘', '⇧', '↑']} />
          <Shortcut label={t('Next branch')} keys={['⌘', '⇧', '↓']} />
        </div>
      </div>
      {newWs && target && <NewWorkspaceDialog projectId={target} onClose={() => setNewWs(false)} />}
    </div>
  )
}

function Shortcut({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div className="flex items-center justify-between">
      <span>{label}</span>
      <span className="flex gap-1">
        {keys.map((k) => (
          <Kbd key={k} keys={k} />
        ))}
      </span>
    </div>
  )
}

function Chat({ wsId }: { wsId: string }) {
  const messages = useStore((s) => s.messages[wsId]) ?? EMPTY
  const page = useStore((s) => s.pages[wsId])
  const ws = useStore((s) => s.workspaces.find((w) => w.id === wsId)) ?? null
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const [atBottom, setAtBottom] = useState(true)
  // Anchor: the message at the top of the view and where it was, so prepending older ones doesn't move it.
  const anchor = useRef<{ id: string; top: number } | null>(null)
  const captureAnchor = () => {
    const el = scroller.current
    if (!el) return
    const box = el.getBoundingClientRect().top
    for (const n of el.querySelectorAll<HTMLElement>('[data-mid]')) {
      const y = n.getBoundingClientRect().top - box
      if (y >= -n.offsetHeight) return void (anchor.current = { id: n.dataset.mid!, top: y })
    }
  }
  const restoreAnchor = () => {
    const el = scroller.current
    const a = anchor.current
    if (!el || !a) return
    const n = el.querySelector<HTMLElement>(`[data-mid="${a.id}"]`)
    if (n) el.scrollTop += n.getBoundingClientRect().top - el.getBoundingClientRect().top - a.top
  }

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    if (stick.current) {
      el.scrollTop = el.scrollHeight
      return
    }
    // Older messages prepended: the browser's scroll anchoring keeps the visible message in place
    // (including while off-screen sizes settle), so nothing to do here.
    anchor.current = null
  }, [messages])

  // Heights settle after the first paint (off-screen messages start from an estimate, images and cards load later):
  // while the chat sits at the bottom it stays there as the content grows or shrinks.
  const content = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scroller.current
    const box = content.current
    if (!el || !box) return
    const ro = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight
    })
    ro.observe(box)
    return () => ro.disconnect()
  }, [messages.length === 0])

  // Sending a message always goes to the bottom, so the reply shows in full.
  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== wsId) return
      stick.current = true
      setAtBottom(true)
      const down = () => {
        const el = scroller.current
        if (el) el.scrollTop = el.scrollHeight
      }
      if (getState().pages[wsId]?.hasNewer) void actions.loadLatest(wsId).then(() => requestAnimationFrame(down))
      else down()
    }
    window.addEventListener('cm-sent', on)
    return () => window.removeEventListener('cm-sent', on)
  }, [wsId])

  const onScroll = () => {
    const el = scroller.current
    if (!el) return
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    stick.current = fromBottom < 80 && !page?.hasNewer
    setAtBottom(fromBottom < 80)
    if (el.scrollTop < 400 && page?.hasOlder && !page.loading) {
      captureAnchor()
      void actions.loadOlder(wsId)
    }
    if (fromBottom < 400 && page?.hasNewer && !page.loading) void actions.loadNewer(wsId)
  }

  const toLatest = async () => {
    if (page?.hasNewer) await actions.loadLatest(wsId)
    stick.current = true
    const el = scroller.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }

  return (
    <>
      <div className="relative min-h-0 flex-1">
        <div ref={scroller} onScroll={onScroll} className="h-full overflow-y-auto overscroll-contain [overflow-anchor:auto]">
          {messages.length === 0 ? (
            <div className="grid h-full place-items-center px-6">
              <EmptyState
                bare
                icon={<MessageSquare size={20} />}
                title={t('No messages yet')}
                text={t('Ask the orchestrator anything below, call an agent with @, or pick a pipeline next to the model.')}
              />
            </div>
          ) : (
            <div ref={content} className="mx-auto flex max-w-[760px] flex-col gap-6 pb-8 pl-6 pr-10 pt-6">
              {page?.hasOlder && (
                <div className="flex justify-center py-2 text-[12px] text-mute">{page.loading ? <Spinner size={13} /> : t('Scroll up for earlier messages')}</div>
              )}
              {messages.map((m) => (
                // Off-screen messages skip layout and paint, so long chats stay smooth.
                // content-visibility clips to the box: the side padding leaves room for the copy button and its tooltip.
                <div key={m.id} data-mid={m.id} className="-mx-4 px-4 pt-1" style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 240px' }}>
                  <MessageView m={m} />
                </div>
              ))}
              {page?.hasNewer && <div className="flex justify-center py-2"><Spinner size={13} /></div>}
            </div>
          )}
        </div>
        <ChatIndex wsId={wsId} scroller={scroller} onJumped={() => (stick.current = false)} />
        {(!atBottom || page?.hasNewer) && messages.length > 0 && (
          <button
            onClick={() => void toLatest()}
            className="cm-in absolute bottom-3 left-1/2 flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-full border border-line-strong bg-raised px-3 text-[12px] text-dim shadow-lg hover:text-ink"
          >
            {t('Latest')} <ArrowDown size={13} />
          </button>
        )}
      </div>
      <div className="mx-auto w-full max-w-[760px] px-6 pb-4">
        <Composer key={ws?.id ?? 'none'} ws={ws} autoFocus />
      </div>
    </>
  )
}
