import { useEffect, useRef } from 'react'
import { actions, useStore } from '@/lib/store'
import { EmptyState } from '../affect/empty-state'
import { PlanCard } from './PlanCard'

const EMPTY: never[] = []

/** Right drawer: the plans of the selected branch, the open one first. */
export function PlansPanel({ workspaceId }: { workspaceId: string | null }) {
  const plans = useStore((s) => (workspaceId ? s.plans[workspaceId] : undefined)) ?? EMPTY
  const focus = useStore((s) => s.focusPlan)
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (workspaceId) void actions.loadPlans(workspaceId)
  }, [workspaceId])
  // Opened from a chat card: scroll to that plan and flash it.
  useEffect(() => {
    if (!focus) return
    const t = setTimeout(() => {
      const el = list.current?.querySelector<HTMLElement>(`[data-plan="${focus.id}"]`)
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      el.classList.remove('cm-flash')
      void el.offsetWidth
      el.classList.add('cm-flash')
    }, 80)
    return () => clearTimeout(t)
  }, [focus, plans.length])

  if (!workspaceId)
    return (
      <div className="grid h-full min-h-0 flex-1 place-items-center px-4">
        <EmptyState bare title="No branch" text="Pick a branch on the left to see its plans." />
      </div>
    )
  const open = plans.filter((p) => p.status === 'proposed' || p.status === 'running')
  const past = plans.filter((p) => p.status === 'done' || p.status === 'cancelled')
  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center px-3">
        <span className="text-[11px] font-semibold text-dim">Plans</span>
        <span className="ml-auto text-[11px] tabular-nums text-mute">{plans.length || ''}</span>
      </div>
      <div ref={list} className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-2 pb-4">
        {plans.length === 0 ? (
          <div className="grid h-full min-h-0 flex-1 place-items-center px-4">
            <EmptyState
              bare
              title="No plans yet"
              text="Ask for something big: the orchestrator plans it first, then shows the plan here for your approval."
            />
          </div>
        ) : (
          <>
            {open.map((p) => (
              <div key={p.id} data-plan={p.id} className="scroll-mt-2 rounded-xl">
                <PlanCard plan={p} showChatLink />
              </div>
            ))}
            {past.length > 0 && <div className="px-1 pt-2 text-[11px] font-semibold text-mute">Earlier</div>}
            {past.map((p) => (
              <div key={p.id} data-plan={p.id} className="scroll-mt-2 rounded-xl">
                <PlanCard plan={p} compact showChatLink />
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
