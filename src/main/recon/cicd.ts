import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, posix, relative, resolve } from 'node:path'
import { parse } from 'yaml'
import { z } from 'zod'
import type { Deploy } from '@shared/recon'
import { pool } from '../db'
import { bin, shellEnv } from '../engine/bins'
import { decrypt } from './secrets'
import { rsyncUp, run, sshExec, type EnvRow } from './ssh'
import { rstore } from './store'

/*
 * Built-in CI/CD, no GitHub: a trimmed-down GitHub Actions. Steps run in order and the first failure stops
 * the deploy. Zero-downtime releases over SSH: each release goes to <path>/releases/<id> and `activate`
 * swaps the <path>/current symlink atomically. Any failure after activate swaps it straight back.
 */

const step = z
  .object({
    name: z.string().min(1),
    run: z.string().optional(),
    uses: z.enum(['upload', 'activate', 'healthcheck', 'cleanup', 'env-file']).optional(),
    where: z.enum(['local', 'remote']).default('local'),
    workdir: z.string().optional(),
    timeout: z.number().int().min(5).max(7200).default(900),
    continue_on_error: z.boolean().default(false),
    with: z.record(z.string(), z.unknown()).default({})
  })
  .refine((s) => !!s.run !== !!s.uses, { message: 'each step needs either "run" or "uses", not both' })

const schema = z.object({
  name: z.string().default('Deploy'),
  on: z
    .object({ manual: z.boolean().default(true), push: z.object({ branch: z.string().min(1) }).optional() })
    .default({ manual: true }),
  env: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]).transform(String)).default({}),
  release: z.object({ path: z.string().min(1), keep: z.number().int().min(2).max(20).default(5) }),
  steps: z.array(step).min(1),
  rollback: z.array(step).default([])
})
export type Spec = z.infer<typeof schema>
type Step = Spec['steps'][number]

export function parseSpec(yaml: string, protocol: string): { ok: boolean; spec?: Spec; errors: string[] } {
  let raw: unknown
  try {
    raw = parse(yaml)
  } catch (e) {
    return { ok: false, errors: [`Invalid YAML: ${(e as Error).message.split('\n')[0]}`] }
  }
  const r = schema.safeParse(raw)
  if (!r.success) return { ok: false, errors: r.error.issues.map((i) => `${i.path.join('.') || 'file'}: ${i.message}`) }
  const spec = r.data
  const errors: string[] = []
  if (protocol !== 'ssh') errors.push('The built-in CI/CD needs an SSH environment (atomic releases use a symlink on the server)')
  const iUp = spec.steps.findIndex((s) => s.uses === 'upload')
  const iAct = spec.steps.findIndex((s) => s.uses === 'activate')
  if (spec.steps.filter((s) => s.uses === 'activate').length !== 1) errors.push('Exactly one "uses: activate" step is needed: it is the atomic swap that publishes the release')
  if (spec.steps.filter((s) => s.uses === 'upload').length !== 1) errors.push('Exactly one "uses: upload" step is needed, before "activate"')
  if (iUp >= 0 && iAct >= 0 && iUp > iAct) errors.push('"upload" must come before "activate"')
  if (spec.steps.some((s, i) => s.where === 'remote' && s.run && iUp >= 0 && i < iUp)) errors.push('Remote commands run inside the release folder: put them after "upload"')
  if (spec.rollback.some((s) => s.where !== 'remote' || !s.run)) errors.push('"rollback" only takes remote commands (where: remote, run: …)')
  return { ok: !errors.length, spec, errors }
}

export function starterYaml(env: { name: string; workdir: string; health_url: string | null }): string {
  return `name: Deploy ${env.name}
on:
  manual: true
  # push: { branch: main }   # deploy on every new commit on origin/main
env:
  NODE_ENV: production
release:
  path: ${env.workdir || '/var/www/app'}   # releases/<id> + the "current" symlink live here
  keep: 5
steps:
  - name: Install
    run: npm ci
  - name: Build
    run: npm run build
  - name: Upload release
    uses: upload
    with: { from: dist }
  - name: Publish
    uses: activate
${env.health_url ? `  - name: Health check\n    uses: healthcheck\n    with: { url: ${env.health_url}, retries: 10, interval: 3 }\n` : ''}  - name: Cleanup
    uses: cleanup
rollback: []
`
}

export const SPEC_DOC = `Steps run in order; the first failure stops the deploy (unless continue_on_error: true).
- run: shell command. where: local (default, in a clean checkout of the commit) or remote (inside $RELEASE_DIR, after upload).
- uses: upload (with.from: folder to ship) · activate (atomic symlink swap) · healthcheck (with.url, expect, retries, interval) · cleanup (keeps release.keep) · env-file (with.path, secrets: [NAMES], where).
- Before activate the live site is untouched. After activate any failure swaps back to the previous release and runs "rollback".
- Variables: $RELEASE_ID $RELEASE_DIR $RELEASE_ROOT $COMMIT_SHA $BRANCH, env and secrets. Secrets never go in the YAML.
- The web server must serve <release.path>/current.`

// ---------------------------------------------------------------- runner

type Emit = (e: { type: 'recon:deploy-log'; deployId: string; step: number; line: string } | { type: 'recon:changed'; projectId: string }) => void
const active = new Map<string, AbortController>()
export const cancelDeploy = (id: string) => (active.get(id)?.abort(), active.has(id))

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
const exports_ = (vars: Record<string, string>) =>
  Object.entries(vars)
    .filter(([k]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k))
    .map(([k, v]) => `export ${k}=${q(v)};`)
    .join(' ')

function runLocal(cmd: string, cwd: string, vars: Record<string, string>, timeoutSec: number, signal: AbortSignal, out: (t: string) => void): Promise<number | null> {
  return new Promise((res) => {
    if (!existsSync(cwd)) {
      out(`folder not found: ${cwd}`)
      return res(1)
    }
    const child = spawn('/bin/bash', ['-lc', cmd], { cwd, env: { ...shellEnv(), ...vars, CI: 'true' }, detached: true })
    const stop = () => {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL')
      } catch {
        /* gone */
      }
    }
    const t = setTimeout(() => {
      out(`timed out after ${timeoutSec}s`)
      stop()
    }, timeoutSec * 1000)
    signal.addEventListener('abort', stop, { once: true })
    child.stdout.on('data', (d) => out(String(d)))
    child.stderr.on('data', (d) => out(String(d)))
    child.on('close', (code) => {
      clearTimeout(t)
      res(signal.aborted ? null : code)
    })
    child.on('error', (e) => {
      out(e.message)
      res(1)
    })
  })
}

async function httpCheck(url: string, expect: number | null): Promise<{ ok: boolean; status: number | null; ms: number; error: string | null }> {
  const t0 = Date.now()
  try {
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15_000), headers: { 'user-agent': 'code-maxxer-monitor' } })
    const ok = expect ? r.status === expect : r.status < 400
    return { ok, status: r.status, ms: Date.now() - t0, error: ok ? null : `HTTP ${r.status}` }
  } catch (e) {
    return { ok: false, status: null, ms: Date.now() - t0, error: (e as Error).message }
  }
}
export { httpCheck }

export async function startDeploy(envId: string, trigger: 'manual' | 'push', emit: Emit): Promise<string> {
  const env = await rstore.envRow(envId)
  if (!env) throw new Error('Environment not found')
  if (env.connection_status === 'unverified') throw new Error('Run the connection scan first: the server is not verified yet')
  const cfg = await rstore.cicdRaw(envId)
  const parsed = parseSpec(cfg?.yaml ?? '', env.protocol)
  if (!parsed.ok || !parsed.spec) throw new Error(parsed.errors[0] ?? 'Invalid CI/CD config')
  if ((await pool.query("select 1 from cicd_deploys where env_id=$1 and status='running'", [envId])).rowCount)
    throw new Error('A deploy is already running on this environment')
  const spec = parsed.spec
  const proj = (await pool.query('select path from projects where id=$1', [env.project_id])).rows[0]
  const repo: string = proj.path
  const branch = spec.on.push?.branch ?? (await run(bin('git'), ['-C', repo, 'rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim()
  const ref = trigger === 'push' ? `origin/${branch}` : 'HEAD'
  const sha = (await run(bin('git'), ['-C', repo, 'rev-parse', ref])).stdout.trim() || null
  const message = sha ? (await run(bin('git'), ['-C', repo, 'log', '-1', '--format=%s', sha])).stdout.trim() : null
  const id = await rstore.newDeploy(envId, { trigger, ref: trigger === 'push' ? ref : branch, sha, message, steps: spec.steps.map((s, idx) => ({ idx, name: s.name })) })
  emit({ type: 'recon:changed', projectId: env.project_id })
  void execute(id, env, spec, repo, sha ?? 'HEAD', branch, emit)
  return id
}

async function execute(id: string, env: EnvRow, spec: Spec, repo: string, sha: string, branch: string, emit: Emit) {
  const ctrl = new AbortController()
  active.set(id, ctrl)
  const secrets: Record<string, string> = {}
  for (const s of await rstore.secretValues(env.id)) secrets[s.name] = decrypt(s.value_encrypted) ?? ''
  const mask = (t: string) => Object.values(secrets).reduce((acc, v) => (v.length >= 4 ? acc.split(v).join('•••') : acc), t)
  let buf: { step: number; line: string }[] = []
  let timer: NodeJS.Timeout | null = null
  const flush = async () => {
    timer = null
    const b = buf
    buf = []
    await rstore.appendDeployLogs(id, b).catch(() => {})
  }
  const log = (stepIdx: number, text: string) => {
    for (const raw of text.split('\n')) {
      if (!raw.trim()) continue
      const line = mask(raw).slice(0, 4000)
      buf.push({ step: stepIdx, line })
      emit({ type: 'recon:deploy-log', deployId: id, step: stepIdx, line })
    }
    if (!timer) timer = setTimeout(() => void flush(), 300)
  }
  const steps: Deploy['steps'] = spec.steps.map((s, idx) => ({ idx, name: s.name, status: 'pending', ms: null }))
  const setStep = async (idx: number, status: Deploy['steps'][number]['status'], ms: number | null = null) => {
    steps[idx] = { ...steps[idx], status, ms }
    await rstore.updateDeploy(id, { steps })
    emit({ type: 'recon:changed', projectId: env.project_id })
  }

  const releaseId = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const root = spec.release.path.replace(/\/+$/, '')
  const releaseDir = `${root}/releases/${releaseId}`
  const checkout = mkdtempSync(join(tmpdir(), 'cm2-deploy-'))
  const vars = { ...spec.env, ...secrets, RELEASE_ID: releaseId, RELEASE_DIR: releaseDir, RELEASE_ROOT: root, COMMIT_SHA: sha, BRANCH: branch }
  let activated = false
  let previous: string | null = null
  let error: string | null = null

  const svc = async (cmd: string) => {
    const r = await sshExec(env, cmd, { timeoutMs: 120_000 })
    return { ok: r.ok, out: `${r.stdout}${r.stderr}`.trim() }
  }

  const builtin = async (s: Step, idx: number): Promise<string | null> => {
    const w = s.with as Record<string, unknown>
    switch (s.uses) {
      case 'upload': {
        const from = resolve(checkout, String(w.from ?? 'dist'))
        if (!from.startsWith(checkout)) return '"from" must be inside the project'
        if (!existsSync(from) || !statSync(from).isDirectory()) return `folder ${String(w.from ?? 'dist')} does not exist after the build`
        const mk = await svc(`mkdir -p ${q(releaseDir)}`)
        if (!mk.ok) return `could not create the release folder: ${mk.out}`
        log(idx, `uploading ${relative(checkout, from) || '.'} → ${releaseDir}`)
        const r = await rsyncUp(env, from, releaseDir, (t) => log(idx, t))
        if (!r.ok) return `upload failed: ${r.stderr.trim().split('\n').pop()}`
        log(idx, `release ${releaseId} uploaded: the live site is untouched`)
        return null
      }
      case 'env-file': {
        const names = Array.isArray(w.secrets) ? (w.secrets as unknown[]).map(String) : []
        const missing = names.filter((n) => !(n in secrets))
        if (missing.length) return `missing secrets: ${missing.join(', ')}`
        const body = names.map((n) => `${n}=${secrets[n]}`).join('\n') + '\n'
        const rel = String(w.path ?? '.env')
        if ((w.where ?? 'remote') === 'remote') {
          const dest = posix.join(releaseDir, rel)
          const r = await svc(`umask 077 && mkdir -p ${q(posix.dirname(dest))} && echo ${q(Buffer.from(body).toString('base64'))} | base64 -d > ${q(dest)}`)
          if (!r.ok) return `could not write ${rel}: ${r.out}`
        } else {
          const dest = resolve(checkout, rel)
          if (!dest.startsWith(checkout)) return '"path" must be inside the project'
          writeFileSync(dest, body, { mode: 0o600 })
        }
        log(idx, `wrote ${rel} with ${names.length} secrets`)
        return null
      }
      case 'activate': {
        const before = await svc(`cd ${q(root)} && if [ -L current ]; then basename "$(readlink current)"; elif [ -e current ]; then echo __NOT_LINK__; fi`)
        if (before.out === '__NOT_LINK__') return `${root}/current exists but is not a symlink: move it once by hand, then releases become atomic`
        previous = before.out || null
        const sw = await svc(`cd ${q(root)} && ln -sfn ${q(`releases/${releaseId}`)} current.__new && mv -Tf current.__new current`)
        if (!sw.ok) return `symlink swap failed: ${sw.out}`
        activated = true
        log(idx, `release ${releaseId} is live${previous ? ` (was ${previous})` : ''}`)
        return null
      }
      case 'healthcheck': {
        const url = String(w.url ?? env.health_url ?? '')
        if (!url) return 'nothing to check (with.url or the environment health URL)'
        const tries = Math.max(1, Number(w.retries ?? 5))
        const pause = Math.max(1, Number(w.interval ?? 3))
        const expect = w.expect ? Number(w.expect) : env.expected_status
        for (let i = 1; i <= tries; i++) {
          if (ctrl.signal.aborted) return 'cancelled'
          const r = await httpCheck(url, expect)
          log(idx, `${i}/${tries} ${url} → ${r.ok ? 'ok' : 'ko'}${r.status ? ` ${r.status}` : ''}${r.error && !r.ok ? ` (${r.error})` : ''}`)
          if (r.ok) return null
          await new Promise((res) => setTimeout(res, pause * 1000))
        }
        return `the site did not answer as expected after ${tries} tries`
      }
      case 'cleanup': {
        const r = await svc(
          `cd ${q(`${root}/releases`)} && cur="$(basename "$(readlink ../current)")" && ls -1 | sort -r | grep -vx "$cur" | tail -n +${spec.release.keep} | while read d; do rm -rf -- "$d" && echo "removed $d"; done; true`
        )
        log(idx, r.out || 'nothing to remove')
        return null
      }
    }
    return `unknown step: ${s.uses}`
  }

  const runStep = async (s: Step, idx: number): Promise<string | null> => {
    if (s.uses) return builtin(s, idx)
    const timeout = s.timeout
    if (s.where === 'remote') {
      const dir = s.workdir ? posix.join(releaseDir, s.workdir) : releaseDir
      log(idx, `$ ${s.run}`)
      const r = await sshExec(env, `${exports_(vars)} cd ${q(dir)} && ${s.run}`, { timeoutMs: timeout * 1000, onData: (t) => log(idx, t) })
      return r.ok ? null : `exit ${r.code ?? 'timeout'}`
    }
    const cwd = s.workdir ? resolve(checkout, s.workdir) : checkout
    log(idx, `$ ${s.run}`)
    const code = await runLocal(s.run!, cwd, vars, timeout, ctrl.signal, (t) => log(idx, t))
    return code === 0 ? null : code === null ? 'cancelled' : `exit ${code}`
  }

  try {
    const wt = await run(bin('git'), ['-C', repo, 'worktree', 'add', '--detach', checkout, sha], { timeoutMs: 120_000 })
    if (!wt.ok) throw new Error(`checkout failed: ${wt.stderr.trim()}`)
    for (const [idx, s] of spec.steps.entries()) {
      if (ctrl.signal.aborted) {
        error = 'Cancelled'
        break
      }
      await setStep(idx, 'running')
      const t0 = Date.now()
      const err = await runStep(s, idx)
      if (err && !s.continue_on_error) {
        log(idx, `✗ ${err}`)
        await setStep(idx, 'failed', Date.now() - t0)
        error = `${s.name}: ${err}`
        break
      }
      await setStep(idx, err ? 'failed' : 'success', Date.now() - t0)
    }
    for (const [idx, st] of steps.entries()) if (st.status === 'pending' && error) await setStep(idx, 'skipped')
    let status: Deploy['status'] = error ? (ctrl.signal.aborted ? 'cancelled' : 'failed') : 'success'
    if (error && activated) {
      const last = steps.length - 1
      if (previous) {
        const r = await svc(`cd ${q(root)} && ln -sfn ${q(`releases/${previous}`)} current.__new && mv -Tf current.__new current`)
        log(last, r.ok ? `↩ rolled back to ${previous}` : `rollback failed: ${r.out}`)
        if (r.ok) {
          for (const s of spec.rollback) await runStep(s, last)
          status = 'rolled_back'
        }
      } else log(last, 'first release: nothing to roll back to')
    }
    await flush()
    await rstore.updateDeploy(id, { status, release_id: releaseId, error: error ?? undefined })
    if (status === 'success') await rstore.saveCicd(env.id, { last_seen_sha: sha })
  } catch (e) {
    await flush()
    await rstore.updateDeploy(id, { status: 'failed', error: (e as Error).message })
  } finally {
    active.delete(id)
    await run(bin('git'), ['-C', repo, 'worktree', 'remove', '--force', checkout]).catch(() => null)
    rmSync(checkout, { recursive: true, force: true })
    emit({ type: 'recon:changed', projectId: env.project_id })
  }
}

/** Push trigger: every minute, look at origin/<branch> for each enabled config and deploy new commits. */
export function startPushWatcher(emit: Emit, enabled: () => boolean) {
  const tick = async () => {
    if (!enabled()) return
    const rows = (await pool.query('select c.env_id, c.yaml, c.last_seen_sha, e.protocol, p.path from cicd_configs c join recon_environments e on e.id=c.env_id join projects p on p.id=e.project_id where c.enabled')).rows
    for (const r of rows) {
      const spec = parseSpec(r.yaml, r.protocol).spec
      const branch = spec?.on.push?.branch
      if (!branch) continue
      const ls = await run(bin('git'), ['-C', r.path, 'ls-remote', 'origin', `refs/heads/${branch}`], { timeoutMs: 30_000, env: shellEnv() })
      const sha = ls.stdout.split(/\s/)[0]
      if (!sha || sha === r.last_seen_sha) continue
      await run(bin('git'), ['-C', r.path, 'fetch', 'origin', branch], { timeoutMs: 120_000, env: shellEnv() })
      await rstore.saveCicd(r.env_id, { last_seen_sha: sha })
      if (r.last_seen_sha) await startDeploy(r.env_id, 'push', emit).catch(() => null)
    }
  }
  setInterval(() => void tick().catch(() => null), 60_000)
}
