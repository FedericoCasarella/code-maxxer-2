import type { ReactNode } from 'react'
import { KeyRound, Lock, Sparkles } from 'lucide-react'
import { actions, useStore } from '@/lib/store'

export const PRO_URL = 'https://federicocasarella.com/code-maxxer'

/** Pro = an active license on this Mac. */
export function useIsPro() {
  return useStore((s) => s.license?.state === 'active')
}

export function ProBadge() {
  return <span className="rounded-md bg-gradient-to-r from-accent to-[#e8a26a] px-1.5 py-px text-[9.5px] font-bold tracking-wide text-black">PRO</span>
}

/** Pro pages: the real page, blurred and inert, under an unlock dialog when there is no Pro license. */
export function ProGate({ feature, description, preview, children }: { feature: string; description: string; preview: ReactNode; children: () => ReactNode }) {
  const pro = useIsPro()
  if (pro) return <>{children()}</>
  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      <div className="pointer-events-none absolute inset-0 select-none blur-[6px] saturate-50" aria-hidden="true">
        {preview}
      </div>
      <div className="absolute inset-0 bg-bg/40" />
      <div className="absolute inset-0 grid place-items-center p-6">
        <div role="dialog" aria-label={`${feature} needs Pro`} className="cm-in w-[420px] rounded-2xl border border-line-strong bg-raised/95 p-6 text-center shadow-2xl backdrop-blur">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl border border-line-strong bg-panel">
            <Lock size={20} className="text-accent" />
          </span>
          <h2 className="mt-4 flex items-center justify-center gap-2 text-[17px] font-semibold">
            {feature} <ProBadge />
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-dim">{description}</p>
          <p className="mt-2 text-[12.5px] text-mute">You need an active code-maxxer Pro license to use it.</p>
          <button
            onClick={() => window.open(PRO_URL, '_blank')}
            className="mt-5 flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-ink text-[13.5px] font-semibold text-black hover:bg-white"
          >
            <Sparkles size={15} /> Unlock
          </button>
          <button
            onClick={() => actions.openLicenseDialog(true)}
            className="mt-2 flex h-9 w-full items-center justify-center gap-2 rounded-xl text-[12.5px] text-dim hover:bg-white/[.05] hover:text-ink"
          >
            <KeyRound size={13} /> I already have a key
          </button>
        </div>
      </div>
    </div>
  )
}
