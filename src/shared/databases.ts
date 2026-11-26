/** Database viewer (Pro): the user's database connections, browsed and queried in the app and by the agents. */
export type DbKind = 'postgres'
/** What agents may do on a connection: nothing, read (queries run in a read-only transaction), or anything */
export type DbAgentAccess = 'off' | 'read' | 'write'
export type DbConnection = {
  id: string
  name: string
  kind: DbKind
  host: string
  port: number
  database: string
  user: string
  ssl: boolean
  agents: DbAgentAccess
  /** A password is saved (it never leaves the main process) */
  hasPassword?: boolean
}
export type DbTable = { schema: string; name: string; type: 'table' | 'view' }
export type DbColumn = { name: string; type: string; nullable: boolean; default: string | null; pk: boolean }
/** Cells as text (null stays null), so any value reaches the window and the agents the same way */
export type DbResult = {
  columns: string[]
  rows: (string | null)[][]
  /** Rows the statement touched or returned */
  rowCount: number | null
  command: string
  ms: number
  /** More rows than were sent */
  truncated: boolean
}
export type DbRowsQuery = { limit: number; offset: number; orderBy?: string; desc?: boolean }
export type DbApi = {
  list(): Promise<DbConnection[]>
  /** password: undefined keeps the saved one, '' removes it */
  save(c: DbConnection, password?: string): Promise<DbConnection>
  remove(id: string): Promise<void>
  /** Tries the connection (the saved password when none is given): the server version */
  test(c: DbConnection, password?: string): Promise<string>
  tables(id: string): Promise<DbTable[]>
  columns(id: string, schema: string, table: string): Promise<DbColumn[]>
  rows(id: string, schema: string, table: string, q: DbRowsQuery): Promise<DbResult & { total: number }>
  query(id: string, sql: string): Promise<DbResult>
  insert(id: string, schema: string, table: string, values: Record<string, string | null>): Promise<DbResult>
  update(id: string, schema: string, table: string, key: Record<string, string | null>, values: Record<string, string | null>): Promise<DbResult>
  deleteRow(id: string, schema: string, table: string, key: Record<string, string | null>): Promise<DbResult>
}
