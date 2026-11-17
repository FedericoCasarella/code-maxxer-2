import { useState } from 'react'
import { GitBranch } from 'lucide-react'
import { actions, useStore } from '@/lib/store'
import { slugPreview } from './slug'
import { Spinner } from '../affect/spinner'

export function NewWorkspaceDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const project = useStore((s) => s.projects.find((p) => p.id === projectId))
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await actions.createWorkspace(projectId, name.trim())
      onClose()
    } catch (e: any) {
      setError(e.message?.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') ?? 'Failed')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 backdrop-blur-[2px]" onMouseDown={onClose}>
      <div
        className="cm-in w-[420px] rounded-2xl border border-line-strong bg-raised p-5 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="text-[15px] font-semibold">New workspace</div>
        <div className="mt-1 text-[12.5px] text-dim">
          A new branch and git worktree in <span className="text-ink">{project?.name}</span>. Agents work there, never on your checkout.
        </div>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit()
            if (e.key === 'Escape') onClose()
          }}
          placeholder="e.g. Checkout redesign"
          className="selectable mt-4 h-10 w-full rounded-xl border border-line bg-input px-3 text-[13.5px] outline-none placeholder:text-mute focus:border-line-strong"
        />
        <div className="mt-2 flex items-center gap-1.5 font-mono text-[11.5px] text-mute">
          <GitBranch size={12} /> cm/{slugPreview(name)}-xxxx
        </div>
        {error && <div className="selectable mt-3 rounded-lg bg-bad/10 px-3 py-2 text-[12px] text-bad">{error}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="h-8 rounded-lg px-3 text-dim hover:bg-white/5 hover:text-ink">
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={!name.trim() || busy}
            className="flex h-8 items-center gap-2 rounded-lg bg-ink px-3.5 font-medium text-black disabled:opacity-40"
          >
            {busy && <Spinner size={12} />} Create
          </button>
        </div>
      </div>
    </div>
  )
}
