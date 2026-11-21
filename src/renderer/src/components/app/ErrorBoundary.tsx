import { Component, type ReactNode } from 'react'
import { FolderOpen, RotateCw } from 'lucide-react'
import { Button } from '../affect/button'
import { EmptyState } from '../affect/empty-state'
import { t } from '@/lib/i18n'

/** Errors the window throws outside React (event handlers, promises) go to the log file too. */
window.addEventListener('error', (e) => void window.cm?.logError('error', String(e.error?.stack ?? e.message)))
window.addEventListener('unhandledrejection', (e) => void window.cm?.logError('promise', String(e.reason?.stack ?? e.reason)))

/**
 * An error while drawing a part of the app shows here, in that part only, instead of a black window.
 * It is written to the log; a new resetKey (another branch picked) or "Try again" draws it again.
 */
export class ErrorBoundary extends Component<{ where: string; resetKey?: unknown; children: ReactNode }, { error: Error | null; key: unknown }> {
  state = { error: null as Error | null, key: this.props.resetKey }

  static getDerivedStateFromProps(p: { resetKey?: unknown }, s: { error: Error | null; key: unknown }) {
    return p.resetKey !== s.key ? { error: null, key: p.resetKey } : null
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    void window.cm?.logError(this.props.where, `${error.stack ?? error.message}\n${info.componentStack ?? ''}`)
  }

  render() {
    const e = this.state.error
    if (!e) return this.props.children
    return (
      <div className="grid min-h-0 flex-1 place-items-center p-6">
        <EmptyState
          bare
          title={t('Something went wrong')}
          text={e.message}
          action={
            <>
              <Button size="sm" variant="secondary" iconRight={<FolderOpen size={13} />} onClick={() => void window.cm.openLogs()}>
                {t('Open logs')}
              </Button>
              <Button size="sm" iconRight={<RotateCw size={13} />} onClick={() => this.setState({ error: null })}>
                {t('Try again')}
              </Button>
            </>
          }
        />
      </div>
    )
  }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }
}
