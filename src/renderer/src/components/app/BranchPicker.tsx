import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Check, Cloud, Copy, GitBranch, MessageSquare, RefreshCw, Search } from 'lucide-react'
import type { BranchInfo, Workspace } from '@shared/types'
import { actions } from '@/lib/store'
import { cn, timeAgo } from '@/lib/utils'
import { Popover } from '../affect/popover'
import { Spinner } from '../affect/spinner'
import { Marquee } from './Marquee'
import { TextField } from '../affect/text-field'
import { IconButton } from '../affect/icon-button'
import { t } from '@/lib/i18n'

/** The branch chip under the prompt: search the project's branches and jump to (or open) a branch's chat. */
export function BranchPicker({ ws }: { ws: Workspace }) {
  const anchor = useRef<HTMLButtonElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [branches, setBranches] = useState<BranchInfo[] | null>(null)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [fetching, setFetching] = useState(false)
  const live = useRef(false)

  // A fetch of origin, then the list again: new remote branches show up, gone ones leave.
  const fetchRemote = () => {
    setFetching(true)
    void window.cm
      .listBranches(ws.id, { remote: true, fetch: true })
      .then((b) => live.current && setBranches(b))
      .finally(() => live.current && setFetching(false))
  }

  useEffect(() => {
    if (!open) return
    setQ('')
    setError(null)
    setBranches(null)
    live.current = true
    // What's known now right away, then again after the fetch
    void window.cm.listBranches(ws.id, { remote: true }).then((b) => live.current && setBranches((cur) => cur ?? b))
    fetchRemote()
    setTimeout(() => input.current?.focus(), 30)
    return () => {
      live.current = false
    }
  }, [open, ws.id])

  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    const l = (branches ?? []).filter((b) => !s || b.name.toLowerCase().includes(s))
    // current first, then the rest by recency
    return [...l.filter((b) => b.current), ...l.filter((b) => !b.current)]
  }, [branches, q])

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
      setError(e.message?.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') ?? t('Could not open branch'))
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
      <BranchSearch
        open={open}
        onClose={() => setOpen(false)}
        anchor={anchor}
        side="top"
        branches={list}
        loading={!branches}
        q={q}
        setQ={setQ}
        input={input}
        error={error}
        isCurrent={(b) => b.current}
        onPick={(b) => void pick(b)}
        refreshing={fetching}
        onRefresh={fetchRemote}
        right={(b) =>
          busy === b.name ? (
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
                aria-label={t('Copy branch name')}
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
              </button>
              <Check size={13} className="text-ink" />
            </>
          ) : b.workspaceId ? (
            <span className="flex shrink-0 items-center gap-1 text-[11px] text-[#8ab4ff]">
              <MessageSquare size={11} /> {t('Open chat')}
            </span>
          ) : (
            <span className="shrink-0 text-[11px] text-mute">{t('{time} ago', { time: timeAgo(b.updatedAt) })}</span>
          )
        }
      />
    </>
  )
}

/** The branch search of the picker: a field and the list, keyboard included. Shared by every branch picker. */
function BranchSearch({
  open, onClose, anchor, side, branches, loading, q, setQ, input, error, isCurrent, onPick, right, onRefresh, refreshing
}: {
  open: boolean
  onClose: () => void
  anchor: RefObject<HTMLButtonElement | null>
  side: 'top' | 'bottom'
  branches: BranchInfo[]
  loading: boolean
  q: string
  setQ: (q: string) => void
  input: RefObject<HTMLInputElement | null>
  error?: string | null
  isCurrent: (b: BranchInfo) => boolean
  onPick: (b: BranchInfo) => void
  right: (b: BranchInfo) => ReactNode
  /** A button next to the search that fetches the remote again */
  onRefresh?: () => void
  refreshing?: boolean
}) {
  const [active, setActive] = useState(0)
  useEffect(() => setActive(0), [q])
  return (
    <Popover open={open} onClose={onClose} anchor={anchor} side={side} align="start" width={330} offset={8} unstyled focusOnOpen={false}>
      <div className="cm-in overflow-hidden rounded-xl border border-line-strong bg-raised shadow-2xl">
        <div className="flex items-center gap-1.5 border-b border-line p-2">
          <TextField
            className="min-w-0 flex-1"
            size="sm"
            prefix={<Search size={13} />}
            aria-label={t('Search branches')}
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => Math.min(a + 1, branches.length - 1)))
              if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)))
              if (e.key === 'Enter' && branches[active]) onPick(branches[active])
              if (e.key === 'Escape') onClose()
            }}
            placeholder={t('Search branches')}
          />
          {onRefresh && (
            <IconButton
              size="sm"
              variant="ghost"
              label={t('Fetch branches from the remote')}
              icon={refreshing ? <Spinner size={13} /> : <RefreshCw size={14} />}
              disabled={refreshing}
              onClick={onRefresh}
            />
          )}
        </div>
        {error && <div className="selectable border-b border-line bg-bad/10 px-3 py-2 text-[12px] text-bad">{error}</div>}
        <div className="max-h-[320px] overflow-y-auto p-1">
          {loading ? (
            <div className="flex justify-center py-4"><Spinner size={14} /></div>
          ) : branches.length === 0 ? (
            <div className="px-3 py-4 text-center text-[12px] text-mute">{t('No branches match')}</div>
          ) : (
            branches.map((b, i) => (
              <div
                key={b.name}
                role="option"
                aria-selected={isCurrent(b)}
                onMouseEnter={() => setActive(i)}
                onClick={() => onPick(b)}
                className={cn(
                  'flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-[12.5px]',
                  isCurrent(b) ? 'bg-white/[.08] text-ink' : i === active ? 'bg-white/[.05] text-ink' : 'text-dim'
                )}
              >
                {b.remote ? (
                  <Cloud size={13} className="shrink-0 text-[#8ab4ff]" aria-label={t('Only on the remote')} />
                ) : (
                  <GitBranch size={13} className="shrink-0 text-mute" />
                )}
                <Marquee className={cn('min-w-0 flex-1 font-mono text-[12px]', b.remote && 'italic text-mute')} hoverTarget="[role=option]">
                  {b.name}
                </Marquee>
                {right(b)}
              </div>
            ))
          )}
        </div>
      </div>
    </Popover>
  )
}

/** The same picker with several branches ticked (settings): the chip shows the chosen ones, a click toggles a branch. */
export function BranchMultiPicker({ wsId, value, onChange, side = 'bottom' }: { wsId: string; value: string[]; onChange: (v: string[]) => void; side?: 'top' | 'bottom' }) {
  const anchor = useRef<HTMLButtonElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [branches, setBranches] = useState<BranchInfo[] | null>(null)
  const [q, setQ] = useState('')

  useEffect(() => {
    if (!open) return
    setQ('')
    void window.cm.listBranches(wsId).then(setBranches, () => setBranches([]))
    setTimeout(() => input.current?.focus(), 30)
  }, [open, wsId])

  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    const l = (branches ?? []).filter((b) => !s || b.name.toLowerCase().includes(s))
    // ticked first, then the rest by recency
    return [...l.filter((b) => value.includes(b.name)), ...l.filter((b) => !value.includes(b.name))]
  }, [branches, q, value])

  return (
    <>
      <button
        ref={anchor}
        onClick={() => setOpen((o) => !o)}
        className={cn('branch-picker-btn flex min-w-0 max-w-[260px] items-center gap-1.5 rounded-md px-1.5 py-0.5 font-mono text-[12px] text-dim hover:bg-white/[.06] hover:text-ink', open && 'bg-white/[.06] text-ink')}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <GitBranch size={12} className="shrink-0" />
        <Marquee className="min-w-0" delay={300} hoverTarget=".branch-picker-btn">{value.join(', ')}</Marquee>
      </button>
      <BranchSearch
        open={open}
        onClose={() => setOpen(false)}
        anchor={anchor}
        side={side}
        branches={list}
        loading={!branches}
        q={q}
        setQ={setQ}
        input={input}
        isCurrent={(b) => value.includes(b.name)}
        onPick={(b) => {
          const next = value.includes(b.name) ? value.filter((n) => n !== b.name) : [...value, b.name]
          if (next.length) onChange(next)
        }}
        right={(b) => (value.includes(b.name) ? <Check size={13} className="text-ink" /> : null)}
      />
    </>
  )
}
