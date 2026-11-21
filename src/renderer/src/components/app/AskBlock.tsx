import { useRef, useState } from 'react'
import { MessageCircleQuestion } from 'lucide-react'
import type { Block } from '@shared/types'
import { useStore } from '@/lib/store'
import { DecisionInbox, NoteTray, type Decision } from '../affect/decision-inbox'
import { TextArea } from '../affect/text-area'
import { Button } from '../affect/button'
import { loadPrefs } from './Composer'
import { t } from '@/lib/i18n'

type Ask = Extract<Block, { kind: 'ask' }>

/** The agent's questions: affectUI Decision Inbox (two answers each) and a free reply. Answers go back as one message. */
export function AskBlock({ b }: { b: Ask }) {
  const wsId = useStore((s) => s.selectedWs)
  // Answered once the chat moved on: a user message after the one holding these questions.
  // The reply that answered them (the next user message), to show what was answered.
  const reply = useStore((s) => {
    const list = wsId ? s.messages[wsId] ?? [] : []
    const at = list.findIndex((m) => m.role === 'assistant' && m.blocks.some((x) => x.id === b.id))
    const next = at >= 0 ? list.slice(at + 1).find((m) => m.role === 'user') : undefined
    return next && next.role === 'user' ? next.text : null
  })
  const answered = reply !== null
  const picks = useRef<Record<string, string>>({})
  const [free, setFree] = useState('')
  const [sent, setSent] = useState(false)

  const send = (extra = free) => {
    if (!wsId || sent) return
    const lines = b.questions.filter((q) => picks.current[q.id]).map((q) => `- ${q.title} → ${picks.current[q.id]}`)
    if (extra.trim()) lines.push(lines.length ? `\n${extra.trim()}` : extra.trim())
    if (!lines.length) return
    setSent(true)
    void window.cm.send({ ...loadPrefs(), workspaceId: wsId, text: lines.join('\n') })
    window.dispatchEvent(new CustomEvent('cm-sent', { detail: wsId }))
  }

  const decisions: Decision[] = b.questions.map((q) => ({ id: q.id, title: q.title, detail: q.detail, primary: q.primary, secondary: q.secondary }))
  if (answered || sent) {
    // Each question with its answer: a pick ("- question → answer") or the user's own words.
    const text = reply ?? ''
    const rest = text.split('\n').filter((l) => !b.questions.some((q) => l.startsWith(`- ${q.title} → `))).join('\n').trim()
    return (
      <NoteTray className="cm-in max-w-[592px]" icon={<MessageCircleQuestion size={16} />} label={t('Your answers')} color="var(--color-ok)">
        <span className="flex flex-col gap-2.5">
          {b.questions.map((q) => {
            const pick = text.split('\n').find((l) => l.startsWith(`- ${q.title} → `))?.slice(q.title.length + 5)
            return (
              <span key={q.id} className="flex flex-col">
                <span className="text-dim">{q.title}</span>
                <span className="font-medium text-ink">{pick ?? (rest ? t('In your own words, below') : '—')}</span>
              </span>
            )
          })}
          {rest && (
            <span className="flex flex-col border-t border-line pt-2.5">
              <span className="text-dim">{t('Your words')}</span>
              <span className="whitespace-pre-line text-ink">{rest}</span>
            </span>
          )}
        </span>
      </NoteTray>
    )
  }
  return (
    <div className="cm-in flex max-w-[592px] flex-col gap-2">
      <DecisionInbox
        decisions={decisions}
        onDecide={(d, a) => {
          picks.current[d.id] = a === 'primary' ? d.primary : d.secondary
          // Every question answered: send after the inbox shows its confirmation.
          if (b.questions.every((q) => picks.current[q.id])) setTimeout(() => send(), 1200)
        }}
      />
      <TextArea
        label={t('Or answer in your own words')}
        minRows={2}
        maxRows={8}
        value={free}
        onChange={(e) => setFree(e.target.value)}
        onSubmitShortcut={(v) => send(v)}
        hint={t('⌘↵ to send')}
      />
      <div className="flex justify-end">
        <Button size="sm" disabled={!free.trim()} onClick={() => send()}>
          {t('Send reply')}
        </Button>
      </div>
    </div>
  )
}
