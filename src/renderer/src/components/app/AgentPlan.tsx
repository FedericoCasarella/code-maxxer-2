import { useMemo, useState } from 'react'
import { PanelRight } from 'lucide-react'
import type { Plan, PlanTask } from '@shared/types'
import { actions, useStore } from '@/lib/store'
import { t } from '@/lib/i18n'
import { AgentPlan as PlanCard, type PlanStep, type PlanStepStatus } from '../affect/agent-plan'
import { Button } from '../affect/button'
import { IconButton } from '../affect/icon-button'

const STEP: Record<PlanTask['status'], PlanStepStatus> = { todo: 'pending', in_progress: 'active', done: 'done', failed: 'failed', skipped: 'skipped' }

const steps = (plan: Plan): PlanStep[] =>
  plan.tasks.map((task) => ({
    id: task.id,
    title: task.title,
    detail: [task.detail, ...task.files.slice(0, 2).map((f) => f.split('/').pop())].filter(Boolean).join(' · ') || undefined,
    status: STEP[task.status],
    duration: task.startedAt && task.finishedAt ? task.finishedAt - task.startedAt : undefined
  }))

/**
 * The plan in the chat, as affectUI's Agent Plan: while proposed the steps can be renamed, reordered, added or removed,
 * then run. The full checkpoints live in the side panel: the button under the card opens it on this plan.
 */
export function AgentPlan({ plan }: { plan: Plan }) {
  const proposed = plan.status === 'proposed'
  const running = plan.status === 'running'
  // A running plan moves only while its chat's agent is at work
  const live = useStore((s) => s.workspaces.find((w) => w.id === plan.workspaceId)?.status === 'running')
  const [draft, setDraft] = useState<PlanStep[] | null>(null)
  const shown = useMemo(() => draft ?? steps(plan), [draft, plan])
  const commits = plan.tasks.reduce((a, task) => a + task.commits.length, 0)

  return (
    <div className="cm-in flex flex-col gap-1.5">
      <PlanCard
        title={plan.title}
        steps={shown}
        status={proposed ? 'draft' : running ? 'running' : 'done'}
        onChange={setDraft}
        onRun={proposed ? (final) => void window.cm.approvePlan(plan.id, draft ? final.map((s) => ({ id: s.id, title: s.title })) : undefined).then(() => setDraft(null)) : undefined}
        onCancel={proposed ? () => void window.cm.cancelPlan(plan.id) : undefined}
      />
      {!proposed && (
        <div className="flex items-center gap-2 px-1 text-[11.5px] text-mute">
          <span className="min-w-0 flex-1 tabular-nums">
            {plan.status === 'cancelled' ? t('Discarded') : running && !live ? t('Paused') : ''}
            {commits > 0 ? `${running && !live ? ' · ' : ''}${commits === 1 ? t('1 commit') : t('{n} commits', { n: commits })}` : ''}
          </span>
          {running && (
            <Button size="sm" variant="ghost" onClick={() => void window.cm.cancelPlan(plan.id)}>
              {t('Stop')}
            </Button>
          )}
          <IconButton size="sm" variant="ghost" label={t('Open in the side panel')} icon={<PanelRight size={14} />} onClick={() => actions.focusPlan(plan.id)} />
        </div>
      )}
    </div>
  )
}
