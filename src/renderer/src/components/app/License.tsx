import { useEffect, useRef, useState } from 'react'
import { Check, Download, KeyRound, Lock, LockOpen, LogOut, RefreshCw, Settings } from 'lucide-react'
import { actions, useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { Popover } from '../affect/popover'
import { Spinner } from '../affect/spinner'
import { ProfileMenu, type ProfileMenuItem, type ProfileSetup } from '../affect/profile-menu'
import { Dialog } from '../affect/dialog'
import { Button } from '../affect/button'
import { TextField } from '../affect/text-field'
import { t } from '@/lib/i18n'

const clean = (m?: string) => m?.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') ?? t('Activation failed')

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
          <KeyRound size={16} className="text-accent" /> {t('Activate license')}
        </span>
      }
      description={t('code-maxxer is free to use. A license key unlocks Pro on this Mac.')}
      size="sm"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={close}>
            {t('Cancel')}
          </Button>
          <Button size="sm" loading={busy} disabled={!key.trim()} onClick={() => void go()}>
            {t('Activate')}
          </Button>
        </>
      }
    >
      <TextField
        autoFocus
        aria-label={t('License key')}
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
  const [upd, setUpd] = useState<'checking' | 'latest' | { version: string } | null>(null)
  const [version, setVersion] = useState('')
  useEffect(() => void window.cm.appVersion().then(setVersion).catch(() => {}), [])
  const anchor = useRef<HTMLButtonElement>(null)
  if (!lic) return null
  const active = lic.state === 'active'
  const l = lic.license
  const who = l?.name || l?.email || t('Licensed')
  const close = () => (setOpen(false), setUpd(null))
  const recheck = async () => actions.setLicense(await window.cm.recheckLicense())
  // The answer shows in the row itself; a newer version also opens the update popup.
  const checkUpdates = async () => {
    if (upd === 'checking') return
    setUpd('checking')
    const [u] = await Promise.all([window.cm.checkUpdate().catch(() => null), new Promise((r) => setTimeout(r, 600))])
    setUpd(u ? { version: u.version } : 'latest')
  }
  const items: ProfileMenuItem[] = [
    { id: 'settings', label: t('Settings'), icon: <Settings size={16} />, onSelect: () => (close(), actions.openSettings()) },
    {
      id: 'updates',
      label: upd === 'checking' ? t('Checking…') : upd === 'latest' ? t('Code-Maxxer is up to date') : upd ? t('Version {v} available', { v: upd.version }) : t('Check for updates'),
      icon: upd === 'checking' ? <Spinner size={16} /> : upd === 'latest' ? <Check size={16} className="text-ok" /> : <Download size={16} />,
      // Found: the menu steps aside for the update popup it was covering.
      onSelect: () => (upd && typeof upd === 'object' ? close() : void checkUpdates())
    },
    ...(lic.state === 'free' || lic.state === 'invalid'
      ? [{ id: 'activate', label: t('Activate license'), icon: <KeyRound size={16} />, onSelect: () => (close(), actions.openLicenseDialog(true)) }]
      : [
          {
            id: 'check', label: t('Check now'), icon: <RefreshCw size={16} />,
            badge: lic.state === 'expired' ? t('Expired') : undefined, onSelect: () => void recheck()
          },
          { id: 'deactivate', label: t('Deactivate on this Mac'), icon: <LogOut size={16} />, onSelect: async () => (close(), actions.setLicense(await window.cm.deactivateLicense())) }
        ])
  ]
  // The gray extension: the plan and how much of it is left (a year by default).
  const left = l?.daysLeft ?? null
  const setup: ProfileSetup | undefined = l
    ? {
        title: t('{plan} license', { plan: (l.plan || 'pro').replace(/^./, (c) => c.toUpperCase()) }),
        done: left === null ? 1 : Math.max(0, left),
        total: left === null ? 1 : Math.max(365, left),
        countLabel: left === null ? t('Never expires') : left > 0 ? t('{n} days left', { n: left }) : t('Expired'),
        hint: '',
        next: (
          <>
            {[l.expiresAt ? t('Until {date}', { date: new Date(l.expiresAt).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) }) : null].filter(Boolean).join('')}
            {l.expiresAt && version ? ' ' : null}
            {version ? <span className="text-[11px] text-muted">{t('Version {v}', { v: version })}</span> : lic.device}
          </>
        )
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
            <span className="text-mute">{t('Free')}</span>
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
          name={l?.name || (lic.state === 'free' ? t('Free') : t('License'))}
          email={l?.email || (lic.detail ?? t('Everything works without a license'))}
          items={items}
          setup={setup}
        />
      </Popover>
    </>
  )
}
