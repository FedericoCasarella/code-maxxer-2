import type { EngineEvent, ScheduledRun, SendOptions } from '@shared/types'
import { db } from '../db'
import * as orch from './orchestrator'

/**
 * Sends scheduled prompts when they come due (while the app is open; missed ones run at next start).
 * A run waits if its branch's agent is still busy.
 */
const DEFAULTS = { model: 'claude-opus-5-5', effort: 'medium', mode: { kind: 'direct' }, fullAccess: true } as const

let last = ''
let timer: NodeJS.Timeout | null = null

export async function publishScheduled(emit: (e: EngineEvent) => void): Promise<ScheduledRun[]> {
  const runs = await db.scheduled()
  const sig = JSON.stringify(runs)
  if (sig !== last) {
    last = sig
    emit({ type: 'scheduled', runs })
  }
  return runs
}

export async function fire(id: string, emit: (e: EngineEvent) => void, mcpScript: string): Promise<void> {
  const run = (await db.scheduled()).find((r) => r.id === id)
  if (!run || run.status !== 'pending') return
  if (orch.isRunning(run.workspaceId)) throw new Error('The agent is busy in that branch')
  // Settings saved with it, else the ones last used in that branch, else defaults.
  const opts =
    (await db.scheduledOpts(id)) ?? (await db.getSetting<Partial<SendOptions>>(`opts:${run.workspaceId}`)) ?? DEFAULTS
  await db.updateScheduled(id, { status: 'sent', sent: true })
  void orch
    .send({ ...DEFAULTS, ...opts, workspaceId: run.workspaceId, text: run.text } as SendOptions, emit, mcpScript)
    .catch(async (e) => {
      await db.updateScheduled(id, { status: 'failed', error: e.message })
      void publishScheduled(emit)
    })
  await publishScheduled(emit)
}

export function startScheduler(emit: (e: EngineEvent) => void, mcpScript: string) {
  if (timer) return
  const tick = async () => {
    try {
      const runs = await publishScheduled(emit)
      const now = Date.now()
      for (const r of runs) {
        if (r.status === 'pending' && r.at <= now && !orch.isRunning(r.workspaceId)) await fire(r.id, emit, mcpScript).catch(() => {})
      }
    } catch { /* db hiccup: next tick */ }
  }
  void tick()
  timer = setInterval(tick, 15_000)
}
