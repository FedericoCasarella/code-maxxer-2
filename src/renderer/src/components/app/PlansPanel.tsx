import { useEffect } from 'react'
import { actions, useStore } from '@/lib/store'
import { EmptyState } from '../affect/empty-state'
import { PlanCard } from './PlanCard'

const EMPTY: never[] = []

/** Right drawer: the plans of the selected branch, the open one first. */
export function PlansPanel({ workspaceId }: { workspaceId: string | null }) {
  const plans = useStore((s) => (workspaceId ? s.plans[workspaceId] : undefined)) ?? EMPTY
  useEffect(() => {
    if (workspaceId) void actions.loadPlans(workspaceId)
  }, [workspaceId])

  if (!workspaceId) return <EmptyState bare title="No branch" text="Pick a branch on the left to see its plans." />
  const open = plans.filter((p) => p.status === 'proposed' || p.status === 'running')
  const past = plans.filter((p) => p.status === 'done' || p.status === 'cancelled')
  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center px-3">
        <span className="text-[11px] font-semibold text-dim">Plans</span>
        <span className="ml-auto text-[11px] tabular-nums text-mute">{plans.length || ''}</span>
      </div>
      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-2 pb-4">
        {plans.length === 0 ? (
          <div className="pt-10">
            <EmptyState
              bare
              title="No plans yet"
              text="Ask for something big: the orchestrator plans it first, then shows the plan here for your approval."
            />
          </div>
        ) : (
          <>
            {open.map((p) => (
              <PlanCard key={p.id} plan={p} showChatLink />
            ))}
            {past.length > 0 && <div className="px-1 pt-2 text-[11px] font-semibold text-mute">Earlier</div>}
            {past.map((p) => (
              <PlanCard key={p.id} plan={p} compact showChatLink />
            ))}
          </>
        )}
      </div>
    </div>
  )
}
