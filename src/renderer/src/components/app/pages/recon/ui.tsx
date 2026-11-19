import { Children, isValidElement, type ReactNode } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { IncidentStatus, MonitorState, Severity } from '@shared/recon'
import { cn } from '@/lib/utils'
import { Dialog } from '../../../affect/dialog'
import { Button } from '../../../affect/button'
import { t } from '@/lib/i18n'

export const STATE: Record<MonitorState, { label: string; dot: string; text: string }> = {
  up: { label: 'Up', dot: 'bg-ok', text: 'text-ok' },
  retrying: { label: 'Retrying', dot: 'bg-warn', text: 'text-warn' },
  down: { label: 'Down', dot: 'bg-bad', text: 'text-bad' },
  unknown: { label: 'Waiting', dot: 'bg-mute', text: 'text-mute' },
  disabled: { label: 'Not monitored', dot: 'bg-white/20', text: 'text-mute' }
}
export const SEVERITY: Record<Severity, string> = {
  low: 'bg-white/[.06] text-dim', medium: 'bg-warn/12 text-warn', high: 'bg-bad/12 text-bad', critical: 'bg-bad text-black'
}
export const INC_STATUS: Record<IncidentStatus, { label: string; c: string }> = {
  open: { label: 'Open', c: 'bg-bad/12 text-bad' },
  diagnosing: { label: 'Diagnosing', c: 'bg-[#4d8dff]/15 text-[#8ab4ff]' },
  needs_info: { label: 'Needs info', c: 'bg-warn/12 text-warn' },
  resolved: { label: 'Resolved', c: 'bg-ok/12 text-ok' },
  failed: { label: 'Failed', c: 'bg-bad/12 text-bad' },
  cancelled: { label: 'Cancelled', c: 'bg-white/[.06] text-mute' }
}

/**
 * Incident status, translated. 'Open' is a verb in the shared dictionaries ("Apri"); here it is a state,
 * so in Italian it gets its own word. `plural` for the filter ("Aperti").
 */
export const incLabel = (s: IncidentStatus, plural = false) =>
  s === 'open' ? t(plural ? 'Open|incidents' : 'Open|incident') : t(INC_STATUS[s].label)

export function Pill({ className, children }: { className: string; children: ReactNode }) {
  return <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium', className)}>{children}</span>
}
export function Dot({ className, pulse }: { className: string; pulse?: boolean }) {
  return (
    <span className="relative flex size-2">
      {pulse && <span className={cn('absolute inset-0 animate-ping rounded-full opacity-60', className)} />}
      <span className={cn('relative size-2 rounded-full', className)} />
    </span>
  )
}

export function Card({ title, right, className, children }: { title?: ReactNode; right?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={cn('flex min-w-0 flex-col rounded-2xl border border-line bg-raised/50', className)}>
      {title && (
        <header className="flex h-11 shrink-0 items-center gap-2 px-4 text-[12.5px] font-medium text-dim">
          {title}
          <span className="flex-1" />
          {right}
        </header>
      )}
      {children}
    </section>
  )
}

export function Md({ children }: { children: string }) {
  return (
    <div className="prose-chat selectable text-[12.5px]">
      <Markdown remarkPlugins={[remarkGfm]}>{children}</Markdown>
    </div>
  )
}

/** affectUI Button in the recon pages' three flavours. */
export function Btn({ primary, danger, className, children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean; danger?: boolean }) {
  // The icon (first or last child) goes in the Button's right icon slot: label, then icon, on one line.
  const parts = Children.toArray(children)
  const isIcon = (x: unknown) => isValidElement(x) && typeof x.type !== 'string'
  const icon = parts.length > 1 && isIcon(parts[parts.length - 1]) ? parts.pop() : parts.length > 1 && isIcon(parts[0]) ? parts.shift() : undefined
  return (
    <Button {...p} size="sm" iconRight={icon} variant={primary ? 'primary' : danger ? 'destructive' : 'ghost'} className={className}>
      {parts}
    </Button>
  )
}

/** affectUI Dialog with the recon pages' signature. */
export function Modal({ title, onClose, width = 560, children, footer }: { title: ReactNode; onClose: () => void; width?: number; children: ReactNode; footer?: ReactNode }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={title} width={width} footer={footer}>
      {children}
    </Dialog>
  )
}

export const fmtPct = (v: number | null) => (v === null ? '—' : `${v >= 99.995 ? '100' : v.toFixed(v >= 99 ? 2 : 1)}%`)
export function fmtDur(ms: number) {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h ${m % 60}m` : t('{d}d {h}h', { d: Math.floor(h / 24), h: h % 24 })
}
