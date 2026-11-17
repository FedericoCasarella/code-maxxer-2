import { useState } from 'react'
import { ChevronDown, CornerDownRight, ListEnd, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { DropdownMenu } from '../affect/dropdown-menu'
import { TextField } from '../affect/text-field'

const NONE: never[] = []

/** Prompts sent while the agent was busy. They run in order when the turn ends; Steer sends one now. */
export function QueuePanel({ wsId }: { wsId: string }) {
  const items = useStore((s) => s.queues[wsId]) ?? NONE
  const [open, setOpen] = useState(true)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  if (!items.length) return null

  const commitEdit = (id: string) => {
    if (draft.trim()) void window.cm.editQueued(id, draft.trim())
    setEditing(null)
  }

  return (
    <div className="cm-in mx-3 overflow-hidden rounded-t-xl border border-b-0 border-line bg-raised/70">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center px-3 py-2 text-[12.5px] text-dim hover:text-ink">
        Queued · {items.length}
        <ChevronDown size={14} className={cn('ml-auto text-mute transition-transform', !open && '-rotate-90')} />
      </button>
      {open &&
        items.map((it) => (
          <div key={it.id} className="group flex items-center gap-2 border-t border-line px-3 py-2 text-[13px]">
            <ListEnd size={14} className="shrink-0 text-mute" />
            {editing === it.id ? (
              <TextField
                size="sm"
                className="min-w-0 flex-1"
                aria-label="Queued message"
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => commitEdit(it.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitEdit(it.id)
                  if (e.key === 'Escape') setEditing(null)
                }}
              />
            ) : (
              <span className="min-w-0 flex-1 truncate text-ink">{it.text}</span>
            )}
            <button
              onClick={() => void window.cm.steer(it.id)}
              title="Send now: interrupts the current turn and runs this"
              className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[12.5px] text-dim hover:bg-white/[.06] hover:text-ink"
            >
              <CornerDownRight size={13} /> Steer
            </button>
            <button
              onClick={() => void window.cm.removeQueued(it.id)}
              aria-label="Remove from queue"
              className="grid size-6 shrink-0 place-items-center rounded-md text-mute hover:bg-white/[.06] hover:text-bad"
            >
              <Trash2 size={13} />
            </button>
            <DropdownMenu
              align="end"
              side="top"
              width={170}
              items={[
                {
                  label: 'Edit', icon: <Pencil size={14} />, onSelect: () => {
                    setDraft(it.text)
                    setEditing(it.id)
                  }
                },
                { label: 'Steer now', icon: <CornerDownRight size={14} />, onSelect: () => void window.cm.steer(it.id) },
                { label: 'Remove', icon: <Trash2 size={14} />, danger: true, divider: true, onSelect: () => void window.cm.removeQueued(it.id) }
              ]}
              trigger={({ triggerProps }) => (
                <button {...triggerProps} aria-label="More" className="grid size-6 shrink-0 place-items-center rounded-md text-mute hover:bg-white/[.06] hover:text-ink">
                  <MoreHorizontal size={14} />
                </button>
              )}
            />
          </div>
        ))}
    </div>
  )
}
