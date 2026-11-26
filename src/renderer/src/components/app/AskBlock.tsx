import { useRef, useState } from 'react'
import type { Block } from '@shared/types'
import { useStore } from '@/lib/store'
import { ApprovalGates, type ApprovalGate } from '../affect/approval-gates'
import { loadPrefs } from './Composer'
import { t } from '@/lib/i18n'

type Ask = Extract<Block, { kind: 'ask' }>
type Answer = { status: 'approved' | 'rejected' | 'edited'; text: string }

/**
 * The agent's questions as affectUI Approval Gates: one card per question, its two answers as the buttons and a free
 * reply under Edit. When every question has an answer they go back as one message ("- question → answer" lines).
 */
export function AskBlock({ b }: { b: Ask }) {
  const wsId = useStore((s) => s.selectedWs)
  // The reply that answered them (the next user message), to show what was answered.
  const reply = useStore((s) => {
    const list = wsId ? s.messages[wsId] ?? [] : []
    const at = list.findIndex((m) => m.role === 'assistant' && m.blocks.some((x) => x.id === b.id))
    const next = at >= 0 ? list.slice(at + 1).find((m) => m.role === 'user') : undefined
    return next && next.role === 'user' ? next.text : null
  })
  const answers = useRef<Record<string, Answer>>({})
  const [sent, setSent] = useState(false)

  const send = async () => {
    if (!wsId || sent) return
    const lines = b.questions.map((q) => `- ${q.title} → ${answers.current[q.id].text.replace(/\s*\n\s*/g, ' ')}`)
    setSent(true)
    // The run is still waiting on these questions: it gets the answers and goes on. Otherwise they go as a message.
    if (await window.cm.answerAsk(b.id, lines.join('\n')).catch(() => false)) return
    void window.cm.send({ ...loadPrefs(), workspaceId: wsId, text: lines.join('\n') })
    window.dispatchEvent(new CustomEvent('cm-sent', { detail: wsId }))
  }

  // Already answered (also after a reload): each question with the answer it got, or the reply in the user's words.
  const fromReply = (q: Ask['questions'][number]): Answer | undefined => {
    const said = b.answer ?? reply
    if (said === null) return undefined
    const pick = said.split('\n').find((l) => l.startsWith(`- ${q.title} → `))?.slice(q.title.length + 5).trim()
    if (!pick) return { status: 'edited', text: said.trim() }
    return { status: pick === q.primary ? 'approved' : pick === q.secondary ? 'rejected' : 'edited', text: pick }
  }

  const gates: ApprovalGate[] = b.questions.map((q) => {
    const a = fromReply(q) ?? answers.current[q.id]
    return {
      id: q.id,
      agent: t('Agent'),
      kind: 'message',
      action: q.title,
      reason: q.detail ?? '',
      status: a ? a.status : sent ? 'approved' : 'open',
      note: a?.status === 'edited' ? a.text : undefined,
      labels: { approve: q.primary, reject: q.secondary, edit: t('In your own words'), editField: t('Your answer'), send: t('Send reply') }
    }
  })

  // Every question answered: only the list of questions with their answers stays (no empty card, no counters)
  const answered = gates.every((g) => g.status !== 'open')
  return (
    <div className={answered ? 'cm-in cm-ask cm-ask-done' : 'cm-in cm-ask'}>
      <ApprovalGates
        title={b.questions.length === 1 ? t('A question for you') : t('{n} questions for you', { n: b.questions.length })}
        gates={gates}
        stopOnReject={false}
        onDecide={(id, decision, value) => {
          const q = b.questions.find((x) => x.id === id)
          if (!q) return
          answers.current[id] = { status: decision, text: decision === 'approved' ? q.primary : decision === 'rejected' ? q.secondary : (value ?? '').trim() }
          // Every question answered: send once the last card has dropped into the list.
          if (b.questions.every((x) => answers.current[x.id])) setTimeout(() => void send(), 500)
        }}
      />
    </div>
  )
}
