import { useState } from 'react'
import { GitBranch } from 'lucide-react'
import { actions, useStore } from '@/lib/store'
import { slugPreview } from './slug'
import { Dialog } from '../affect/dialog'
import { Button } from '../affect/button'
import { TextField } from '../affect/text-field'
import { t } from '@/lib/i18n'

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
      setError(e.message?.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') ?? t('Failed'))
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('New branch')}
      description={
        <>
          {t('A new branch and git worktree in')} <span className="text-ink">{project?.name}</span>{t('. Agents work there, never on your checkout.')}
        </>
      }
      size="sm"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button size="sm" loading={busy} disabled={!name.trim()} onClick={() => void submit()}>
            {t('Create')}
          </Button>
        </>
      }
    >
      <TextField
        autoFocus
        aria-label={t('Branch name')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void submit()}
        placeholder={t('e.g. Checkout redesign')}
        error={error ?? undefined}
        hint={
          <span className="flex items-center gap-1.5 font-mono">
            <GitBranch size={12} /> cm/{slugPreview(name)}-xxxx
          </span>
        }
      />
    </Dialog>
  )
}
