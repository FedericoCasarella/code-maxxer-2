import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, posix, relative, resolve, sep } from 'node:path'
import { decrypt } from './secrets'
import { q, run, sftpArgs, sshExec, withAuth, type EnvRow, type ExecResult } from './ssh'

/*
 * Files on a server, for every protocol an environment can use:
 *  - FTP/FTPS through curl (the login goes in a config on stdin, never in the arguments);
 *  - SFTP through the sftp client, with the same key, agent or password as SSH;
 *  - SSH through plain shell commands (and tar for uploads).
 * Relative paths are inside the environment's app folder.
 */

export type FileAction = 'list' | 'read' | 'write' | 'delete' | 'mkdir' | 'rename'
export type FileOp = { action: FileAction; path?: string; to?: string; content?: string }

const isFtp = (env: EnvRow) => env.protocol === 'ftp' || env.protocol === 'ftps'

/** A path on the server: absolute as given, otherwise inside the app folder ('' = the login folder). */
export function remotePath(env: EnvRow, p = ''): string {
  if (p.startsWith('/') || p.startsWith('~/')) return posix.normalize(p)
  const base = env.workdir || ''
  const joined = posix.normalize(posix.join(base || '.', p || '.'))
  return joined === '.' ? '' : joined.replace(/\/$/, '')
}

const parentOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) || (p.startsWith('/') ? '/' : '') : '')
/** Every folder from the top down to p: a/b/c → a, a/b, a/b/c. */
const ancestors = (p: string) => {
  const parts = p.split('/')
  const out: string[] = []
  for (let i = 1; i <= parts.length; i++) {
    const x = parts.slice(0, i).join('/')
    if (x && x !== '~') out.push(x)
  }
  return out
}

function tempFile(data: string | Buffer): { file: string; done: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'cm2-put-'))
  const file = join(dir, 'data')
  writeFileSync(file, data, { mode: 0o600 })
  return { file, done: () => rmSync(dir, { recursive: true, force: true }) }
}

const fail = (stderr: string): ExecResult => ({ ok: false, code: null, stdout: '', stderr, ms: 0 })

// ─── FTP / FTPS ───

function ftpUrl(env: EnvRow, p: string, dir = false): string {
  const abs = p.startsWith('/')
  const segs = p.split('/').filter((s) => s && s !== '.').map(encodeURIComponent).join('/')
  let path = `${abs ? '%2F' : ''}${segs}`
  if (dir && !path.endsWith('/') && path) path += '/'
  return `ftp://${env.host}:${env.port || 21}/${path}`
}

function curl(env: EnvRow, lines: string[], timeoutMs = 120_000): Promise<ExecResult> {
  const pass = decrypt(env.password_encrypted) ?? ''
  const cfg = [
    `user = ${q(`${env.username}:${pass}`)}`,
    ...(env.protocol === 'ftps' ? ['ssl-reqd', 'insecure'] : []),
    'silent',
    'show-error',
    'connect-timeout = 15',
    `max-time = ${Math.round(timeoutMs / 1000) - 5}`,
    ...lines
  ].join('\n')
  return run('curl', ['-K', '-'], { input: cfg + '\n', timeoutMs })
}

/** Raw FTP commands, sent after login from the login folder; the listing that follows is thrown away. */
const ftpQuote = (env: EnvRow, cmds: string[]) => curl(env, [`url = ${q(ftpUrl(env, '', true))}`, ...cmds.map((c) => `quote = ${q(c)}`), 'list-only', 'output = "/dev/null"'])

async function ftpOp(env: EnvRow, op: FileOp, p: string): Promise<ExecResult> {
  switch (op.action) {
    case 'list':
      return curl(env, [`url = ${q(ftpUrl(env, p, true))}`])
    case 'read':
      return curl(env, [`url = ${q(ftpUrl(env, p))}`])
    case 'write': {
      const t = tempFile(op.content ?? '')
      try {
        return await curl(env, [`url = ${q(ftpUrl(env, p))}`, `upload-file = ${q(t.file)}`, 'ftp-create-dirs'])
      } finally {
        t.done()
      }
    }
    case 'delete': {
      const r = await ftpQuote(env, [`DELE ${p}`])
      // Not a file: an empty folder goes with RMD
      return r.ok ? r : ftpQuote(env, [`RMD ${p}`]).then((x) => (x.ok ? x : { ...x, stderr: `${r.stderr}\n${x.stderr}`.trim() + '\n(a folder must be empty: delete its files first)' }))
    }
    case 'mkdir':
      return ftpQuote(env, ancestors(p).map((x) => `*MKD ${x}`))
    case 'rename':
      return ftpQuote(env, [...ancestors(parentOf(remotePath(env, op.to))).map((x) => `*MKD ${x}`), `RNFR ${p}`, `RNTO ${remotePath(env, op.to)}`])
  }
}

// ─── SFTP ───

const sq = (p: string) => `"${p.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
const SFTP_ERR = /^(Couldn't|Can't|remote |.*: No such file|.*Permission denied|.*Failure|.*not found|Invalid command)/im

function sftp(env: EnvRow, cmds: string[], timeoutMs = 120_000): Promise<ExecResult> {
  return withAuth(env, async (a) => {
    // With a password, batch mode (-b) would forbid the prompt our askpass answers: commands go through stdin instead.
    const r = await run('sftp', [...(env.auth_method === 'password' ? [] : ['-b', '-']), ...sftpArgs(a.args)], { input: cmds.join('\n') + '\nbye\n', timeoutMs, env: a.env })
    const bad = `${r.stdout}\n${r.stderr}`.split('\n').filter((l) => SFTP_ERR.test(l))
    return bad.length ? { ...r, ok: false, stderr: bad.join('\n') } : r
  })
}

async function sftpOp(env: EnvRow, op: FileOp, p: string): Promise<ExecResult> {
  const target = p || '.'
  switch (op.action) {
    case 'list': {
      const r = await sftp(env, [`ls -la ${sq(target)}`])
      return { ...r, stdout: r.stdout.split('\n').filter((l) => !/^sftp>/.test(l)).join('\n') }
    }
    case 'read': {
      const dir = mkdtempSync(join(tmpdir(), 'cm2-get-'))
      try {
        const r = await sftp(env, [`get ${sq(target)} ${sq(join(dir, 'data'))}`])
        if (!r.ok) return r
        return { ...r, stdout: readFileSync(join(dir, 'data'), 'utf8') }
      } catch (e) {
        return fail((e as Error).message)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }
    case 'write': {
      const t = tempFile(op.content ?? '')
      try {
        return await sftp(env, [...ancestors(parentOf(p)).map((x) => `-mkdir ${sq(x)}`), `put ${sq(t.file)} ${sq(target)}`].filter((c) => !/^-mkdir ""/.test(c)), 120_000).then(dropMkdirNoise)
      } finally {
        t.done()
      }
    }
    case 'delete': {
      const r = await sftp(env, [`rm ${sq(target)}`])
      return r.ok ? r : sftp(env, [`rmdir ${sq(target)}`]).then((x) => (x.ok ? x : { ...x, stderr: `${r.stderr}\n${x.stderr}\n(a folder must be empty: delete its files first)`.trim() }))
    }
    case 'mkdir':
      return sftp(env, ancestors(p).map((x) => `-mkdir ${sq(x)}`)).then(dropMkdirNoise)
    case 'rename': {
      const to = remotePath(env, op.to)
      return sftp(env, [...ancestors(parentOf(to)).map((x) => `-mkdir ${sq(x)}`), `rename ${sq(target)} ${sq(to)}`]).then(dropMkdirNoise)
    }
  }
}

/** "-mkdir" of a folder that already exists still prints a failure line: that one is fine. */
function dropMkdirNoise(r: ExecResult): ExecResult {
  if (r.ok) return r
  const left = r.stderr.split('\n').filter((l) => l.trim() && !/mkdir.*(Failure|exists)|^Couldn't create directory/i.test(l))
  return left.length ? { ...r, stderr: left.join('\n') } : { ...r, ok: true, stderr: '' }
}

// ─── SSH (a shell) ───

/** A path for a POSIX shell: quoted, keeping a leading ~/ expandable. */
const sh = (p: string) => (p.startsWith('~/') ? `~/'${p.slice(2).replace(/'/g, `'\\''`)}'` : `'${(p || '.').replace(/'/g, `'\\''`)}'`)

function sshOp(env: EnvRow, op: FileOp, p: string): Promise<ExecResult> {
  const T = { timeoutMs: 120_000 }
  switch (op.action) {
    case 'list':
      return sshExec(env, `ls -la -- ${sh(p)}`, T)
    case 'read':
      return sshExec(env, `cat -- ${sh(p)}`, T)
    case 'write': {
      const dir = parentOf(p)
      return sshExec(env, `${dir ? `mkdir -p -- ${sh(dir)} && ` : ''}cat > ${sh(p)}`, { ...T, input: op.content ?? '' })
    }
    case 'delete':
      return sshExec(env, `rm -r -- ${sh(p)}`, T)
    case 'mkdir':
      return sshExec(env, `mkdir -p -- ${sh(p)}`, T)
    case 'rename': {
      const to = remotePath(env, op.to)
      const dir = parentOf(to)
      return sshExec(env, `${dir ? `mkdir -p -- ${sh(dir)} && ` : ''}mv -- ${sh(p)} ${sh(to)}`, T)
    }
  }
}

/** One file operation on the server. */
export async function fileOp(env: EnvRow, op: FileOp): Promise<ExecResult> {
  const p = remotePath(env, op.path)
  if (['read', 'write', 'delete', 'rename'].includes(op.action) && !p) return fail('path: which file?')
  if (op.action === 'rename' && !op.to) return fail('to: the new path')
  if (op.action === 'write' && typeof op.content !== 'string') return fail('content: the text to write')
  if (isFtp(env)) return ftpOp(env, op, p)
  if (env.protocol === 'sftp') return sftpOp(env, op, p)
  return sshOp(env, op, p)
}

// ─── Uploads ───

const SKIP = new Set(['.git', '.DS_Store'])

/** Local files to send: the given files and folders (folders with everything inside), relative to root. */
export function collectFiles(root: string, items: string[]): { files: string[]; error?: string } {
  const out = new Set<string>()
  const walk = (abs: string) => {
    const st = statSync(abs)
    if (st.isDirectory()) {
      for (const n of readdirSync(abs)) if (!SKIP.has(n)) walk(join(abs, n))
    } else if (st.isFile()) out.add(relative(root, abs).split(sep).join('/'))
  }
  for (const it of items.length ? items : ['.']) {
    const abs = resolve(root, it)
    if (abs !== root && !abs.startsWith(root + sep)) return { files: [], error: `${it} is outside the folder` }
    try {
      walk(abs)
    } catch {
      return { files: [], error: `${it}: no such file or folder` }
    }
  }
  return { files: [...out].sort() }
}

export type UploadProgress = (done: number, total: number, file: string, error?: string) => void

/** Send files (relative to root) into remoteDir; nothing on the server is deleted. */
export async function uploadFiles(env: EnvRow, root: string, files: string[], remoteDir: string, onProgress: UploadProgress): Promise<{ uploaded: number; failed: { file: string; error: string }[] }> {
  const dest = (f: string) => posix.join(remoteDir || '.', f).replace(/^\.\//, '')
  const failed: { file: string; error: string }[] = []
  let done = 0
  const tick = (f: string, error?: string) => {
    done++
    if (error) failed.push({ file: f, error })
    onProgress(done, files.length, f, error)
  }
  if (isFtp(env)) {
    // A few at a time: shared hosting limits connections per address
    const queue = [...files]
    const worker = async () => {
      for (let f = queue.shift(); f; f = queue.shift()) {
        const r = await curl(env, [`url = ${q(ftpUrl(env, dest(f)))}`, `upload-file = ${q(join(root, f))}`, 'ftp-create-dirs'], 300_000)
        tick(f, r.ok ? undefined : r.stderr.trim() || `curl exit ${r.code}`)
      }
    }
    await Promise.all([worker(), worker(), worker()])
  } else {
    // SFTP and SSH: one connection per batch of files
    for (let i = 0; i < files.length; i += 25) {
      const chunk = files.slice(i, i + 25)
      if (env.protocol === 'sftp') {
        const dirs = [...new Set(chunk.flatMap((f) => ancestors(parentOf(dest(f)))))]
        const r = dropMkdirNoise(await sftp(env, [...dirs.map((d) => `-mkdir ${sq(d)}`), ...chunk.map((f) => `put ${sq(join(root, f))} ${sq(dest(f))}`)], 600_000))
        for (const f of chunk) tick(f, r.ok ? undefined : r.stderr.split('\n').find((l) => l.includes(f) || l.includes(dest(f))) ?? (r.code ? r.stderr.trim() : undefined))
      } else {
        const tar = await tarOf(root, chunk)
        const r = 'data' in tar ? await sshExec(env, `mkdir -p -- ${sh(remoteDir)} && tar -xf - -C ${sh(remoteDir)}`, { input: tar.data, timeoutMs: 600_000 }) : tar
        for (const f of chunk) tick(f, r.ok ? undefined : r.stderr.trim() || `exit ${r.code}`)
      }
    }
  }
  return { uploaded: done - failed.length, failed }
}

/** A tar of some files, without macOS metadata (._ files, xattrs). */
async function tarOf(root: string, files: string[]): Promise<{ ok: true; data: Buffer } | ExecResult> {
  const dir = mkdtempSync(join(tmpdir(), 'cm2-tar-'))
  try {
    const out = join(dir, 'up.tar')
    const r = await run('tar', ['--no-mac-metadata', '-cf', out, '-C', root, '--', ...files], { env: { ...process.env, COPYFILE_DISABLE: '1' }, timeoutMs: 120_000 })
    if (!r.ok) return r
    return { ok: true, data: readFileSync(out) }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
