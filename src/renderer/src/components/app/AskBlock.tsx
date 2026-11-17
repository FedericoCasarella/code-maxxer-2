import { useRef, useState } from 'react'
import { MessageCircleQuestion } from 'lucide-react'
import type { Block } from '@shared/types'
import { useStore } from '@/lib/store'
import { DecisionInbox, type Decision } from '../affect/decision-inbox'
import { TextArea } from '../affect/text-area'
import { Button } from '../affect/button'
import { loadPrefs } from './Composer'

type Ask = Extract<Block, { kind: 'ask' }>

/** The agent's questions: affectUI Decision Inbox (two answers each) and a free reply. Answers go back as one message. */
export function AskBlock({ b }: { b: Ask }) {
  const wsId = useStore((s) => s.selectedWs)
  // Answered once the chat moved on: a user message after the one holding these questions.
  const answered = useStore((s) => {
    const list = wsId ? s.messages[wsId] ?? [] : []
    const at = list.findIndex((m) => m.role === 'assistant' && m.blocks.some((x) => x.id === b.id))
    return at >= 0 && list.slice(at + 1).some((m) => m.role === 'user')
  })
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
  }

  const decisions: Decision[] = b.questions.map((q) => ({ id: q.id, title: q.title, detail: q.detail, primary: q.primary, secondary: q.secondary }))
  if (answered || sent) {
    return (
      <div className="flex items-center gap-1.5 text-[12.5px] text-mute">
        <MessageCircleQuestion size={13} /> {b.questions.length === 1 ? 'Question answered' : `${b.questions.length} questions answered`}
      </div>
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
        label="Or answer in your own words"
        minRows={2}
        maxRows={8}
        value={free}
        onChange={(e) => setFree(e.target.value)}
        onSubmitShortcut={(v) => send(v)}
        hint="⌘↵ to send"
      />
      <div className="flex justify-end">
        <Button size="sm" disabled={!free.trim()} onClick={() => send()}>
          Send reply
        </Button>
      </div>
    </div>
  )
}
