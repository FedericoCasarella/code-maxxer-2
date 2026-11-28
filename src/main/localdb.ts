import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { connect } from 'node:net'
import { join } from 'node:path'
import { app } from 'electron'

/** Port of the database the installed app runs for itself (dev keeps the Docker one on 5477). */
export const LOCAL_DB_PORT = 5479

let server: { stop: () => Promise<void> } | null = null

/** Something answers on the database port (a server left running is used as it is). */
const answers = () =>
  new Promise<boolean>((done) => {
    const s = connect(LOCAL_DB_PORT, '127.0.0.1')
    s.setTimeout(1500, () => (s.destroy(), done(false)))
    s.once('connect', () => (s.destroy(), done(true)))
    s.once('error', () => done(false))
  })

/** The process with this pid is a running Postgres. */
const isPostgres = (pid: number) => {
  try {
    return /postgres/i.test(execFileSync('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8' }))
  } catch {
    return false
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * The installed app brings its own Postgres: no Docker, nothing to install. The data lives in the app's
 * user data folder and survives updates. Dev, or a CM2_DATABASE_URL, uses the database given instead.
 */
export async function startLocalDb(): Promise<void> {
  if (!app.isPackaged || process.env.CM2_DATABASE_URL) return
  const { default: EmbeddedPostgres } = await import('embedded-postgres')
  const dir = join(app.getPath('userData'), 'postgres')
  // Postgres' own words, for the error when it does not start
  const logs: string[] = []
  const pg = new EmbeddedPostgres({
    databaseDir: dir, user: 'cm2', password: 'cm2', port: LOCAL_DB_PORT, persistent: true,
    onLog: (m) => void (logs.push(String(m)), logs.length > 40 && logs.shift())
  })
  if (!existsSync(join(dir, 'PG_VERSION'))) await pg.initialise()
  // embedded-postgres rejects with nothing when Postgres exits early: true/false here
  const start = () => pg.start().then(() => true, () => false)
  let started = await start()
  if (!started && !(await answers())) {
    // The lock of a server that is gone (a forced quit, the version before an update) keeps Postgres from
    // starting: dropped, then once more. A Postgres still there (shutting down, starting up) gets a few seconds.
    const lock = join(dir, 'postmaster.pid')
    const pid = existsSync(lock) ? Number(readFileSync(lock, 'utf8').split('\n')[0]) : 0
    if (pid && isPostgres(pid)) for (let i = 0; i < 10 && !(await answers()); i++) await sleep(500)
    else if (existsSync(lock)) rmSync(lock, { force: true })
    if (!(await answers())) started = await start()
    if (!started && !(await answers())) {
      const why = logs.join('').trim().split('\n').slice(-4).join('\n')
      throw new Error(`The local database did not start.${why ? `\n${why}` : ''}`)
    }
  }
  if (started) server = pg
  await pg.createDatabase('codemaxxer2').catch(() => {}) // already there after the first run
}

export async function stopLocalDb(): Promise<void> {
  const s = server
  server = null
  await s?.stop().catch(() => {})
}
