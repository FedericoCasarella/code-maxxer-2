import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { usePersisted } from '@/lib/persist'
import { Check, ChevronDown, Layers, Search } from 'lucide-react'
import type { Project } from '@shared/types'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { Popover } from '../affect/popover'
import { TextField } from '../affect/text-field'
import { Spinner } from '../affect/spinner'
import { ProjectAvatar } from './Sidebar'
import { Marquee } from './Marquee'
import { t } from '@/lib/i18n'

/**
 * The one project picker used everywhere: a field like the Select, opening an affectUI Popover with a
 * search field; results come from the server as you type. Arrows move, Enter picks, Escape closes.
 * `allLabel` adds an "all projects" choice (value null).
 * `multiple` turns it into a checklist (several projects, it stays open); `trigger` draws your own opener.
 */
export function ProjectPicker({
  value, onChange, allLabel, className, multiple, trigger
}: {
  value: string | null
  onChange?: (id: string | null) => void
  allLabel?: string
  className?: string
  multiple?: { values: string[]; locked?: string[]; busy?: string | null; onToggle: (id: string, on: boolean) => void }
  trigger?: (p: { ref: RefObject<HTMLButtonElement | null>; open: boolean; toggle: () => void }) => ReactNode
}) {
  const space = useStore((s) => s.space)
  const current = useStore((s) => s.projects.find((p) => p.id === value))
  const anchor = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [items, setItems] = useState<Project[] | null>(null)
  const [active, setActive] = useState(0)

  useEffect(() => {
    if (!open) return
    let live = true
    const timer = setTimeout(async () => {
      const r = await window.cm.searchProjects(q, space)
      if (!live) return
      setItems(r)
      setActive(0)
    }, q ? 120 : 0)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [open, q, space])

  const rows: (Project | null)[] = [...(allLabel && !q ? [null] : []), ...(items ?? [])]
  const pick = (p: Project | null) => {
    if (multiple) {
      if (!p || multiple.locked?.includes(p.id)) return
      multiple.onToggle(p.id, !multiple.values.includes(p.id))
      return
    }
    onChange?.(p?.id ?? null)
    setOpen(false)
    setQ('')
  }

  return (
    <>
      {trigger ? trigger({ ref: anchor, open, toggle: () => setOpen(!open) }) : (
      <button
        ref={anchor}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('Project')}
        onClick={() => setOpen(!open)}
        className={cn(
          'flex h-8 w-64 items-center gap-2 rounded-lg border border-line bg-panel px-2.5 text-left text-[13px] text-ink transition-colors hover:border-line-strong',
          open && 'border-line-strong',
          className
        )}
      >
        {current ? <ProjectAvatar p={current} /> : <Layers size={14} className="text-mute" />}
        <Marquee className="min-w-0 flex-1" delay={300}>
          {current ? (current.owner ? `${current.owner}/${current.name}` : current.name) : allLabel ?? t('Pick a project')}
        </Marquee>
        <ChevronDown size={13} className={cn('shrink-0 text-mute transition-transform', open && 'rotate-180')} />
      </button>
      )}
      <Popover open={open} onClose={() => (setOpen(false), setQ(''))} anchor={anchor} side="bottom" align="start" width={300} offset={6} unstyled>
        <div className="cm-in overflow-hidden rounded-xl border border-line-strong bg-raised shadow-2xl">
          <div className="border-b border-line p-1.5">
            <TextField
              size="sm"
              autoFocus
              aria-label={t('Search projects')}
              placeholder={t('Search projects')}
              prefix={<Search size={13} />}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') (e.preventDefault(), setActive((i) => Math.min(rows.length - 1, i + 1)))
                if (e.key === 'ArrowUp') (e.preventDefault(), setActive((i) => Math.max(0, i - 1)))
                if (e.key === 'Enter' && rows[active] !== undefined) (e.preventDefault(), pick(rows[active]))
              }}
            />
          </div>
          <div role="listbox" aria-multiselectable={!!multiple || undefined} aria-label={t('Projects')} className="max-h-[300px] overflow-y-auto p-1">
            {items === null ? (
              <div className="grid place-items-center py-4">
                <Spinner size={14} />
              </div>
            ) : rows.length === 0 ? (
              <div className="px-3 py-3 text-[12.5px] text-mute">{t('No project matches “{q}”.', { q })}</div>
            ) : (
              rows.map((p, i) => {
                const selected = multiple ? !!p && multiple.values.includes(p.id) : p ? p.id === value : value === null
                const locked = !!p && !!multiple?.locked?.includes(p.id)
                return (
                  <button
                    key={p?.id ?? 'all'}
                    role="option"
                    aria-selected={selected}
                    aria-disabled={locked || undefined}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(p)}
                    className={cn('flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px]', i === active ? 'bg-white/[.06] text-ink' : 'text-ink/90')}
                  >
                    {p ? <ProjectAvatar p={p} /> : <Layers size={14} className="text-mute" />}
                    <Marquee className="min-w-0 flex-1" delay={300}>
                      {p ? (p.owner ? `${p.owner}/${p.name}` : p.name) : allLabel}
                    </Marquee>
                    {multiple ? (
                      multiple.busy === p?.id ? (
                        <Spinner size={12} />
                      ) : (
                        <span
                          aria-hidden="true"
                          className={cn(
                            'grid size-4 shrink-0 place-items-center rounded-[5px] border transition-colors',
                            selected ? 'border-ink bg-ink text-black' : 'border-line-strong',
                            locked && 'opacity-50'
                          )}
                        >
                          {selected && <Check size={11} strokeWidth={3} />}
                        </span>
                      )
                    ) : (
                      selected && <Check size={14} className="shrink-0 text-dim" />
                    )}
                  </button>
                )
              })
            )}
          </div>
        </div>
      </Popover>
    </>
  )
}

/**
 * The project picked in any page's picker, shared by every page and kept across restarts:
 * switching page or reopening the app never silently moves you to another project.
 */
export function usePickedProject(): [string | null, (id: string) => void] {
  const space = useStore((s) => s.space)
  const projects = useStore((s) => s.projects)
  const selected = useStore((s) => s.selectedProject)
  const [saved, setSaved] = usePersisted<string | null>('project', null)
  const inSpace = projects.filter((p) => p.spaceId === space)
  const pid = inSpace.find((p) => p.id === saved)?.id ?? inSpace.find((p) => p.id === selected)?.id ?? inSpace[0]?.id ?? null
  return [pid, setSaved]
}
