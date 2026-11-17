import { useState } from 'react'

/** One text field in a modal: name a workspace, a folder, a branch… */
export function PromptDialog({
  title, label, initial = '', confirmLabel = 'Save', onSubmit, onClose
}: { title: string; label?: string; initial?: string; confirmLabel?: string; onSubmit: (v: string) => void | Promise<void>; onClose: () => void }) {
  const [v, setV] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const go = async () => {
    if (!v.trim()) return
    try {
      await onSubmit(v.trim())
      onClose()
    } catch (e: any) {
      setError(e.message?.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') ?? 'Failed')
    }
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 backdrop-blur-[2px]" onMouseDown={onClose}>
      <div className="cm-in w-[380px] rounded-2xl border border-line-strong bg-raised p-5 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="text-[15px] font-semibold">{title}</div>
        {label && <div className="mt-1 text-[12.5px] text-dim">{label}</div>}
        <input
          autoFocus
          value={v}
          onChange={(e) => setV(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void go()
            if (e.key === 'Escape') onClose()
          }}
          className="selectable mt-4 h-10 w-full rounded-xl border border-line bg-input px-3 text-[13.5px] outline-none focus:border-line-strong"
        />
        {error && <div className="selectable mt-3 rounded-lg bg-bad/10 px-3 py-2 text-[12px] text-bad">{error}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="h-8 rounded-lg px-3 text-dim hover:bg-white/5 hover:text-ink">
            Cancel
          </button>
          <button onClick={() => void go()} disabled={!v.trim()} className="h-8 rounded-lg bg-ink px-3.5 font-medium text-black disabled:opacity-40">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
