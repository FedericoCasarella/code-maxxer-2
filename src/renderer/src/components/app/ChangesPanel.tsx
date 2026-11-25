import { useEffect, useMemo, useState } from 'react'
import { GitPullRequest, MessageSquare, Search } from 'lucide-react'
import type { ChangeRequest } from '@shared/types'
import { ApprovalCard } from '../affect/approval-card'
import { Button } from '../affect/button'
import { EmptyState } from '../affect/empty-state'
import { AgentLedger, type LedgerEntry } from '../affect/agent-ledger'
import { Pagination } from '../affect/pagination'
import { TextField } from '../affect/text-field'
import { Marquee } from './Marquee'
import { jumpToMessage } from './PlanCard'
import { actions, useStore } from '@/lib/store'
import { cn, timeAgoLabel } from '@/lib/utils'
import { t } from '@/lib/i18n'

/**
 * Pull requests: what the agents changed for each of your requests, waiting for your OK (affectUI Approval Card each).
 * Approve pushes it and opens (or adds to) the branch's PR on GitHub; below, the open, merged and refused ones.
 */
export function ChangesPanel() {
  const [list, setList] = useState<ChangeRequest[] | null>(null)
  useEffect(() => {
    let on = true
    const load = () => void window.cm.listChanges?.()?.then((x) => on && setList(x)).catch(() => on && setList([]))
    load()
    const off = window.cm.onEvent((e) => e.type === 'changes' && load())
    // Merged on GitHub happens elsewhere: look again now and then
    const timer = setInterval(load, 60_000)
    return () => {
      on = false
      off()
      clearInterval(timer)
    }
  }, [])

  // Only the open branch's pull requests (all of them when no branch is open)
  const selectedWs = useStore((s) => s.selectedWs)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const q = query.trim().toLowerCase()
  // The search looks at the title, project, branch and PR number
  const found = useMemo(
    () => (list ?? []).filter((c) => !selectedWs || c.workspaceId === selectedWs).filter((c) => !q || [titleOf(c), c.project, c.branch, c.prNumber ? `#${c.prNumber}` : ''].some((x) => x.toLowerCase().includes(q))),
    [list, q, selectedWs]
  )
  useEffect(() => setPage(1), [q, selectedWs])

  if (list && !list.length)
    return (
      <div className="grid h-full min-h-0 flex-1 place-items-center px-4">
        <EmptyState bare icon={<GitPullRequest size={18} />} title={t('No pull requests yet')} text={t('When an agent commits work for one of your requests, it waits here for your OK before it is pushed.')} />
      </div>
    )
  const pending = found.filter((c) => c.status === 'pending')
  const done = found.filter((c) => c.status !== 'pending').sort((a, b) => (b.decidedAt ?? b.createdAt) - (a.decidedAt ?? a.createdAt))
  const pages = Math.max(1, Math.ceil(done.length / PAGE))
  const at = Math.min(page, pages)
  const shown = done.slice((at - 1) * PAGE, at * PAGE)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-3 pt-3">
        <TextField
          size="sm"
          prefix={<Search size={12} />}
          clearable
          aria-label={t('Search pull requests')}
          placeholder={t('Search pull requests')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {!found.length && (q ? <p className="px-1 text-[12px] text-mute">{t('No pull requests match')}</p> : <EmptyState bare icon={<GitPullRequest size={18} />} title={t('No pull requests yet')} text={t('When an agent commits work for one of your requests, it waits here for your OK before it is pushed.')} />)}
        {pending.length > 0 && !q && <AllHeader pending={pending} />}
        {pending.map((c) => (
          <PendingCard key={c.id} c={c} />
        ))}
        {done.length > 0 && <DoneLedger list={shown} total={done.length} />}
        {pages > 1 && <Pagination page={at} onPageChange={setPage} pageCount={pages} compact />}
      </div>
    </div>
  )
}

/** Approve every waiting request in one go, oldest first (so each branch's pushes follow its history); a failure stays on its card. */
function AllHeader({ pending }: { pending: ChangeRequest[] }) {
  const [busy, setBusy] = useState<{ merge: boolean; at: number; of: number } | null>(null)
  const run = async (merge: boolean) => {
    const queue = [...pending].sort((a, b) => a.createdAt - b.createdAt)
    for (const [i, c] of queue.entries()) {
      setBusy({ merge, at: i + 1, of: queue.length })
      await window.cm.approveChange(c.id, merge).catch(() => {})
    }
    setBusy(null)
  }
  const label = (merge: boolean) =>
    busy?.merge === merge ? t(merge ? 'Merging {at} of {of}…' : 'Opening {at} of {of}…', { at: busy.at, of: busy.of }) : t(merge ? 'Push and merge all PRs' : 'Push and open all PRs')
  return (
    <div className="flex items-center justify-end gap-2">
      <Button variant="secondary" size="sm" loading={busy?.merge === true} disabled={!!busy} onClick={() => void run(true)}>
        {label(true)}
      </Button>
      <Button variant="primary" size="sm" loading={busy?.merge === false} disabled={!!busy} onClick={() => void run(false)}>
        {label(false)}
      </Button>
    </div>
  )
}

/** A request the app sent on its own (the manual update) reads as its short notice, not as the prompt. */
/** Never the user's own words: the public title, or the last commit's subject until it is written. */
const titleOf = (c: ChangeRequest) => c.publicTitle || c.commits[0]?.subject || t('Changes')

const openChat = (c: ChangeRequest) => (c.messageId ? void jumpToMessage(c.workspaceId, c.messageId) : void actions.selectWorkspace(c.workspaceId))

const PAGE = 10

const STEP_NOTE = { push: 'Pushing the commits…', pr: 'Opening the PR…', merge: 'Merging the PR…' } as const

function PendingCard({ c }: { c: ChangeRequest }) {
  const [error, setError] = useState<string | null>(c.error ?? null)
  useEffect(() => setError(c.error ?? null), [c.error])
  // What the approval is doing now, from the main process
  const [step, setStep] = useState<keyof typeof STEP_NOTE>('push')
  useEffect(() => window.cm.onEvent((e) => e.type === 'change-progress' && e.id === c.id && setStep(e.step)), [c.id])
  return (
    <div className="cm-in flex flex-col gap-1.5">
      <ApprovalCard
        className="cm-pr"
        icon={<GitPullRequest />}
        label={
          <span className="flex min-w-0 items-center gap-1.5">
            <Marquee className="min-w-0" delay={300}>{`${c.project} · ${c.branch} · ${timeAgoLabel(c.createdAt)}`}</Marquee>
          </span>
        }
        title={titleOf(c)}
        description={c.stat || t('{n} commits', { n: c.commits.length })}
        preview={
          <div className="flex flex-col gap-1">
            {c.commits.map((x) => (
              <div key={x.sha} className="cm-commit-row flex min-w-0 items-center gap-2 text-[12px]">
                <span className="shrink-0 font-mono text-[11px] text-mute">{x.sha}</span>
                <Marquee className="min-w-0 flex-1 text-dim" delay={300} hoverTarget=".cm-commit-row">{x.subject}</Marquee>
              </div>
            ))}
            <button onClick={() => openChat(c)} className="mt-1 flex w-fit items-center gap-1 text-[12px] text-mute hover:text-ink">
              <MessageSquare size={12} /> {t('Open the request in the chat')}
            </button>
          </div>
        }
        allowAlways={false}
        approveLabel={t('Push and open PR')}
        altApproveLabel={t('Push and merge the PR')}
        busyNote={t(STEP_NOTE[step])}
        denyLabel={t('Refuse')}
        onApprove={async ({ alt }) => {
          setError(null)
          setStep('push')
          try {
            await window.cm.approveChange(c.id, !!alt)
          } catch (e) {
            setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
            throw e
          }
        }}
        onDeny={({ reason }) => reason === 'user' && void window.cm.rejectChange(c.id)}
      />
      {error && <p className="selectable px-1 text-[12px] text-bad">{error}</p>}
    </div>
  )
}

const LOOK: Record<ChangeRequest['status'], { label: string; dot: string }> = {
  pending: { label: 'Waiting', dot: 'bg-warn' },
  approved: { label: 'PR open', dot: 'bg-[#8ab4ff]' },
  merged: { label: 'Merged', dot: 'bg-ok' },
  closed: { label: 'PR closed', dot: 'bg-mute' },
  rejected: { label: 'Refused', dot: 'bg-bad' }
}

/** The decided ones, on an affectUI Agent Ledger: a row each, its state and PR under the title; a click opens its PR on GitHub, or its chat. */
function DoneLedger({ list, total }: { list: ChangeRequest[]; total: number }) {
  const byId = new Map(list.map((c) => [c.id, c]))
  const entries: LedgerEntry[] = list.map((c) => {
    const look = LOOK[c.status]
    return {
      id: c.id,
      action: titleOf(c),
      system: c.project,
      icon: <span className={cn('size-2 rounded-full', look.dot)} />,
      at: c.decidedAt ?? c.createdAt,
      detail: `${t(c.status === 'approved' && !c.prNumber ? 'Pushed' : look.label)}${c.prNumber ? ` · #${c.prNumber}` : ''} · ${c.branch}`,
      reversible: false
    }
  })
  return (
    <AgentLedger
      key={list.map((c) => c.id).join()}
      className="cm-in"
      title={t('Decided')}
      total={total}
      entries={entries}
      onSelect={(e) => {
        const c = byId.get(e.id)
        if (!c) return
        if (c.prUrl) window.open(c.prUrl, '_blank')
        else openChat(c)
      }}
    />
  )
}
