import { useState, type ReactNode } from 'react'
import { AlertDialog } from '../affect/dialog'
import { t } from '@/lib/i18n'

/** Confirm one thing (affectUI AlertDialog). Errors from onConfirm show inside and keep it open. */
export function ConfirmDialog({
  title, children, confirmLabel, danger, onConfirm, onClose
}: { title: string; children: ReactNode; confirmLabel: string; danger?: boolean; onConfirm: () => Promise<void> | void; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null)
  return (
    <AlertDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={title}
      description={children}
      confirmLabel={confirmLabel}
      cancelLabel={t('Cancel')}
      danger={danger}
      onCancel={onClose}
      onConfirm={async () => {
        setError(null)
        try {
          await onConfirm()
        } catch (e: any) {
          setError(e.message?.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') ?? t('Failed'))
          throw e
        }
      }}
    >
      {error && <div className="selectable rounded-lg bg-bad/10 px-3 py-2 text-[12px] text-bad">{error}</div>}
    </AlertDialog>
  )
}
