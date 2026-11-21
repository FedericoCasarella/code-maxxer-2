import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check, X } from 'lucide-react'
import { IconButton } from '../affect/icon-button'
import { t } from '@/lib/i18n'

const BARS = 26

type Phase = 'off' | 'starting' | 'listening' | 'commit' | 'cancel'

/** Live dictation through the main process (Apple's on-device recognizer). */
export function useDictation(onCommit: (words: string) => void) {
  const [phase, setPhase] = useState<Phase>('off')
  const [partial, setPartial] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [levels, setLevels] = useState<number[]>(() => Array(BARS).fill(0))
  const latest = useRef('')

  useEffect(
    () =>
      window.cm.onEvent((e) => {
        if (e.type !== 'dictation') return
        if (e.event === 'status') setStatus(e.message ?? null)
        else if (e.event === 'ready') {
          setStatus(null)
          setPhase((p) => (p === 'starting' ? 'listening' : p))
        }
        else if (e.event === 'partial' || e.event === 'final') {
          latest.current = e.text ?? ''
          setPartial(latest.current)
        } else if (e.event === 'level') setLevels((l) => [...l.slice(1), e.level ?? 0])
        else if (e.event === 'error') {
          setError(e.message ?? t('Dictation failed'))
          setPhase('off')
        }
      }),
    []
  )

  const start = () => {
    setError(null)
    setPartial('')
    latest.current = ''
    setLevels(Array(BARS).fill(0))
    setPhase('starting')
    void window.cm.startDictation(navigator.language || 'en-US')
  }
  // ✓: the grey words turn into text; ×: they fade away. The helper stops either way.
  const commit = () => {
    void window.cm.stopDictation(false)
    setPhase('commit')
    setTimeout(() => {
      if (latest.current.trim()) onCommit(latest.current.trim())
      setPhase('off')
      setPartial('')
    }, 260)
  }
  const cancel = () => {
    void window.cm.stopDictation(false)
    setPhase('cancel')
    setTimeout(() => {
      setPhase('off')
      setPartial('')
    }, 260)
  }
  useEffect(() => {
    // A helper waits ready with the model loaded: pressing the mic listens at once
    void window.cm.prewarmDictation(navigator.language || 'en-US')
    return () => void window.cm.stopDictation(false)
  }, [])

  return { phase, active: phase !== 'off', partial, error, status, levels, start, commit, cancel, dismissError: () => setError(null) }
}

/** The prompt text with the words being spoken after it, grey until confirmed. */
export function DictationText({ text, partial, phase, status }: { text: string; partial: string; phase: Phase; status?: string | null }) {
  // Each new word keeps the latest line in view; scrolling by hand between words is left alone.
  const box = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight
  }, [text, partial])
  return (
    <div ref={box} className="selectable max-h-60 min-h-[52px] overflow-y-auto whitespace-pre-wrap px-4 pt-3.5 text-[14px] leading-6 text-ink">
      {text}
      {text && partial && !text.endsWith(' ') && !text.endsWith('\n') ? ' ' : ''}
      <span
        className="transition-[color,opacity] duration-[260ms] ease-out"
        style={{ color: phase === 'commit' ? 'var(--color-ink)' : 'var(--color-mute)', opacity: phase === 'cancel' ? 0 : 1 }}
      >
        {partial}
      </span>
      {phase !== 'commit' && phase !== 'cancel' && (
        <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-[3px] bg-accent" style={{ animation: 'cm-pulse 1s infinite' }} />
      )}
      {!text && !partial && <span className="text-mute">{status ?? (phase === 'starting' ? t('Starting the microphone…') : t('Listening…'))}</span>}
    </div>
  )
}

/** Live level bars from the microphone, then cancel and confirm. */
export function DictationBar({ levels, onCancel, onCommit }: { levels: number[]; onCancel: () => void; onCommit: () => void }) {
  return (
    <div className="cm-in flex items-center gap-2">
      <div className="flex h-7 items-center gap-[3px] px-1" aria-label={t('Microphone level')}>
        {levels.map((l, i) => (
          <span
            key={i}
            className="w-[2px] rounded-full bg-ink/80 transition-[height] duration-100 ease-out"
            style={{ height: `${Math.max(3, Math.min(22, 3 + l * 22))}px`, opacity: 0.35 + Math.min(0.65, l * 1.5) }}
          />
        ))}
      </div>
      <IconButton label={t('Cancel dictation')} variant="secondary" size="sm" icon={<X size={14} />} onClick={onCancel} />
      <IconButton label={t('Use the dictated text')} variant="secondary" size="sm" icon={<Check size={14} />} onClick={onCommit} />
    </div>
  )
}
