import { useEffect, useState } from 'react'
import { Download, FolderOpen } from 'lucide-react'
import { actions } from '@/lib/store'
import { t } from '@/lib/i18n'
import { Dialog } from '../affect/dialog'
import { Button } from '../affect/button'
import { TextField } from '../affect/text-field'

/** Clone a repository (GitHub link, owner/name, or any git URL) into a folder and add it as a project. */
export function CloneRepoDialog({ onClose, folderId }: { onClose: () => void; folderId?: string }) {
  const [url, setUrl] = useState('')
  const [parent, setParent] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    void window.cm.cloneDefaults().then((d) => setParent((p) => p || d.parent))
  }, [])
  const ready = !!url.trim() && !!parent.trim() && !busy

  const pick = async () => {
    const dir = await window.cm.pickFolder(parent || undefined)
    if (dir) setParent(dir)
  }
  const submit = async () => {
    if (!ready) return
    setBusy(true)
    setError(null)
    try {
      await actions.cloneProject(url.trim(), parent.trim(), folderId)
      onClose()
    } catch (e: any) {
      setError(e.message?.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') ?? t('Failed'))
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !busy && onClose()}
      title={t('Clone a repository')}
      size="sm"
      footer={
        <>
          <Button variant="secondary" size="sm" disabled={busy} onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button size="sm" loading={busy} disabled={!ready} iconRight={<Download size={13} />} onClick={() => void submit()}>
            {busy ? t('Cloning') : t('Clone')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <TextField
          autoFocus
          label={t('Repository link')}
          placeholder="https://github.com/owner/repo"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
          error={error ?? undefined}
        />
        <div className="flex items-end gap-2">
          <TextField className="min-w-0 flex-1" label={t('Destination')} value={parent} onChange={(e) => setParent(e.target.value)} />
          <Button variant="secondary" size="md" className="cm-clone-pick translate-y-px !h-[38px] !rounded-[11px]" iconRight={<FolderOpen size={14} />} onClick={() => void pick()}>
            {t('Choose')}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
