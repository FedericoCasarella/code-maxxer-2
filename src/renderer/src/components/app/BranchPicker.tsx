import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, GitBranch, Info, MessageSquare, Search } from 'lucide-react'
import type { BranchInfo, Workspace } from '@shared/types'
import { actions } from '@/lib/store'
import { cn, timeAgo } from '@/lib/utils'
import { Popover } from '../affect/popover'
import { Spinner } from '../affect/spinner'
import { Marquee } from './Marquee'
import { TextField } from '../affect/text-field'

/** The branch chip under the prompt: search the project's branches and jump to (or open) a branch's chat. */
export function BranchPicker({ ws }: { ws: Workspace }) {
  const anchor = useRef<HTMLButtonElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [branches, setBranches] = useState<BranchInfo[] | null>(null)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) return
    setQ('')
    setError(null)
    setBranches(null)
    void window.cm.listBranches(ws.id).then(setBranches)
    setTimeout(() => input.current?.focus(), 30)
  }, [open, ws.id])

  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    const l = (branches ?? []).filter((b) => !s || b.name.toLowerCase().includes(s))
    // current first, then the rest by recency
    return [...l.filter((b) => b.current), ...l.filter((b) => !b.current)]
  }, [branches, q])
  useEffect(() => setActive(0), [q])

  const pick = async (b: BranchInfo) => {
    if (b.current) return setOpen(false)
    setBusy(b.name)
    setError(null)
    try {
      const target = b.workspaceId ?? (await window.cm.openBranch(ws.projectId, b.name)).id
      if (!b.workspaceId) await actions.reloadProjects()
      await actions.selectWorkspace(target)
      setOpen(false)
    } catch (e: any) {
      setError(e.message?.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') ?? 'Could not open branch')
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <button
        ref={anchor}
        onClick={() => setOpen((o) => !o)}
        className={cn('branch-picker-btn flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 font-mono hover:bg-white/[.06] hover:text-ink', open && 'bg-white/[.06] text-ink')}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <GitBranch size={12} className="shrink-0" />
        <Marquee className="min-w-0" delay={300} hoverTarget=".branch-picker-btn">{ws.branch}</Marquee>
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} side="top" align="start" width={330} offset={8} unstyled focusOnOpen={false}>
        <div className="cm-in overflow-hidden rounded-xl border border-line-strong bg-raised shadow-2xl">
          <div className="border-b border-line p-2">
            <TextField
              size="sm"
              prefix={<Search size={13} />}
              aria-label="Search branches"
              ref={input}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => Math.min(a + 1, list.length - 1)))
                if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)))
                if (e.key === 'Enter' && list[active]) void pick(list[active])
                if (e.key === 'Escape') setOpen(false)
              }}
              placeholder="Search branches"
            />
          </div>
          <div className="flex items-start gap-2 border-b border-line px-3 py-2 text-[11.5px] leading-snug text-mute">
            <Info size={13} className="mt-px shrink-0" />
            Each branch has its own worktree and chat: switching never touches uncommitted work.
          </div>
          {error && <div className="selectable border-b border-line bg-bad/10 px-3 py-2 text-[12px] text-bad">{error}</div>}
          <div className="max-h-[320px] overflow-y-auto p-1">
            {!branches ? (
              <div className="flex justify-center py-4"><Spinner size={14} /></div>
            ) : list.length === 0 ? (
              <div className="px-3 py-4 text-center text-[12px] text-mute">No branches match</div>
            ) : (
              list.map((b, i) => (
                <div
                  key={b.name}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => void pick(b)}
                  className={cn(
                    'flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-[12.5px]',
                    b.current ? 'bg-white/[.08] text-ink' : i === active ? 'bg-white/[.05] text-ink' : 'text-dim'
                  )}
                >
                  <Marquee className="min-w-0 flex-1 font-mono text-[12px]" hoverTarget="[role=option]">
                    {b.name}
                  </Marquee>
                  {busy === b.name ? (
                    <Spinner size={12} />
                  ) : b.current ? (
                    <>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          void navigator.clipboard.writeText(b.name)
                          setCopied(true)
                          setTimeout(() => setCopied(false), 1200)
                        }}
                        className="text-mute hover:text-ink"
                        aria-label="Copy branch name"
                      >
                        {copied ? <Check size={12} /> : <Copy size={12} />}
                      </button>
                      <Check size={13} className="text-ink" />
                    </>
                  ) : b.workspaceId ? (
                    <span className="flex shrink-0 items-center gap-1 text-[11px] text-[#8ab4ff]">
                      <MessageSquare size={11} /> Open chat
                    </span>
                  ) : (
                    <span className="shrink-0 text-[11px] text-mute">{timeAgo(b.updatedAt)} ago</span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </Popover>
    </>
  )
}
