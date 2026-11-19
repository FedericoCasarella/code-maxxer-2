import { memo, useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ArrowRight, BadgeCheck, ExternalLink, KeyRound, RotateCw, BookOpen, Brain, Clock, CornerDownRight, GitCommitHorizontal, GitFork, ChevronRight, FileCode2, FilePlus2, FileText, Globe, Image as ImageIcon, ListChecks, Search, SquareTerminal } from 'lucide-react'
import { LOGIN_NEEDED, type Block, type ClaudeLoginState, type Message } from '@shared/types'
import { actions, useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { Working } from './Working'
import { AskBlock } from './AskBlock'
import { Timeline } from './Timeline'
import { ToolCallCard, ToolCallGroup } from '../affect/tool-call-card'
import { MessageActions } from '../affect/message-actions'
import { Spinner } from '../affect/spinner'
import { PipelineHandoff } from './PipelineHandoff'
import { AgentPlan } from './AgentPlan'
import { AgentChip, linkMentions } from './AgentMention'
import { Dialog } from '../affect/dialog'
import { Skeleton } from '../affect/shimmer-loader'
import { ProviderLogo } from './Logos'
import { modelLabel, providerOf } from './ModelSelect'
import { Marquee } from './Marquee'
import { Button } from '../affect/button'

export const MessageView = memo(function MessageView({ m }: { m: Message }) {
  if (m.role === 'user')
    return (
      <div className="cm-in flex flex-col items-end gap-1.5">
        {m.attachments && m.attachments.length > 0 && (
          <div className="flex max-w-[80%] flex-wrap justify-end gap-1.5">
            {m.attachments.map((a) => (
              <button
                key={a.path}
                title={a.path}
                onClick={() => void window.cm.openFile(a.path)}
                className="msg-att-chip flex h-8 max-w-[220px] items-center gap-1.5 rounded-lg border border-line bg-raised px-2 text-[12px] text-dim hover:text-ink"
              >
                {a.kind === 'image' ? <ImageIcon size={13} /> : <FileText size={13} />}
                <Marquee className="min-w-0" delay={300} hoverTarget=".msg-att-chip">{a.name}</Marquee>
              </button>
            ))}
          </div>
        )}
        <div className="prose-chat max-w-[80%] rounded-2xl rounded-br-md bg-raised px-4 py-2.5 [&_p]:whitespace-pre-wrap">
          {/* lists typed in the composer render as lists */}
          <Markdown
            remarkPlugins={[remarkGfm]}
            urlTransform={(u) => u}
            components={{ a: ({ href, children }) => (href?.startsWith('cm-agent:') ? <AgentChip handle={href.slice(9)} /> : <a href={href}>{children}</a>) }}
          >
            {linkMentions(m.text)}
          </Markdown>
        </div>
      </div>
    )

  // Group consecutive tool calls; pipeline_step calls are shown by the diagram, not as cards.
  const visible = m.blocks.filter((b) => !(b.kind === 'tool' && (b.name === 'mcp__cm2__pipeline_step' || b.name === 'mcp__cm2__ask_user' || b.name.startsWith('mcp__cm2__plan_'))))
  // The work (thinking, tool calls, the notes in between) goes on one timeline; what comes after the last step is the answer.
  const isWork = (b: Block) => b.kind === 'thinking' || b.kind === 'tool'
  let lastWork = -1
  visible.forEach((b, i) => isWork(b) && (lastWork = i))
  const work = visible.slice(0, lastWork + 1).filter((b) => isWork(b) || b.kind === 'text')
  const other = visible.filter((b, i) => !(i <= lastWork && (isWork(b) || b.kind === 'text')))
  const text = m.blocks.filter((b) => b.kind === 'text').map((b) => (b as any).text).join('\n\n')

  return (
    <div className="group/msg flex flex-col gap-3">
      {(work.length > 0 || !m.done) && <Timeline m={m} blocks={work} />}
      {other.map((b) => (
        <BlockView key={b.id} b={b} />
      ))}
      {!m.done && <LiveShots />}
      {m.error && LOGIN_NEEDED.test(m.error) ? (
        <LoginCallout />
      ) : m.error && (
        <div className="selectable rounded-xl border border-bad/30 bg-bad/[.07] px-3.5 py-2.5 font-mono text-[12px] whitespace-pre-wrap text-bad">
          {m.error}
        </div>
      )}
      {m.cutOff && (
        <div className="flex items-center gap-1.5 text-[12px] text-mute">
          <RotateCw size={12} /> Cut off when code-maxxer restarted · the agent continues below
        </div>
      )}
      {m.interrupted && (
        <div className="flex items-center gap-1.5 text-[12px] text-mute">
          <CornerDownRight size={12} /> Interrupted to steer with your next message
        </div>
      )}
      {m.done && !m.error && !m.cutOff && (
        <div className="-ml-1.5 flex min-w-0 items-center justify-between gap-3 text-[11.5px] text-mute opacity-0 transition-opacity duration-200 ease-out focus-within:opacity-100 group-hover/msg:opacity-100">
          <MessageActions text={text} actions={['copy']} quiet />
          {m.tokens && (
            <span className="shrink-0 whitespace-nowrap tabular-nums">
              {fmt(m.tokens.input + m.tokens.cacheRead)} in · {fmt(m.tokens.output)} out
              {m.tokens.cacheRead > 0 && ` · ${Math.round((m.tokens.cacheRead / Math.max(1, m.tokens.input + m.tokens.cacheRead)) * 100)}% cached`}
            </span>
          )}
        </div>
      )}
    </div>
  )
})

const fmt = (n: number) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n))

function BlockView({ b }: { b: Block }) {
  switch (b.kind) {
    case 'thinking':
      return <ThinkingBlock b={b} />
    case 'text':
      return (
        <div className="prose-chat cm-in">
          <Markdown remarkPlugins={[remarkGfm]}>{b.text}</Markdown>
        </div>
      )
    case 'tool':
      // Plan bookkeeping shows in the plan card, not as tool rows.
      if (b.name.startsWith('mcp__cm2__plan_')) return null
      return commitOf(b) ? <CommitCard b={b} /> : <FileEdit b={b} />
    case 'pipeline':
      return <PipelineBlock runId={b.runId} />
    case 'plan':
      return <PlanBlock planId={b.planId} />
    case 'ask':
      return <AskBlock b={b} />
    case 'fork':
      return <ForkAlert b={b} />
    case 'handoff':
      return <HandoffNote b={b} />
  }
}

/** The agent's browser checks, in order, only while it runs (they vanish with the run). */
function LiveShots() {
  const ws = useStore((s) => s.selectedWs)
  const shots = useStore((s) => (ws ? s.shots[ws] : undefined))
  const [big, setBig] = useState<string | null>(null)
  if (!shots?.length) return null
  return (
    <>
      {/* Small cards, about six to a row; more scroll sideways. */}
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]">
        {shots.map((sh) => (
          <Shot key={sh.at} src={sh.dataUrl} caption={sh.caption} onOpen={() => setBig(sh.dataUrl)} />
        ))}
      </div>
      {big && (
        <Dialog open onOpenChange={(o) => !o && setBig(null)} title="Browser check" size="lg">
          <img src={big} alt="" className="block w-full rounded-lg border border-line" />
        </Dialog>
      )}
    </>
  )
}

function Shot({ src, caption, onOpen }: { src: string; caption: string; onOpen: () => void }) {
  const [loaded, setLoaded] = useState(false)
  return (
    <button
      onClick={onOpen}
      title={caption}
      className="msg-shot-card w-[118px] shrink-0 overflow-hidden rounded-lg border border-line bg-raised text-left hover:border-line-strong"
      style={{ animation: 'cm-fade-up .45s cubic-bezier(.22,1,.36,1) both' }}
    >
      <div className="relative aspect-[16/10] w-full">
        {!loaded && <Skeleton className="absolute inset-0" width="100%" height="100%" radius={0} />}
        <img
          src={src}
          alt={caption}
          onLoad={() => setLoaded(true)}
          className={cn('block size-full object-cover object-top transition-opacity duration-200', loaded ? 'opacity-100' : 'opacity-0')}
        />
      </div>
      <Marquee className="px-2 py-1 text-[10.5px] text-dim" delay={300} hoverTarget=".msg-shot-card">{caption}</Marquee>
    </button>
  )
}

/** A new agent (another model) takes over the pipeline with the previous one's handoff. */
function HandoffNote({ b }: { b: Extract<Block, { kind: 'handoff' }> }) {
  const models = useStore((s) => s.models)
  const [open, setOpen] = useState(false)
  return (
    <div className="cm-in rounded-xl border border-line bg-raised/60">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[12.5px]">
        <ProviderLogo provider={providerOf(b.model)} size={14} />
        <span className="text-dim">Handoff to</span>
        <span className="font-medium text-ink">{modelLabel(b.model, models)}</span>
        <span className="text-mute">· from {b.toNode}</span>
        <ChevronRight size={13} className={cn('ml-auto text-mute transition-transform', open && 'rotate-90')} />
      </button>
      {open && <div className="selectable border-t border-line px-3 py-2.5 text-[12.5px] leading-relaxed whitespace-pre-wrap text-dim">{b.text || 'No handoff text.'}</div>}
    </div>
  )
}

/** The run failed because Claude isn't signed in: the sign-in opens in the browser on its own. */
function LoginCallout() {
  const [st, setSt] = useState<ClaudeLoginState>({ status: 'idle' })
  useEffect(() => {
    void window.cm.claudeLogin.state().then(setSt)
    return window.cm.onEvent((e) => e.type === 'claudeLogin' && setSt(e.state))
  }, [])
  const box = st.status === 'error' ? 'border-bad/30 bg-bad/[.06]' : st.status === 'ok' ? 'border-ok/30 bg-ok/[.06]' : 'border-accent/30 bg-accent/[.06]'
  const title = { idle: 'Not signed in to Claude', pending: 'Signing in to Claude', ok: 'Signed in to Claude', error: 'Sign-in failed' }[st.status]
  const text = {
    idle: 'Sign in to run the agent.',
    pending: 'Finish in the browser window that just opened.',
    ok: 'Send your message again.',
    error: st.message ?? 'The sign-in did not finish.'
  }[st.status]
  return (
    <div className={cn('login-callout cm-in flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-[12.5px]', box)}>
      {st.status === 'pending' ? <Spinner size={14} /> : st.status === 'ok' ? <BadgeCheck size={15} className="text-ok" /> : <KeyRound size={15} className={st.status === 'error' ? 'text-bad' : 'text-accent'} />}
      <span className="shrink-0 font-medium text-ink">{title}</span>
      <Marquee className="min-w-0 flex-1 text-dim" delay={300} hoverTarget=".login-callout">{text}</Marquee>
      {st.status === 'pending' && st.url && (
        <Button size="sm" variant="ghost" iconRight={<ExternalLink size={13} />} onClick={() => window.open(st.url, '_blank')}>
          Open link
        </Button>
      )}
      {(st.status === 'idle' || st.status === 'error') && (
        <Button size="sm" variant="secondary" iconRight={st.status === 'error' ? <RotateCw size={13} /> : <KeyRound size={13} />} onClick={() => void window.cm.claudeLogin.start().then(setSt)}>
          {st.status === 'error' ? 'Try again' : 'Sign in'}
        </Button>
      )}
    </div>
  )
}

/** "Branch forked → name · prompt": opens the new branch's chat. */
function ForkAlert({ b }: { b: Extract<Block, { kind: 'fork' }> }) {
  const exists = useStore((s) => !!b.workspaceId && s.workspaces.some((w) => w.id === b.workspaceId))
  return (
    <button
      disabled={!exists}
      onClick={() => b.workspaceId && void actions.selectWorkspace(b.workspaceId)}
      className={cn(
        'fork-alert-btn cm-in flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left text-[12.5px] transition-colors',
        b.error ? 'border-bad/30 bg-bad/[.06]' : 'border-[#8ab4ff]/25 bg-[#8ab4ff]/[.06] hover:bg-[#8ab4ff]/[.1]'
      )}
    >
      <GitFork size={15} className={b.error ? 'text-bad' : 'text-[#8ab4ff]'} />
      <span className="shrink-0 font-medium">{b.error ? 'Branch fork failed' : 'Branch forked'}</span>
      <ArrowRight size={13} className="shrink-0 text-mute" />
      <span className="shrink-0 font-mono text-[12px] text-ink">{b.branch}</span>
      <Marquee className="min-w-0 flex-1 text-dim" delay={300} hoverTarget=".fork-alert-btn">{b.error ?? b.prompt}</Marquee>
      {exists && <span className="shrink-0 text-[11.5px] text-[#8ab4ff]">Open</span>}
    </button>
  )
}

function PipelineBlock({ runId }: { runId: string }) {
  const run = useStore((s) => s.runs[runId])
  return run ? <PipelineHandoff run={run} /> : null
}

/** Claude-style reasoning: live loader while streaming, expandable to the raw thought. */
function ThinkingBlock({ b }: { b: Extract<Block, { kind: 'thinking' }> }) {
  const [open, setOpen] = useState(false)
  const secs = Math.max(1, Math.round(((b.endedAt ?? Date.now()) - b.startedAt) / 1000))
  return (
    <div className="cm-in">
      {/* Opus 5.x through the CLI streams thinking without its text: then there is nothing to open. */}
      <button
        onClick={() => b.text && setOpen((o) => !o)}
        disabled={b.done && !b.text}
        className="group flex items-center gap-1.5 text-[13px] text-dim enabled:hover:text-ink disabled:cursor-default"
      >
        {b.done ? (
          <>
            <Brain size={14} className="text-mute" />
            <span>Thought for {secs}s</span>
          </>
        ) : (
          <Working phases={['Thinking']} />
        )}
        {!!b.text && <ChevronRight size={13} className={cn('text-mute transition-transform', open && 'rotate-90')} />}
      </button>
      {open && b.text && (
        <div className="selectable mt-2 max-h-80 overflow-y-auto border-l-2 border-line pl-3.5 text-[13px] leading-6 whitespace-pre-wrap text-dim">
          {b.text}
          {!b.done && <span className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 bg-dim" style={{ animation: 'cm-pulse 1s infinite' }} />}
        </div>
      )}
    </div>
  )
}

/** v0-style file edit row: icon, path, +/− and a live state. */
function FileEdit({ b }: { b: Extract<Block, { kind: 'tool' }> }) {
  if (!b.file) return <ToolGroup tools={[b]} />
  const created = b.name === 'Write'
  const parts = b.file.path.split('/')
  const name = parts.pop()
  return (
    <div
      className={cn(
        'file-edit-card cm-in flex h-10 items-center gap-2.5 rounded-xl border px-3 text-[12.5px]',
        b.status === 'running' ? 'cm-file-active border-accent/30' : 'border-line bg-white/[.015]',
        b.status === 'error' && 'border-bad/30'
      )}
    >
      {b.status === 'running' ? (
        <Spinner size={13} className="text-accent" />
      ) : created ? (
        <FilePlus2 size={14} className="text-ok" />
      ) : (
        <FileCode2 size={14} className="text-dim" />
      )}
      <span className="text-mute">{b.status === 'running' ? (created ? 'Creating' : 'Editing') : created ? 'Created' : 'Edited'}</span>
      <Marquee className="min-w-0 flex-1 font-mono text-[12px]" delay={300} hoverTarget=".file-edit-card">
        <span className="text-mute">{parts.length ? parts.join('/') + '/' : ''}</span>
        <span className="text-ink">{name}</span>
      </Marquee>
      {b.file.added > 0 && <span className="font-mono text-[11.5px] text-ok">+{b.file.added}</span>}
      {b.file.removed > 0 && <span className="font-mono text-[11.5px] text-bad">−{b.file.removed}</span>}
    </div>
  )
}

const TOOL_META: Record<string, { label: string; icon: React.ReactNode; summary: (i: any) => string }> = {
  Bash: { label: 'Run', icon: <SquareTerminal size={14} />, summary: (i) => i?.command ?? '' },
  Read: { label: 'Read', icon: <FileText size={14} />, summary: (i) => i?.file_path?.split('/').slice(-2).join('/') ?? '' },
  Grep: { label: 'Search', icon: <Search size={14} />, summary: (i) => i?.pattern ?? '' },
  Glob: { label: 'Find files', icon: <Search size={14} />, summary: (i) => i?.pattern ?? '' },
  WebFetch: { label: 'Fetch', icon: <Globe size={14} />, summary: (i) => i?.url ?? '' },
  WebSearch: { label: 'Web search', icon: <Globe size={14} />, summary: (i) => i?.query ?? '' },
  TodoWrite: { label: 'Todos', icon: <ListChecks size={14} />, summary: (i) => `${i?.todos?.length ?? 0} items` },
  mcp__cm2__brain_record: { label: 'Brain · record', icon: <Brain size={14} />, summary: (i) => `${i?.kind}: ${i?.title ?? ''}` },
  mcp__cm2__brain_search: { label: 'Brain · search', icon: <BookOpen size={14} />, summary: (i) => i?.query ?? i?.kind ?? '' },
  mcp__cm2__brain_read: { label: 'Brain · read', icon: <BookOpen size={14} />, summary: (i) => i?.id ?? '' },
  mcp__cm2__fork_branch: { label: 'Fork to branch', icon: <GitFork size={14} />, summary: (i) => i?.name ?? '' },
  mcp__cm2__schedule_run: { label: 'Schedule run', icon: <Clock size={14} />, summary: (i) => (i?.at ? new Date(i.at).toLocaleString() : '') },
  mcp__cm2__browser_navigate: { label: 'Browser · open', icon: <Globe size={14} />, summary: (i) => i?.url ?? '' },
  mcp__cm2__browser_read: { label: 'Browser · read', icon: <Globe size={14} />, summary: () => 'page' },
  mcp__cm2__browser_click: { label: 'Browser · click', icon: <Globe size={14} />, summary: (i) => (i?.index !== undefined ? `#${i.index}` : i?.selector ?? `${i?.x},${i?.y}`) },
  mcp__cm2__browser_type: { label: 'Browser · type', icon: <Globe size={14} />, summary: (i) => i?.text ?? '' },
  mcp__cm2__browser_key: { label: 'Browser · key', icon: <Globe size={14} />, summary: (i) => i?.key ?? '' },
  mcp__cm2__browser_scroll: { label: 'Browser · scroll', icon: <Globe size={14} />, summary: (i) => String(i?.dy ?? '') },
  mcp__cm2__browser_screenshot: { label: 'Browser · screenshot', icon: <Globe size={14} />, summary: (i) => i?.caption ?? '' },
  mcp__cm2__brain_resolve: { label: 'Brain · resolve', icon: <Brain size={14} />, summary: (i) => i?.id ?? '' }
}

/** A Bash call that ran `git commit`: parse "[branch abc1234] message" and the shortstat. */
function commitOf(b: Block): { branch: string; hash: string; message: string; files?: number; plus?: number; minus?: number } | null {
  if (b.kind !== 'tool' || b.name !== 'Bash') return null
  const cmd = String((b.input as any)?.command ?? '')
  if (!/\bgit\b[^|;&]*\bcommit\b/.test(cmd)) return null
  const out = String(b.result ?? '')
  const m = out.match(/\[([^\]\s]+)(?: \(root-commit\))? ([0-9a-f]{7,})\] (.+)/)
  if (!m) return b.status === 'running' ? { branch: '', hash: '', message: (cmd.match(/-m\s+["']([^"']+)/)?.[1] ?? 'Committing…') } : null
  const st = out.match(/(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/)
  return { branch: m[1], hash: m[2], message: m[3], files: st ? +st[1] : undefined, plus: st?.[2] ? +st[2] : 0, minus: st?.[3] ? +st[3] : 0 }
}

function CommitCard({ b }: { b: Extract<Block, { kind: 'tool' }> }) {
  const c = commitOf(b)!
  return (
    <div className="commit-card cm-in flex items-center gap-2.5 rounded-xl border border-ok/25 bg-ok/[.05] px-3 py-2.5 text-[12.5px]">
      {b.status === 'running' ? <Spinner size={13} className="text-ok" /> : <GitCommitHorizontal size={15} className="text-ok" />}
      <span className="shrink-0 font-medium text-ok">{b.status === 'running' ? 'Committing' : 'Committed'}</span>
      <Marquee className="min-w-0 flex-1 text-ink" delay={300} hoverTarget=".commit-card">{c.message}</Marquee>
      {c.hash && <span className="shrink-0 font-mono text-[11.5px] text-mute">{c.hash.slice(0, 7)}</span>}
      {c.files !== undefined && (
        <span className="shrink-0 font-mono text-[11px] text-mute">
          {c.files} file{c.files === 1 ? '' : 's'} <span className="text-ok">+{c.plus}</span> <span className="text-bad">−{c.minus}</span>
        </span>
      )}
    </div>
  )
}

function ToolGroup({ tools }: { tools: Extract<Block, { kind: 'tool' }>[] }) {
  const cards = tools.map((t) => {
    const meta = TOOL_META[t.name]
    return (
      <ToolCallCard
        key={t.id}
        name={meta?.label ?? t.name.replace(/^mcp__/, '').replace(/__/g, ' · ')}
        icon={meta?.icon}
        summary={meta?.summary(t.input)}
        status={t.status}
        args={t.input}
        result={t.status === 'error' ? undefined : t.result}
        error={t.status === 'error' ? String(t.result ?? 'Failed') : undefined}
        startedAt={t.startedAt}
        duration={t.duration}
        openOnError={false}
      />
    )
  })
  // Every call stays visible, one line each (open one to see arguments and result).
  return <div className="cm-in flex flex-col gap-1.5">{cards}</div>
}

/** The plan proposed in this turn, live (approve right from the chat). */
function PlanBlock({ planId }: { planId: string }) {
  const plan = useStore((s) => Object.values(s.plans).flat().find((p) => p.id === planId))
  const wsId = useStore((s) => s.selectedWs)
  useEffect(() => {
    if (!plan && wsId) void actions.loadPlans(wsId)
  }, [plan, wsId])
  return plan ? <AgentPlan plan={plan} /> : null
}
