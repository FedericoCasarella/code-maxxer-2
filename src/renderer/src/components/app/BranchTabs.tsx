import { useEffect, useRef, useState } from 'react'
import { GitBranch, X } from 'lucide-react'
import { actions, useStore } from '@/lib/store'
import { Spinner } from '../affect/spinner'
import { Tab } from './editor/EditorTabs'
import { ContextMenu, type ContextMenuItem } from '../affect/context-menu'
import { t } from '@/lib/i18n'

const KEY = 'cm2.branchTabs'
const load = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}
const save = (ids: string[]) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids))
  } catch { /* ignore */ }
}

/** The branches opened in the chat, as tabs (like open files): a click goes back to one, × closes it. */
export function BranchTabs() {
  const selectedWs = useStore((s) => s.selectedWs)
  const workspaces = useStore((s) => s.workspaces)
  const projects = useStore((s) => s.projects)
  const [ids, setIds] = useState<string[]>(load)

  // Opening a branch adds its tab, after the others
  useEffect(() => {
    if (selectedWs && !ids.includes(selectedWs)) setIds((l) => [...l, selectedWs])
  }, [selectedWs])
  // Branches that no longer exist lose their tab
  const open = ids.filter((id) => workspaces.some((w) => w.id === id))
  useEffect(() => {
    if (workspaces.length) save(open)
  }, [open.join(), workspaces.length])

  const closeMany = (list: string[]) => {
    const rest = open.filter((x) => !list.includes(x))
    setIds(rest)
    if (!selectedWs || !list.includes(selectedWs)) return
    const i = open.indexOf(selectedWs)
    const next = rest.find((x) => open.indexOf(x) > i) ?? rest[rest.length - 1]
    if (next) void actions.selectWorkspace(next)
    else actions.goHome()
  }
  const close = (id: string) => closeMany([id])
  // Right-click on a tab: close it, the others, all of them, or the ones with nothing running
  const isRunning = (id: string) => workspaces.find((w) => w.id === id)?.status === 'running'
  const tabMenu = (target: HTMLElement): ContextMenuItem[] => {
    const id = target.closest<HTMLElement>('[data-tab]')?.dataset.tab
    if (!id) return []
    const others = open.filter((x) => x !== id)
    const idle = open.filter((x) => !isRunning(x))
    return [
      { label: t('Close'), icon: <X size={16} />, shortcut: '⌘W', onSelect: () => close(id) },
      { label: t('Close others'), disabled: !others.length, onSelect: () => closeMany(others) },
      { label: t('Close the ones with nothing running'), disabled: !idle.length, onSelect: () => closeMany(idle) },
      { label: t('Close all'), divider: true, onSelect: () => closeMany(open) }
    ]
  }

  // ⌘W on the chat closes the branch's tab (an open file in front takes ⌘W first)
  const fileInFront = useStore((s) => (selectedWs ? !!s.editors[selectedWs]?.active : false))
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!e.metaKey || e.key !== 'w' || !selectedWs || fileInFront) return
      e.preventDefault()
      close(selectedWs)
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  })

  // The open branch's tab always in sight, also when the tabs scroll
  const strip = useRef<HTMLDivElement>(null)
  useEffect(() => {
    strip.current?.querySelector('[role="tab"][aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [selectedWs, open.length])

  if (!open.length) return null
  return (
    <ContextMenu items={tabMenu} aria-label={t('Tabs')}>
    <div ref={strip} role="tablist" className="no-drag flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
      {open.map((id) => {
        const w = workspaces.find((x) => x.id === id)!
        const project = projects.find((p) => p.id === w.projectId)?.name ?? ''
        return (
          <Tab
            key={id}
            tabId={id}
            active={id === selectedWs}
            onClick={() => void actions.selectWorkspace(id)}
            onClose={() => close(id)}
            title={`${project} / ${w.branch}`}
            icon={w.status === 'running' ? <Spinner size={12} className="text-accent" /> : <GitBranch size={14} className="text-dim" />}
            label={`${project} / ${w.branch}`}
            wide
          />
        )
      })}
    </div>
    </ContextMenu>
  )
}
