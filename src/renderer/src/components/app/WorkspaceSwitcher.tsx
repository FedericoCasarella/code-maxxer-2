import { useRef, useState } from 'react'
import { ArrowRight, Check, Pencil, Plus, Trash2 } from 'lucide-react'
import type { Space } from '@shared/types'
import { actions, useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { Popover } from '../affect/popover'
import { Tooltip } from '../affect/tooltip'
import { PromptDialog } from './PromptDialog'

/** Footer, bottom right: "Workspace → Personal"; opens the workspace manager. */
export function WorkspaceSwitcher() {
  const spaces = useStore((s) => s.spaces)
  const space = useStore((s) => s.space)
  const projects = useStore((s) => s.projects)
  const anchor = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [dialog, setDialog] = useState<{ kind: 'new' } | { kind: 'rename'; sp: Space } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const current = spaces.find((x) => x.id === space)
  const count = (id: string) => projects.filter((p) => p.spaceId === id).length

  return (
    <>
      <button
        ref={anchor}
        onClick={() => setOpen((o) => !o)}
        className={cn('flex h-5 items-center gap-1.5 rounded-md px-1.5 hover:bg-white/5', open && 'bg-white/5')}
      >
        <span className="text-mute">Workspace</span>
        <ArrowRight size={11} className="text-mute" />
        {current && <Badge sp={current} size={14} />}
        <span className="text-dim">{current?.name ?? '—'}</span>
      </button>

      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} side="top" align="end" width={300} offset={8} unstyled>
        <div className="cm-in overflow-hidden rounded-2xl border border-line-strong bg-raised shadow-2xl">
          <div className="px-3.5 pb-1.5 pt-3 text-[11px] font-semibold uppercase tracking-wider text-mute">Workspaces</div>
          <div className="flex max-h-[280px] flex-col overflow-y-auto px-1.5 pb-1.5">
            {spaces.map((sp) => {
              const active = sp.id === space
              const n = count(sp.id)
              return (
                <div
                  key={sp.id}
                  role="menuitemradio"
                  aria-checked={active}
                  onClick={() => {
                    actions.switchSpace(sp.id)
                    setOpen(false)
                  }}
                  className={cn('group flex h-10 cursor-default items-center gap-2.5 rounded-lg px-2', active ? 'bg-white/[.06]' : 'hover:bg-white/[.04]')}
                >
                  <Badge sp={sp} size={24} />
                  <div className="min-w-0 flex-1 leading-tight">
                    <div className="truncate text-[13px] font-medium text-ink">{sp.name}</div>
                    <div className="text-[11px] text-mute">
                      {n} project{n === 1 ? '' : 's'}
                    </div>
                  </div>
                  <Tooltip content="Rename" side="top">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setDialog({ kind: 'rename', sp })
                      }}
                      aria-label={`Rename ${sp.name}`}
                      className="grid size-6 place-items-center rounded-md text-mute opacity-0 hover:bg-white/[.08] hover:text-ink group-hover:opacity-100"
                    >
                      <Pencil size={12} />
                    </button>
                  </Tooltip>
                  <Tooltip content={n > 0 ? 'Move or remove its projects first' : spaces.length <= 1 ? 'The last workspace stays' : 'Delete'} side="top">
                    <button
                      disabled={n > 0 || spaces.length <= 1}
                      onClick={(e) => {
                        e.stopPropagation()
                        setError(null)
                        void actions.deleteSpace(sp.id).catch((err) => setError(err.message))
                      }}
                      aria-label={`Delete ${sp.name}`}
                      className="grid size-6 place-items-center rounded-md text-mute opacity-0 hover:bg-bad/10 hover:text-bad group-hover:opacity-100 disabled:hover:bg-transparent disabled:hover:text-mute disabled:group-hover:opacity-40"
                    >
                      <Trash2 size={12} />
                    </button>
                  </Tooltip>
                  <span className="grid w-4 place-items-center">{active && <Check size={14} className="text-ink" />}</span>
                </div>
              )
            })}
          </div>
          {error && <div className="mx-3 mb-2 rounded-lg bg-bad/10 px-2.5 py-1.5 text-[11.5px] text-bad">{error}</div>}
          <div className="border-t border-line p-1.5">
            <button
              onClick={() => setDialog({ kind: 'new' })}
              className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-[12.5px] text-dim hover:bg-white/[.05] hover:text-ink"
            >
              <span className="grid size-6 place-items-center rounded-md border border-dashed border-line-strong">
                <Plus size={13} />
              </span>
              New workspace…
            </button>
          </div>
        </div>
      </Popover>

      {dialog?.kind === 'new' && (
        <PromptDialog
          title="New workspace"
          label="A set of projects you work on together, e.g. Personal or Agency."
          confirmLabel="Create"
          onSubmit={(v) => actions.newSpace(v)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'rename' && (
        <PromptDialog
          title="Rename workspace"
          initial={dialog.sp.name}
          onSubmit={(v) => actions.saveSpace({ ...dialog.sp, name: v })}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  )
}

function Badge({ sp, size }: { sp: Space; size: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center rounded-md font-bold text-black/80"
      style={{ background: sp.color, width: size, height: size, fontSize: Math.round(size * 0.46) }}
    >
      {sp.name[0]?.toUpperCase()}
    </span>
  )
}
