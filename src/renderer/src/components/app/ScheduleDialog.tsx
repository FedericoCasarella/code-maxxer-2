import { useState } from 'react'
import { CalendarClock } from 'lucide-react'
import { DatePicker } from '../affect/date-picker'
import { TimePicker } from '../affect/time-picker'

const pad = (n: number) => String(n).padStart(2, '0')
const toTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`

/** Pick a day and a time with the design system's date and time pickers. */
export function ScheduleDialog({
  text, initial, title = 'Schedule run', onSubmit, onClose
}: { text: string; initial?: number; title?: string; onSubmit: (at: number) => void | Promise<void>; onClose: () => void }) {
  const start = new Date(initial ?? Date.now() + 60 * 60_000)
  if (!initial) start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15, 0, 0)
  const [day, setDay] = useState<Date>(start)
  const [time, setTime] = useState<string | null>(toTime(start))
  const at = (() => {
    if (!time) return NaN
    const [h, m] = time.split(':').map(Number)
    const d = new Date(day)
    d.setHours(h, m, 0, 0)
    return d.getTime()
  })()
  const valid = Number.isFinite(at) && at > Date.now()
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 backdrop-blur-[2px]" onMouseDown={onClose}>
      <div className="cm-in w-[420px] rounded-2xl border border-line-strong bg-raised p-5 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 text-[15px] font-semibold">
          <CalendarClock size={16} className="text-accent" /> {title}
        </div>
        <div className="mt-3 line-clamp-3 rounded-lg border border-line bg-panel px-3 py-2 text-[12.5px] text-dim">{text}</div>
        <div className="mt-4 grid grid-cols-[1fr_150px] gap-2.5">
          <DatePicker label="Day" value={day} onChange={setDay} min={today} weekStartsOn={1} />
          <TimePicker label="Time" value={time} onChange={setTime} step={15} hourCycle={24} />
        </div>
        <div className={`mt-2 text-[12px] ${valid ? 'text-mute' : 'text-warn'}`}>{valid ? relative(at) : 'Pick a moment in the future'}</div>
        <p className="mt-3 text-[11.5px] leading-snug text-mute">Runs in this branch's chat with the current model and mode, while code-maxxer is open.</p>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="h-8 rounded-lg px-3 text-dim hover:bg-white/5 hover:text-ink">
            Cancel
          </button>
          <button
            disabled={!valid}
            onClick={async () => {
              await onSubmit(at)
              onClose()
            }}
            className="h-8 rounded-lg bg-ink px-3.5 font-medium text-black disabled:opacity-40"
          >
            Schedule
          </button>
        </div>
      </div>
    </div>
  )
}

export function relative(at: number): string {
  const m = Math.round((at - Date.now()) / 60_000)
  if (m < 1) return 'now'
  if (m < 60) return `in ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `in ${h}h${m % 60 ? ` ${m % 60}m` : ''}`
  const d = Math.floor(h / 24)
  return `in ${d} day${d === 1 ? '' : 's'}${h % 24 ? ` ${h % 24}h` : ''}`
}
