import { useEffect, useRef, useState } from 'react'
import { Check, X, Zap } from 'lucide-react'
import type { Block } from '@shared/types'
import { usePersisted } from '@/lib/persist'
import { useStore } from '@/lib/store'
import { t } from '@/lib/i18n'
import { timeAgoLabel } from '@/lib/utils'
import { Button } from '../affect/button'
import { ApprovalCard, type ApprovalState } from '../affect/approval-card'
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

  const decide = async (id: string, choice: Choice) => {
    const ask = asks.find((a) => a.id === id)
    if (!ask) return
    setError(null)
    if (choice === 'approved') {
      setWorking(id)
      try {
        await window.cm.installSkillProposal(wsId, ask.p.url)
      } catch (e) {
        setError({ id, text: errText(e as Error) })
        setRound((r) => r + 1)
        return
      } finally {
        setWorking(null)
      }
    }
    decidedNow.current = true
    setChoices({ ...latest.current, [id]: choice })
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
    const state: ApprovalState = working === id ? 'working' : error ? 'failed' : choices[id] ?? 'pending'
    return (
      <div className="cm-in max-w-[560px]">
        <ApprovalCard
          agent={t('Agent')}
          icon={<Zap size={12} />}
          kind={t('Skill')}
          time={timeAgoLabel(at)}
          flag={t('To approve')}
          title={t('Install the skill {name}', { name: p.name })}
          subtitle={p.why}
          detailLabel={t('What it does')}
          detail={p.what}
          context={p.url}
          state={state}
          note={error?.text ?? (choices[id] === 'approved' ? t('Loaded in this chat from the next message') : undefined)}
          approveLabel={t('Install')}
          onReject={() => void decide(id, 'rejected')}
          onApprove={() => void decide(id, 'approved')}
        />
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
          detail: `${a.p.why}\n\n${a.p.what}`,
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
