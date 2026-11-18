import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Switch } from '../affect/switch'

/**
 * The one way an on/off setting looks in the app (first made for Auto-learning): a callout row,
 * title and a short line on the left, the affectUI Switch on the right, vertically centred.
 */
export function SwitchCallout({
  title, description, checked, onChange, disabled, className
}: { title: ReactNode; description?: ReactNode; checked: boolean; onChange: (on: boolean) => void; disabled?: boolean; className?: string }) {
  return (
    <section className={cn('flex items-center gap-4 rounded-xl border border-line bg-panel px-3.5 py-3', className)}>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="text-[15px] font-semibold text-ink">{title}</div>
        {description && <p className="text-[12px] leading-[1.5] text-dim">{description}</p>}
      </div>
      <Switch
        size="sm"
        className="shrink-0"
        aria-label={typeof title === 'string' ? title : undefined}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.currentTarget.checked)}
      />
    </section>
  )
}
