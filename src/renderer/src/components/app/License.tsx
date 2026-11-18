import { useRef, useState } from 'react'
import { KeyRound, Lock, LockOpen, LogOut, RefreshCw, Settings } from 'lucide-react'
import { actions, useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { Popover } from '../affect/popover'
import { ProfileMenu, type ProfileMenuItem, type ProfileSetup } from '../affect/profile-menu'
import { Dialog } from '../affect/dialog'
import { Button } from '../affect/button'
import { TextField } from '../affect/text-field'

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
    <Dialog
      open
      onOpenChange={(o) => !o && close()}
      title={
        <span className="flex items-center gap-2">
          <KeyRound size={16} className="text-accent" /> Activate license
        </span>
      }
      description="code-maxxer is free to use. A license key unlocks Pro on this Mac."
      size="sm"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={close}>
            Cancel
          </Button>
          <Button size="sm" loading={busy} disabled={!key.trim()} onClick={() => void go()}>
            Activate
          </Button>
        </>
      }
    >
      <TextField
        autoFocus
        aria-label="License key"
        value={key}
        onChange={(e) => setKey(e.target.value.toUpperCase())}
        onKeyDown={(e) => e.key === 'Enter' && key.trim() && !busy && void go()}
        placeholder="CMX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
        spellCheck={false}
        inputClassName="font-mono tracking-wide"
        error={error ?? undefined}
      />
    </Dialog>
  )
}

/** Footer, bottom right: who holds the license, with a lock that says its state; opens the account card. */
export function LicenseBadge() {
  const lic = useStore((s) => s.license)
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  if (!lic) return null
  const active = lic.state === 'active'
  const l = lic.license
  const who = l?.name || l?.email || 'Licensed'
  const close = () => setOpen(false)
  const recheck = async () => actions.setLicense(await window.cm.recheckLicense())
  const items: ProfileMenuItem[] = [
    { id: 'settings', label: 'Settings', icon: <Settings size={16} />, onSelect: () => (close(), actions.openSettings()) },
    ...(lic.state === 'free' || lic.state === 'invalid'
      ? [{ id: 'activate', label: 'Activate license', icon: <KeyRound size={16} />, onSelect: () => (close(), actions.openLicenseDialog(true)) }]
      : [
          {
            id: 'check', label: 'Check now', icon: <RefreshCw size={16} />,
            badge: lic.state === 'expired' ? 'Expired' : undefined, onSelect: () => void recheck()
          },
          { id: 'deactivate', label: 'Deactivate on this Mac', icon: <LogOut size={16} />, onSelect: async () => (close(), actions.setLicense(await window.cm.deactivateLicense())) }
        ])
  ]
  // The gray extension: the plan and how much of it is left (a year by default).
  const left = l?.daysLeft ?? null
  const setup: ProfileSetup | undefined = l
    ? {
        title: `${(l.plan || 'pro').replace(/^./, (c) => c.toUpperCase())} license`,
        done: left === null ? 1 : Math.max(0, left),
        total: left === null ? 1 : Math.max(365, left),
        countLabel: left === null ? 'Never expires' : left > 0 ? `${left} days left` : 'Expired',
        hint: '',
        next: [l.expiresAt ? `Until ${new Date(l.expiresAt).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}` : null, lic.device].filter(Boolean).join(' · ')
      }
    : undefined
  return (
    <>
      <button
        ref={anchor}
        onClick={() => setOpen((o) => !o)}
        className={cn('flex h-5 items-center gap-1.5 rounded-md px-1.5 hover:bg-white/5', open && 'bg-white/5')}
      >
        {lic.state === 'free' ? (
          <>
            <span className="text-mute">Free</span>
            <LockOpen size={11} className="text-mute" />
          </>
        ) : (
          <>
            <span className={active ? 'text-dim' : 'text-warn'}>{who}</span>
            <Lock size={11} className={active ? 'text-ok' : lic.state === 'expired' ? 'text-warn' : 'text-bad'} />
          </>
        )}
      </button>
      <Popover open={open} onClose={close} anchor={anchor} side="top" align="end" width={300} offset={8} unstyled>
        <ProfileMenu
          className="cm-in"
          name={l?.name || (lic.state === 'free' ? 'Free' : 'License')}
          email={l?.email || (lic.detail ?? 'Everything works without a license')}
          items={items}
          setup={setup}
        />
      </Popover>
    </>
  )
}
