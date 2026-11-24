import { execFile } from 'node:child_process'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { EngineEvent, PushDecision, PushRequest } from '@shared/types'
import { registerAppAction } from './browser'
import { bin, shellEnv } from './bins'

/*
 * Every git push an agent makes asks the user first. A pre-push hook, put in front of every agent's git through
 * GIT_CONFIG_* (core.hooksPath), calls the app over the bridge and waits; the chat shows the request as a
 * Permission Request (once, for an hour, always). The repo's own pre-push hook still runs before it.
 * Cooperative, not a sandbox: `git push --no-verify` skips hooks, and the agents are told not to use it.
 */

const HOOKS = join(homedir(), '.code-maxxer-2', 'git-hooks')

const HOOK = `#!/bin/sh
# code-maxxer: a push by an agent waits for the user's ok in the chat.
refs=$(cat)
common=$(git rev-parse --git-common-dir 2>/dev/null)
own=$(git config --file "$common/config" --get core.hooksPath 2>/dev/null)
[ -z "$own" ] && own="$common/hooks"
case "$own" in /*) ;; *) own="$(git rev-parse --show-toplevel)/$own" ;; esac
if [ -x "$own/pre-push" ]; then printf '%s\\n' "$refs" | "$own/pre-push" "$@" || exit $?; fi
[ -z "$CM2_BRIDGE_URL" ] && exit 0
esc() { printf '%s' "$1" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g' | tr '\\n' ';'; }
body="{\\"ws\\":\\"$CM2_WORKSPACE_ID\\",\\"action\\":\\"push_request\\",\\"args\\":{\\"remote\\":\\"$(esc "$1")\\",\\"url\\":\\"$(esc "$2")\\",\\"refs\\":\\"$(esc "$refs")\\",\\"cwd\\":\\"$(esc "$(pwd)")\\"}}"
out=$(curl -s --max-time 1900 -H "x-cm2-token: $CM2_BRIDGE_TOKEN" -H 'content-type: application/json' -d "$body" "$CM2_BRIDGE_URL/app")
case "$out" in *'"text":"allow'*) exit 0 ;; esac
echo "code-maxxer: push not allowed by the user. Do not retry and do not use --no-verify; tell the user." >&2
exit 1
`

/** Writes the hook (on start): agents get it through gitEnv(). */
export function installPushHook() {
  mkdirSync(HOOKS, { recursive: true })
  writeFileSync(join(HOOKS, 'pre-push'), HOOK)
  chmodSync(join(HOOKS, 'pre-push'), 0o755)
}

/** The env an agent's process gets so every git it runs goes through the hook, and the hook can reach the app. */
export function gitEnv(env: NodeJS.ProcessEnv, wsId: string, bridge: { url: string; token: string }): NodeJS.ProcessEnv {
  const n = Number(env.GIT_CONFIG_COUNT) || 0
  return {
    ...env,
    GIT_CONFIG_COUNT: String(n + 1),
    [`GIT_CONFIG_KEY_${n}`]: 'core.hooksPath',
    [`GIT_CONFIG_VALUE_${n}`]: HOOKS,
    CM2_WORKSPACE_ID: wsId,
    CM2_BRIDGE_URL: bridge.url,
    CM2_BRIDGE_TOKEN: bridge.token
  }
}

/** Grants per chat: for a while, or always (until revoked or the app quits). */
const grants = new Map<string, { scope: 'timed' | 'always'; until?: number }>()
const pending = new Map<string, { ws: string; resolve: (allow: boolean) => void; timer: NodeJS.Timeout }>()
const requests = new Map<string, PushRequest>()

const git = (cwd: string, args: string[]) =>
  new Promise<string>((ok) => execFile(bin('git'), args, { cwd, env: shellEnv(), maxBuffer: 4 << 20 }, (_e, o) => ok(String(o ?? '').trim())))

const ZERO = /^0+$/

async function describe(ws: string, a: { remote?: string; url?: string; refs?: string; cwd?: string }): Promise<PushRequest> {
  const cwd = a.cwd || process.cwd()
  const lines = String(a.refs ?? '').split(';').map((l) => l.trim()).filter(Boolean)
  const refs = lines.map((l) => {
    const [localRef, localSha, remoteRef, remoteSha] = l.split(/\s+/)
    return { localRef, localSha, remoteRef, remoteSha }
  })
  const commits: PushRequest['commits'] = []
  let stat = ''
  for (const r of refs) {
    if (!r.localSha || ZERO.test(r.localSha)) continue
    // A new branch on the remote: what isn't on any remote branch yet.
    const range = r.remoteSha && !ZERO.test(r.remoteSha) ? [`${r.remoteSha}..${r.localSha}`] : [r.localSha, '--not', '--remotes']
    const log = await git(cwd, ['log', '--format=%h%x1f%s', '-n', '20', ...range])
    for (const l of log.split('\n').filter(Boolean)) {
      const [sha, subject] = l.split('\x1f')
      commits.push({ sha, subject })
    }
    // The diff against the remote's tip, or (a new branch) from just before its oldest new commit.
    const base = r.remoteSha && !ZERO.test(r.remoteSha) ? r.remoteSha : commits.length ? `${commits[commits.length - 1].sha}^` : ''
    if (base) stat = await git(cwd, ['diff', '--shortstat', base, r.localSha])
  }
  const branch = refs[0]?.remoteRef?.replace(/^refs\/heads\//, '') ?? ''
  return {
    id: 'push_' + randomUUID().slice(0, 8),
    workspaceId: ws,
    remote: a.remote ?? '',
    url: String(a.url ?? '').replace(/\/\/[^@/]+@/, '//'),
    branch,
    deletes: refs.some((r) => r.localSha && ZERO.test(r.localSha)),
    commits,
    stat,
    at: Date.now(),
    status: 'pending'
  }
}

export function registerPushGate(emit: (e: EngineEvent) => void) {
  registerAppAction('push_request', async (ws, a) => {
    const g = grants.get(ws)
    if (g && (g.scope === 'always' || (g.until ?? 0) > Date.now())) return { text: 'allow' }
    if (g) grants.delete(ws)
    const req = await describe(ws, a)
    requests.set(req.id, req)
    emit({ type: 'push-request', request: req })
    const allow = await new Promise<boolean>((resolve) => {
      // Nobody answers in 30 minutes: the push doesn't go.
      const timer = setTimeout(() => decide(req.id, { allow: false, scope: 'once' }, emit), 30 * 60_000)
      pending.set(req.id, { ws, resolve, timer })
    })
    return { text: allow ? 'allow' : 'deny' }
  })
}

export function decide(id: string, d: PushDecision, emit: (e: EngineEvent) => void) {
  const p = pending.get(id)
  const req = requests.get(id)
  if (!req) return
  if (p) {
    clearTimeout(p.timer)
    pending.delete(id)
    if (d.allow && d.scope !== 'once') grants.set(p.ws, { scope: d.scope, until: d.until })
    p.resolve(d.allow)
  }
  const next: PushRequest = { ...req, status: d.allow ? 'allowed' : 'denied', decision: d }
  requests.set(id, next)
  emit({ type: 'push-request', request: next })
}

/** Revoke: the chat's grant goes, so the next push asks again. */
export function revoke(id: string, emit: (e: EngineEvent) => void) {
  const req = requests.get(id)
  if (!req) return
  grants.delete(req.workspaceId)
  const next: PushRequest = { ...req, status: 'revoked' }
  requests.set(id, next)
  emit({ type: 'push-request', request: next })
}

/** The requests of a chat (this session), to show them again after a reload. */
export const pushRequests = (ws: string) => [...requests.values()].filter((r) => r.workspaceId === ws)
