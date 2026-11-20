import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/** Port of the database the installed app runs for itself (dev keeps the Docker one on 5477). */
export const LOCAL_DB_PORT = 5479

let server: { stop: () => Promise<void> } | null = null

/**
 * The installed app brings its own Postgres: no Docker, nothing to install. The data lives in the app's
 * user data folder and survives updates. Dev, or a CM2_DATABASE_URL, uses the database given instead.
 */
export async function startLocalDb(): Promise<void> {
  if (!app.isPackaged || process.env.CM2_DATABASE_URL) return
  const { default: EmbeddedPostgres } = await import('embedded-postgres')
  const dir = join(app.getPath('userData'), 'postgres')
  const pg = new EmbeddedPostgres({ databaseDir: dir, user: 'cm2', password: 'cm2', port: LOCAL_DB_PORT, persistent: true, onLog: () => {} })
  if (!existsSync(join(dir, 'PG_VERSION'))) await pg.initialise()
  // A server left running by a crash still answers on the port: then starting fails and that one is used
  await pg.start().catch((e: Error) => console.warn('[db] start:', e.message))
  await pg.createDatabase('codemaxxer2').catch(() => {}) // already there after the first run
  server = pg
}

export async function stopLocalDb(): Promise<void> {
  const s = server
  server = null
  await s?.stop().catch(() => {})
}
