import { PanelLeft, PanelRight } from 'lucide-react'
import { Tooltip } from '../affect/tooltip'

/** The fold/unfold button that sits top-left in a drawer (or in the center header when folded). */
export function PaneToggle({ side, onClick, label }: { side: 'left' | 'right'; onClick: () => void; label: string }) {
  const Icon = side === 'left' ? PanelLeft : PanelRight
  return (
    <Tooltip content={label} side="bottom">
      <button
        onClick={onClick}
        aria-label={label}
        className="no-drag grid size-6 shrink-0 place-items-center rounded-md text-mute hover:bg-white/[.06] hover:text-ink"
      >
        <Icon size={14} />
      </button>
    </Tooltip>
  )
}
