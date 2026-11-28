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
    '\\bpm2\\s+(restart|stop|delete|reload|start)\\b',
    // Windows: PowerShell verbs that change things, and cmd tools that do
    '\\b(set|remove|stop|restart|start|new|rename|move|copy|clear|disable|enable|install|uninstall|register|unregister|suspend|resume|mount|dismount|initialize|reset|update|add|export)-[a-z]+\\b',
    '\\b(restart|stop)-computer\\b',
    '\\b(out-file|format-volume)\\b',
    // Invoke-*: running code or items is blocked; web requests only as plain reads (no other method, no saving to disk)
    '\\binvoke-(?!webrequest\\b|restmethod\\b)[a-z]+\\b',
    '\\binvoke-(webrequest|restmethod)\\b[^|;]*-(method\\s+(?!get\\b)\\w+|outfile\\b|infile\\b|body\\b)',
    '\\b(reg|regedit)\\s+(add|delete|import|copy|restore|load|unload)\\b',
    '\\bsc(\\.exe)?\\s+(start|stop|config|delete|create|pause|continue|failure)\\b',
    '\\bnet\\s+(start|stop|user|localgroup|share|use)\\b',
    '\\bschtasks(\\.exe)?\\s+/(create|delete|change|run|end)\\b',
    '\\b(taskkill|shutdown|wmic\\s+\\S+\\s+(call|delete|set))\\b',
    '(^|[\\s;&|])(del|erase|rd|rmdir|md|mkdir|ren|move|copy|xcopy|robocopy|attrib|icacls|takeown|cipher)(\\.exe)?\\s',
    '\\bwsl(\\.exe)?\\s+--(shutdown|unregister|terminate|import|set-default)\\b'
  ].join('|'),
  'i'
)
const REDIRECT = /(^|[^0-9&<>])>{1,2}\s*(?!\/dev\/null|&)/

export function isMutating(command: string): boolean {
  const cmd = command.replace(/2>&1/g, '').replace(/>\s*\/dev\/null/g, '')
  return MUTATING.test(cmd) || REDIRECT.test(cmd.replace(/'[^']*'/g, "''"))
}

/** How to log in for one command: ssh arguments and extra environment. */
type Auth = { args: string[]; env: NodeJS.ProcessEnv }

/**
 * Credentials only for the time a command runs:
 *  - a stored private key goes to a 0600 temp file;
 *  - a stored password goes through SSH_ASKPASS: a tiny 0700 script that prints an environment
 *    variable, so the password is never written to disk nor shown in the process list.
 */
export async function withAuth<T>(env: EnvRow, fn: (auth: Auth) => Promise<T>): Promise<T> {
  const target = `${env.username}@${env.host}`
  const common = ['-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=15', '-p', String(env.port || 22)]
  if (env.auth_method === 'password') {
    const pass = decrypt(env.password_encrypted)
    if (!pass) return fn({ args: ['-o', 'BatchMode=yes', ...common, target], env: process.env })
    const dir = mkdtempSync(join(tmpdir(), 'cm2-ask-'))
    const ask = join(dir, 'askpass')
    writeFileSync(ask, '#!/bin/sh\nprintf \'%s\\n\' "$CM2_SSH_PASS"\n', { mode: 0o700 })
    try {
      return await fn({
        args: ['-o', 'BatchMode=no', '-o', 'PubkeyAuthentication=no', '-o', 'PreferredAuthentications=password,keyboard-interactive', '-o', 'NumberOfPasswordPrompts=1', ...common, target],
        env: { ...process.env, SSH_ASKPASS: ask, SSH_ASKPASS_REQUIRE: 'force', DISPLAY: process.env.DISPLAY || ':0', CM2_SSH_PASS: pass }
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
  if (env.auth_method === 'key_path' && env.key_path)
    return fn({ args: ['-o', 'BatchMode=yes', ...common, '-i', env.key_path.replace(/^~(?=\/|$)/, homedir()), '-o', 'IdentitiesOnly=yes', target], env: process.env })
  if (env.auth_method !== 'key' || !env.key_encrypted) return fn({ args: ['-o', 'BatchMode=yes', ...common, target], env: process.env })
  const dir = mkdtempSync(join(tmpdir(), 'cm2-key-'))
  const file = join(dir, 'id')
  writeFileSync(file, (decrypt(env.key_encrypted) ?? '').trim() + '\n', { mode: 0o600 })
  try {
    return await fn({ args: ['-o', 'BatchMode=yes', ...common, '-i', file, '-o', 'IdentitiesOnly=yes', target], env: process.env })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** sftp takes the port as -P (its -p means "preserve"). */
export const sftpArgs = (args: string[]) => args.map((x, i) => (x === '-p' && args[i + 1] && /^\d+$/.test(args[i + 1]) ? '-P' : x))

export type ExecResult = { ok: boolean; code: number | null; stdout: string; stderr: string; ms: number }

export function run(cmd: string, args: string[], opts: { input?: string | Buffer; timeoutMs?: number; cwd?: string; env?: NodeJS.ProcessEnv; onData?: (s: string, stream: 'out' | 'err') => void } = {}): Promise<ExecResult> {
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

/** Run a command on the server (SSH only), with a key, the SSH agent or a stored password. */
export async function sshExec(env: EnvRow, command: string, opts: { timeoutMs?: number; readOnly?: boolean; input?: string | Buffer; onData?: (s: string, stream: 'out' | 'err') => void } = {}): Promise<ExecResult> {
  if (env.protocol !== 'ssh') return { ok: false, code: null, stdout: '', stderr: `${env.protocol.toUpperCase()} has no shell: only file operations`, ms: 0 }
  if (opts.readOnly && isMutating(command)) return { ok: false, code: null, stdout: '', stderr: 'Blocked: this session is read-only and the command would change the server.', ms: 0 }
  return withAuth(env, (a) => run('ssh', [...a.args, command], { timeoutMs: opts.timeoutMs ?? 60_000, onData: opts.onData, env: a.env, input: opts.input }))
}

/** rsync a local folder to the server over the same SSH settings. */
export async function rsyncUp(env: EnvRow, localDir: string, remoteDir: string, onData?: (s: string, stream: 'out' | 'err') => void): Promise<ExecResult> {
  return withAuth(env, (a) => {
    const ssh = ['ssh', ...a.args.slice(0, -1)].map((x) => (x.includes(' ') ? `'${x}'` : x)).join(' ')
    return run('rsync', ['-az', '--delete', '-e', ssh, `${localDir.replace(/\/?$/, '/')}`, `${env.username}@${env.host}:${remoteDir}/`], { timeoutMs: 30 * 60_000, onData, env: a.env })
  })
}

/** curl config strings: only backslash and double quote need escaping. */
export const q = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/**
 * FTP/FTPS through curl (on every Mac), as code-maxxer did with basic-ftp: FTP is plain, FTPS requires
 * TLS but accepts the hosting's own certificate (shared hosting serves e.g. ftpX.provider.it for every domain).
 * The login goes in a config read from stdin, never in the arguments nor on disk.
 */
export function ftpList(env: EnvRow, dir = env.workdir || ''): Promise<ExecResult> {
  const path = dir.startsWith('/') ? `/%2F${dir.slice(1)}` : `/${dir}`
  const url = `ftp://${env.host}:${env.port || 21}${encodeURI(path.replace(/\/?$/, '/')).replace(/%252F/, '%2F')}`
  const pass = decrypt(env.password_encrypted) ?? ''
  const cfg = [`url = ${q(url)}`, `user = ${q(`${env.username}:${pass}`)}`, ...(env.protocol === 'ftps' ? ['ssl-reqd', 'insecure'] : []), 'list-only', 'silent', 'show-error', 'connect-timeout = 15', 'max-time = 30'].join('\n')
  return run('curl', ['-K', '-'], { input: cfg + '\n', timeoutMs: 40_000 })
}

/** Deterministic connection test (no agent). */
export async function testConnection(env: EnvRow): Promise<ExecResult> {
  if (env.protocol === 'ftp' || env.protocol === 'ftps') {
    const r = await ftpList(env)
    return r.ok ? { ...r, stdout: `connection ok\n${r.stdout}` } : r
  }
  if (env.protocol === 'sftp') {
    return withAuth(env, (a) =>
      // With a password, batch mode (-b) would forbid the prompt our askpass answers: commands go through stdin instead.
      run('sftp', [...(env.auth_method === 'password' ? [] : ['-b', '-']), ...sftpArgs(a.args)], { input: `cd ${env.workdir || '.'}\nls\nbye\n`, timeoutMs: 30_000, env: a.env })
    )
  }
  return sshExec(env, 'echo "connection ok"; whoami; hostname; uname -srm; uptime', { timeoutMs: 30_000 })
}
