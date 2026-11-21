import { useEffect } from 'react'
import { actions, useStore } from '@/lib/store'
import { t } from '@/lib/i18n'
import { ConfirmDialog } from './ConfirmDialog'

/** Closing the window: confirm first, and say which branches still have an agent at work (they stop). */
export function QuitDialog() {
  const ask = useStore((s) => s.quitAsk)
  // Tells the app the question is on screen; without it the window closes on its own.
  useEffect(() => {
    if (ask) void window.cm.quitSeen()
  }, [ask])
  if (!ask) return null
  return (
    <ConfirmDialog
      title={t('Quit Code-Maxxer?')}
      confirmLabel={t('Quit')}
      danger={ask.length > 0}
      onClose={() => actions.closeQuitAsk()}
      onConfirm={() => window.cm.quitApp()}
    >
      {ask.length === 0
        ? t('No agent is working right now.')
        : ask.length === 1
          ? t('An agent is still working on {branch}: it stops when you quit, and picks up from there the next time you open the app.', { branch: ask[0] })
          : t('{n} agents are still working ({branches}): they stop when you quit, and pick up from there the next time you open the app.', { n: ask.length, branches: ask.join(', ') })}
    </ConfirmDialog>
  )
}
