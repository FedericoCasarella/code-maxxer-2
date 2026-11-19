import { useEffect, useMemo, useState } from 'react'
import { usePersisted } from '@/lib/persist'
import {
  Check, ChevronDown, ChevronUp, Copy, FileText, MessageSquareText, Play, RefreshCw, Search, Settings2, SquareTerminal, UserRound
} from 'lucide-react'
import type { AgentSession } from '@shared/types'
import { actions, useStore } from '@/lib/store'
import { cn, timeAgo } from '@/lib/utils'
import { SegmentedControl } from '../affect/segmented-control'
import { DropdownMenu } from '../affect/dropdown-menu'
import { Spinner } from '../affect/spinner'
import { EmptyState } from '../affect/empty-state'
import { Tooltip } from '../affect/tooltip'
import { ClaudeGlyph } from './Logos'
import { TextField } from '../affect/text-field'
import { Marquee } from './Marquee'
import { t } from '@/lib/i18n'

type Scope = 'branch' | 'project' | 'space'
const ago = (at: number) => (timeAgo(at) === 'now' ? t('just now') : t('{t} ago', { t: timeAgo(at) }))
type Sort = 'updated' | 'messages'

/**
 * Agent session history for the right drawer: every Claude Code session run in this
 * workspace's directory (by code-maxxer or by you in a terminal), indexed from disk.
 */
export function AgentsPanel() {
  const selectedWs = useStore((s) => s.selectedWs)
  const selectedProject = useStore((s) => s.selectedProject)
  const projects = useStore((s) => s.projects)
  const workspaces = useStore((s) => s.workspaces)
  const [scope, setScope] = usePersisted<Scope>('agents.scope', 'branch')
  const [sort, setSort] = usePersisted<Sort>('agents.sort', 'updated')
  const [query, setQuery] = useState('')
  const [data, setData] = useState<{ sessions: AgentSession[]; scanned: number } | null>(null)
  const [scannedAt, setScannedAt] = useState(0)
  const [loading, setLoading] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const ws = workspaces.find((w) => w.id === selectedWs)
  const projectId = ws?.projectId ?? selectedProject
  const space = useStore((s) => s.space)
  const target =
    scope === 'branch' ? (selectedWs ? { kind: 'workspace', id: selectedWs } : null)
    : scope === 'project' ? (projectId ? { kind: 'project', id: projectId } : null)
    : { kind: 'space', id: space }

  const scan = async () => {
    if (!target) return setData({ sessions: [], scanned: 0 })
    setLoading(true)
    setData(await window.cm.listSessions(target as any))
    setScannedAt(Date.now())
    setLoading(false)
  }
  // Rescan when the scope changes or a run finishes in any workspace.
  const runningKey = workspaces.map((w) => w.status).join()
  useEffect(() => {
    void scan()
  }, [scope, selectedWs, projectId, space, runningKey])

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    const l = (data?.sessions ?? []).filter((s) => !q || `${s.title} ${s.firstPrompt}`.toLowerCase().includes(q))
    return sort === 'messages' ? [...l].sort((a, b) => b.messages - a.messages) : l
  }, [data, query, sort])

  const groups = useMemo(() => {
    const m = new Map<string, AgentSession[]>()
    for (const s of list) m.set(s.projectId, [...(m.get(s.projectId) ?? []), s])
    return [...m.entries()]
  }, [list])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-start gap-2 px-3 pb-2 pt-2.5">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold">{t('Agent sessions')}</div>
          <div className="text-[11.5px] text-mute">{t('Indexed history')}</div>
        </div>
        <Tooltip content={t('Agent personas')} side="bottom">
          <button onClick={() => actions.setView('agents')} className="grid size-7 place-items-center rounded-md text-mute hover:bg-white/[.06] hover:text-ink" aria-label={t('Agent personas')}>
            <Settings2 size={14} />
          </button>
        </Tooltip>
        <Tooltip content={t('Rescan')} side="bottom">
          <button onClick={() => void scan()} className="grid size-7 place-items-center rounded-md text-mute hover:bg-white/[.06] hover:text-ink" aria-label={t('Rescan')}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : undefined} />
          </button>
        </Tooltip>
      </div>

      <div className="px-3">
        <SegmentedControl
          fullWidth
          size="sm"
          value={scope}
          onChange={setScope}
          aria-label={t('Scope')}
          options={[
            { value: 'branch', label: t('Branch') },
            { value: 'project', label: t('Project') },
            { value: 'space', label: t('Workspace') }
          ]}
        />
<TextField size="sm" className="mt-2" prefix={<Search size={13} />} clearable aria-label={t('Search sessions')} placeholder={t('Search sessions')} value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      <div className="mt-2 flex items-center gap-1.5 border-y border-line px-3 py-1.5 text-[11.5px] text-mute">
        {loading ? <Spinner size={11} /> : <Check size={12} />}
        <span>
          {t('Scanned {n} files').split('{n}')[0]}
          <b className="font-medium text-dim">{data?.scanned ?? 0}</b>
          {t('Scanned {n} files').split('{n}')[1]}
        </span>
        <span className="ml-auto">{scannedAt ? (Date.now() - scannedAt < 60_000 ? t('Just now') : timeAgo(scannedAt)) : '—'}</span>
      </div>

      <div className="flex items-center justify-between gap-2 px-3 py-1.5 text-[12px]">
        <span className="font-medium">
          {list.length === 1 ? t('1 session') : t('{n} sessions', { n: list.length })}
        </span>
        <DropdownMenu
          align="end"
          width={180}
          items={[
            { label: t('Last updated'), type: 'radio', checked: sort === 'updated', onSelect: () => setSort('updated') },
            { label: t('Most messages'), type: 'radio', checked: sort === 'messages', onSelect: () => setSort('messages') }
          ]}
          trigger={({ triggerProps }) => (
            <button {...triggerProps} className="ml-auto flex items-center gap-1 text-dim hover:text-ink">
              {sort === 'updated' ? t('Last updated') : t('Most messages')} <ChevronDown size={12} />
            </button>
          )}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        {!target ? (
          <div className="grid h-full min-h-0 flex-1 place-items-center px-4">
            <EmptyState bare title={t('No branch')} text={t('Pick a branch to see its agent sessions.')} />
          </div>
        ) : list.length === 0 && !loading ? (
          <div className="grid h-full min-h-0 flex-1 place-items-center px-4">
            <EmptyState bare title={t('No sessions')} text={t('Claude Code sessions run in this folder show up here.')} />
          </div>
        ) : (
          groups.map(([pid, sessions]) => {
            const p = projects.find((x) => x.id === pid)
            const isCollapsed = collapsed.has(pid)
            return (
              <section key={pid}>
                <button
                  onClick={() =>
                    setCollapsed((c) => {
                      const n = new Set(c)
                      n.has(pid) ? n.delete(pid) : n.add(pid)
                      return n
                    })
                  }
                  className="agents-proj-row flex w-full items-center gap-1.5 border-b border-line px-3 py-1.5 text-left text-[12.5px] font-medium hover:bg-white/[.02]"
                >
                  <ChevronDown size={12} className={cn('text-mute transition-transform', isCollapsed && '-rotate-90')} />
                  <Marquee className="min-w-0 flex-1" delay={300} hoverTarget=".agents-proj-row">{p?.name ?? t('Project')}</Marquee>
                  <span className="rounded-full bg-white/[.08] px-1.5 text-[10.5px] tabular-nums">{sessions.length}</span>
                </button>
                {!isCollapsed &&
                  sessions.map((s) => (
                    <SessionItem key={s.id} s={s} open={openId === s.id} onToggle={() => setOpenId((o) => (o === s.id ? null : s.id))} />
                  ))}
              </section>
            )
          })
        )}
      </div>
    </div>
  )
}

function SessionItem({ s, open, onToggle }: { s: AgentSession; open: boolean; onToggle: () => void }) {
  const [copied, setCopied] = useState(false)
  const [resumed, setResumed] = useState<string | null>(null)
  const resume = async (how: 'worktree' | 'terminal') => {
    await window.cm.resumeSession(s, how)
    if (how === 'worktree') await actions.selectWorkspace(s.workspaceId)
    setResumed(how)
    setTimeout(() => setResumed(null), 1800)
  }
  return (
    <div className={cn('border-b border-line', open && 'bg-white/[.015]')}>
      <div className="group flex items-start gap-2 px-3 py-2.5">
        <button onClick={onToggle} className="agents-session-btn min-w-0 flex-1 text-left">
          <div className="line-clamp-2 text-[13px] font-medium leading-snug">{s.title}</div>
          <div className="mt-1 flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap text-[11.5px] text-mute">
            <ClaudeGlyph size={11} />
            <span>Claude</span>
            <span>{t('{n} msgs', { n: s.messages })}</span>
            <span>· {ago(s.updatedAt)}</span>
            {s.model && <Marquee className="min-w-0" delay={300} hoverTarget=".agents-session-btn">· {s.model}</Marquee>}
          </div>
        </button>
        <Tooltip content={t('Resume in worktree')} side="left">
          <button onClick={() => void resume('worktree')} className="grid size-6 place-items-center rounded-md text-mute hover:bg-white/[.06] hover:text-ink" aria-label={t('Resume in worktree')}>
            <Play size={13} />
          </button>
        </Tooltip>
        <button onClick={onToggle} className="grid size-6 place-items-center rounded-md text-mute hover:bg-white/[.06] hover:text-ink" aria-label={open ? t('Collapse') : t('Expand')}>
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {open && (
        <div className="cm-in mx-3 mb-3 rounded-xl border border-line bg-raised">
          <div className="flex flex-wrap gap-1.5 p-2.5">
            <ActionBtn icon={<Play size={12} />} label={resumed === 'worktree' ? t('Resumed') : t('Resume in Worktree')} primary onClick={() => void resume('worktree')} />
            <ActionBtn icon={<SquareTerminal size={12} />} label={resumed === 'terminal' ? t('Opened') : t('Resume in New Terminal')} onClick={() => void resume('terminal')} />
            <ActionBtn icon={<FileText size={12} />} label={t('View Log')} onClick={() => void window.cm.openFile(s.file)} />
          </div>
          <Block icon={<MessageSquareText size={12} />} title={t('First prompt')}>
            <Turn
              role="YOU"
              text={s.firstPrompt}
              action={
                <button
                  onClick={() => {
                    void navigator.clipboard.writeText(s.firstPrompt)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1400)
                  }}
                  className="flex items-center gap-1 text-[11px] text-mute hover:text-ink"
                >
                  {copied ? <Check size={11} /> : <Copy size={11} />} {copied ? t('Copied') : t('Copy')}
                </button>
              }
            />
          </Block>
          <Block icon={<MessageSquareText size={12} />} title={t('Latest turns')}>
            <div className="flex flex-col gap-1.5">
              {s.latest.map((turn, i) => (
                <Turn key={i} role={turn.role === 'user' ? 'YOU' : 'AGENT'} text={turn.text} />
              ))}
            </div>
          </Block>
          <Block icon={<UserRound size={12} />} title={t('Account')} last>
            <div className="text-[12px] text-dim">{t('System default')} · <span className="font-mono text-[11px]">{s.id.slice(0, 8)}</span></div>
          </Block>
        </div>
      )}
    </div>
  )
}

function ActionBtn({ icon, label, onClick, primary }: { icon: React.ReactNode; label: string; onClick: () => void; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex h-7 items-center gap-1.5 rounded-md border px-2 text-[12px]',
        primary ? 'border-white/20 bg-ink text-black' : 'border-line bg-white/[.03] text-dim hover:text-ink'
      )}
    >
      {label}
      {icon}
    </button>
  )
}

function Block({ icon, title, children, last }: { icon: React.ReactNode; title: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className={cn('border-t border-line px-2.5 py-2.5', last && 'pb-3')}>
      <div className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-semibold text-mute">
        {icon}
        {title}
      </div>
      {children}
    </div>
  )
}

function Turn({ role, text, action }: { role: 'YOU' | 'AGENT'; text: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-panel px-2.5 py-2">
      <div className="mb-1 flex items-center text-[10.5px] font-semibold tracking-wider text-mute">
        {role === 'YOU' ? t('YOU') : t('AGENT')}
        <span className="ml-auto">{action}</span>
      </div>
      <div className="selectable line-clamp-4 whitespace-pre-wrap text-[12px] leading-snug text-dim">{text}</div>
    </div>
  )
}
