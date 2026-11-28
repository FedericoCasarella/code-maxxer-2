import type { IpcMain } from 'electron'
import type { CicdConfig, ReconApi, ReconEvent } from '@shared/recon'
import { licenseStatus } from '../license'
import { cancelDeploy, parseSpec, SPEC_DOC, starterYaml, startDeploy, startPushWatcher } from './cicd'
import { probeSoon, startMonitor } from './monitor'
import { startAll, startSession, stepState } from './scan'
import { rstore } from './store'
import { testConnection, type EnvRow } from './ssh'
import { collectFiles, fileOp, remotePath, uploadFiles, type FileAction } from './files'
import { encrypt } from './secrets'
import { registerAppAction } from '../engine/browser'
import { db } from '../db'
import { execFile } from 'node:child_process'
import { resolve as resolvePath, sep } from 'node:path'
import { bin, shellEnv } from '../engine/bins'

const gitLine = (cwd: string, ...args: string[]) =>
  new Promise<string | null>((res) => execFile(bin('git'), args, { cwd, env: shellEnv() }, (e, out) => res(e ? null : out.trim())))

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
      Promise.all((await rstore.envs(projectId)).map(async (env) => ({
        env, steps: await stepState(env.id), sessions: await rstore.sessions(env.id),
        uptime24h: env.monitor_enabled ? await rstore.uptimeHours(env.id) : null
      }))),
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
      const out = (r.ok ? r.stdout : r.stderr || r.stdout).trim().split('\n').filter((l) => !/^Warning: (Permanently added|--ssl is an insecure|.*insecure)/.test(l)).join('\n')
      const hint = /Access denied: 530|Login denied/i.test(out) ? '\nLogin refused: check user and password.' : ''
      return { ok: r.ok, output: (out + hint).slice(0, 1200) || (r.ok ? 'Connected' : `Failed (exit ${r.code ?? '?'})`), ms: r.ms }
    },
    deleteEnv: (id) => rstore.deleteEnv(id),
    scan: (envId, kind) => startSession(envId, kind, emit),
    scanAll: (envId) => startAll(envId, emit),
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
      const env = await rstore.envRow(envId)
      if (!env) throw new Error('Environment not found')
      // The editor shows the starter until something is saved: enabling it saves that starter.
      if (p.yaml === undefined && !(await rstore.cicdRaw(envId))?.yaml) p = { ...p, yaml: starterYaml(env) }
      if (p.enabled) {
        const check = parseSpec(p.yaml ?? (await rstore.cicdRaw(envId))?.yaml ?? '', env.protocol)
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
    deployLogs: (id) => rstore.deployLogs(id),
    deployById: (id) => rstore.deployById(id)
  }
  // Agents use the same Recon as the user (mcp__cm2__recon): every method, on this chat's project.
  registerAppAction('recon', async (wsId: string, a: any) => {
    if (!isPro()) return { text: 'Recon needs an active Pro license: tell the user.', error: true }
    const ws = await db.workspace(wsId)
    if (!ws) return { text: 'Workspace not found', error: true }
    const method = String(a?.method ?? '') as keyof ReconApi
    const fn = api[method] as ((...x: unknown[]) => Promise<unknown>) | undefined
    if (!fn) return { text: `Unknown method. Methods: ${Object.keys(api).join(', ')}`, error: true }
    const args: any[] = Array.isArray(a?.args) ? [...a.args] : a?.args !== undefined ? [a.args] : []
    // The project is this chat's, whatever the agent passed.
    if (method === 'envs' || method === 'incidents' || method === 'overview') args[0] = ws.projectId
    if (method === 'overview') (args[1] ??= 7), (args[2] ??= null)
    if ((method === 'saveEnv' || method === 'testAccess' || method === 'createIncident') && args[0] && typeof args[0] === 'object') args[0] = { ...args[0], project_id: ws.projectId }
    // An environment, incident or deploy of another project is off limits.
    const mine = new Set((await rstore.envs(ws.projectId)).map((e) => e.id))
    const envArg = ['deleteEnv', 'scan', 'cicd', 'saveCicd', 'setSecret', 'deploy', 'deploys'].includes(method) ? String(args[0] ?? '') : ''
    if (envArg && !mine.has(envArg)) return { text: 'That environment is not in this project: call envs first for the ids.', error: true }
    try {
      const out = await fn(...args)
      const text = out === undefined ? 'Done.' : typeof out === 'string' ? out : JSON.stringify(out, null, 1)
      return { text: text.length > 12000 ? text.slice(0, 12000) + '\n…' : text }
    } catch (e: any) {
      return { text: String(e?.message ?? e), error: true }
    }
  })
  for (const [name, fn] of Object.entries(api)) {
    ipc.handle(`recon:${name}`, (_e, ...args: unknown[]) => {
      if (!isPro()) throw new Error('Recon needs an active Pro license')
      return (fn as (...a: unknown[]) => unknown)(...args)
    })
  }
  startMonitor(emit, isPro)
  startPushWatcher(emit, isPro)
  registerChatDeploys(emit)
}

/** Deploys started from the chat: the chat shows them live as a progress tracker (it reads "deploy_id:" from the result). */
function registerChatDeploys(emit: (e: ReconEvent) => void) {
  const envOf = async (wsId: string, kind: unknown) => {
    const ws = await db.workspace(wsId)
    if (!ws) throw new Error('Unknown chat')
    const envs = await rstore.envs(ws.projectId)
    return envs.find((e) => e.kind === (kind === 'production' ? 'production' : 'staging')) ?? null
  }
  const summary = (d: Awaited<ReturnType<typeof rstore.deploys>>[number]) =>
    `Deploy #${d.number}: ${d.status}${d.error ? ` (${d.error})` : ''}\n` +
    d.steps.map((s) => `- ${s.name}: ${s.status}${s.ms != null ? ` ${Math.round(s.ms / 1000)}s` : ''}`).join('\n')
  registerAppAction('deploy_start', async (ws, a) => {
    if (!isPro()) return { text: 'Recon needs an active Pro license', error: true }
    const env = await envOf(ws, a.env)
    if (!env) return { text: `No ${a.env} environment: the user connects it in Recon.`, error: true }
    const cfg = await rstore.cicdRaw(env.id)
    if (!cfg?.enabled) return { text: `CI/CD is off for ${env.name}: the user enables it in Recon > CI/CD.`, error: true }
    try {
      const id = await startDeploy(env.id, 'manual', emit)
      return { text: `deploy_id: ${id}\nDeploy started on ${env.name}. The chat shows its steps live; call deploy_status with wait true to get the outcome.` }
    } catch (e) {
      return { text: (e as Error).message, error: true }
    }
  })
  // A publish the agent does by hand (FTP, ssh, scripts): recorded like a CI/CD deploy, so the chat shows it live and it joins the history.
  const stepStart = new Map<string, number>()
  const changed = async (envId: string) => {
    const env = await rstore.envRow(envId)
    if (env?.project_id) emit({ type: 'recon:changed', projectId: env.project_id })
  }
  registerAppAction('deploy_progress', async (ws, a) => {
    if (a.action === 'start') {
      const env = await envOf(ws, a.env)
      if (!env) return { text: `No ${a.env} environment in Recon: go on without tracking.`, error: true }
      const names = (Array.isArray(a.steps) ? a.steps : []).map((x: unknown) => String(x).trim()).filter(Boolean).slice(0, 12)
      if (!names.length) return { text: 'steps: list the steps of the publish, e.g. ["Build", "Upload", "Check the site"].', error: true }
      const w = await db.workspace(ws)
      const head = w?.worktreePath ? await gitLine(w.worktreePath, 'log', '-1', '--format=%H%x00%s') : null
      const [sha, message] = head ? head.split('\0') : [null, null]
      const id = await rstore.newDeploy(env.id, { trigger: 'agent', ref: w?.branch ?? '', sha: sha || null, message: message || null, steps: names.map((name: string, idx: number) => ({ idx, name })) })
      await changed(env.id)
      return { text: `deploy_id: ${id}\nTracking the publish on ${env.name}. Report each step with action "step", then "finish".` }
    }
    const d = a.deploy_id ? await rstore.deployById(String(a.deploy_id)) : null
    if (!d) return { text: 'Unknown deploy_id.', error: true }
    if (a.action === 'step') {
      const i = /^\d+$/.test(String(a.step ?? '')) ? Number(a.step) - 1 : d.steps.findIndex((x) => x.name.toLowerCase() === String(a.step ?? '').trim().toLowerCase())
      const step = d.steps[i]
      if (!step) return { text: `No step ${a.step}: the steps are ${d.steps.map((x, n) => `${n + 1}. ${x.name}`).join(', ')}.`, error: true }
      const status = ['running', 'success', 'failed', 'skipped'].includes(a.status) ? a.status : 'running'
      const key = `${d.id}:${i}`
      // The step's time: from when it was marked running, else from the end of the step before it (or the start of the deploy)
      const prevEnd = d.steps.slice(0, i).reduce((t, x) => t + (x.ms ?? 0), Date.parse(d.started_at))
      if (status === 'running') stepStart.set(key, Date.now())
      const ms = status === 'running' ? null : Math.max(0, Date.now() - (stepStart.get(key) ?? prevEnd))
      if (status !== 'running') stepStart.delete(key)
      const steps = d.steps.map((x, n) => (n === i ? { ...x, status, ms } : x))
      await rstore.updateDeploy(d.id, { steps })
      if (a.line) await rstore.appendDeployLogs(d.id, [{ step: i, line: String(a.line).slice(0, 400) }])
      await changed(d.env_id)
      return { text: `Step ${i + 1} (${step.name}): ${status}.` }
    }
    if (a.action === 'finish') {
      const ok = a.status === 'success'
      // Steps left open close with the deploy: done on success, skipped after a failure
      const steps = d.steps.map((x) =>
        x.status === 'pending' || x.status === 'running' ? { ...x, status: ok ? 'success' : x.status === 'running' ? 'failed' : 'skipped', ms: x.ms } : x
      ) as typeof d.steps
      await rstore.updateDeploy(d.id, { status: ok ? 'success' : 'failed', steps, ...(a.error ? { error: String(a.error).slice(0, 300) } : {}) })
      await changed(d.env_id)
      return { text: `Deploy #${d.number} on ${d.env_name}: ${ok ? 'success' : 'failed'}.` }
    }
    return { text: 'action: start, step or finish.', error: true }
  })
  // Files on the server, any protocol (FTP, FTPS, SFTP, SSH) with the credentials stored in Recon.
  const envRowOf = async (ws: string, kind: unknown) => {
    const env = await envOf(ws, kind)
    const row = env ? await rstore.envRow(env.id) : null
    return row && row.connection_status !== 'unverified' ? row : null
  }
  registerAppAction('env_files', async (ws, a) => {
    if (!isPro()) return { text: 'Recon needs an active Pro license', error: true }
    const row = await envRowOf(ws, a.env)
    if (!row) return { text: `No verified ${a.env} environment: the user connects it in Recon.`, error: true }
    const action = String(a.action) as FileAction
    if (!['list', 'read', 'write', 'delete', 'mkdir', 'rename'].includes(action)) return { text: 'action: list, read, write, delete, mkdir or rename.', error: true }
    const r = await fileOp(row, { action, path: a.path ? String(a.path) : '', to: a.to ? String(a.to) : undefined, content: typeof a.content === 'string' ? a.content : undefined })
    if (!r.ok) return { text: `${action} failed: ${(r.stderr || r.stdout).trim().slice(0, 2000) || `exit ${r.code}`}`, error: true }
    const where = remotePath(row, a.path ? String(a.path) : '') || '(login folder)'
    if (action === 'read') return { text: r.stdout.includes('\0') ? `${where}: binary file, ${r.stdout.length} bytes` : r.stdout.slice(0, 60_000) || '(empty file)' }
    if (action === 'list') return { text: `${where}:\n${r.stdout.slice(0, 30_000) || '(empty)'}` }
    return { text: `${action} done: ${where}${action === 'rename' ? ` → ${remotePath(row, String(a.to))}` : ''}` }
  })
  // Uploads run in the background and show their progress in the deploy card; deploy_status waits for them.
  const uploads = new Map<string, Promise<string>>()
  registerAppAction('env_upload', async (ws, a) => {
    if (!isPro()) return { text: 'Recon needs an active Pro license', error: true }
    const row = await envRowOf(ws, a.env)
    if (!row) return { text: `No verified ${a.env} environment: the user connects it in Recon.`, error: true }
    const w = await db.workspace(ws)
    if (!w?.worktreePath) return { text: 'This chat has no project folder.', error: true }
    const base = resolvePath(w.worktreePath, String(a.local_dir || '.'))
    if (base !== w.worktreePath && !base.startsWith(w.worktreePath + sep)) return { text: 'local_dir must be inside the project folder.', error: true }
    const { files, error } = collectFiles(base, Array.isArray(a.files) ? a.files.map(String) : [])
    if (error) return { text: error, error: true }
    if (!files.length) return { text: 'No files to upload.', error: true }
    const remoteDir = remotePath(row, a.remote_dir ? String(a.remote_dir) : '')
    // The step that shows the upload: the agent's own (deploy_progress), or a deploy of its own
    let deployId = a.deploy_id ? String(a.deploy_id) : ''
    let own = false
    if (deployId) {
      if (!(await rstore.deployById(deployId))) return { text: 'Unknown deploy_id.', error: true }
    } else {
      const head = await gitLine(w.worktreePath, 'log', '-1', '--format=%H%x00%s')
      const [sha, message] = head ? head.split('\0') : [null, null]
      deployId = await rstore.newDeploy(row.id, { trigger: 'agent', ref: w.branch ?? '', sha: sha || null, message: message || null, steps: [{ idx: 0, name: `Upload ${files.length} files` }] })
      own = true
    }
    const d0 = (await rstore.deployById(deployId))!
    const si = own ? 0 : /^\d+$/.test(String(a.step ?? '')) ? Number(a.step) - 1 : Math.max(0, d0.steps.findIndex((x) => /upload|carica|ftp|publish|copy/i.test(x.name)))
    if (!d0.steps[si]) return { text: `No step ${a.step} in that deploy.`, error: true }
    const t0 = Date.now()
    const setStep = async (patch: Partial<(typeof d0.steps)[number]>) => {
      const d = await rstore.deployById(deployId)
      if (!d) return
      await rstore.updateDeploy(deployId, { steps: d.steps.map((x, n) => (n === si ? { ...x, ...patch } : x)) })
      await changed(row.id)
    }
    await setStep({ status: 'running', progress: { done: 0, total: files.length } })
    let last = 0
    let logs: { step: number; line: string }[] = []
    const job = uploadFiles(row, base, files, remoteDir, (done, total, file, err) => {
      logs.push({ step: si, line: err ? `✗ ${file}: ${err.slice(0, 200)}` : `↑ ${file}` })
      if (Date.now() - last < 500 && done < total) return
      last = Date.now()
      const batch = logs
      logs = []
      void rstore.appendDeployLogs(deployId, batch).then(() => setStep({ progress: { done, total } })).catch(() => {})
    }).then(async (res) => {
      await rstore.appendDeployLogs(deployId, logs).catch(() => {})
      const ok = res.failed.length === 0
      await setStep({ status: ok ? 'success' : 'failed', ms: Date.now() - t0, progress: { done: files.length, total: files.length } })
      if (own) await rstore.updateDeploy(deployId, { status: ok ? 'success' : 'failed', ...(ok ? {} : { error: `${res.failed.length} files not uploaded` }) })
      await changed(row.id)
      return `Upload to ${remoteDir || '(login folder)'}: ${res.uploaded}/${files.length} files sent.` +
        (ok ? '' : `\nFailed:\n${res.failed.slice(0, 20).map((f) => `- ${f.file}: ${f.error.slice(0, 200)}`).join('\n')}`)
    }).catch(async (e) => {
      await setStep({ status: 'failed', ms: Date.now() - t0 }).catch(() => {})
      if (own) await rstore.updateDeploy(deployId, { status: 'failed', error: String((e as Error).message).slice(0, 300) }).catch(() => {})
      return `Upload failed: ${(e as Error).message}`
    }).finally(() => setTimeout(() => uploads.delete(deployId), 10 * 60_000))
    uploads.set(deployId, job)
    return {
      text: `${own ? `deploy_id: ${deployId}\n` : ''}Uploading ${files.length} files to ${remoteDir || '(login folder)'} on ${row.name}; the chat shows the progress. ` +
        `Call deploy_status with id "${deployId}" and wait true for the outcome${own ? '' : ', then go on with the next steps'}.`
    }
  })
  registerAppAction('deploy_status', async (ws, a) => {
    const env = await envOf(ws, a.env)
    if (!env) return { text: `No ${a.env} environment.`, error: true }
    const deadline = Date.now() + 4 * 60_000 // the bridge fetch gives up at 5 minutes
    const up = a.id ? uploads.get(String(a.id)) : undefined
    if (up && a.wait) {
      const res = await Promise.race([up, new Promise<null>((r) => setTimeout(() => r(null), 4 * 60_000))])
      return { text: res ?? 'The upload is still running: call deploy_status again.', error: !!res && /failed|Failed:/.test(res) }
    }
    for (;;) {
      const all = await rstore.deploys(env.id)
      const d = (a.id ? all.find((x) => x.id === a.id) : null) ?? all[0]
      if (!d) return { text: 'No deploys yet.' }
      const live = d.status === 'running' || d.status === 'queued'
      if (!live || !a.wait || Date.now() > deadline) return { text: summary(d) + (live ? '\n(still running)' : ''), error: d.status === 'failed' }
      await new Promise((r) => setTimeout(r, 3000))
    }
  })
}

export const RECON_METHODS = [
  'envs', 'saveEnv', 'testAccess', 'deleteEnv', 'scan', 'overview', 'incidents', 'createIncident', 'updateIncident', 'diagnose',
  'cicd', 'saveCicd', 'setSecret', 'deploy', 'cancelDeploy', 'deploys', 'deployLogs', 'deployById'
] as const
