import type { IpcMain } from 'electron'
import type { CicdConfig, ReconApi, ReconEvent } from '@shared/recon'
import { licenseStatus } from '../license'
import { cancelDeploy, parseSpec, SPEC_DOC, starterYaml, startDeploy, startPushWatcher } from './cicd'
import { probeSoon, startMonitor } from './monitor'
import { startSession, stepState } from './scan'
import { rstore } from './store'
import { testConnection, type EnvRow } from './ssh'
import { encrypt } from './secrets'

const isPro = () => licenseStatus().state === 'active'

async function cicdView(envId: string): Promise<CicdConfig & { doc: string }> {
  const env = await rstore.envRow(envId)
  if (!env) throw new Error('Environment not found')
  const raw = await rstore.cicdRaw(envId)
  const yaml = raw?.yaml || starterYaml(env)
  const p = parseSpec(yaml, env.protocol)
  return { env_id: envId, enabled: raw?.enabled ?? false, yaml, valid: p.ok, errors: p.errors, secrets: await rstore.secretNames(envId), doc: SPEC_DOC }
}

export function registerRecon(ipc: IpcMain, emit: (e: ReconEvent) => void) {
  const api: ReconApi = {
    envs: async (projectId) =>
      Promise.all((await rstore.envs(projectId)).map(async (env) => ({ env, steps: await stepState(env.id), sessions: await rstore.sessions(env.id) }))),
    saveEnv: async (input) => {
      const env = await rstore.saveEnv(input)
      probeSoon(env.id)
      emit({ type: 'recon:changed', projectId: env.project_id })
      return env
    },
    testAccess: async (input) => {
      // The form's values over what is stored: secrets typed now are encrypted the same way, never saved here.
      const cur = (await rstore.envs(input.project_id)).find((e) => e.kind === input.kind)
      const row = cur ? await rstore.envRow(cur.id) : null
      const probe = {
        ...(row ?? {}), ...input,
        key_encrypted: input.private_key ? encrypt(input.private_key) : row?.key_encrypted ?? null,
        password_encrypted: input.password ? encrypt(input.password) : row?.password_encrypted ?? null
      } as EnvRow
      const r = await testConnection(probe)
      const out = (r.ok ? r.stdout : r.stderr || r.stdout).trim().split('\n').filter((l) => !/^Warning: (Permanently added|--ssl is an insecure)/.test(l)).join('\n')
      const hint = /Access denied: 530|Login denied/i.test(out) ? '\nLogin refused: check user and password.' : ''
      return { ok: r.ok, output: (out + hint).slice(0, 1200) || (r.ok ? 'Connected' : `Failed (exit ${r.code ?? '?'})`), ms: r.ms }
    },
    deleteEnv: (id) => rstore.deleteEnv(id),
    scan: (envId, kind) => startSession(envId, kind, emit),
    overview: (projectId, days, envId) => rstore.overview(projectId, days, envId),
    incidents: (projectId) => rstore.incidents(projectId),
    createIncident: async (i) => {
      const inc = await rstore.createIncident({ ...i, source: 'manual' })
      emit({ type: 'recon:changed', projectId: i.project_id })
      return inc
    },
    updateIncident: async (id, p) => {
      await rstore.updateIncident(id, p)
      const inc = await rstore.incident(id)
      if (inc) emit({ type: 'recon:changed', projectId: inc.project_id })
    },
    diagnose: async (incidentId) => {
      const inc = await rstore.incident(incidentId)
      if (!inc?.env_id) throw new Error('Link the incident to an environment first')
      return startSession(inc.env_id, 'diagnose', emit, incidentId)
    },
    cicd: cicdView,
    saveCicd: async (envId, p) => {
      if (p.enabled) {
        const env = await rstore.envRow(envId)
        const check = parseSpec(p.yaml ?? (await rstore.cicdRaw(envId))?.yaml ?? '', env?.protocol ?? 'ssh')
        if (!check.ok) throw new Error(check.errors[0])
      }
      await rstore.saveCicd(envId, p)
      return cicdView(envId)
    },
    setSecret: async (envId, name, value) => {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error('Secret names: letters, digits and _')
      await rstore.setSecret(envId, name, value)
      return rstore.secretNames(envId)
    },
    deploy: (envId) => startDeploy(envId, 'manual', emit),
    cancelDeploy: async (id) => cancelDeploy(id),
    deploys: (envId) => rstore.deploys(envId),
    deployLogs: (id) => rstore.deployLogs(id)
  }
  for (const [name, fn] of Object.entries(api)) {
    ipc.handle(`recon:${name}`, (_e, ...args: unknown[]) => {
      if (!isPro()) throw new Error('Recon needs an active Pro license')
      return (fn as (...a: unknown[]) => unknown)(...args)
    })
  }
  startMonitor(emit, isPro)
  startPushWatcher(emit, isPro)
}

export const RECON_METHODS = [
  'envs', 'saveEnv', 'testAccess', 'deleteEnv', 'scan', 'overview', 'incidents', 'createIncident', 'updateIncident', 'diagnose',
  'cicd', 'saveCicd', 'setSecret', 'deploy', 'cancelDeploy', 'deploys', 'deployLogs'
] as const
