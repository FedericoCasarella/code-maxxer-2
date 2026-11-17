import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export const inputCls =
  'selectable h-8 w-full rounded-lg border border-line bg-input px-2.5 text-[13px] text-ink outline-none placeholder:text-mute focus:border-line-strong'

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn('flex flex-col gap-1', className)}>
      <span className="text-[11.5px] font-medium text-dim">{label}</span>
      {children}
    </label>
  )
}
