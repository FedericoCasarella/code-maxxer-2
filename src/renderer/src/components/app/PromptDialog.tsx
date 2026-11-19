import { useState } from 'react'
import { Dialog } from '../affect/dialog'
import { Button } from '../affect/button'
import { TextField } from '../affect/text-field'
import { t } from '@/lib/i18n'

/** One text field in a modal: name a workspace, a folder, a branch… */
export function PromptDialog({
  title, label, initial = '', confirmLabel, onSubmit, onClose
}: { title: string; label?: string; initial?: string; confirmLabel?: string; onSubmit: (v: string) => void | Promise<void>; onClose: () => void }) {
  const [v, setV] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const go = async () => {
    if (!v.trim() || busy) return
    setBusy(true)
    try {
      await onSubmit(v.trim())
      onClose()
    } catch (e: any) {
      setError(e.message?.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') ?? t('Failed'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={title}
      description={label}
      size="sm"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button size="sm" loading={busy} disabled={!v.trim()} onClick={() => void go()}>
            {confirmLabel ?? t('Save')}
          </Button>
        </>
      }
    >
      <TextField
        autoFocus
        aria-label={title}
        value={v}
        error={error ?? undefined}
        onChange={(e) => setV(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => e.key === 'Enter' && void go()}
      />
    </Dialog>
  )
}
