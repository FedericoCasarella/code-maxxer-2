import { httpCheck } from './cicd'
import { rstore } from './store'

/*
 * Uptime monitor: each monitored environment is probed every interval_sec.
 * up → (1 failure) retrying → (3 in a row) down: a downtime opens and a monitor incident is filed.
 * The first success after that closes the downtime and resolves the incident.
 */

type Emit = (e: { type: 'recon:changed'; projectId: string }) => void
const fails = new Map<string, number>()
const due = new Map<string, number>()
const DOWN_AFTER = 3

export function startMonitor(emit: Emit, enabled: () => boolean) {
  const tick = async () => {
    if (!enabled()) return
    const now = Date.now()
    for (const env of await rstore.allMonitored()) {
      if ((due.get(env.id) ?? 0) > now) continue
      due.set(env.id, now + Math.max(15, env.interval_sec) * 1000)
      const r = await httpCheck(env.health_url!, env.expected_status)
      await rstore.recordCheck(env.id, { ok: r.ok, status: r.status, ms: r.ms, error: r.error })
      const prev = env.monitor_state
      if (r.ok) {
        fails.set(env.id, 0)
        if (prev === 'down') {
          const incId = await rstore.closeDowntime(env.id)
          if (incId) await rstore.updateIncident(incId, { status: 'resolved', summary: 'Recovered: the health check answers again' })
        }
        await rstore.setMonitor(env.id, 'up', true, null)
      } else {
        const n = (fails.get(env.id) ?? 0) + 1
        fails.set(env.id, n)
        if (n >= DOWN_AFTER && prev !== 'down') {
          const inc = await rstore.createIncident({
            project_id: env.project_id, env_id: env.id, source: 'monitor',
            severity: env.kind === 'production' ? 'critical' : 'high',
            title: `${env.name} is down`,
            details: `${env.health_url} failed ${n} checks in a row: ${r.error ?? `HTTP ${r.status}`}`
          })
          await rstore.openDowntime(env.id, inc.id)
          await rstore.setMonitor(env.id, 'down', false, r.error)
        } else await rstore.setMonitor(env.id, prev === 'down' ? 'down' : 'retrying', false, r.error)
      }
      if (prev !== (r.ok ? 'up' : prev) || !r.ok) emit({ type: 'recon:changed', projectId: env.project_id })
    }
  }
  setInterval(() => void tick().catch(() => null), 5_000)
}

/** Forget a stopped/changed environment's schedule so the next tick probes it right away. */
export const probeSoon = (envId: string) => due.delete(envId)
