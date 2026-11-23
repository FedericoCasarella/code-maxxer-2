import { useEffect, useRef, useState } from 'react'
import { Check, ExternalLink, X, Zap } from 'lucide-react'
import type { Block } from '@shared/types'
import { usePersisted } from '@/lib/persist'
import { useStore } from '@/lib/store'
import { t } from '@/lib/i18n'
import { timeAgoLabel } from '@/lib/utils'
import { Button } from '../affect/button'
import { ApprovalCard } from '../affect/approval-card'
import { DecisionInbox } from '../affect/decision-inbox'
import { loadPrefs } from './Composer'

type Proposal = { name: string; url: string; why: string; what: string }
type ToolBlock = Extract<Block, { kind: 'tool' }>
type Choice = 'approved' | 'rejected'

/** What was chosen on each card before the cards were grouped. */
const earlier = (blocks: ToolBlock[]): Record<string, Choice> => {
  const out: Record<string, Choice> = {}
  for (const b of blocks) {
    try {
      const v = JSON.parse(localStorage.getItem(`cm2.view.skill-proposal.${b.id}`) ?? 'null')
      if (v === 'approved' || v === 'rejected') out[b.id] = v
    } catch { /* no earlier choice */ }
  }
  return out
}

/** Where a skill comes from: always in sight, the whole address, opens in the browser. */
export function SkillSource({ url, className }: { url: string | null; className?: string }) {
  if (!url) return <span className={className}>{t('Written in the app: no source online')}</span>
  return (
    <a href={url} target="_blank" rel="noreferrer" className={['inline-flex max-w-full items-start gap-1 break-all font-mono text-[11.5px] leading-[1.5] text-dim hover:text-ink', className].filter(Boolean).join(' ')}>
      <span className="min-w-0">{url}</span>
      <ExternalLink size={11} className="mt-[3px] shrink-0" />
    </a>
  )
}

const errText = (e: Error) => e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/**
 * The skills the agent asked for in one reply: installed only if the user approves. One asks with its approval card,
 * several with a Decision Inbox. The agent waits; once every one is decided, a message tells it which were installed.
 */
export function SkillProposals({ blocks, wsId, messageId, done }: { blocks: ToolBlock[]; wsId: string; messageId: string; done: boolean }) {
  // Choices made on the earlier one-card-per-skill version are kept
  const [choices, setChoices] = usePersisted<Record<string, Choice>>(`skill-proposals.${messageId}`, earlier(blocks))
  const latest = useRef(choices)
  latest.current = choices
  const [working, setWorking] = useState<string | null>(null)
  const [error, setError] = useState<{ id: string; text: string } | null>(null)
  // The inbox keeps its answers itself: a failed install remounts it, so that skill asks again.
  const [round, setRound] = useState(0)
  // Already answered by a later message from the user: nothing is sent on their behalf.
  const answered = useStore((s) => {
    const list = s.messages[wsId] ?? []
    const at = list.findIndex((m) => m.id === messageId)
    return at >= 0 && list.slice(at + 1).some((m) => m.role === 'user')
  })
  const sent = useRef(false)
  // Only a choice made now sends the message: opening an old chat sends nothing
  const decidedNow = useRef(false)
  const asks = blocks.map((b) => ({ id: b.id, at: b.startedAt, p: b.input as Proposal }))

  /** True once the choice is saved: false when the install failed. */
  const decide = async (id: string, choice: Choice): Promise<boolean> => {
    const ask = asks.find((a) => a.id === id)
    if (!ask) return false
    setError(null)
    if (choice === 'approved') {
      setWorking(id)
      try {
        await window.cm.installSkillProposal(wsId, ask.p.url)
      } catch (e) {
        setError({ id, text: errText(e as Error) })
        setRound((r) => r + 1)
        return false
      } finally {
        setWorking(null)
      }
    }
    decidedNow.current = true
    latest.current = { ...latest.current, [id]: choice }
    setChoices(latest.current)
    return true
  }

  // Every skill decided, the reply over and the user hasn't written since: the agent carries on with what was installed.
  useEffect(() => {
    if (sent.current || !decidedNow.current || answered || !done || !asks.length || asks.some((a) => !choices[a.id])) return
    sent.current = true
    const yes = asks.filter((a) => choices[a.id] === 'approved').map((a) => a.p.name)
    const no = asks.filter((a) => choices[a.id] === 'rejected').map((a) => a.p.name)
    const lines = [
      yes.length ? t('Installed: {names}.', { names: yes.join(', ') }) : '',
      no.length ? t('Not installed: {names}.', { names: no.join(', ') }) : '',
      t('Carry on with the work.')
    ].filter(Boolean)
    const timer = setTimeout(() => {
      void window.cm.send({ ...loadPrefs(), workspaceId: wsId, text: lines.join('\n') })
      window.dispatchEvent(new CustomEvent('cm-sent', { detail: wsId }))
    }, 1200)
    return () => clearTimeout(timer)
  }, [choices, done, answered])

  if (asks.length === 1) {
    const { id, at, p } = asks[0]
    const choice = choices[id]
    return (
      <div className="cm-in flex max-w-[560px] flex-col gap-2">
        <ApprovalCard
          icon={<Zap />}
          label={`${t('Skill')} · ${timeAgoLabel(at)}`}
          title={t('Install the skill {name}', { name: p.name })}
          description={p.why}
          details={[
            { label: t('What it does'), value: p.what },
            { label: t('Source'), value: <SkillSource url={p.url} /> }
          ]}
          allowAlways={false}
          status={choice === 'approved' ? 'approved' : choice === 'rejected' ? 'denied' : 'pending'}
          approveLabel={t('Install')}
          onDeny={() => void decide(id, 'rejected')}
          // The card spins while the skill installs; a failure keeps it waiting and the reason shows below
          onApprove={() => decide(id, 'approved').then((ok) => { if (!ok) throw new Error('not installed') })}
        />
        {error?.id === id && <p className="text-[12px] text-bad">{t("Couldn't install {name}: {error}", { name: p.name, error: error.text })}</p>}
        {choice === 'approved' && <p className="text-[12px] text-mute">{t('Loaded in this chat from the next message')}</p>}
      </div>
    )
  }

  const open = asks.filter((a) => !choices[a.id])
  // Every skill still waiting, one after the other; a failure stops there and shows why
  const installAll = async () => {
    for (const a of open) {
      setError(null)
      setWorking(a.id)
      try {
        await window.cm.installSkillProposal(wsId, a.p.url)
      } catch (e) {
        setError({ id: a.id, text: errText(e as Error) })
        setRound((r) => r + 1)
        return
      } finally {
        setWorking(null)
      }
      decidedNow.current = true
      latest.current = { ...latest.current, [a.id]: 'approved' }
      setChoices(latest.current)
    }
  }
  return (
    <div className="cm-in flex max-w-[592px] flex-col gap-2">
      <DecisionInbox
        key={round}
        decisions={open.map((a) => ({
          id: a.id,
          title: t('Install the skill {name}', { name: a.p.name }),
          detail: (
            <>
              {`${a.p.why}\n\n${a.p.what}`}
              <SkillSource url={a.p.url} className="mt-2 flex" />
            </>
          ),
          primary: t('Install'),
          secondary: t('Reject'),
          primaryIcon: <Check size={13} />,
          secondaryIcon: <X size={13} />
        }))}
        onDecide={(d, a) => void decide(d.id, a === 'primary' ? 'approved' : 'rejected')}
        footer={
          open.length > 1 && (
            <Button size="sm" iconRight={<Check size={13} />} loading={!!working} onClick={() => void installAll()}>
              {t('Install all')}
            </Button>
          )
        }
      />
      {working && <p className="text-[12px] text-mute">{t('Installing {name}…', { name: asks.find((a) => a.id === working)?.p.name ?? '' })}</p>}
      {error && <p className="text-[12px] text-bad">{t("Couldn't install {name}: {error}", { name: asks.find((a) => a.id === error.id)?.p.name ?? '', error: error.text })}</p>}
    </div>
  )
}
