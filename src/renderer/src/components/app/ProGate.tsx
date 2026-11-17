import type { ReactNode } from 'react'
import { KeyRound, Lock, Sparkles } from 'lucide-react'
import { actions, useStore } from '@/lib/store'
import { Button } from '../affect/button'

export const PRO_URL = 'https://federicocasarella.com/code-maxxer'

/** Pro = an active license on this Mac. */
export function useIsPro() {
  return useStore((s) => s.license?.state === 'active')
}

export function ProBadge() {
  return <span className="rounded-md bg-gradient-to-r from-accent to-[#e8a26a] px-1.5 py-px text-[9.5px] font-bold tracking-wide text-black">PRO</span>
}

/** A page shown blurred and inert under a dialog: locked features, or pages that need setting up first. */
export function GateOverlay({ preview, icon, title, description, note, action, secondary, label, children }: {
  preview: ReactNode; icon: ReactNode; title: ReactNode; description: ReactNode; note?: ReactNode; children?: ReactNode
  action: { label: string; icon?: ReactNode; onClick: () => void }
  secondary?: { label: string; icon?: ReactNode; onClick: () => void }
  label: string
}) {
  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      <div className="pointer-events-none absolute inset-0 select-none blur-[6px] saturate-50" aria-hidden="true">
        {preview}
      </div>
      <div className="absolute inset-0 bg-bg/40" />
      <div className="absolute inset-0 grid place-items-center p-6">
        <div role="dialog" aria-label={label} className="cm-in w-[420px] rounded-2xl border border-line-strong bg-raised/95 p-6 text-center shadow-2xl backdrop-blur">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl border border-line-strong bg-panel">{icon}</span>
          <h2 className="mt-4 flex items-center justify-center gap-2 text-[17px] font-semibold">{title}</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-dim">{description}</p>
          {note && <p className="mt-2 text-[12.5px] text-mute">{note}</p>}
          {children}
          <div className="mt-5 flex flex-col gap-1.5">
            <Button className="w-full" size="lg" icon={action.icon} onClick={action.onClick}>
              {action.label}
            </Button>
            {secondary && (
              <Button className="w-full" variant="ghost" size="md" icon={secondary.icon} onClick={secondary.onClick}>
                {secondary.label}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Pro pages: the real page, blurred and inert, under an unlock dialog when there is no Pro license. */
export function ProGate({ feature, description, preview, children }: { feature: string; description: string; preview: ReactNode; children: () => ReactNode }) {
  const pro = useIsPro()
  if (pro) return <>{children()}</>
  return (
    <GateOverlay
      label={`${feature} needs Pro`}
      preview={preview}
      icon={<Lock size={20} className="text-accent" />}
      title={<>{feature} <ProBadge /></>}
      description={description}
      note="You need an active code-maxxer Pro license to use it."
      action={{ label: 'Unlock', icon: <Sparkles size={15} />, onClick: () => window.open(PRO_URL, '_blank') }}
      secondary={{ label: 'I already have a key', icon: <KeyRound size={13} />, onClick: () => actions.openLicenseDialog(true) }}
    />
  )
}
