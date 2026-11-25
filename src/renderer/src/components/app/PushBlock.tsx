import { useEffect, useRef } from 'react'
import { GitCommitHorizontal, Upload } from 'lucide-react'
import type { PushRequest } from '@shared/types'
import { PermissionRequest, type PermissionDecision } from '../affect/permission-request'
import { t } from '@/lib/i18n'

/** A git push an agent wants to make, inline in the chat, full width: allow it or refuse it. */
export function PushBlock({ r }: { r: PushRequest }) {
  const repo = r.url.replace(/^.*[:/]([^/]+\/[^/]+?)(\.git)?$/, '$1') || r.remote
  const decision: PermissionDecision | null =
    r.status === 'pending'
      ? null
      : r.status === 'revoked'
        ? { allow: true, scope: 'timed', at: r.decision?.at ?? r.at, until: Date.now() - 1 }
        : { allow: !!r.decision?.allow, scope: r.decision?.scope ?? 'once', at: r.decision?.at ?? r.at, until: r.decision?.until }
  // The keys work from anywhere in the window, not only with the card focused: ↵ allows once, ⌘↵ always, Esc refuses.
  // Only the last waiting push answers, and never while you type (a field with text in it) or a dialog is open.
  const el = useRef<HTMLDivElement>(null)
  const pending = r.status === 'pending'
  useEffect(() => {
    if (!pending) return
    const k = (e: KeyboardEvent) => {
      if (e.defaultPrevented || (e.key !== 'Enter' && e.key !== 'Escape') || e.shiftKey || e.altKey) return
      const all = document.querySelectorAll('.cm-push[data-pending]')
      if (all[all.length - 1] !== el.current) return
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return
      const t = e.target as HTMLElement
      if (el.current?.contains(t)) return
      const typing = t.isContentEditable || t instanceof HTMLTextAreaElement || t instanceof HTMLInputElement || t instanceof HTMLSelectElement
      if (typing && ((t as HTMLInputElement).value ?? t.textContent ?? '').trim()) return
      if (typing && e.key === 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      const at = Date.now()
      if (e.key === 'Escape') void window.cm.decidePush(r.id, { allow: false, scope: 'once', at })
      else void window.cm.decidePush(r.id, { allow: true, scope: e.metaKey || e.ctrlKey ? 'always' : 'once', at })
    }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  }, [pending, r.id])
  return (
    <div ref={el} className="cm-in cm-push" data-pending={pending ? '' : undefined}>
      <PermissionRequest
        className="!max-w-none"
        scopes={['once']}
        alwaysLabel={t('Allow always')}
        agent={{ name: t('Agent') }}
        action={r.deletes ? t('delete {branch} on the remote', { branch: r.branch }) : t('push to {branch}', { branch: r.branch || r.remote })}
        target={repo}
        toolIcon={<Upload size={14} />}
        risk={r.deletes || /^(main|master|production|prod)$/.test(r.branch) ? 'destructive' : 'risky'}
        reason={r.stat || undefined}
        previewTitle={r.commits.length === 1 ? t('1 commit goes out') : t('{n} commits go out', { n: r.commits.length })}
        preview={r.commits.map((c) => ({ id: c.sha, label: c.subject, meta: <span className="font-mono">{c.sha}</span>, icon: <GitCommitHorizontal size={14} /> }))}
        decision={decision}
        final
        onDecisionChange={(d) => {
          if (d && r.status === 'pending') void window.cm.decidePush(r.id, { allow: d.allow, scope: d.scope, at: d.at, until: d.until })
          else if (!d && r.status === 'allowed') void window.cm.revokePush(r.id)
        }}
      />
    </div>
  )
}
