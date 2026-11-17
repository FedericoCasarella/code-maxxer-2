import type { ReactNode } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { IncidentStatus, MonitorState, Severity } from '@shared/recon'
import { cn } from '@/lib/utils'

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

export function Btn({ primary, danger, className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean; danger?: boolean }) {
  return (
    <button
      {...p}
      className={cn(
        'flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-40',
        primary ? 'bg-ink text-black hover:bg-white' : danger ? 'text-bad hover:bg-bad/10' : 'text-dim hover:bg-white/[.06] hover:text-ink',
        className
      )}
    />
  )
}

export function Modal({ title, onClose, width = 560, children, footer }: { title: ReactNode; onClose: () => void; width?: number; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 backdrop-blur-[2px]" onMouseDown={onClose}>
      <div className="cm-in flex max-h-[86vh] flex-col rounded-2xl border border-line-strong bg-raised shadow-2xl" style={{ width }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="px-5 pt-5 text-[15px] font-semibold">{title}</div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  )
}

export const fmtPct = (v: number | null) => (v === null ? '—' : `${v >= 99.995 ? '100' : v.toFixed(v >= 99 ? 2 : 1)}%`)
export function fmtDur(ms: number) {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`
}
