import { Children, isValidElement, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { BookOpen, ChevronDown, FileText, History, Folder, FolderOpen, PenLine } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { DocsExportLabels, DocsNode, DocsRevision, DocsState } from '@shared/docs'
import { actions } from '@/lib/store'
import { locale, t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { usePersisted } from '@/lib/persist'
import { PageHeader } from '../PageHeader'
import { ProBadge, ProGate } from '../ProGate'
import { ProjectPicker, usePickedProject } from '../ProjectPicker'
import { SwitchCallout } from '../SwitchCallout'
import { Button } from '../../affect/button'
import { EmptyState } from '../../affect/empty-state'
import { TreeView, type TreeNode } from '../../affect/tree-view'
import { Skeleton } from '../../affect/shimmer-loader'
import { DropdownMenu } from '../../affect/dropdown-menu'
import { Popover } from '../../affect/popover'

type Props = { leftCollapsed: boolean; onExpandLeft: () => void }
type Heading = { id: string; text: string; level: 2 | 3 }

/** Documentation (Pro): the user manual of each project, written and kept up to date by an agent, committed in docs/manual/. */
export function DocsPage({ leftCollapsed, onExpandLeft }: Props) {
  return (
    <>
      <PageHeader leftCollapsed={leftCollapsed} onExpandLeft={onExpandLeft}>
        <BookOpen size={14} className="text-accent" />
        <span className="font-medium text-ink">{t('Documentation')}</span>
        <ProBadge />
      </PageHeader>
      <ProGate
        feature={t('Documentation')}
        description={t('A user manual for each project, in simple words and with screenshots, committed in the repository and updated by an agent after every pipeline run.')}
        preview={<Reader tree={DEMO_TREE} page={DEMO_PAGE} revisions={DEMO_REVS} selected="01-getting-started/01-first-steps.md" onSelect={() => {}} asset={async () => null} />}
      >
        {() => <Docs />}
      </ProGate>
    </>
  )
}

function Docs() {
  const [pid, setPid] = usePickedProject()
  const [state, setState] = useState<DocsState | null>(null)
  const [selected, setSelected] = usePersisted<string | null>(`docs.page.${pid}`, null)
  const [page, setPage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = () => pid && void window.cm.docs.state(pid).then(setState)
  useEffect(() => {
    setState(null)
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid])
  // The page shown: the one picked, or the first of the manual
  const first = useMemo(() => (state ? firstPage(state.tree) : null), [state])
  const current = state && selected && hasPage(state.tree, selected) ? selected : first
  const [revs, setRevs] = useState<DocsRevision[] | null>(null)
  useEffect(() => {
    setPage(null)
    setRevs(null)
    if (pid && current) {
      void window.cm.docs.page(pid, current).then(setPage).catch(() => setPage(''))
      void window.cm.docs.revisions(pid, current).then(setRevs).catch(() => setRevs([]))
    }
  }, [pid, current])

  const write = async () => {
    if (!pid) return
    setBusy(true)
    try {
      actions.selectWorkspace(await window.cm.docs.write(pid))
    } finally {
      setBusy(false)
    }
  }

  const [saving, setSaving] = useState<'md' | 'pdf' | null>(null)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const exporting = async (kind: 'md' | 'pdf') => {
    if (!pid || !state) return
    setSaving(kind)
    setNote(null)
    try {
      const file = kind === 'md' ? await window.cm.docs.exportMarkdown(pid, labels()) : await window.cm.docs.exportPdf(pid, await manualHtml(pid, state.tree))
      if (file) setNote({ ok: true, text: t('Saved to {file}', { file }) })
    } catch (e) {
      setNote({ ok: false, text: (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
    } finally {
      setSaving(null)
    }
  }

  if (!pid)
    return (
      <div className="grid flex-1 place-items-center">
        <EmptyState title={t('No project')} text={t('Add a project to write its manual.')} />
      </div>
    )
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-6 py-3">
        <ProjectPicker value={pid} onChange={(v) => v && setPid(v)} />
        <div className="flex-1" />
        {!!state?.tree.length && (
          <DropdownMenu
            align="end"
            width={200}
            items={[
              { label: 'Markdown', description: t('One .md file and its images'), onSelect: () => void exporting('md') },
              { label: 'PDF', description: t('Every page, ready to print'), onSelect: () => void exporting('pdf') }
            ]}
            trigger={({ triggerProps }) => (
              <Button {...triggerProps} size="sm" variant="secondary" loading={!!saving} iconRight={<ChevronDown size={13} />}>
                {t('Export')}
              </Button>
            )}
          />
        )}
        {state?.exists && (
          <Button size="sm" variant="secondary" iconRight={<PenLine size={13} />} loading={busy} onClick={() => void write()}>
            {t('Update now')}
          </Button>
        )}
      </div>
      {note && <p className={cn('px-6 pt-2 text-[12px]', note.ok ? 'text-dim' : 'text-bad')}>{note.text}</p>}
      <div className="px-6 pt-3">
        <SwitchCallout
          title={t('Auto-documentation')}
          description={t('After every pipeline run, an agent updates the user manual of this project on the same branch: simple words, screenshots, committed in docs/manual/.')}
          checked={!!state?.enabled}
          disabled={!state}
          onChange={(on) => pid && void window.cm.docs.setEnabled(pid, on).then(load)}
        />
      </div>
      {!state ? (
        <div className="space-y-3 px-6 pt-4">
          <Skeleton width="100%" height={420} radius={14} />
        </div>
      ) : !state.tree.length ? (
        <div className="grid flex-1 place-items-center px-6">
          <EmptyState
            icon={<BookOpen size={20} />}
            title={t('No manual yet')}
            text={t('An agent writes it on a branch of its own: what the app is for, how to start, every feature, with screenshots. You review it and merge it.')}
            action={
              <Button size="sm" iconRight={<PenLine size={13} />} loading={busy} onClick={() => void write()}>
                {t('Write the manual')}
              </Button>
            }
          />
        </div>
      ) : (
        <Reader tree={state.tree} page={page} revisions={revs} selected={current} onSelect={setSelected} asset={(p) => window.cm.docs.asset(pid, p)} />
      )}
    </div>
  )
}

/** The manual: its pages on the left, the page in the middle, the page's sections on the right (they follow the scroll). */
function Reader({ tree, page, revisions, selected, onSelect, asset }: { tree: DocsNode[]; page: string | null; revisions: DocsRevision[] | null; selected: string | null; onSelect: (id: string) => void; asset: (path: string) => Promise<string | null> }) {
  const scroller = useRef<HTMLDivElement>(null)
  const headings = useMemo(() => (page ? headingsOf(page) : []), [page])
  const [active, setActive] = useState<string | null>(null)
  const items = useMemo(() => toTree(tree), [tree])
  const folders = useMemo(() => foldersOf(tree), [tree])

  // Spyscroll: the last section whose title has gone past the top
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    el.scrollTop = 0
    const spy = () => {
      let id = headings[0]?.id ?? null
      for (const h of headings) {
        const node = el.querySelector<HTMLElement>(`#${CSS.escape(h.id)}`)
        if (node && node.offsetTop - el.offsetTop <= el.scrollTop + 24) id = h.id
      }
      // At the bottom of the page: its last section, even when it's too short to reach the top
      if (headings.length && el.scrollTop > 0 && el.scrollTop + el.clientHeight >= el.scrollHeight - 4) id = headings[headings.length - 1].id
      setActive(id)
    }
    spy()
    el.addEventListener('scroll', spy, { passive: true })
    return () => el.removeEventListener('scroll', spy)
  }, [headings])

  const go = (id: string) => scroller.current?.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const dir = selected?.includes('/') ? selected.slice(0, selected.lastIndexOf('/')) : ''
  const heading = (level: 2 | 3) =>
    function H({ children }: { children?: ReactNode }) {
      const id = slug(textOf(children))
      return level === 2 ? <h2 id={id}>{children}</h2> : <h3 id={id}>{children}</h3>
    }

  return (
    <div className="flex min-h-0 flex-1">
      <nav className="w-64 shrink-0 overflow-y-auto border-r border-line px-2 py-3" aria-label={t('Pages')}>
        <TreeView items={items} defaultExpanded={folders} selected={selected} onSelect={(id, n) => !n.children && onSelect(id)} aria-label={t('Pages')} />
      </nav>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        <article className="prose-doc selectable mx-auto max-w-[760px] px-8 pb-24 pt-6">
          {page === null ? (
            <Skeleton width="100%" height={320} radius={12} />
          ) : (
            <Markdown
              remarkPlugins={[remarkGfm]}
              components={{
                h1: ({ children }) => (
                  <>
                    <h1>{children}</h1>
                    <Revisions list={revisions} />
                  </>
                ),
                h2: heading(2),
                h3: heading(3),
                img: ({ src, alt }) => <DocImage src={String(src ?? '')} alt={alt ?? ''} dir={dir} asset={asset} />,
                a: ({ href, children }) => {
                  const target = href && !/^[a-z]+:/i.test(href) && /\.md(#.*)?$/i.test(href) ? join(dir, href.replace(/#.*$/, '')) : null
                  return target ? (
                    <a href="#" onClick={(e) => (e.preventDefault(), onSelect(target))}>{children}</a>
                  ) : (
                    <a href={href} target="_blank" rel="noreferrer">{children}</a>
                  )
                }
              }}
            >
              {page}
            </Markdown>
          )}
        </article>
      </div>
      {headings.length > 1 && (
        <aside className="hidden w-56 shrink-0 overflow-y-auto py-6 pr-4 xl:block" aria-label={t('On this page')}>
          <div className="pb-2 text-[11.5px] font-medium uppercase tracking-wide text-mute">{t('On this page')}</div>
          <ul className="border-l border-line">
            {headings.map((h) => (
              <li key={h.id}>
                <button
                  onClick={() => go(h.id)}
                  className={cn(
                    '-ml-px block w-full truncate border-l py-1 text-left text-[12.5px] transition-colors',
                    h.level === 3 ? 'pl-6' : 'pl-3',
                    active === h.id ? 'border-accent text-ink' : 'border-transparent text-dim hover:text-ink'
                  )}
                >
                  {h.text}
                </button>
              </li>
            ))}
          </ul>
        </aside>
      )}
    </div>
  )
}

/** An image of the manual, loaded from the repository. */
function DocImage({ src, alt, dir, asset }: { src: string; alt: string; dir: string; asset: (path: string) => Promise<string | null> }) {
  const [url, setUrl] = useState<string | null>(/^(https?|data):/.test(src) ? src : null)
  useEffect(() => {
    if (/^(https?|data):/.test(src)) return
    void asset(join(dir, src)).then(setUrl)
  }, [src, dir])
  return url ? <img src={url} alt={alt} /> : <span className="block h-40 rounded-lg border border-line bg-panel" aria-label={alt} />
}

const slug = (s: string) => 'h-' + s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const textOf = (n: ReactNode): string =>
  typeof n === 'string' || typeof n === 'number' ? String(n) : Array.isArray(n) ? n.map(textOf).join('') : isValidElement(n) ? textOf((n.props as { children?: ReactNode }).children) : Children.toArray(n).map(textOf).join('')
/** The "## " and "### " titles of a page, outside code blocks. */
function headingsOf(md: string): Heading[] {
  let code = false
  const out: Heading[] = []
  for (const line of md.split('\n')) {
    if (/^\s*```/.test(line)) code = !code
    const m = !code && line.match(/^(##|###)\s+(.+?)\s*#*\s*$/)
    if (m) {
      const text = m[2].replace(/[*_`]/g, '')
      out.push({ id: slug(text), text, level: m[1].length as 2 | 3 })
    }
  }
  return out
}
/** "a/b" + "../images/x.png" → "images/x.png" (paths inside the manual). */
function join(dir: string, rel: string): string {
  const parts = dir ? dir.split('/') : []
  for (const p of rel.split('/')) {
    if (p === '..') parts.pop()
    else if (p && p !== '.') parts.push(p)
  }
  return parts.join('/')
}
const toTree = (nodes: DocsNode[]): TreeNode[] =>
  nodes.map((n) =>
    n.children
      ? { id: n.id, label: n.label, icon: <Folder size={14} />, openIcon: <FolderOpen size={14} />, children: toTree(n.children) }
      : { id: n.id, label: n.label, icon: <FileText size={14} /> }
  )
const foldersOf = (nodes: DocsNode[]): string[] => nodes.flatMap((n) => (n.children ? [n.id, ...foldersOf(n.children)] : []))
const firstPage = (nodes: DocsNode[]): string | null => {
  for (const n of nodes) {
    const p = n.children ? firstPage(n.children) : n.id
    if (p) return p
  }
  return null
}
const hasPage = (nodes: DocsNode[], id: string): boolean => nodes.some((n) => (n.children ? hasPage(n.children, id) : n.id === id))

const DEMO_TREE: DocsNode[] = [
  { id: '01-getting-started', label: 'Getting started', children: [{ id: '01-getting-started/01-first-steps.md', label: 'First steps' }, { id: '01-getting-started/02-login.md', label: 'Log in' }] },
  { id: '02-projects', label: 'Projects', children: [{ id: '02-projects/01-new-project.md', label: 'Create a project' }] }
]
const DEMO_PAGE = '# First steps\n\nThis app helps you keep your work in order.\n\n## Open the app\n\nClick the icon on your desktop. The home page opens.\n\n## Find your way\n\nOn the left you see the menu. Click a name to open that page.\n\n### The top bar\n\nHere you search and see your profile.'

/** The whole manual as one printable HTML page: pages in order, each on a new sheet, images inline, links as anchors. */
async function manualHtml(pid: string, tree: DocsNode[]): Promise<string> {
  const pages = pagesOf(tree)
  const bodies: string[] = []
  for (const p of pages) {
    const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''
    let md = await window.cm.docs.page(pid, p)
    // Images become data URLs, so the PDF needs nothing from disk
    for (const m of [...md.matchAll(/!\[[^\]]*\]\(([^)\s]+)[^)]*\)/g)]) {
      if (/^(https?|data):/.test(m[1])) continue
      const url = await window.cm.docs.asset(pid, join(dir, m[1]))
      if (url) md = md.replace(m[1], url)
    }
    const last = (await window.cm.docs.revisions(pid, p))[0]
    const note = `<p class="rev">${esc(last ? t('Last revision: {date} · {author}', { date: when(last.date), author: last.author }) : t('Not committed yet'))}</p>`
    bodies.push(
      `<section id="${slug(p)}">` +
        renderToStaticMarkup(
          <Markdown
            remarkPlugins={[remarkGfm]}
            urlTransform={(u) => u}
            components={{
              h2: ({ children }) => <h2 id={slug(textOf(children))}>{children}</h2>,
              h3: ({ children }) => <h3 id={slug(textOf(children))}>{children}</h3>,
              a: ({ href, children }) => <a href={href && /\.md(#.*)?$/i.test(href) && !/^[a-z]+:/i.test(href) ? `#${slug(join(dir, href.replace(/#.*$/, '')))}` : href}>{children}</a>
            }}
          >
            {md}
          </Markdown>
        ).replace(/(<\/h1>)/, `$1${note}`) +
        '</section>'
    )
  }
  // The manual's history on the first sheet: every change, newest first
  const history = await window.cm.docs.revisions(pid)
  if (history.length)
    bodies.unshift(
      `<section><h1>${esc(t('Revision history'))}</h1><table><thead><tr><th>${esc(t('Date'))}</th><th>${esc(t('Author'))}</th><th>${esc(t('Change'))}</th></tr></thead><tbody>` +
        history.map((r) => `<tr><td>${esc(when(r.date))}</td><td>${esc(r.author)}</td><td>${esc(r.message)}</td></tr>`).join('') +
        '</tbody></table></section>'
    )
  return `<!doctype html><html><head><meta charset="utf-8"><style>${PDF_CSS}</style></head><body>${bodies.join('')}</body></html>`
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const pagesOf = (nodes: DocsNode[]): string[] => nodes.flatMap((n) => (n.children ? pagesOf(n.children) : [n.id]))
const PDF_CSS = `
body { font: 11.5pt/1.6 -apple-system, "Helvetica Neue", Arial, sans-serif; color: #1d1d1f; margin: 0; }
section { break-before: page; } section:first-child { break-before: auto; }
h1 { font-size: 22pt; margin: 0 0 12pt; } h2 { font-size: 15pt; margin: 18pt 0 6pt; break-after: avoid; } h3 { font-size: 12.5pt; margin: 14pt 0 4pt; break-after: avoid; }
p, ul, ol { margin: 0 0 8pt; } ul, ol { padding-left: 16pt; }
img { display: block; max-width: 100%; border: 1px solid #ddd; border-radius: 6px; margin: 6pt 0 10pt; break-inside: avoid; }
code { font: 10pt "SF Mono", Menlo, monospace; background: #f2f2f4; padding: 1px 4px; border-radius: 4px; }
pre { background: #f6f6f8; border: 1px solid #e3e3e6; border-radius: 6px; padding: 8pt; overflow: hidden; white-space: pre-wrap; } pre code { background: none; padding: 0; }
table { border-collapse: collapse; margin: 0 0 8pt; } td, th { border: 1px solid #ddd; padding: 3pt 6pt; }
blockquote { border-left: 3px solid #d97757; margin: 0 0 8pt; padding-left: 10pt; color: #555; }
a { color: #2563eb; text-decoration: none; }
.rev { color: #777; font-size: 9.5pt; margin: -6pt 0 14pt; }
table { width: 100%; font-size: 10pt; } th { text-align: left; background: #f6f6f8; }
`

const when = (iso: string) => new Date(iso).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' })
/** Under a page's title: its last revision (date and who), and the whole history from git on a click. */
function Revisions({ list }: { list: DocsRevision[] | null }) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  if (!list) return <div className="-mt-2 mb-5 h-4" />
  const last = list[0]
  return (
    <div className="not-prose -mt-2 mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-mute">
      <span>{last ? t('Last revision: {date} · {author}', { date: when(last.date), author: last.author }) : t('Not committed yet')}</span>
      {list.length > 0 && (
        <>
          <button ref={anchor} onClick={() => setOpen(!open)} className="inline-flex items-center gap-1 text-dim hover:text-ink">
            <History size={12} />
            {t('History ({n})', { n: list.length })}
          </button>
          <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} side="bottom" align="start" width={380} title={t('Revision history')}>
            <ol className="max-h-[320px] space-y-2.5 overflow-y-auto">
              {list.map((r) => (
                <li key={r.sha} className="text-[12.5px]">
                  <div className="text-ink">{r.message}</div>
                  <div className="text-[11.5px] text-mute">
                    {when(r.date)} · {r.author} · <span className="font-mono">{r.sha.slice(0, 7)}</span>
                  </div>
                </li>
              ))}
            </ol>
          </Popover>
        </>
      )}
    </div>
  )
}
const labels = (): DocsExportLabels => ({
  lastRevision: t('Last revision'),
  notCommitted: t('Not committed yet'),
  history: t('Revision history'),
  date: t('Date'),
  author: t('Author'),
  change: t('Change')
})
const DEMO_REVS: DocsRevision[] = [{ sha: '0000000', author: 'Agent', date: new Date().toISOString(), message: 'Docs: first steps' }]
