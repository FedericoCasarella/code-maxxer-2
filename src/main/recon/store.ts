import { randomUUID } from 'node:crypto'
import type { CicdConfig, Deploy, EnvInput, Incident, Overview, ReconEnv, ReconSession, SessionLog } from '@shared/recon'
import { pool } from '../db'
import { encrypt } from './secrets'
import type { EnvRow } from './ssh'


const iso = (d: Date | null) => (d ? d.toISOString() : null)

export function toEnv(r: any): ReconEnv {
  return {
    id: r.id, project_id: r.project_id, kind: r.kind, name: r.name, protocol: r.protocol, host: r.host, port: r.port,
    username: r.username, auth_method: r.auth_method, key_path: r.key_path, workdir: r.workdir, rules: r.rules,
    health_url: r.health_url, monitor_enabled: r.monitor_enabled, interval_sec: r.interval_sec, expected_status: r.expected_status,
    monitor_state: r.monitor_enabled ? r.monitor_state : 'disabled', last_check_at: iso(r.last_check_at), last_ok_at: iso(r.last_ok_at),
    last_error: r.last_error, connection_status: r.connection_status, verified_at: iso(r.verified_at), profile_md: r.profile_md,
    profile_summary: r.profile_summary, has_key: !!r.key_encrypted, has_password: !!r.password_encrypted
  }
}
const toIncident = (r: any): Incident => ({
  id: r.id, project_id: r.project_id, env_id: r.env_id, number: r.number, title: r.title, details: r.details, severity: r.severity,
  source: r.source, status: r.status, summary: r.summary, diagnosis: r.diagnosis, created_at: iso(r.created_at)!, resolved_at: iso(r.resolved_at)
})

export const rstore = {
  async envs(projectId: string): Promise<ReconEnv[]> {
    return (await pool.query("select * from recon_environments where project_id=$1 order by case kind when 'production' then 0 else 1 end", [projectId])).rows.map(toEnv)
  },
  async envRow(id: string): Promise<EnvRow | null> {
    const r = (await pool.query('select * from recon_environments where id=$1', [id])).rows[0]
    return r ? ({ ...toEnv(r), key_encrypted: r.key_encrypted, password_encrypted: r.password_encrypted } as EnvRow) : null
  },
  async allMonitored(): Promise<EnvRow[]> {
    const r = await pool.query("select * from recon_environments where monitor_enabled and coalesce(health_url,'')<>''")
    return r.rows.map((x) => ({ ...toEnv(x), key_encrypted: x.key_encrypted, password_encrypted: x.password_encrypted }) as EnvRow)
  },
  async saveEnv(i: EnvInput): Promise<ReconEnv> {
    const cur = (await pool.query('select * from recon_environments where project_id=$1 and kind=$2', [i.project_id, i.kind])).rows[0]
    const id = cur?.id ?? `env_${randomUUID().slice(0, 8)}`
    const v = (k: keyof EnvInput, d: unknown) => (i[k] !== undefined ? i[k] : cur ? cur[k as string] : d)
    // Changing where/how we connect means the server must be checked again.
    const accessChanged = !!cur && ['host', 'port', 'username', 'protocol', 'auth_method', 'key_path'].some((k) => i[k as keyof EnvInput] !== undefined && i[k as keyof EnvInput] !== cur[k]) || i.private_key !== undefined || i.password !== undefined
    const keyEnc = i.private_key === undefined ? (cur?.key_encrypted ?? null) : i.private_key ? encrypt(i.private_key) : null
    const passEnc = i.password === undefined ? (cur?.password_encrypted ?? null) : i.password ? encrypt(i.password) : null
    await pool.query(
      `insert into recon_environments(id,project_id,kind,name,protocol,host,port,username,auth_method,key_path,key_encrypted,workdir,rules,health_url,monitor_enabled,interval_sec,expected_status,password_encrypted)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       on conflict (id) do update set name=excluded.name, protocol=excluded.protocol, host=excluded.host, port=excluded.port,
         username=excluded.username, auth_method=excluded.auth_method, key_path=excluded.key_path, key_encrypted=excluded.key_encrypted,
         password_encrypted=excluded.password_encrypted,
         workdir=excluded.workdir, rules=excluded.rules, health_url=excluded.health_url, monitor_enabled=excluded.monitor_enabled,
         interval_sec=excluded.interval_sec, expected_status=excluded.expected_status`,
      [
        id, i.project_id, i.kind, v('name', i.kind === 'production' ? 'Production' : 'Staging'), v('protocol', 'ssh'), v('host', ''), v('port', 22),
        v('username', ''), v('auth_method', 'agent'), v('key_path', null), keyEnc, v('workdir', ''), v('rules', ''), v('health_url', null),
        v('monitor_enabled', false), v('interval_sec', 60), v('expected_status', null), passEnc
      ]
    )
    if (accessChanged) await pool.query("update recon_environments set connection_status='unverified', verified_at=null where id=$1", [id])
    return toEnv((await pool.query('select * from recon_environments where id=$1', [id])).rows[0])
  },
  async deleteEnv(id: string) {
    await pool.query('delete from recon_environments where id=$1', [id])
  },
  async setConnection(id: string, status: 'unverified' | 'verified' | 'profiled', profile?: { md: string; summary: string }) {
    await pool.query(
      `update recon_environments set connection_status=$2, verified_at=case when $2<>'unverified' then now() else verified_at end,
       profile_md=coalesce($3, profile_md), profile_summary=coalesce($4, profile_summary), profile_updated_at=case when $3 is not null then now() else profile_updated_at end where id=$1`,
      [id, status, profile?.md ?? null, profile?.summary ?? null]
    )
  },

  // sessions
  async newSession(envId: string, kind: string): Promise<string> {
    const id = `ses_${randomUUID().slice(0, 10)}`
    await pool.query('insert into recon_sessions(id,env_id,kind) values($1,$2,$3)', [id, envId, kind])
    return id
  },
  async appendLogs(id: string, logs: SessionLog[]) {
    if (logs.length) await pool.query('update recon_sessions set logs = logs || $2::jsonb where id=$1', [id, JSON.stringify(logs)])
  },
  async finishSession(id: string, r: { status: 'done' | 'failed' | 'cancelled'; ok: boolean | null; summary: string; result_md?: string; cost?: number }) {
    await pool.query('update recon_sessions set status=$2, ok=$3, summary=$4, result_md=$5, cost_usd=$6, finished_at=now() where id=$1', [id, r.status, r.ok, r.summary, r.result_md ?? null, r.cost ?? null])
  },
  async sessions(envId: string): Promise<(ReconSession & { logs: SessionLog[] })[]> {
    const r = await pool.query('select * from recon_sessions where env_id=$1 order by started_at desc limit 30', [envId])
    return r.rows.map((x) => ({ ...x, started_at: iso(x.started_at)!, finished_at: iso(x.finished_at) }))
  },

  // incidents
  async incidents(projectId: string): Promise<Incident[]> {
    return (await pool.query('select * from recon_incidents where project_id=$1 order by created_at desc limit 300', [projectId])).rows.map(toIncident)
  },
  async incident(id: string): Promise<Incident | null> {
    const r = (await pool.query('select * from recon_incidents where id=$1', [id])).rows[0]
    return r ? toIncident(r) : null
  },
  async createIncident(i: { project_id: string; env_id: string | null; title: string; details: string; severity: string; source: 'manual' | 'monitor' }): Promise<Incident> {
    const id = `inc_${randomUUID().slice(0, 8)}`
    await pool.query(
      `insert into recon_incidents(id,project_id,env_id,number,title,details,severity,source)
       values($1,$2,$3,(select coalesce(max(number),0)+1 from recon_incidents where project_id=$2),$4,$5,$6,$7)`,
      [id, i.project_id, i.env_id, i.title, i.details, i.severity, i.source]
    )
    return (await rstore.incident(id))!
  },
  async updateIncident(id: string, p: { status?: string; summary?: string; diagnosis?: string }) {
    await pool.query(
      `update recon_incidents set status=coalesce($2,status), summary=coalesce($3,summary), diagnosis=coalesce($4,diagnosis),
       resolved_at=case when $2 in ('resolved','cancelled') then now() when $2 is not null then null else resolved_at end where id=$1`,
      [id, p.status ?? null, p.summary ?? null, p.diagnosis ?? null]
    )
  },

  // monitor
  async recordCheck(envId: string, c: { ok: boolean; status: number | null; ms: number | null; error: string | null }) {
    await pool.query('insert into recon_checks(env_id,ok,status,ms,error) values($1,$2,$3,$4,$5)', [envId, c.ok, c.status, c.ms, c.error])
    await pool.query("delete from recon_checks where env_id=$1 and at < now() - interval '120 days'", [envId])
  },
  async setMonitor(envId: string, state: string, ok: boolean, error: string | null) {
    await pool.query(
      `update recon_environments set monitor_state=$2, last_check_at=now(), last_ok_at=case when $3 then now() else last_ok_at end, last_error=$4 where id=$1`,
      [envId, state, ok, error]
    )
  },
  async openDowntime(envId: string, incidentId: string | null) {
    await pool.query('insert into recon_downtimes(id,env_id,incident_id) values($1,$2,$3)', [`dt_${randomUUID().slice(0, 8)}`, envId, incidentId])
  },
  async closeDowntime(envId: string): Promise<string | null> {
    const r = await pool.query('update recon_downtimes set ended_at=now() where env_id=$1 and ended_at is null returning incident_id', [envId])
    return r.rows[0]?.incident_id ?? null
  },

  async overview(projectId: string, days: number, envId: string | null): Promise<Overview> {
    const envs = await rstore.envs(projectId)
    const ids = envs.filter((e) => !envId || e.id === envId).map((e) => e.id)
    const q = async (sql: string, args: unknown[]) => (await pool.query(sql, args)).rows
    const pct = async (interval: string) => {
      const r = await q(`select avg(case when ok then 1.0 else 0 end)*100 as p from recon_checks where env_id = any($1) and at > now() - $2::interval`, [ids, interval])
      return r[0]?.p === null || r[0]?.p === undefined ? null : Math.round(Number(r[0].p) * 100) / 100
    }
    const latency = await q(
      `select floor(extract(epoch from at)/900)*900*1000 as t, avg(ms) as ms from recon_checks
       where env_id = any($1) and at > now() - interval '24 hours' group by 1 order by 1`,
      [ids]
    )
    const daily = await q(
      `select to_char(d, 'YYYY-MM-DD') as day,
        (select avg(case when ok then 1.0 else 0 end)*100 from recon_checks where env_id = any($1) and at >= d and at < d + interval '1 day') as pct
       from generate_series(date_trunc('day', now()) - ($2::int - 1) * interval '1 day', date_trunc('day', now()), interval '1 day') d`,
      [ids, days]
    )
    const downtimes = await q(`select * from recon_downtimes where env_id = any($1) order by started_at desc limit 8`, [ids])
    const incidents = (await rstore.incidents(projectId)).filter((i) => !envId || i.env_id === envId)
    const heat = await q(
      `select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day, count(*)::int as count from recon_incidents
       where project_id=$1 and created_at > now() - interval '182 days' ${envId ? 'and env_id=$2' : ''} group by 1`,
      envId ? [projectId, envId] : [projectId]
    )
    const open = downtimes.find((d: any) => !d.ended_at)
    const lastNow = await q(`select ms from recon_checks where env_id = any($1) and ok order by at desc limit 1`, [ids])
    return {
      envs: envs.map((e) => ({ id: e.id, kind: e.kind, name: e.name, monitor_state: e.monitor_state, connection_status: e.connection_status, last_check_at: e.last_check_at })),
      uptime: { pct24h: await pct('24 hours'), pct7d: await pct('7 days'), pctRange: await pct(`${days} days`) },
      latency24h: latency.map((r: any) => ({ t: Number(r.t), ms: r.ms === null ? null : Math.round(Number(r.ms)) })),
      latencyNow: lastNow[0]?.ms ?? null,
      daily: daily.map((r: any) => ({ day: r.day, pct: r.pct === null ? null : Math.round(Number(r.pct) * 100) / 100 })),
      downtimes: downtimes.map((d: any) => ({ id: d.id, env_id: d.env_id, started_at: iso(d.started_at)!, ended_at: iso(d.ended_at), incident_id: d.incident_id })),
      lastIncidentAt: incidents[0]?.created_at ?? null,
      downSince: open ? iso(open.started_at) : null,
      incidents: incidents.slice(0, 5),
      heat: heat.map((h: any) => ({ day: h.day, count: h.count }))
    }
  },

  // CI/CD
  async cicdRaw(envId: string): Promise<{ enabled: boolean; yaml: string; last_seen_sha: string | null } | null> {
    return (await pool.query('select * from cicd_configs where env_id=$1', [envId])).rows[0] ?? null
  },
  async saveCicd(envId: string, p: { enabled?: boolean; yaml?: string; last_seen_sha?: string }) {
    await pool.query(
      `insert into cicd_configs(env_id,enabled,yaml,last_seen_sha) values($1,coalesce($2,false),coalesce($3,''),$4)
       on conflict (env_id) do update set enabled=coalesce($2,cicd_configs.enabled), yaml=coalesce($3,cicd_configs.yaml), last_seen_sha=coalesce($4,cicd_configs.last_seen_sha)`,
      [envId, p.enabled ?? null, p.yaml ?? null, p.last_seen_sha ?? null]
    )
  },
  async secretNames(envId: string): Promise<string[]> {
    return (await pool.query('select name from cicd_secrets where env_id=$1 order by name', [envId])).rows.map((r) => r.name)
  },
  async secretValues(envId: string): Promise<{ name: string; value_encrypted: string }[]> {
    return (await pool.query('select name, value_encrypted from cicd_secrets where env_id=$1', [envId])).rows
  },
  async setSecret(envId: string, name: string, value: string | null) {
    if (value === null) await pool.query('delete from cicd_secrets where env_id=$1 and name=$2', [envId, name])
    else await pool.query('insert into cicd_secrets(env_id,name,value_encrypted) values($1,$2,$3) on conflict (env_id,name) do update set value_encrypted=excluded.value_encrypted', [envId, name, encrypt(value)])
  },
  async newDeploy(envId: string, d: { trigger: string; ref: string; sha: string | null; message: string | null; steps: { idx: number; name: string }[] }): Promise<string> {
    const id = `dep_${randomUUID().slice(0, 8)}`
    await pool.query(
      `insert into cicd_deploys(id,env_id,number,trigger,ref,commit_sha,commit_message,status,steps)
       values($1,$2,(select coalesce(max(number),0)+1 from cicd_deploys where env_id=$2),$3,$4,$5,$6,'running',$7)`,
      [id, envId, d.trigger, d.ref, d.sha, d.message, JSON.stringify(d.steps.map((s) => ({ ...s, status: 'pending', ms: null })))]
    )
    return id
  },
  async updateDeploy(id: string, p: { status?: string; release_id?: string; error?: string; steps?: Deploy['steps'] }) {
    await pool.query(
      `update cicd_deploys set status=coalesce($2,status), release_id=coalesce($3,release_id), error=coalesce($4,error), steps=coalesce($5,steps),
       finished_at=case when $2 in ('success','failed','rolled_back','cancelled') then now() else finished_at end where id=$1`,
      [id, p.status ?? null, p.release_id ?? null, p.error ?? null, p.steps ? JSON.stringify(p.steps) : null]
    )
  },
  async appendDeployLogs(id: string, lines: { step: number; line: string }[]) {
    if (lines.length) await pool.query('update cicd_deploys set logs = logs || $2::jsonb where id=$1', [id, JSON.stringify(lines)])
  },
  async deploys(envId: string): Promise<Deploy[]> {
    const r = await pool.query('select * from cicd_deploys where env_id=$1 order by started_at desc limit 30', [envId])
    return r.rows.map((x) => ({ ...x, started_at: iso(x.started_at)!, finished_at: iso(x.finished_at) }))
  },
  async deployLogs(id: string): Promise<{ step: number; line: string }[]> {
    return (await pool.query('select logs from cicd_deploys where id=$1', [id])).rows[0]?.logs ?? []
  }
}

export type { CicdConfig }
