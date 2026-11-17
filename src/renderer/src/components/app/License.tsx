import { useRef, useState } from 'react'
import { KeyRound, Lock, LockOpen, RefreshCw } from 'lucide-react'
import { actions, useStore } from '@/lib/store'
import { cn, timeAgo } from '@/lib/utils'
import { Popover } from '../affect/popover'
import { Spinner } from '../affect/spinner'

const clean = (m?: string) => m?.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') ?? 'Activation failed'

/** Opened from the app menu (Activate License…). */
export function LicenseDialog() {
  const open = useStore((s) => s.licenseDialog)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!open) return null
  const close = () => {
    actions.openLicenseDialog(false)
    setKey('')
    setError(null)
  }
  const go = async () => {
    setBusy(true)
    setError(null)
    try {
      actions.setLicense(await window.cm.activateLicense(key))
      close()
    } catch (e: any) {
      setError(clean(e.message))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 backdrop-blur-[2px]" onMouseDown={close}>
      <div className="cm-in w-[440px] rounded-2xl border border-line-strong bg-raised p-5 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 text-[15px] font-semibold">
          <KeyRound size={16} className="text-accent" /> Activate license
        </div>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-dim">
          code-maxxer is free to use. A license key unlocks Pro on this Mac.
        </p>
        <input
          autoFocus
          value={key}
          onChange={(e) => setKey(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && key.trim() && !busy) void go()
            if (e.key === 'Escape') close()
          }}
          placeholder="CMX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
          spellCheck={false}
          className="selectable mt-4 h-10 w-full rounded-xl border border-line bg-input px-3 font-mono text-[13px] tracking-wide outline-none placeholder:text-mute focus:border-line-strong"
        />
        {error && <div className="selectable mt-3 rounded-lg bg-bad/10 px-3 py-2 text-[12px] text-bad">{error}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={close} className="h-8 rounded-lg px-3 text-dim hover:bg-white/5 hover:text-ink">
            Cancel
          </button>
          <button
            onClick={() => void go()}
            disabled={!key.trim() || busy}
            className="flex h-8 items-center gap-2 rounded-lg bg-ink px-3.5 font-medium text-black disabled:opacity-40"
          >
            {busy && <Spinner size={12} />} Activate
          </button>
        </div>
      </div>
    </div>
  )
}

/** Footer, bottom right: who holds the license, with a lock that says its state. */
export function LicenseBadge() {
  const lic = useStore((s) => s.license)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  if (!lic) return null
  const active = lic.state === 'active'
  const who = lic.license?.name || lic.license?.email || 'Licensed'
  const recheck = async () => {
    setBusy(true)
    actions.setLicense(await window.cm.recheckLicense())
    setBusy(false)
  }
  return (
    <>
      <button
        ref={anchor}
        onClick={() => setOpen((o) => !o)}
        className={cn('flex h-5 items-center gap-1.5 rounded-md px-1.5 hover:bg-white/5', open && 'bg-white/5')}
      >
        {lic.state === 'free' ? (
          <>
            <LockOpen size={11} className="text-mute" />
            <span className="text-mute">Free</span>
          </>
        ) : (
          <>
            <span className={active ? 'text-dim' : 'text-warn'}>{who}</span>
            <Lock size={11} className={active ? 'text-ok' : lic.state === 'expired' ? 'text-warn' : 'text-bad'} />
          </>
        )}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} side="top" align="end" width={300} offset={8} unstyled>
        <div className="cm-in rounded-2xl border border-line-strong bg-raised p-3.5 text-[12.5px] shadow-2xl">
          <div className="flex items-center gap-2">
            {lic.state === 'free' ? <LockOpen size={15} className="text-mute" /> : <Lock size={15} className={active ? 'text-ok' : 'text-warn'} />}
            <span className="text-[13.5px] font-semibold">
              {lic.state === 'free' ? 'Free' : lic.state === 'active' ? `${lic.license?.plan ?? 'Pro'} license` : lic.state === 'expired' ? 'License expired' : 'License not valid'}
            </span>
          </div>
          {lic.license ? (
            <dl className="mt-3 grid grid-cols-[88px_1fr] gap-y-1.5 text-[12px]">
              <dt className="text-mute">Holder</dt>
              <dd className="selectable truncate">{lic.license.name}</dd>
              <dt className="text-mute">Email</dt>
              <dd className="selectable truncate">{lic.license.email}</dd>
              <dt className="text-mute">Expires</dt>
              <dd>{lic.license.expiresAt ? `${new Date(lic.license.expiresAt).toLocaleDateString()} · ${lic.license.daysLeft} days` : 'Never'}</dd>
              <dt className="text-mute">This Mac</dt>
              <dd className="truncate">{lic.device}</dd>
              <dt className="text-mute">Checked</dt>
              <dd>{lic.lastCheck ? `${timeAgo(lic.lastCheck)} ago` : 'never'}</dd>
            </dl>
          ) : (
            <p className="mt-2 leading-relaxed text-dim">Everything works without a license. Activate one from the app menu or here.</p>
          )}
          {lic.detail && <div className="mt-3 rounded-lg bg-warn/10 px-2.5 py-1.5 text-[12px] text-warn">{lic.detail}</div>}
          <div className="mt-3.5 flex gap-2">
            {lic.state === 'free' || lic.state === 'invalid' ? (
              <button
                onClick={() => (setOpen(false), actions.openLicenseDialog(true))}
                className="h-8 flex-1 rounded-lg bg-ink text-[12.5px] font-medium text-black"
              >
                Activate license…
              </button>
            ) : (
              <>
                <button onClick={() => void recheck()} className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-line text-dim hover:text-ink">
                  <RefreshCw size={12} className={busy ? 'animate-spin' : undefined} /> Check now
                </button>
                <button
                  onClick={async () => actions.setLicense(await window.cm.deactivateLicense())}
                  className="h-8 flex-1 rounded-lg border border-line text-dim hover:border-bad/40 hover:text-bad"
                >
                  Remove from this Mac
                </button>
              </>
            )}
          </div>
        </div>
      </Popover>
    </>
  )
}
