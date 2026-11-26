import { useEffect, useMemo, useState } from 'react'
import { Database, Eye, Pencil, Play, Plus, RefreshCw, Search, Table2, Trash2 } from 'lucide-react'
import type { DbColumn, DbConnection, DbResult, DbTable } from '@shared/databases'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { usePersisted } from '@/lib/persist'
import { PageHeader } from '../PageHeader'
import { ProBadge, ProGate } from '../ProGate'
import { ConfirmDialog } from '../ConfirmDialog'
import { Marquee } from '../Marquee'
import { CodeEditor } from '../editor/CodeEditor'
import { Button } from '../../affect/button'
import { Dialog } from '../../affect/dialog'
import { EmptyState } from '../../affect/empty-state'
import { ListTable, type ListTableColumn } from '../../affect/list-table'
import { Pagination } from '../../affect/pagination'
import { SegmentedControl } from '../../affect/segmented-control'
import { Select } from '../../affect/select'
import { Switch } from '../../affect/switch'
import { TextField } from '../../affect/text-field'
import { TreeView, type TreeNode } from '../../affect/tree-view'
import { ContextMenu } from '../../affect/context-menu'
import { Spinner } from '../../affect/spinner'

type Props = { leftCollapsed: boolean; onExpandLeft: () => void }
type Row = { key: string; cells: (string | null)[] }

const errText = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** Database (Pro): the user's connections, their tables and rows, and a query editor. Agents reach them with db_* tools. */
export function DatabasePage({ leftCollapsed, onExpandLeft }: Props) {
  return (
    <>
      <PageHeader leftCollapsed={leftCollapsed} onExpandLeft={onExpandLeft}>
        <Database size={14} className="text-accent" />
        <span className="font-medium text-ink">{t('Database')}</span>
        <ProBadge />
      </PageHeader>
      <ProGate
        feature={t('Database')}
        description={t('Connect to your databases, local or remote: browse tables, edit rows and run queries. Your agents can query them too.')}
        preview={<Preview />}
      >
        {() => <Viewer />}
      </ProGate>
    </>
  )
}

function Preview() {
  return (
    <div className="flex h-full">
      <div className="w-[260px] border-r border-line p-3 text-[12.5px] text-dim">
        {['Production', 'Local'].map((n) => (
          <div key={n} className="rounded-md px-2 py-1.5">{n}</div>
        ))}
      </div>
      <div className="flex-1 p-4">
        <div className="h-full rounded-xl border border-line bg-raised" />
      </div>
    </div>
  )
}

function Viewer() {
  const [conns, setConns] = useState<DbConnection[] | null>(null)
  const [sel, setSel] = usePersisted<string | null>('database.connection', null)
  const [editing, setEditing] = useState<DbConnection | 'new' | null>(null)
  const [removing, setRemoving] = useState<DbConnection | null>(null)
  const load = () => void window.cm.databases.list().then(setConns)
  useEffect(load, [])
  const conn = conns?.find((c) => c.id === sel) ?? null

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-[260px] shrink-0 flex-col border-r border-line">
        <div className="flex h-10 items-center gap-1 pl-4 pr-2 text-[11px] font-medium text-mute">
          <span className="flex-1">{t('Connections')}</span>
          <Button size="sm" variant="ghost" icon={<Plus size={14} />} aria-label={t('New connection')} onClick={() => setEditing('new')} />
        </div>
        <ContextMenu
          aria-label={t('Connections')}
          items={(target) => {
            const c = conns?.find((x) => x.id === target.closest<HTMLElement>('[data-conn]')?.dataset.conn)
            if (!c) return [{ label: t('New connection'), icon: <Plus size={16} />, onSelect: () => setEditing('new') }]
            return [
              { label: t('Edit'), icon: <Pencil size={16} />, onSelect: () => setEditing(c) },
              { label: t('Delete'), icon: <Trash2 size={16} />, danger: true, onSelect: () => setRemoving(c) }
            ]
          }}
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2">
            {conns?.length === 0 && (
              <button
                onClick={() => setEditing('new')}
                className="mx-1 mt-1 flex items-center gap-2 rounded-xl border border-dashed border-line-strong px-3 py-3 text-left text-[12.5px] text-dim hover:border-white/25 hover:text-ink"
              >
                {t('Add your first connection')} <Plus size={14} />
              </button>
            )}
            {conns?.map((c) => (
              <div key={c.id} data-conn={c.id}>
                <button
                  onClick={() => setSel(c.id)}
                  onDoubleClick={() => setEditing(c)}
                  className={cn(
                    'conn-row flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px]',
                    c.id === sel ? 'bg-white/[.08] text-ink' : 'text-dim hover:bg-white/[.04] hover:text-ink'
                  )}
                >
                  <Database size={13} className="shrink-0 text-mute" />
                  <span className="min-w-0 flex-1">
                    <Marquee className="min-w-0" hoverTarget=".conn-row">{c.name}</Marquee>
                    <Marquee className="min-w-0 font-mono text-[10.5px] text-mute" hoverTarget=".conn-row">{`${c.host}:${c.port}/${c.database}`}</Marquee>
                  </span>
                </button>
                {c.id === sel && <Tables conn={c} />}
              </div>
            ))}
          </div>
        </ContextMenu>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        {conn ? (
          <Workspace key={conn.id} conn={conn} />
        ) : (
          <div className="grid flex-1 place-items-center p-6">
            <EmptyState
              title={conns?.length ? t('Pick a connection') : t('No connections yet')}
              text={t('Add a Postgres database, on this Mac or on a server, to browse it and query it.')}
              action={<Button icon={<Plus size={14} />} onClick={() => setEditing('new')}>{t('New connection')}</Button>}
            />
          </div>
        )}
      </main>
      {editing && (
        <ConnectionDialog
          conn={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(c) => {
            setEditing(null)
            setSel(c.id)
            load()
          }}
        />
      )}
      {removing && (
        <ConfirmDialog
          title={t('Delete {name}?', { name: removing.name })}
          danger
          confirmLabel={t('Delete')}
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await window.cm.databases.remove(removing.id)
            setRemoving(null)
            load()
          }}
        >
          {t('Only the connection goes, the database stays as it is.')}
        </ConfirmDialog>
      )}
    </div>
  )
}

/* The picked table, shared by the tree and the data view */
let pickTable: ((t: DbTable) => void) | null = null

function Tables({ conn }: { conn: DbConnection }) {
  const [list, setList] = useState<DbTable[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const load = () => {
    setError(null)
    setList(null)
    window.cm.databases.tables(conn.id).then(setList, (e) => setError(errText(e)))
  }
  useEffect(load, [conn.id])
  const items = useMemo<TreeNode[]>(() => {
    const s = q.trim().toLowerCase()
    const shown = (list ?? []).filter((x) => !s || `${x.schema}.${x.name}`.toLowerCase().includes(s))
    const schemas = [...new Set(shown.map((x) => x.schema))]
    const leaf = (x: DbTable): TreeNode => ({ id: `${x.schema}.${x.name}`, label: x.name, icon: x.type === 'view' ? <Eye size={13} /> : <Table2 size={13} /> })
    // One schema: its tables straight away; more: a folder each
    if (schemas.length <= 1) return shown.map(leaf)
    return schemas.map((sc) => ({ id: `schema:${sc}`, label: sc, children: shown.filter((x) => x.schema === sc).map(leaf) }))
  }, [list, q])

  return (
    <div className="mb-2 ml-3 border-l border-line pl-1.5 pt-1">
      <div className="flex items-center gap-1 pr-1">
        <TextField size="sm" prefix={<Search size={12} />} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Filter tables')} aria-label={t('Filter tables')} className="flex-1" />
        <Button size="sm" variant="ghost" icon={<RefreshCw size={13} />} aria-label={t('Reload')} onClick={load} />
      </div>
      {error ? (
        <p className="selectable px-2 py-2 text-[12px] text-bad">{error}</p>
      ) : !list ? (
        <div className="flex justify-center py-3"><Spinner size={13} /></div>
      ) : items.length === 0 ? (
        <p className="px-2 py-2 text-[12px] text-mute">{q ? t('No matching tables') : t('No tables')}</p>
      ) : (
        <TreeView
          items={items}
          selected={picked}
          onSelect={(id, node) => {
            if (node.children) return
            setPicked(id)
            const [schema, ...rest] = id.split('.')
            pickTable?.({ schema, name: rest.join('.'), type: 'table' })
          }}
        />
      )}
    </div>
  )
}

function Workspace({ conn }: { conn: DbConnection }) {
  const [tab, setTab] = usePersisted<'data' | 'query'>('database.tab', 'data')
  const [table, setTable] = useState<DbTable | null>(null)
  useEffect(() => {
    pickTable = (x) => {
      setTable(x)
      setTab('data')
    }
    return () => void (pickTable = null)
  }, [])
  return (
    <>
      <div className="flex h-11 shrink-0 items-center gap-3 border-b border-line px-4">
        <SegmentedControl
          size="sm"
          kind="tabs"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'data', label: t('Data'), icon: <Table2 size={13} /> },
            { value: 'query', label: t('Query'), icon: <Play size={13} /> }
          ]}
        />
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-mute">{tab === 'data' && table ? `${table.schema}.${table.name}` : conn.name}</span>
      </div>
      <div className={cn('min-h-0 flex-1 flex-col', tab === 'data' ? 'flex' : 'hidden')}>
        {table ? <TableData key={`${table.schema}.${table.name}`} conn={conn} table={table} /> : (
          <div className="grid flex-1 place-items-center p-6">
            <EmptyState bare title={t('Pick a table')} text={t('Its rows show here: double-click one to change it.')} />
          </div>
        )}
      </div>
      <div className={cn('min-h-0 flex-1 flex-col', tab === 'query' ? 'flex' : 'hidden')}>
        <QueryView conn={conn} />
      </div>
    </>
  )
}

const columnsOf = (r: DbResult): ListTableColumn<Row>[] =>
  r.columns.map((name, i) => ({
    id: `${i}:${name}`,
    label: name,
    sortable: true,
    value: (row) => row.cells[i] ?? '',
    render: (row) => (row.cells[i] === null ? <span className="italic text-mute">NULL</span> : <span className="font-mono text-[12px]">{row.cells[i]!.length > 200 ? row.cells[i]!.slice(0, 200) + '…' : row.cells[i]}</span>)
  }))
const rowsOf = (r: DbResult): Row[] => r.rows.map((cells, i) => ({ key: String(i), cells }))

function TableData({ conn, table }: { conn: DbConnection; table: DbTable }) {
  const [page, setPage] = useState(1)
  const [size, setSize] = usePersisted('database.pageSize', 50)
  const [data, setData] = useState<(DbResult & { total: number }) | null>(null)
  const [cols, setCols] = useState<DbColumn[]>([])
  const [error, setError] = useState<string | null>(null)
  const [edit, setEdit] = useState<Row | 'new' | null>(null)
  const load = () => {
    setError(null)
    window.cm.databases.rows(conn.id, table.schema, table.name, { limit: size, offset: (page - 1) * size }).then(setData, (e) => setError(errText(e)))
  }
  useEffect(load, [page, size])
  useEffect(() => void window.cm.databases.columns(conn.id, table.schema, table.name).then(setCols, () => setCols([])), [])

  if (error) return <p className="selectable m-4 rounded-lg bg-bad/10 px-3 py-2 text-[12.5px] text-bad">{error}</p>
  if (!data) return <div className="flex justify-center py-6"><Spinner size={14} /></div>
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <ListTable
          columns={columnsOf(data)}
          rows={rowsOf(data)}
          rowKey={(r) => r.key}
          pageSize={size}
          onRowDoubleClick={(r) => setEdit(r)}
          tools={<Button size="sm" variant="secondary" icon={<Plus size={13} />} onClick={() => setEdit('new')}>{t('Add row')}</Button>}
          empty={<EmptyState bare title={t('No rows')} />}
        />
      </div>
      <div className="shrink-0 border-t border-line px-4 py-2">
        <Pagination page={page} onPageChange={setPage} total={data.total} pageSize={size} pageSizes={[25, 50, 100, 250]} onPageSizeChange={(n) => (setSize(n), setPage(1))} />
      </div>
      {edit && (
        <RowDialog
          conn={conn}
          table={table}
          cols={cols}
          names={data.columns}
          row={edit === 'new' ? null : edit.cells}
          onClose={() => setEdit(null)}
          onDone={() => {
            setEdit(null)
            load()
          }}
        />
      )}
    </div>
  )
}

/** One row: change it (found by its primary key, or by all its values), delete it, or a new one. */
function RowDialog({ conn, table, cols, names, row, onClose, onDone }: {
  conn: DbConnection; table: DbTable; cols: DbColumn[]; names: string[]; row: (string | null)[] | null; onClose: () => void; onDone: () => void
}) {
  const fields = cols.length ? cols : names.map((name) => ({ name, type: '', nullable: true, default: null, pk: false }))
  const start = (name: string) => (row ? row[names.indexOf(name)] ?? null : null)
  const [vals, setVals] = useState<Record<string, string | null>>(() => Object.fromEntries(fields.map((f) => [f.name, start(f.name)])))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const pks = fields.filter((f) => f.pk)
  const key = () => Object.fromEntries((pks.length ? pks : fields).map((f) => [f.name, start(f.name)]))
  const go = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      onDone()
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }
  const save = () =>
    go(async () => {
      if (!row) {
        // A new row: empty fields are left to the column's default
        const v = Object.fromEntries(Object.entries(vals).filter(([, x]) => x !== null && x !== ''))
        return window.cm.databases.insert(conn.id, table.schema, table.name, v)
      }
      const changed = Object.fromEntries(Object.entries(vals).filter(([k, x]) => x !== start(k)))
      if (!Object.keys(changed).length) return
      return window.cm.databases.update(conn.id, table.schema, table.name, key(), changed)
    })

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={row ? t('Edit row') : t('New row')}
      description={`${table.schema}.${table.name}`}
      size="md"
      closeButton
      footer={
        <div className="flex w-full items-center gap-2">
          {row && <Button variant="ghost" icon={<Trash2 size={14} />} className="text-bad" onClick={() => setDeleting(true)}>{t('Delete')}</Button>}
          <span className="flex-1" />
          <Button variant="secondary" onClick={onClose}>{t('Cancel')}</Button>
          <Button loading={busy} onClick={() => void save()}>{row ? t('Save') : t('Add')}</Button>
        </div>
      }
    >
      <div className="flex max-h-[55vh] flex-col gap-3 overflow-y-auto pr-1">
        {error && <p className="selectable rounded-lg bg-bad/10 px-3 py-2 text-[12.5px] text-bad">{error}</p>}
        {fields.map((f) => (
          <div key={f.name} className="flex items-end gap-2">
            <TextField
              className="flex-1"
              size="sm"
              label={<span className="font-mono">{f.name}{f.pk ? ' 🔑' : ''} <span className="text-mute">{f.type}</span></span>}
              value={vals[f.name] ?? ''}
              placeholder={vals[f.name] === null ? (row ? 'NULL' : f.default ? t('Default: {value}', { value: f.default }) : 'NULL') : ''}
              onChange={(e) => setVals((v) => ({ ...v, [f.name]: e.target.value }))}
            />
            {f.nullable && (
              <Button size="sm" variant={vals[f.name] === null ? 'secondary' : 'ghost'} onClick={() => setVals((v) => ({ ...v, [f.name]: null }))}>
                NULL
              </Button>
            )}
          </div>
        ))}
      </div>
      {deleting && (
        <ConfirmDialog
          title={t('Delete this row?')}
          danger
          confirmLabel={t('Delete')}
          onClose={() => setDeleting(false)}
          onConfirm={() => go(() => window.cm.databases.deleteRow(conn.id, table.schema, table.name, key()))}
        >
          {t('It cannot be undone.')}
        </ConfirmDialog>
      )}
    </Dialog>
  )
}

function QueryView({ conn }: { conn: DbConnection }) {
  const [sql, setSql] = usePersisted(`database.sql.${conn.id}`, 'select now();')
  const [res, setRes] = useState<DbResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const runIt = async () => {
    if (busy || !sql.trim()) return
    setBusy(true)
    setError(null)
    try {
      setRes(await window.cm.databases.query(conn.id, sql))
    } catch (e) {
      setRes(null)
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="h-[38%] min-h-[120px] shrink-0 border-b border-line"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault()
            void runIt()
          }
        }}
      >
        <CodeEditor value={sql} onChange={setSql} filename="query.sql" onSave={() => void runIt()} className="h-full" />
      </div>
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-line px-4">
        <Button size="sm" loading={busy} icon={<Play size={13} />} onClick={() => void runIt()}>{t('Run')} <span className="text-[11px] opacity-60">⌘↵</span></Button>
        {res && (
          <span className="text-[12px] text-mute">
            {t('{command} · {n} rows · {ms} ms', { command: res.command || '—', n: res.rowCount ?? res.rows.length, ms: res.ms })}
            {res.truncated && ` · ${t('first 1000 shown')}`}
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {error ? (
          <p className="selectable rounded-lg bg-bad/10 px-3 py-2 font-mono text-[12px] text-bad">{error}</p>
        ) : res && res.columns.length ? (
          <ListTable columns={columnsOf(res)} rows={rowsOf(res)} rowKey={(r) => r.key} pageSize={50} />
        ) : res ? (
          <p className="text-[12.5px] text-dim">{t('Done: {command} {n}', { command: res.command, n: res.rowCount ?? 0 })}</p>
        ) : (
          <p className="text-[12.5px] text-mute">{t('Write SQL above and run it with ⌘↵.')}</p>
        )}
      </div>
    </div>
  )
}

const EMPTY: DbConnection = { id: '', name: '', kind: 'postgres', host: 'localhost', port: 5432, database: 'postgres', user: 'postgres', ssl: false, agents: 'read' }

/** postgres://user:pass@host:port/db?sslmode=require → the fields (and the password) */
function parseUrl(s: string): (Partial<DbConnection> & { password?: string }) | null {
  try {
    const u = new URL(s.trim())
    if (!/^postgres(ql)?:$/.test(u.protocol)) return null
    return {
      host: u.hostname,
      port: Number(u.port) || 5432,
      database: decodeURIComponent(u.pathname.replace(/^\//, '')) || 'postgres',
      user: decodeURIComponent(u.username),
      password: u.password ? decodeURIComponent(u.password) : undefined,
      ssl: /require|verify/.test(u.searchParams.get('sslmode') ?? '')
    }
  } catch {
    return null
  }
}

function ConnectionDialog({ conn, onClose, onSaved }: { conn: DbConnection | null; onClose: () => void; onSaved: (c: DbConnection) => void }) {
  const [c, setC] = useState<DbConnection>(conn ?? EMPTY)
  const [password, setPassword] = useState<string | undefined>(undefined)
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState<'test' | 'save' | null>(null)
  const set = (p: Partial<DbConnection>) => setC((x) => ({ ...x, ...p }))

  const test = async () => {
    setBusy('test')
    setStatus(null)
    try {
      setStatus({ ok: true, text: t('Connected: {version}', { version: await window.cm.databases.test(c, password) }) })
    } catch (e) {
      setStatus({ ok: false, text: errText(e) })
    } finally {
      setBusy(null)
    }
  }
  const save = async () => {
    setBusy('save')
    setStatus(null)
    try {
      onSaved(await window.cm.databases.save(c, password))
    } catch (e) {
      setStatus({ ok: false, text: errText(e) })
      setBusy(null)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={conn ? t('Edit {name}', { name: conn.name }) : t('New connection')}
      size="md"
      closeButton
      footer={
        <div className="flex w-full items-center gap-2">
          <Button variant="secondary" loading={busy === 'test'} onClick={() => void test()}>{t('Test')}</Button>
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
          <Button loading={busy === 'save'} onClick={() => void save()}>{t('Save')}</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <TextField
          size="sm"
          label={t('Connection URL')}
          optional
          placeholder="postgres://user:password@host:5432/database"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value)
            const p = parseUrl(e.target.value)
            if (!p) return
            const { password: pw, ...rest } = p
            set(rest)
            if (pw !== undefined) setPassword(pw)
          }}
        />
        <TextField size="sm" label={t('Name')} value={c.name} onChange={(e) => set({ name: e.target.value })} placeholder={t('e.g. Production')} />
        <div className="flex gap-2">
          <TextField size="sm" className="flex-1" label={t('Host')} value={c.host} onChange={(e) => set({ host: e.target.value })} />
          <TextField size="sm" className="w-24" label={t('Port')} inputMode="numeric" value={String(c.port)} onChange={(e) => set({ port: Number(e.target.value.replace(/\D/g, '')) || 0 })} />
        </div>
        <TextField size="sm" label={t('Database')} value={c.database} onChange={(e) => set({ database: e.target.value })} />
        <div className="flex gap-2">
          <TextField size="sm" className="flex-1" label={t('User')} value={c.user} onChange={(e) => set({ user: e.target.value })} />
          <TextField
            size="sm"
            className="flex-1"
            type="password"
            label={t('Password')}
            value={password ?? ''}
            placeholder={conn?.hasPassword && password === undefined ? t('Saved') : ''}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <Switch label={t('SSL')} checked={c.ssl} onChange={(e) => set({ ssl: e.target.checked })} />
        <Select
          size="sm"
          label={t('Agents')}
          value={c.agents}
          onChange={(v) => set({ agents: v as DbConnection['agents'] })}
          options={[
            { value: 'read', label: t('Can read') },
            { value: 'write', label: t('Can read and write') },
            { value: 'off', label: t('No access') }
          ]}
        />
        {status && <p className={cn('selectable rounded-lg px-3 py-2 text-[12.5px]', status.ok ? 'bg-ok/10 text-ok' : 'bg-bad/10 text-bad')}>{status.text}</p>}
      </div>
    </Dialog>
  )
}
