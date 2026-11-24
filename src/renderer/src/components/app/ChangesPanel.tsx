import { useEffect, useState } from 'react'
import { ArrowUpRight, GitPullRequest, MessageSquare } from 'lucide-react'
import type { ChangeRequest } from '@shared/types'
import { ApprovalCard } from '../affect/approval-card'
import { Button } from '../affect/button'
import { EmptyState } from '../affect/empty-state'
import { Accordion } from '../affect/smart-recommendation'
import { Marquee } from './Marquee'
import { jumpToMessage } from './PlanCard'
import { actions } from '@/lib/store'
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

  if (list && !list.length)
    return (
      <div className="grid h-full min-h-0 flex-1 place-items-center px-4">
        <EmptyState bare icon={<GitPullRequest size={18} />} title={t('No pull requests yet')} text={t('When an agent commits work for one of your requests, it waits here for your OK before it is pushed.')} />
      </div>
    )
  const pending = (list ?? []).filter((c) => c.status === 'pending')
  const done = (list ?? []).filter((c) => c.status !== 'pending')
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      {pending.length > 0 && <AllHeader pending={pending} />}
      {pending.map((c) => (
        <PendingCard key={c.id} c={c} />
      ))}
      {done.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="px-1 text-[12px] font-semibold text-mute">{t('Decided')}</div>
          {done.map((c) => (
            <DoneRow key={c.id} c={c} />
          ))}
        </div>
      )}
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

const openChat = (c: ChangeRequest) => (c.messageId ? void jumpToMessage(c.workspaceId, c.messageId) : void actions.selectWorkspace(c.workspaceId))

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
        title={c.title}
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

function DoneRow({ c }: { c: ChangeRequest }) {
  const look = LOOK[c.status]
  return (
    <Accordion
      stacked
      className="cm-in"
      icon={<span className={cn('mx-1 size-2 shrink-0 rounded-full', look.dot)} />}
      title={<Marquee className="min-w-0" delay={300}>{c.title}</Marquee>}
      meta={<span className="text-[11.5px] text-mute">{t(c.status === 'approved' && !c.prNumber ? 'Pushed' : look.label)}{c.prNumber ? ` · #${c.prNumber}` : ''}</span>}
    >
      <div className="flex flex-col gap-1.5 px-2 pb-1 text-[12px]">
        <Marquee className="text-mute" delay={300}>{`${c.project} · ${c.branch} · ${timeAgoLabel(c.decidedAt ?? c.createdAt)}`}</Marquee>
        {c.commits.map((x) => (
          <div key={x.sha} className="cm-commit-row flex min-w-0 items-center gap-2">
            <span className="shrink-0 font-mono text-[11px] text-mute">{x.sha}</span>
            <Marquee className="min-w-0 flex-1 text-dim" delay={300} hoverTarget=".cm-commit-row">{x.subject}</Marquee>
          </div>
        ))}
        <div className="mt-1 flex items-center gap-3">
          <button onClick={() => openChat(c)} className="flex items-center gap-1 text-mute hover:text-ink">
            <MessageSquare size={12} /> {t('Open the request in the chat')}
          </button>
          {c.prUrl && (
            <button onClick={() => window.open(c.prUrl, '_blank')} className="flex items-center gap-1 text-mute hover:text-ink">
              {t('Open on GitHub')} <ArrowUpRight size={12} />
            </button>
          )}
        </div>
      </div>
    </Accordion>
  )
}
