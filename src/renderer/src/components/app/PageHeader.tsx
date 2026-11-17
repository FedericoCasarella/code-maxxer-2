import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { PaneToggle } from './PaneToggle'

/** Top bar of the center area; makes room for the traffic lights when the sidebar is folded. */
export function PageHeader({ leftCollapsed, onExpandLeft, children }: { leftCollapsed: boolean; onExpandLeft: () => void; children: ReactNode }) {
  return (
    <header className={cn('drag flex h-11 shrink-0 items-center gap-2 border-b border-line pr-3 text-[12.5px]', leftCollapsed ? 'pl-[78px]' : 'pl-4')}>
      {leftCollapsed && <PaneToggle side="left" onClick={onExpandLeft} label="Show sidebar" />}
      {children}
    </header>
  )
}
