import { useState } from 'react'
import { UserCheck } from 'lucide-react'
import type { PipelineRunState } from '@shared/types'
import { t } from '@/lib/i18n'
import { timeAgoLabel } from '@/lib/utils'
import { ApprovalCard, type ApprovalState } from '../affect/approval-card'
import { TextArea } from '../affect/text-area'
import { Select } from '../affect/select'

/**
 * A pipeline run that waits for the user: at an approval node, or because its loop budget ran out.
 * Approve goes on; the other button sends the work back to the chosen node, or stops the run. A note goes with either.
 */
export function PipelineGate({ run, workspaceId }: { run: PipelineRunState; workspaceId: string }) {
  const w = run.wait
  const at = run.nodes.findIndex((n) => n.id === w?.node)
  const node = run.nodes[at]
  // Where the work can go back to: the nodes an agent plays, up to here.
  const targets = run.nodes.slice(0, at + 1).filter((n) => n.status !== 'skipped' && n.role !== 'gate' && n.role !== 'script')
  const fallback = w?.kind === 'budget' ? node?.onFail : [...targets].reverse().find((n) => n.role === 'build')?.id
  const [target, setTarget] = useState<string>(fallback ?? 'stop')
  const [note, setNote] = useState('')
  const [state, setState] = useState<ApprovalState>('pending')
  const [error, setError] = useState<string | null>(null)
  if (!w || !node) return null

  const done = run.nodes.slice(0, at).filter((n) => n.status === 'passed')
  const next = run.nodes.slice(at + 1).find((n) => n.status !== 'skipped')
  const why =
    w.kind === 'budget'
      ? t('{node} failed {n} times: the loop budget is used up.', { node: node.label, n: run.loops })
      : [
          done.length ? t('Done: {list}.', { list: done.map((n) => n.label).join(', ') }) : '',
          next ? t('After your approval: {next}.', { next: next.label }) : t('Your approval ends the pipeline.')
        ].filter(Boolean).join(' ')
  const targetLabel = run.nodes.find((n) => n.id === target)?.label ?? ''

  const decide = async (decision: 'approve' | 'back' | 'stop') => {
    setState('working')
    setError(null)
    const text =
      decision === 'approve'
        ? w.kind === 'budget' ? t('Two more loops for {node}.', { node: node.label }) : t('Approved: {node}.', { node: node.label })
        : decision === 'back' ? t('Sent back to {node}.', { node: targetLabel }) : t('Pipeline stopped at {node}.', { node: node.label })
    try {
      await window.cm.decidePipeline(workspaceId, run.runId, { decision, target: decision === 'back' ? target : undefined, note, text })
      setState(decision === 'approve' ? 'approved' : 'rejected')
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      setState('failed')
    }
  }

  return (
    <ApprovalCard
      agent={run.name}
      icon={<UserCheck size={12} />}
      kind={w.kind === 'budget' ? t('Loop budget') : t('Approval')}
      time={timeAgoLabel(w.at)}
      flag={t('Needs you')}
      title={w.kind === 'budget' ? t('{node} keeps failing', { node: node.label }) : node.label}
      subtitle={why}
      detail={
        <div className="flex flex-col gap-2.5">
          <TextArea label={t('Note for the agent')} optional value={note} onChange={(e) => setNote(e.target.value)} />
          <Select
            label={t('If you send it back')}
            value={target}
            onChange={(v) => setTarget(String(v))}
            options={[...targets.map((n) => ({ value: n.id, label: t('Back to {node}', { node: n.label }) })), { value: 'stop', label: t('Stop the pipeline') }]}
          />
        </div>
      }
      state={state}
      note={error ?? undefined}
      approveLabel={w.kind === 'budget' ? t('Two more loops') : t('Approve and continue')}
      rejectLabel={target === 'stop' ? t('Stop') : t('Send back to {node}', { node: targetLabel })}
      onApprove={() => void decide('approve')}
      onReject={() => void decide(target === 'stop' ? 'stop' : 'back')}
    />
  )
}
