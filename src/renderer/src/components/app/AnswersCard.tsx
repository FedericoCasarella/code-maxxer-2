import { MessageCircleQuestion } from 'lucide-react'
import { t } from '@/lib/i18n'
import { Card, CardContent, CardHeader } from '../affect/card'

export type Answers = { pairs: { q: string; a: string }[]; note: string }

/** The reply AskBlock sends: "- question → answer" lines, then the user's own words. Null for any other message. */
export function parseAnswers(text: string): Answers | null {
  const lines = text.split('\n')
  const pairs: Answers['pairs'] = []
  let i = 0
  for (; i < lines.length; i++) {
    const m = lines[i].match(/^- (.+?) → (.+)$/)
    if (!m) break
    pairs.push({ q: m[1].trim(), a: m[2].trim() })
  }
  if (!pairs.length) return null
  const note = lines.slice(i).join('\n').trim()
  return { pairs, note }
}

/** Answers to the agent's questions: numbered, each question with the answer under it. */
export function AnswersCard({ answers }: { answers: Answers }) {
  return (
    <Card className="w-[min(520px,80%)]">
      <CardHeader icon={<MessageCircleQuestion />} title={t('Answers')} />
      <CardContent>
        <ol className="flex flex-col gap-3">
          {answers.pairs.map((p, i) => (
            <li key={i} className="flex gap-3">
              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-white/[.07] text-[11px] font-medium tabular-nums text-dim">{i + 1}</span>
              <div className="selectable min-w-0">
                <div className="text-[12.5px] leading-5 text-mute">{p.q}</div>
                <div className="text-[13.5px] leading-5 text-ink">{p.a}</div>
              </div>
            </li>
          ))}
        </ol>
        {answers.note && <p className="selectable mt-3 whitespace-pre-wrap border-t border-line pt-3 text-[13.5px] leading-5 text-ink">{answers.note}</p>}
      </CardContent>
    </Card>
  )
}
