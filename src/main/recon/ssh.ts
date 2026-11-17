import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ReconEnv } from '@shared/recon'
import { decrypt } from './secrets'

/** Server row as stored (credentials encrypted). */
export type EnvRow = ReconEnv & { key_encrypted: string | null; password_encrypted: string | null }

const MAX_OUT = 400_000
const cap = (s: string) => (s.length > MAX_OUT ? `${s.slice(0, MAX_OUT)}\n… [${s.length - MAX_OUT} chars cut]` : s)

/**
 * Commands a read-only session must not run (a safety net, the prompt is the real rule).
 * Same list as code-maxxer's.
 */
const MUTATING = new RegExp(
  [
    '\\b(rm|rmdir|mv|cp|chmod|chown|chgrp|ln|truncate|dd|mkfs\\S*|umount|kill|pkill|killall|reboot|shutdown|halt|poweroff|useradd|userdel|usermod|visudo)\\b',
    '(^|[;&|(]\\s*|\\bsudo\\s+)passwd\\b',
    '\\bmount\\s+(-\\S+|/|\\w+:)',
    '\\bcrontab\\s+-[er]\\b',
    '\\b(apt|apt-get)\\s+(install|remove|purge|upgrade|dist-upgrade|autoremove)\\b',
    '\\b(yum|dnf)\\s+(install|remove|update|upgrade)\\b',
    '\\bapk\\s+(add|del|upgrade)\\b',
    '\\bpip3?\\s+(install|uninstall)\\b',
    '\\b(npm|pnpm|yarn)\\s+(install|i|ci|add|remove|uninstall|run\\s+(build|migrate|deploy))\\b',
    '\\bgit\\s+(pull|push|reset|checkout|switch|merge|rebase|commit|clean|stash|restore|revert|am|apply)\\b',
    '\\bsystemctl\\s+(start|stop|restart|reload|enable|disable|kill|mask|daemon-reload)\\b',
    '\\bservice\\s+\\S+\\s+(start|stop|restart|reload)\\b',
    '\\bdocker\\s+(rm|rmi|stop|start|restart|kill|run|create|pull|build|update|prune|system\\s+prune|volume\\s+rm|network\\s+rm)\\b',
    '\\bdocker[\\s-]compose\\s+(\\S+\\s+)*?(up|down|restart|stop|start|rm|pull|build)\\b',
    '\\bkubectl\\s+(delete|apply|create|scale|rollout|edit|patch|replace|drain|cordon)\\b',
    '\\b(drop|delete\\s+from|update\\s+\\S+\\s+set|insert\\s+into|alter\\s+table|truncate\\s+table)\\b',
    '\\bsed\\s+(-\\S*i|--in-place)',
    '\\btee\\b',
    '\\bnginx\\s+-s\\s+(reload|stop|quit)\\b',
    '\\bpm2\\s+(restart|stop|delete|reload|start)\\b'
  ].join('|'),
  'i'
)
const REDIRECT = /(^|[^0-9&<>])>{1,2}\s*(?!\/dev\/null|&)/

export function isMutating(command: string): boolean {
  const cmd = command.replace(/2>&1/g, '').replace(/>\s*\/dev\/null/g, '')
  return MUTATING.test(cmd) || REDIRECT.test(cmd.replace(/'[^']*'/g, "''"))
}

/** A stored private key lives in a temp 0600 file only while a command runs. */
async function withIdentity<T>(env: EnvRow, fn: (identity: string | null) => Promise<T>): Promise<T> {
  if (env.auth_method === 'key_path' && env.key_path) return fn(env.key_path.replace(/^~(?=\/|$)/, homedir()))
  if (env.auth_method !== 'key' || !env.key_encrypted) return fn(null)
  const dir = mkdtempSync(join(tmpdir(), 'cm2-key-'))
  const file = join(dir, 'id')
  writeFileSync(file, (decrypt(env.key_encrypted) ?? '').trim() + '\n', { mode: 0o600 })
  try {
    return await fn(file)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export function sshBaseArgs(env: EnvRow, identity: string | null): string[] {
  return [
    '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=15',
    '-p', String(env.port || 22),
    ...(identity ? ['-i', identity, '-o', 'IdentitiesOnly=yes'] : []),
    `${env.username}@${env.host}`
  ]
}

export type ExecResult = { ok: boolean; code: number | null; stdout: string; stderr: string; ms: number }

export function run(cmd: string, args: string[], opts: { input?: string; timeoutMs?: number; cwd?: string; env?: NodeJS.ProcessEnv; onData?: (s: string, stream: 'out' | 'err') => void } = {}): Promise<ExecResult> {
  return new Promise((resolve) => {
    const t0 = Date.now()
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env ?? process.env })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => {
      stdout = cap(stdout + d)
      opts.onData?.(String(d), 'out')
    })
    child.stderr.on('data', (d) => {
      stderr = cap(stderr + d)
      opts.onData?.(String(d), 'err')
    })
    const t = setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs ?? 60_000)
    child.on('error', (e) => {
      clearTimeout(t)
      resolve({ ok: false, code: null, stdout, stderr: stderr + e.message, ms: Date.now() - t0 })
    })
    child.on('close', (code) => {
      clearTimeout(t)
      resolve({ ok: code === 0, code, stdout, stderr, ms: Date.now() - t0 })
    })
    if (opts.input !== undefined) child.stdin.end(opts.input)
    else child.stdin.end()
  })
}

/** Run a command on the server (SSH only). Password auth is not supported over BatchMode: use a key or the agent. */
export async function sshExec(env: EnvRow, command: string, opts: { timeoutMs?: number; readOnly?: boolean; onData?: (s: string, stream: 'out' | 'err') => void } = {}): Promise<ExecResult> {
  if (env.protocol !== 'ssh') return { ok: false, code: null, stdout: '', stderr: `${env.protocol.toUpperCase()} has no shell: only file operations`, ms: 0 }
  if (opts.readOnly && isMutating(command)) return { ok: false, code: null, stdout: '', stderr: 'Blocked: this session is read-only and the command would change the server.', ms: 0 }
  return withIdentity(env, (identity) => run('ssh', [...sshBaseArgs(env, identity), command], { timeoutMs: opts.timeoutMs ?? 60_000, onData: opts.onData }))
}

/** rsync a local folder to the server over the same SSH settings. */
export async function rsyncUp(env: EnvRow, localDir: string, remoteDir: string, onData?: (s: string, stream: 'out' | 'err') => void): Promise<ExecResult> {
  return withIdentity(env, (identity) => {
    const ssh = ['ssh', ...sshBaseArgs(env, identity).slice(0, -1)].map((a) => (a.includes(' ') ? `'${a}'` : a)).join(' ')
    return run('rsync', ['-az', '--delete', '-e', ssh, `${localDir.replace(/\/?$/, '/')}`, `${env.username}@${env.host}:${remoteDir}/`], { timeoutMs: 30 * 60_000, onData })
  })
}

/** Deterministic connection test (no agent). */
export async function testConnection(env: EnvRow): Promise<ExecResult> {
  if (env.protocol === 'sftp') {
    return withIdentity(env, (identity) =>
      run('sftp', ['-b', '-', ...sshBaseArgs(env, identity)], { input: `cd ${env.workdir || '.'}\nls\n`, timeoutMs: 30_000 })
    )
  }
  return sshExec(env, 'echo "connection ok"; whoami; hostname; uname -srm; uptime', { timeoutMs: 30_000 })
}
