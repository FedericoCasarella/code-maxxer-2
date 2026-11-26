import pg from 'pg'
import { randomUUID } from 'node:crypto'
import { db } from '../db'
import { decrypt, encrypt } from '../recon/secrets'
import type { DbColumn, DbConnection, DbResult, DbRowsQuery, DbTable } from '@shared/databases'

/*
 * Database viewer (Pro): the user's connections (setting "databases", passwords AES-encrypted with the app's master
 * key, never sent to the window or to agents), one small pool each, and the reads and writes the page and the
 * agents' db_* tools make. Postgres for now.
 */
type Stored = DbConnection & { secret?: string | null }
const MAX_ROWS = 1000
const pools = new Map<string, pg.Pool>()

async function stored(): Promise<Stored[]> {
  return (await db.getSetting<Stored[]>('databases')) ?? []
}
const pub = ({ secret, ...c }: Stored): DbConnection => ({ ...c, hasPassword: !!secret })

export async function listConnections(): Promise<DbConnection[]> {
  return (await stored()).map(pub)
}

function clean(c: DbConnection): DbConnection {
  const name = String(c.name ?? '').trim()
  if (!name) throw new Error('Give the connection a name')
  if (!String(c.host ?? '').trim()) throw new Error('Give the host')
  return {
    id: c.id || 'db_' + randomUUID().slice(0, 8),
    name,
    kind: 'postgres',
    host: c.host.trim(),
    port: Number(c.port) || 5432,
    database: String(c.database ?? '').trim() || 'postgres',
    user: String(c.user ?? '').trim(),
    ssl: !!c.ssl,
    agents: c.agents === 'off' || c.agents === 'write' ? c.agents : 'read'
  }
}

export async function saveConnection(c: DbConnection, password?: string): Promise<DbConnection> {
  const all = await stored()
  const next = clean(c)
  const old = all.find((x) => x.id === next.id)
  const secret = password === undefined ? (old?.secret ?? null) : password ? encrypt(password) : null
  const row: Stored = { ...next, secret }
  await db.setSetting('databases', old ? all.map((x) => (x.id === row.id ? row : x)) : [...all, row])
  await dropPool(row.id)
  return pub(row)
}

export async function removeConnection(id: string): Promise<void> {
  await db.setSetting('databases', (await stored()).filter((x) => x.id !== id))
  await dropPool(id)
}

async function dropPool(id: string) {
  const p = pools.get(id)
  pools.delete(id)
  await p?.end().catch(() => {})
}

const config = (c: DbConnection, password: string | null): pg.PoolConfig => ({
  host: c.host,
  port: c.port,
  database: c.database,
  user: c.user || undefined,
  password: password ?? undefined,
  ssl: c.ssl ? { rejectUnauthorized: false } : undefined,
  connectionTimeoutMillis: 8000,
  statement_timeout: 30000,
  idleTimeoutMillis: 30000,
  max: 3,
  application_name: 'code-maxxer'
})

async function pool(id: string): Promise<{ pool: pg.Pool; conn: Stored }> {
  const conn = (await stored()).find((x) => x.id === id)
  if (!conn) throw new Error('Connection not found')
  let p = pools.get(id)
  if (!p) {
    p = new pg.Pool(config(conn, decrypt(conn.secret)))
    // A dropped connection must not take the app down
    p.on('error', () => {})
    pools.set(id, p)
  }
  return { pool: p, conn }
}

export async function testConnection(c: DbConnection, password?: string): Promise<string> {
  const conn = clean(c)
  const old = (await stored()).find((x) => x.id === c.id)
  const pass = password !== undefined ? password || null : decrypt(old?.secret)
  const client = new pg.Client(config(conn, pass))
  client.on('error', () => {})
  try {
    await client.connect()
    const r = await client.query('select version() as v')
    return String(r.rows[0]?.v ?? '').split(',')[0]
  } finally {
    await client.end().catch(() => {})
  }
}

/** A cell as text: dates as ISO, bytes as hex (cut), objects and arrays as JSON. */
function cell(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return isNaN(v.getTime()) ? String(v) : v.toISOString()
  if (Buffer.isBuffer(v)) return '\\x' + v.subarray(0, 64).toString('hex') + (v.length > 64 ? '…' : '')
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function result(r: pg.QueryArrayResult, t0: number): DbResult {
  const rows = (r.rows ?? []).slice(0, MAX_ROWS).map((row) => row.map(cell))
  return {
    columns: (r.fields ?? []).map((f) => f.name),
    rows,
    rowCount: r.rowCount ?? null,
    command: r.command ?? '',
    ms: Date.now() - t0,
    truncated: (r.rows?.length ?? 0) > MAX_ROWS
  }
}

/** One statement or several (the last one's result comes back); read-only runs inside a transaction that can't write. */
async function run(id: string, sql: string, params: unknown[] = [], readOnly = false): Promise<DbResult> {
  const { pool: p } = await pool(id)
  const client = await p.connect()
  const t0 = Date.now()
  try {
    if (readOnly) await client.query('begin transaction read only')
    const r = (await client.query({ text: sql, values: params, rowMode: 'array' })) as unknown as pg.QueryArrayResult | pg.QueryArrayResult[]
    if (readOnly) await client.query('rollback')
    return result(Array.isArray(r) ? r[r.length - 1] : r, t0)
  } catch (e) {
    if (readOnly) await client.query('rollback').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

const ident = (s: string) => '"' + String(s).replace(/"/g, '""') + '"'
const qualified = (schema: string, table: string) => `${ident(schema)}.${ident(table)}`

export async function tables(id: string): Promise<DbTable[]> {
  const r = await run(
    id,
    `select table_schema, table_name, table_type from information_schema.tables
     where table_schema not in ('pg_catalog', 'information_schema') and table_schema not like 'pg_toast%'
     order by table_schema = 'public' desc, table_schema, table_name`
  )
  return r.rows.map(([schema, name, type]) => ({ schema: schema!, name: name!, type: type === 'VIEW' ? 'view' : 'table' }))
}

export async function columns(id: string, schema: string, table: string): Promise<DbColumn[]> {
  const r = await run(
    id,
    `select c.column_name, c.data_type, c.is_nullable, c.column_default,
       exists (select 1 from information_schema.table_constraints tc
               join information_schema.key_column_usage k on k.constraint_name = tc.constraint_name and k.table_schema = tc.table_schema and k.table_name = tc.table_name
               where tc.constraint_type = 'PRIMARY KEY' and tc.table_schema = c.table_schema and tc.table_name = c.table_name and k.column_name = c.column_name)::text
     from information_schema.columns c where c.table_schema = $1 and c.table_name = $2 order by c.ordinal_position`,
    [schema, table]
  )
  return r.rows.map(([name, type, nullable, def, pk]) => ({ name: name!, type: type!, nullable: nullable === 'YES', default: def, pk: pk === 'true' }))
}

export async function rows(id: string, schema: string, table: string, q: DbRowsQuery): Promise<DbResult & { total: number }> {
  const limit = Math.min(Math.max(1, Number(q.limit) || 50), 500)
  const offset = Math.max(0, Number(q.offset) || 0)
  const order = q.orderBy ? ` order by ${ident(q.orderBy)} ${q.desc ? 'desc' : 'asc'} nulls last` : ''
  const data = await run(id, `select * from ${qualified(schema, table)}${order} limit ${limit} offset ${offset}`)
  const count = await run(id, `select count(*) from ${qualified(schema, table)}`).catch(() => null)
  return { ...data, total: Number(count?.rows[0]?.[0] ?? data.rows.length) }
}

export const query = (id: string, sql: string) => run(id, sql)

const where = (key: Record<string, string | null>, from: number) => {
  const parts: string[] = []
  const values: unknown[] = []
  for (const [k, v] of Object.entries(key)) {
    if (v === null) parts.push(`${ident(k)} is null`)
    else {
      values.push(v)
      parts.push(`${ident(k)}::text = $${from + values.length}`)
    }
  }
  if (!parts.length) throw new Error('The row has no key to find it by')
  return { sql: parts.join(' and '), values }
}

export async function insertRow(id: string, schema: string, table: string, values: Record<string, string | null>): Promise<DbResult> {
  const cols = Object.keys(values)
  if (!cols.length) return run(id, `insert into ${qualified(schema, table)} default values returning *`)
  return run(
    id,
    `insert into ${qualified(schema, table)} (${cols.map(ident).join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning *`,
    cols.map((c) => values[c])
  )
}

/** Changes one row, found by its key (the primary key, or every column when the table has none); one row at most. */
export async function updateRow(id: string, schema: string, table: string, key: Record<string, string | null>, values: Record<string, string | null>): Promise<DbResult> {
  const cols = Object.keys(values)
  if (!cols.length) throw new Error('Nothing to change')
  const w = where(key, cols.length)
  const target = `select ctid from ${qualified(schema, table)} where ${w.sql} limit 1`
  return run(
    id,
    `update ${qualified(schema, table)} set ${cols.map((c, i) => `${ident(c)} = $${i + 1}`).join(', ')} where ctid = (${target}) returning *`,
    [...cols.map((c) => values[c]), ...w.values]
  )
}

export async function deleteRow(id: string, schema: string, table: string, key: Record<string, string | null>): Promise<DbResult> {
  const w = where(key, 0)
  return run(id, `delete from ${qualified(schema, table)} where ctid = (select ctid from ${qualified(schema, table)} where ${w.sql} limit 1) returning *`, w.values)
}

/* ---- Agents (db_* tools) ---- */

async function forAgent(name: string, need: 'read' | 'write' = 'read'): Promise<Stored> {
  const all = await stored()
  const c = all.find((x) => x.name.toLowerCase() === String(name ?? '').trim().toLowerCase() || x.id === name)
  if (!c) throw new Error(`No connection "${name}". Connections: ${all.filter((x) => x.agents !== 'off').map((x) => x.name).join(', ') || 'none'}`)
  if (c.agents === 'off') throw new Error(`The user turned agents off for "${c.name}"`)
  if (need === 'write' && c.agents !== 'write') throw new Error(`"${c.name}" is read-only for agents`)
  return c
}

const table = (r: DbResult, max = 200) => {
  if (!r.columns.length) return `${r.command} ${r.rowCount ?? ''}`.trim()
  const lines = [r.columns.join('\t'), ...r.rows.slice(0, max).map((row) => row.map((v) => (v === null ? 'NULL' : v.replace(/\s+/g, ' ').slice(0, 300))).join('\t'))]
  const more = r.rows.length > max || r.truncated ? `\n… ${r.rowCount ?? r.rows.length} rows in all, ${max} shown: add a LIMIT or a WHERE` : ''
  return lines.join('\n') + more + `\n(${r.command} ${r.rowCount ?? ''}, ${r.ms} ms)`
}

export async function agentList(): Promise<string> {
  const all = (await stored()).filter((c) => c.agents !== 'off')
  if (!all.length) return 'No database connections are shared with agents. The user adds them in Database (left sidebar).'
  return all.map((c) => `- ${c.name}: postgres ${c.host}:${c.port}/${c.database} (${c.agents === 'write' ? 'read and write' : 'read only'})`).join('\n')
}

export async function agentSchema(name: string, tableName?: string): Promise<string> {
  const c = await forAgent(name)
  if (tableName) {
    const [schema, t] = tableName.includes('.') ? tableName.split('.', 2) : ['public', tableName]
    const cols = await columns(c.id, schema, t)
    if (!cols.length) throw new Error(`No table ${schema}.${t}`)
    return cols.map((x) => `${x.name} ${x.type}${x.pk ? ' PRIMARY KEY' : ''}${x.nullable ? '' : ' NOT NULL'}${x.default ? ` DEFAULT ${x.default}` : ''}`).join('\n')
  }
  return (await tables(c.id)).map((x) => `${x.schema}.${x.name}${x.type === 'view' ? ' (view)' : ''}`).join('\n')
}

export async function agentQuery(name: string, sql: string, write: boolean): Promise<string> {
  const c = await forAgent(name, write ? 'write' : 'read')
  return table(await run(c.id, sql, [], !write))
}
