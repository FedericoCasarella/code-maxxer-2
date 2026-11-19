import { CreateRepoDialog } from './CreateRepoDialog'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ArrowDown, ArrowUp, Check, ChevronRight, FileText, GitBranch, Minus, Plus, RefreshCw, RotateCw, Sparkles, Undo2
} from 'lucide-react'
import type { ScmChange, ScmCommit, ScmStatus } from '@shared/scm'
import { actions, useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { Spinner } from '../affect/spinner'
import { Button } from '../affect/button'
import { Tooltip } from '../affect/tooltip'
import { EmptyState } from '../affect/empty-state'
import { ConfirmDialog } from './ConfirmDialog'
import { TextArea } from '../affect/text-area'
import { fileIcon } from './FilesPanel'
import { Marquee } from './Marquee'
import { locale, t } from '@/lib/i18n'

const POLL_MS = 5000
const STATUS_COLOR: Record<string, string> = {
  M: 'text-[#e2c08d]', A: 'text-ok', U: 'text-ok', D: 'text-bad', R: 'text-[#82aaff]', C: 'text-[#82aaff]', '!': 'text-bad'
}
const STATUS_NAME: Record<string, string> = {
  M: 'Modified', A: 'Added', U: 'Untracked', D: 'Deleted', R: 'Renamed', C: 'Copied', '!': 'Conflict'
}

const split = (p: string) => {
  const i = p.lastIndexOf('/')
  return { name: p.slice(i + 1), dir: i < 0 ? '' : p.slice(0, i) }
}

function ago(at: number) {
  const s = Math.max(1, Math.round((Date.now() - at) / 1000))
  if (s < 60) return t('{n}s', { n: s })
  const m = Math.round(s / 60)
  if (m < 60) return t('{n}m', { n: m })
  const h = Math.round(m / 60)
  if (h < 48) return t('{n}h', { n: h })
  const d = Math.round(h / 24)
  if (d < 60) return t('{n}d', { n: d })
  return new Date(at).toLocaleDateString(locale(), { month: 'short', day: 'numeric', year: '2-digit' })
}

/** Source control for the selected branch: changes, staging, commit, sync, history. */
export function ScmPanel({ workspaceId }: { workspaceId: string | null }) {
  if (!workspaceId) {
    return (
      <div className="grid h-full min-h-0 flex-1 place-items-center px-4">
        <EmptyState bare title={t('No branch')} text={t('Pick a branch on the left to see its changes and commits.')} />
      </div>
    )
  }
  return <Scm key={workspaceId} wsId={workspaceId} />
}

function Scm({ wsId }: { wsId: string }) {
  const filesVersion = useStore((s) => s.files[wsId]?.version ?? 0)
  const [st, setSt] = useState<ScmStatus | null>(null)
  const [commits, setCommits] = useState<ScmCommit[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [discard, setDiscard] = useState<ScmChange[] | null>(null)
  const [open, setOpen] = useState({ conflicts: true, staged: true, changes: true, commits: true })

  const refresh = useCallback(async () => {
    try {
      const [s, l] = await Promise.all([window.cm.scm.status(wsId), window.cm.scm.log(wsId, 150)])
      setSt(s)
      setCommits((old) => (old.length === l.length && old[0]?.sha === l[0]?.sha && old.every((c, i) => c.refs.join() === l[i].refs.join()) ? old : l))
      setLoadError(null)
    } catch (e: any) {
      setLoadError(e.message)
    }
  }, [wsId])

  // Files changed on disk, a poll for what the watcher can't see (commits, index), and on focus.
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (pending.current) clearTimeout(pending.current)
    pending.current = setTimeout(() => void refresh(), 300)
  }, [filesVersion, refresh])
  useEffect(() => {
    const id = setInterval(() => document.visibilityState === 'visible' && void refresh(), POLL_MS)
    const f = () => void refresh()
    window.addEventListener('focus', f)
    void window.cm.scm.fetch(wsId).then(refresh, () => {})
    return () => {
      clearInterval(id)
      window.removeEventListener('focus', f)
    }
  }, [refresh, wsId])

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label)
    setError(null)
    try {
      await fn()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(null)
      void refresh()
    }
  }

  const doCommit = () => {
    if (!st || !msg.trim()) return
    const all = st.staged.length === 0
    void run('commit', async () => {
      await window.cm.scm.commit(wsId, msg, { all })
      setMsg('')
    })
  }

  const openDiff = (c: ScmChange, staged: boolean) =>
    c.status === '!'
      ? actions.openEditor(wsId, { kind: 'file', path: c.path })
      : actions.openEditor(wsId, { kind: 'diff', path: c.path, oldPath: c.oldPath, left: staged ? 'HEAD' : 'index', right: staged ? 'index' : 'worktree' })

  if (loadError && !st) return <NoStatus wsId={wsId} error={loadError} onRetry={() => void refresh()} />
  if (!st) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center">
        <Spinner size={14} className="text-mute" />
      </div>
    )
  }

  const nothing = st.staged.length + st.changes.length + st.conflicts.length === 0
  const canCommit = !!msg.trim() && !nothing && st.conflicts.length === 0 && !busy

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
      {/* Branch + sync */}
      <div className="flex h-9 shrink-0 items-center gap-1 px-3">
        <GitBranch size={12.5} className="shrink-0 text-mute" />
        <Marquee className="min-w-0 font-mono text-[11.5px] text-ink" delay={300}>{st.branch}</Marquee>
        {st.upstream ? (
          <span className="ml-1 flex shrink-0 items-center gap-1.5 text-[11px] tabular-nums text-mute">
            <span className={cn('flex items-center', st.ahead > 0 && 'text-ink')}>
              <ArrowUp size={11} />
              {st.ahead}
            </span>
            <span className={cn('flex items-center', st.behind > 0 && 'text-ink')}>
              <ArrowDown size={11} />
              {st.behind}
            </span>
          </span>
        ) : (
          <span className="ml-1 shrink-0 text-[11px] text-mute">{t('not published')}</span>
        )}
        <span className="flex-1" />
        <IconBtn label={t('Fetch')} busy={busy === 'fetch'} onClick={() => void run('fetch', () => window.cm.scm.fetch(wsId))}>
          <RefreshCw size={13} />
        </IconBtn>
        <IconBtn label={t('Pull')} busy={busy === 'pull'} disabled={!st.upstream} onClick={() => void run('pull', () => window.cm.scm.pull(wsId))}>
          <ArrowDown size={14} />
        </IconBtn>
        <IconBtn label={st.upstream ? t('Push') : t('Publish branch')} busy={busy === 'push'} onClick={() => void run('push', () => window.cm.scm.push(wsId))}>
          <ArrowUp size={14} />
        </IconBtn>
      </div>

      {/* Message + commit */}
      <div className="shrink-0 px-2 pb-2">
        <div className="relative">
          <TextArea
            aria-label={t('Commit message')}
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            onSubmitShortcut={() => doCommit()}
            minRows={2}
            maxRows={6}
            placeholder={t('Message (⌘↵ to commit on {branch})', { branch: st.branch })}
            inputClassName="pr-8"
          />
          <span className="absolute right-1 top-1">
            <IconBtn
              label={t('Write the message with AI')}
              busy={busy === 'ai'}
              disabled={nothing}
              onClick={() =>
                void run('ai', async () => {
                  setMsg(await window.cm.scm.suggestMessage(wsId))
                })
              }
            >
              <Sparkles size={13} />
            </IconBtn>
          </span>
        </div>
        <button
          onClick={doCommit}
          disabled={!canCommit}
          className="mt-1.5 flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-ink text-[12.5px] font-medium text-black hover:bg-ink/90 disabled:opacity-35"
        >
          {busy === 'commit' ? <Spinner size={12} /> : <Check size={13} />}
          {st.staged.length === 0 && !nothing ? t('Commit all') : t('Commit')}
        </button>
        {error && (
          <div className="mt-2 max-h-28 overflow-y-auto whitespace-pre-wrap rounded-md border border-bad/30 bg-bad/[.07] px-2.5 py-1.5 font-mono text-[11px] leading-[1.5] text-bad">
            {error}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden border-t border-line pb-3">
        {st.conflicts.length > 0 && (
          <Section title={t('Merge conflicts')} count={st.conflicts.length} open={open.conflicts} onToggle={() => setOpen({ ...open, conflicts: !open.conflicts })}>
            {st.conflicts.map((c) => (
              <ChangeRow key={c.path} c={c} onOpen={() => openDiff(c, false)} actions={[]} />
            ))}
          </Section>
        )}
        {st.staged.length > 0 && (
          <Section
            title={t('Staged changes')}
            count={st.staged.length}
            open={open.staged}
            onToggle={() => setOpen({ ...open, staged: !open.staged })}
            actions={
              <RowBtn label={t('Unstage all')} onClick={() => void run('unstage', () => window.cm.scm.unstage(wsId, 'all'))}>
                <Minus size={13} />
              </RowBtn>
            }
          >
            {st.staged.map((c) => (
              <ChangeRow
                key={c.path}
                c={c}
                onOpen={() => openDiff(c, true)}
                actions={[
                  { label: t('Open file'), icon: <FileText size={12.5} />, run: () => actions.openEditor(wsId, { kind: 'file', path: c.path }), hide: c.status === 'D' },
                  { label: t('Unstage'), icon: <Minus size={13} />, run: () => void run('unstage', () => window.cm.scm.unstage(wsId, [c.path])) }
                ]}
              />
            ))}
          </Section>
        )}
        <Section
          title={t('Changes')}
          count={st.changes.length}
          open={open.changes}
          onToggle={() => setOpen({ ...open, changes: !open.changes })}
          actions={
            st.changes.length > 0 && (
              <>
                <RowBtn label={t('Discard all')} onClick={() => setDiscard(st.changes)}>
                  <Undo2 size={12.5} />
                </RowBtn>
                <RowBtn label={t('Stage all')} onClick={() => void run('stage', () => window.cm.scm.stage(wsId, st.changes.map((c) => c.path)))}>
                  <Plus size={13} />
                </RowBtn>
              </>
            )
          }
        >
          {st.changes.length === 0 ? (
            <div className="px-4 py-1.5 text-[12px] text-mute">{nothing ? t('Working tree clean') : t('Everything is staged')}</div>
          ) : (
            st.changes.map((c) => (
              <ChangeRow
                key={c.path}
                c={c}
                onOpen={() => openDiff(c, false)}
                actions={[
                  { label: t('Open file'), icon: <FileText size={12.5} />, run: () => actions.openEditor(wsId, { kind: 'file', path: c.path }), hide: c.status === 'D' },
                  { label: c.status === 'U' ? t('Delete file') : t('Discard changes'), icon: <Undo2 size={12.5} />, run: () => setDiscard([c]) },
                  { label: t('Stage'), icon: <Plus size={13} />, run: () => void run('stage', () => window.cm.scm.stage(wsId, [c.path])) }
                ]}
              />
            ))
          )}
        </Section>

        <Section title={t('Commits')} count={commits.length || undefined} open={open.commits} onToggle={() => setOpen({ ...open, commits: !open.commits })}>
          {commits.length === 0 ? <div className="px-4 py-1.5 text-[12px] text-mute">{t('No commits yet')}</div> : <History wsId={wsId} commits={commits} />}
        </Section>
      </div>

      {discard && (
        <ConfirmDialog
          title={discard.length === 1 ? t('Discard changes to {name}?', { name: split(discard[0].path).name }) : t('Discard {n} changes?', { n: discard.length })}
          confirmLabel={t('Discard')}
          danger
          onConfirm={async () => {
            await window.cm.scm.discard(wsId, discard.map((c) => c.path))
            setDiscard(null)
            void refresh()
          }}
          onClose={() => setDiscard(null)}
        >
          {discard.some((c) => c.status === 'U')
            ? t('Untracked files are deleted and edits to the others are thrown away. This can’t be undone.')
            : t('The edits go back to the last staged or committed version. This can’t be undone.')}
        </ConfirmDialog>
      )}
    </div>
  )
}

function IconBtn(p: { label: string; onClick: () => void; busy?: boolean; disabled?: boolean; children: ReactNode }) {
  return (
    <Tooltip content={p.label} side="bottom">
      <button
        aria-label={p.label}
        onClick={p.onClick}
        disabled={p.disabled || p.busy}
        className="grid size-7 place-items-center rounded-md text-dim hover:bg-white/[.06] hover:text-ink disabled:opacity-35"
      >
        {p.busy ? <Spinner size={12} /> : p.children}
      </button>
    </Tooltip>
  )
}

function RowBtn(p: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip content={p.label}>
      <button
        aria-label={p.label}
        onClick={(e) => {
          e.stopPropagation()
          p.onClick()
        }}
        className="grid size-5 place-items-center rounded text-dim hover:bg-white/[.1] hover:text-ink"
      >
        {p.children}
      </button>
    </Tooltip>
  )
}

function Section(p: { title: string; count?: number; open: boolean; onToggle: () => void; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="pt-1">
      <div onClick={p.onToggle} className="group flex h-7 cursor-default items-center gap-1 px-2 text-[11.5px] font-semibold text-dim hover:text-ink">
        <ChevronRight size={12} className={cn('shrink-0 text-mute transition-transform duration-100', p.open && 'rotate-90')} />
        <span>{p.title}</span>
        {p.count != null && <span className="rounded-full bg-white/[.07] px-1.5 text-[10.5px] font-medium tabular-nums text-dim">{p.count}</span>}
        <span className="flex-1" />
        <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">{p.actions}</span>
      </div>
      {p.open && p.children}
    </div>
  )
}

type RowAction = { label: string; icon: ReactNode; run: () => void; hide?: boolean }

function ChangeRow({ c, onOpen, actions: acts, indent = 0 }: { c: ScmChange; onOpen: () => void; actions: RowAction[]; indent?: number }) {
  const { name, dir } = split(c.path)
  return (
    <div
      onClick={onOpen}
      title={`${c.oldPath ? `${c.oldPath} → ` : ''}${c.path} · ${t(STATUS_NAME[c.status])}`}
      style={{ paddingLeft: 22 + indent }}
      className="scm-file group flex h-[24px] cursor-default items-center gap-1.5 pr-2 text-[12.5px] hover:bg-white/[.04]"
    >
      <span className="grid w-4 shrink-0 place-items-center">{fileIcon(name)}</span>
      <span className="min-w-0 shrink-0" style={{ maxWidth: '70%' }}>
        <Marquee className={cn('text-ink/90', c.status === 'D' && 'line-through decoration-white/30')} delay={300} hoverTarget=".scm-file">{name}</Marquee>
      </span>
      <Marquee className="min-w-0 flex-1 text-[11px] text-mute" delay={300} hoverTarget=".scm-file">{dir}</Marquee>
      <span className="flex shrink-0 items-center gap-0.5 group-hover:hidden">
        {(c.add != null || c.del != null) && (
          <span className="mr-1 flex gap-1 font-mono text-[10.5px] tabular-nums">
            {!!c.add && <span className="text-ok">+{c.add}</span>}
            {!!c.del && <span className="text-bad">−{c.del}</span>}
          </span>
        )}
      </span>
      {acts.length > 0 && (
        <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
          {acts.filter((a) => !a.hide).map((a) => (
            <RowBtn key={a.label} label={a.label} onClick={a.run}>
              {a.icon}
            </RowBtn>
          ))}
        </span>
      )}
      <span className={cn('w-3 shrink-0 text-center font-mono text-[11px] font-semibold', STATUS_COLOR[c.status])}>{c.status}</span>
    </div>
  )
}

/* ─────────────── History with a lane graph ─────────────── */

const ROW = 26
const LANE = 12
const PAD = 9
const R = 5
const LANE_COLORS = ['#4d9fff', '#e3a34a', '#c792ea', '#4fc38a', '#f07178', '#89ddff', '#ffcb6b']
const laneX = (l: number) => PAD + l * LANE
const laneColor = (l: number) => LANE_COLORS[l % LANE_COLORS.length]

type GraphRow = {
  lane: number
  /** Lanes passing straight through this row */
  through: number[]
  /** Did a line come into the node from above? */
  fromTop: boolean
  /** Lanes from above that end in this node (other children of the same parent) */
  joins: number[]
  /** Lanes that leave the node downwards: first parent in its own lane, then other parents */
  down: number[]
  width: number
}

/** Classic lane assignment over a topo-ordered log; lines bend in rounded right angles. */
function layout(commits: ScmCommit[]): { rows: GraphRow[]; lanes: number } {
  let lanes: (string | null)[] = []
  let max = 1
  const rows = commits.map((c) => {
    let lane = lanes.indexOf(c.sha)
    const fromTop = lane >= 0
    if (lane < 0) {
      lane = lanes.indexOf(null)
      if (lane < 0) lane = lanes.push(null) - 1
    }
    const joins: number[] = []
    lanes.forEach((s, j) => s === c.sha && j !== lane && joins.push(j))
    const through: number[] = []
    lanes.forEach((s, j) => s && s !== c.sha && through.push(j))
    const next = lanes.slice()
    joins.forEach((j) => (next[j] = null))
    next[lane] = c.parents[0] ?? null
    const down: number[] = c.parents[0] ? [lane] : []
    for (const p of c.parents.slice(1)) {
      let k = next.indexOf(p)
      if (k < 0) {
        k = next.findIndex((s, j) => s === null && j > lane)
        if (k < 0) k = next.push(null) - 1
        next[k] = p
      }
      down.push(k)
    }
    while (next.length && next[next.length - 1] === null) next.pop()
    lanes = next
    const width = Math.max(lane, ...through, ...joins, ...down, 0) + 1
    max = Math.max(max, width)
    return { lane, through, fromTop, joins, down, width }
  })
  return { rows, lanes: Math.min(max, 16) }
}

function GraphCell({ g, w }: { g: GraphRow; w: number }) {
  const mid = ROW / 2
  const x = laneX(g.lane)
  const bend = (fromX: number, toX: number, downwards: boolean) => {
    const s = Math.sign(toX - fromX)
    return downwards
      ? `M ${fromX} ${mid} H ${toX - s * R} Q ${toX} ${mid} ${toX} ${mid + R} V ${ROW}`
      : `M ${fromX} 0 V ${mid - R} Q ${fromX} ${mid} ${fromX + s * R} ${mid} H ${toX}`
  }
  return (
    <svg width={w} height={ROW} className="shrink-0 overflow-hidden" aria-hidden>
      {g.through.map((j) => (
        <line key={`t${j}`} x1={laneX(j)} x2={laneX(j)} y1={0} y2={ROW} stroke={laneColor(j)} strokeWidth={1.6} strokeOpacity={0.75} />
      ))}
      {g.fromTop && <line x1={x} x2={x} y1={0} y2={mid} stroke={laneColor(g.lane)} strokeWidth={1.6} strokeOpacity={0.75} />}
      {g.joins.map((j) => (
        <path key={`j${j}`} d={bend(laneX(j), x, false)} fill="none" stroke={laneColor(j)} strokeWidth={1.6} strokeOpacity={0.75} />
      ))}
      {g.down.map((k) =>
        k === g.lane ? (
          <line key={`d${k}`} x1={x} x2={x} y1={mid} y2={ROW} stroke={laneColor(k)} strokeWidth={1.6} strokeOpacity={0.75} />
        ) : (
          <path key={`d${k}`} d={bend(x, laneX(k), true)} fill="none" stroke={laneColor(k)} strokeWidth={1.6} strokeOpacity={0.75} />
        )
      )}
      <circle cx={x} cy={mid} r={3.6} fill="var(--color-bg)" stroke={laneColor(g.lane)} strokeWidth={1.8} />
    </svg>
  )
}

function RefChip({ r }: { r: string }) {
  const head = r.startsWith('HEAD -> ')
  const name = r.replace(/^HEAD -> /, '').replace(/^tag: /, '')
  const remote = name.includes('/') && /^(origin|upstream)\//.test(name)
  return (
    <span
      className={cn(
        'flex max-w-[120px] shrink-0 overflow-hidden rounded-full border px-1.5 text-[10px] leading-[16px]',
        head ? 'border-accent/50 text-accent' : remote ? 'border-line-strong text-dim' : 'border-[#4d9fff]/40 text-[#8ab4ff]'
      )}
      title={r}
    >
      <Marquee className="min-w-0" delay={300} hoverTarget=".scm-row">{name}</Marquee>
    </span>
  )
}

function History({ wsId, commits }: { wsId: string; commits: ScmCommit[] }) {
  const { rows, lanes } = useMemo(() => layout(commits), [commits])
  const [openSha, setOpenSha] = useState<string | null>(null)
  const [files, setFiles] = useState<Record<string, ScmChange[] | 'loading'>>({})

  const toggle = (sha: string) => {
    setOpenSha((o) => (o === sha ? null : sha))
    if (!files[sha]) {
      setFiles((f) => ({ ...f, [sha]: 'loading' }))
      void window.cm.scm.commitFiles(wsId, sha).then(
        (list) => setFiles((f) => ({ ...f, [sha]: list })),
        () => setFiles((f) => ({ ...f, [sha]: [] }))
      )
    }
  }

  return (
    <div className="pl-1.5">
      {commits.map((c, i) => {
        const g = rows[i]
        // Like VS Code: the text starts right after the lanes this row actually uses.
        const w = laneX(Math.min(g.width, lanes) - 1) + PAD
        const isOpen = openSha === c.sha
        const list = files[c.sha]
        const refs = c.refs.filter((r) => r !== 'HEAD' && !r.endsWith('/HEAD'))
        return (
          <div key={c.sha}>
            <div
              onClick={() => toggle(c.sha)}
              title={`${c.sha.slice(0, 7)} · ${c.author} · ${new Date(c.at).toLocaleString(locale())}\n\n${c.subject}`}
              className={cn('scm-row group flex cursor-default items-center gap-1.5 pr-2 hover:bg-white/[.04]', isOpen && 'bg-white/[.04]')}
              style={{ height: ROW }}
            >
              <GraphCell g={g} w={w} />
              <Marquee className={cn('min-w-0 flex-1 text-[12.5px]', i === 0 ? 'text-ink' : 'text-ink/80')} delay={300} hoverTarget=".scm-row">{c.subject}</Marquee>
              {refs.slice(0, 2).map((r) => (
                <RefChip key={r} r={r} />
              ))}
              <span className="shrink-0 text-[10.5px] tabular-nums text-mute">{ago(c.at)}</span>
            </div>
            {isOpen && (
              <div className="relative pb-1">
                {/* keep the lanes running behind the file list */}
                <svg width={w} className="absolute inset-y-0 left-0" aria-hidden>
                  {[...new Set([...(rows[i + 1]?.through ?? []), ...(rows[i + 1]?.fromTop ? [rows[i + 1].lane] : []), ...(rows[i + 1]?.joins ?? [])])].map((j) => (
                    <line key={j} x1={laneX(j)} x2={laneX(j)} y1={0} y2="100%" stroke={laneColor(j)} strokeWidth={1.6} strokeOpacity={0.75} />
                  ))}
                </svg>
                <div className="flex items-center gap-2 py-1 text-[11px] text-mute" style={{ paddingLeft: w + 8 }}>
                  <span className="font-mono">{c.sha.slice(0, 7)}</span>
                  <Marquee className="min-w-0" delay={300}>{c.author}</Marquee>
                </div>
                {list === 'loading' || !list ? (
                  <div style={{ paddingLeft: w + 8 }} className="py-1">
                    <Spinner size={11} className="text-mute" />
                  </div>
                ) : list.length === 0 ? (
                  <div style={{ paddingLeft: w + 8 }} className="py-1 text-[11.5px] text-mute">{t('No file changes')}</div>
                ) : (
                  list.map((f) => (
                    <ChangeRow
                      key={f.path}
                      c={f}
                      indent={w - 14}
                      onOpen={() => actions.openEditor(wsId, { kind: 'diff', path: f.path, oldPath: f.oldPath, left: `${c.sha}^`, right: c.sha })}
                      actions={[]}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** No status: either the folder has no repository yet (offer to create one), or git failed (say why, retry). */
function NoStatus({ wsId, error, onRetry }: { wsId: string; error: string; onRetry: () => void }) {
  const [check, setCheck] = useState<{ isRepo: boolean; folder: string; githubUser: string | null } | null>(null)
  const [creating, setCreating] = useState(false)
  useEffect(() => {
    setCheck(null)
    void window.cm.repo.check(wsId).then(setCheck, () => setCheck({ isRepo: true, folder: '', githubUser: null }))
  }, [wsId, error])
  if (!check)
    return (
      <div className="grid min-h-0 flex-1 place-items-center">
        <Spinner size={14} className="text-mute" />
      </div>
    )
  return (
    <div className="grid h-full min-h-0 flex-1 place-items-center px-4">
      {check.isRepo ? (
        <EmptyState
          bare
          icon={<GitBranch size={16} />}
          title={t("Couldn't read git")}
          text={error.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}
          action={
            <Button size="sm" variant="secondary" iconRight={<RotateCw size={13} />} onClick={onRetry}>
              {t('Try again')}
            </Button>
          }
        />
      ) : (
        <EmptyState
          bare
          icon={<GitBranch size={16} />}
          title={t('No git repository')}
          text={t('Create one to track changes, commit and push.')}
          action={
            <Button size="sm" variant="secondary" iconRight={<Plus size={13} />} onClick={() => setCreating(true)}>
              {t('Create now')}
            </Button>
          }
        />
      )}
      {creating && (
        <CreateRepoDialog wsId={wsId} folder={check.folder} githubUser={check.githubUser} onClose={() => setCreating(false)} onCreated={onRetry} />
      )}
    </div>
  )
}
