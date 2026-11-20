import { MessageCircleQuestion } from 'lucide-react'
import { t } from '@/lib/i18n'

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

/** Answers to the agent's questions, in the classic tray: the title on the tray, numbered rows in the card. */
export function AnswersCard({ answers }: { answers: Answers }) {
  return (
    <section className="w-[min(520px,80%)] rounded-2xl bg-white/[.035] p-1">
      <header className="flex items-center gap-2 px-2.5 pb-2 pt-1.5 text-[12px]">
        <MessageCircleQuestion size={13} className="text-mute" />
        <span className="font-medium text-ink">{t('Answers')}</span>
      </header>
      <ol className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel">
        {answers.pairs.map((p, i) => (
          <li key={i} className="flex gap-3 px-3.5 py-3">
            <span className="grid size-5 shrink-0 place-items-center rounded-full bg-white/[.07] text-[11px] font-medium tabular-nums text-dim">{i + 1}</span>
            <div className="selectable min-w-0">
              <div className="text-[12.5px] leading-5 text-mute">{p.q}</div>
              <div className="mt-0.5 text-[13.5px] leading-5 text-ink">{p.a}</div>
            </div>
          </li>
        ))}
        {answers.note && <li className="selectable whitespace-pre-wrap px-3.5 py-3 text-[13.5px] leading-5 text-ink">{answers.note}</li>}
      </ol>
    </section>
  )
}
