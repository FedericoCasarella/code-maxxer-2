import { useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Spinner } from '../affect/spinner'

export function ConfirmDialog({
  title, children, confirmLabel, danger, onConfirm, onClose
}: { title: string; children: ReactNode; confirmLabel: string; danger?: boolean; onConfirm: () => Promise<void> | void; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const go = async () => {
    setBusy(true)
    try {
      await onConfirm()
      onClose()
    } catch (e: any) {
      setError(e.message ?? 'Failed')
      setBusy(false)
    }
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 backdrop-blur-[2px]" onMouseDown={onClose}>
      <div
        role="alertdialog"
        aria-label={title}
        className="cm-in w-[440px] rounded-2xl border border-line-strong bg-raised p-5 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <div className="text-[15px] font-semibold">{title}</div>
        <div className="mt-2 text-[12.5px] leading-relaxed text-dim">{children}</div>
        {error && <div className="selectable mt-3 rounded-lg bg-bad/10 px-3 py-2 text-[12px] text-bad">{error}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <button autoFocus onClick={onClose} className="h-8 rounded-lg px-3 text-dim hover:bg-white/5 hover:text-ink">
            Cancel
          </button>
          <button
            onClick={() => void go()}
            disabled={busy}
            className={cn('flex h-8 items-center gap-2 rounded-lg px-3.5 font-medium disabled:opacity-50', danger ? 'bg-bad text-black' : 'bg-ink text-black')}
          >
            {busy && <Spinner size={12} />} {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
