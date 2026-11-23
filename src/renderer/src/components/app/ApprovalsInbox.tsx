import { useEffect, useRef, useState } from 'react'
import { UserCheck } from 'lucide-react'
import type { RunRow } from '@shared/types'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'
import { actions } from '@/lib/store'
import { Popover } from '../affect/popover'
import { DecisionInbox } from '../affect/decision-inbox'

/**
 * Every pipeline run waiting for the user, across branches: approve from here, or open the chat
 * to send the work back with a note. Shown in the sidebar only while something waits.
 */
export function ApprovalsInbox() {
  const [rows, setRows] = useState<RunRow[]>([])
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    let waiting = new Set<string>()
    const load = () =>
      void window.cm.listRuns().then((r) => {
        const w = r.filter((x) => x.status === 'waiting' && x.wait)
        waiting = new Set(w.map((x) => x.runId))
        setRows(w)
      })
    load()
    // Runs report every step: reload only when one starts or stops waiting.
    return window.cm.onEvent((e) => {
      if (e.type === 'pipeline' && (e.state.status === 'waiting') !== waiting.has(e.state.runId)) load()
    })
  }, [])
  useEffect(() => {
    if (!rows.length) setOpen(false)
  }, [rows.length])
  if (!rows.length) return null

  return (
    <>
      <button
        ref={anchor}
        onClick={() => setOpen((o) => !o)}
        className={cn('flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-colors', open ? 'bg-white/[.06] text-ink' : 'text-dim hover:bg-white/[.03] hover:text-ink')}
      >
        <span className={open ? 'text-accent' : 'text-mute'}>
          <UserCheck size={14} />
        </span>
        <span className="flex-1 text-left">{t('To approve')}</span>
        <span className="rounded-full bg-warn/15 px-1.5 text-[11px] tabular-nums text-warn">{rows.length}</span>
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} side="right" align="start" width={420}>
        <DecisionInbox
          key={rows.map((r) => r.runId + r.wait?.at).join()}
          decisions={rows.map((r) => ({
            id: r.runId,
            title: r.wait!.kind === 'budget' ? t('{node} keeps failing', { node: r.wait!.label }) : `${r.pipelineName} · ${r.wait!.label}`,
            detail: `${r.projectName} · ${r.branch}${r.task ? ` — ${r.task}` : ''}`,
            primary: r.wait!.kind === 'budget' ? t('Two more loops') : t('Approve and continue'),
            secondary: t('Open the chat')
          }))}
          onDecide={(d, answer) => {
            const r = rows.find((x) => x.runId === d.id)
            if (!r?.wait) return
            if (answer === 'secondary') {
              setOpen(false)
              void actions.selectWorkspace(r.workspaceId)
              return
            }
            const text = r.wait.kind === 'budget' ? t('Two more loops for {node}.', { node: r.wait.label }) : t('Approved: {node}.', { node: r.wait.label })
            void window.cm.decidePipeline(r.workspaceId, r.runId, { decision: 'approve', text }).catch(() => {})
          }}
        />
      </Popover>
    </>
  )
}
