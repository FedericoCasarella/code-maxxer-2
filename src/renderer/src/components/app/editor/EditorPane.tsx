import { useCallback, useEffect, useRef, useState } from 'react'
import { MergeView, unifiedMergeView } from '@codemirror/merge'
import { Columns2, FileCode2, Rows2, Save } from 'lucide-react'
import type { ScmFileText } from '@shared/scm'
import { actions, type EditorTab } from '@/lib/store'
import { cn } from '@/lib/utils'
import { SegmentedControl } from '../../affect/segmented-control'
import { Spinner } from '../../affect/spinner'
import { base, Compartment, EditorState, EditorView, languageFor } from './cm'
import { Marquee } from '../Marquee'

const REF_LABEL = (r?: string) => (!r ? '' : r === 'worktree' ? 'Working tree' : r === 'index' ? 'Index' : r === 'HEAD' ? 'HEAD' : r.replace(/^([0-9a-f]{7})[0-9a-f]+/, '$1'))

let splitPref: 'inline' | 'split' = (() => {
  try {
    return (localStorage.getItem('cm2.diffMode') as 'inline' | 'split') || 'inline'
  } catch {
    return 'inline'
  }
})()

/** One open file or diff. Stays mounted while hidden so edits and scroll survive tab switches. */
export function EditorPane({ wsId, tab, visible }: { wsId: string; tab: EditorTab; visible: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  /** The editable view (file, or the new side of a worktree diff) */
  const view = useRef<EditorView | null>(null)
  const merge = useRef<MergeView | null>(null)
  const saved = useRef('')
  const lang = useRef(new Compartment())
  const [mode, setMode] = useState(splitPref)
  const [problem, setProblem] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const editable = tab.kind === 'file' || tab.right === 'worktree'

  const markDirty = useCallback((doc: string) => actions.setEditorDirty(wsId, tab.id, doc !== saved.current), [wsId, tab.id])

  const save = useCallback(async () => {
    const v = view.current
    if (!v || !editable) return
    const text = v.state.doc.toString()
    setSaving(true)
    setError(null)
    try {
      await window.cm.scm.write(wsId, tab.path, text)
      saved.current = text
      markDirty(text)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }, [wsId, tab.path, editable, markDirty])
  const saveRef = useRef(save)
  saveRef.current = save

  // Build the editor(s) for this tab and mode.
  useEffect(() => {
    let dead = false
    const el = host.current!
    setLoading(true)
    const ext = (readOnly: boolean) => [
      base({ readOnly, onSave: readOnly ? undefined : () => void saveRef.current() }),
      lang.current.of([]),
      ...(readOnly ? [] : [EditorView.updateListener.of((u) => u.docChanged && markDirty(u.state.doc.toString()))])
    ]
    const sides: Promise<ScmFileText>[] =
      tab.kind === 'file'
        ? [window.cm.scm.read(wsId, tab.path, 'worktree')]
        : [window.cm.scm.read(wsId, tab.oldPath ?? tab.path, tab.left), window.cm.scm.read(wsId, tab.path, tab.right)]
    void Promise.all([Promise.all(sides), languageFor(tab.path)]).then(([texts, language]) => {
      if (dead) return
      setLoading(false)
      const bad = texts.find((x) => x.binary || x.tooLarge)
      if (bad) return setProblem(bad.binary ? 'Binary file, not shown.' : 'File larger than 2 MB, not shown.')
      if (tab.kind === 'file' && texts[0].missing) return setProblem('This file no longer exists.')
      setProblem(null)
      const setLang = { effects: lang.current.reconfigure(language) }
      if (tab.kind === 'file') {
        saved.current = texts[0].text
        view.current = new EditorView({ parent: el, state: EditorState.create({ doc: texts[0].text, extensions: ext(false) }) })
        view.current.dispatch(setLang)
      } else if (mode === 'inline') {
        const [a, b] = texts
        saved.current = b.text
        view.current = new EditorView({
          parent: el,
          state: EditorState.create({
            doc: b.text,
            extensions: [ext(!editable), unifiedMergeView({ original: a.text, mergeControls: false, gutter: true, collapseUnchanged: { margin: 3, minSize: 8 } })]
          })
        })
        view.current.dispatch(setLang)
      } else {
        const [a, b] = texts
        saved.current = b.text
        const langA = new Compartment()
        merge.current = new MergeView({
          parent: el,
          a: { doc: a.text, extensions: [base({ readOnly: true }), langA.of(language)] },
          b: {
            doc: b.text,
            extensions: [
              base({ readOnly: !editable, onSave: editable ? () => void saveRef.current() : undefined }),
              lang.current.of(language),
              ...(editable ? [EditorView.updateListener.of((u) => u.docChanged && markDirty(u.state.doc.toString()))] : [])
            ]
          },
          gutter: true,
          highlightChanges: true,
          collapseUnchanged: { margin: 3, minSize: 8 }
        })
        merge.current.dom.style.height = '100%'
        view.current = merge.current.b
      }
    })
    return () => {
      dead = true
      merge.current?.destroy()
      if (!merge.current) view.current?.destroy()
      merge.current = null
      view.current = null
      el.replaceChildren()
    }
  }, [wsId, tab.id, mode])

  // The file changed on disk (an agent, a pull…): take the new text unless there are unsaved edits.
  useEffect(() => {
    if (!editable) return
    return window.cm.onEvent((e) => {
      if (e.type !== 'files' || e.workspaceId !== wsId || e.event.kind !== 'change' || e.event.path !== tab.path) return
      const v = view.current
      if (!v || v.state.doc.toString() !== saved.current) return
      void window.cm.scm.read(wsId, tab.path, 'worktree').then((f) => {
        const cur = view.current
        if (!cur || f.binary || f.tooLarge || f.missing || f.text === cur.state.doc.toString()) return
        if (cur.state.doc.toString() !== saved.current) return
        saved.current = f.text
        const head = Math.min(cur.state.selection.main.head, f.text.length)
        cur.dispatch({ changes: { from: 0, to: cur.state.doc.length, insert: f.text }, selection: { anchor: head } })
      })
    })
  }, [wsId, tab.path, editable])

  useEffect(() => {
    if (visible) requestAnimationFrame(() => view.current?.focus())
  }, [visible])

  const dir = tab.path.includes('/') ? tab.path.slice(0, tab.path.lastIndexOf('/')) : ''
  const name = tab.path.slice(tab.path.lastIndexOf('/') + 1)

  return (
    <div className={cn('min-h-0 flex-1 flex-col', visible ? 'flex' : 'hidden')}>
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-4 text-[12px]">
        <FileCode2 size={13} className="shrink-0 text-mute" />
        <Marquee className="min-w-0" delay={300}>
          {dir && <span className="text-mute">{dir}/</span>}
          <span className="text-ink">{name}</span>
        </Marquee>
        {tab.kind === 'diff' && (
          <span className="shrink-0 rounded bg-white/[.05] px-1.5 py-px text-[11px] text-dim">
            {REF_LABEL(tab.left)} → {REF_LABEL(tab.right)}
          </span>
        )}
        {error && <Marquee className="min-w-0 text-[11.5px] text-bad" delay={300}>{error}</Marquee>}
        <span className="flex-1" />
        {tab.kind === 'diff' && (
          <SegmentedControl
            size="sm"
            aria-label="Diff layout"
            value={mode}
            onChange={(m) => {
              splitPref = m
              try {
                localStorage.setItem('cm2.diffMode', m)
              } catch { /* ignore */ }
              setMode(m)
            }}
            options={[
              { value: 'inline', label: 'Inline', icon: <Rows2 size={12} /> },
              { value: 'split', label: 'Split', icon: <Columns2 size={12} /> }
            ]}
          />
        )}
        {tab.kind === 'diff' && (
          <button
            onClick={() => actions.openEditor(wsId, { kind: 'file', path: tab.path })}
            className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] text-dim hover:bg-white/[.05] hover:text-ink"
          >
            Open file
          </button>
        )}
        {editable && (
          <button
            onClick={() => void save()}
            disabled={!tab.dirty || saving}
            className="flex h-7 items-center gap-1.5 rounded-md border border-line-strong bg-raised px-2.5 text-[12px] font-medium text-ink hover:bg-white/[.06] disabled:opacity-40"
          >
            {saving ? <Spinner size={11} /> : <Save size={12} />} Save
            <span className="text-[11px] text-mute">⌘S</span>
          </button>
        )}
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div ref={host} className={cn('h-full [&_.cm-mergeView]:h-full [&_.cm-mergeViewEditors]:min-h-full', problem && 'hidden')} />
        {loading && !problem && (
          <div className="absolute inset-0 grid place-items-center">
            <Spinner size={16} className="text-mute" />
          </div>
        )}
        {problem && <div className="grid h-full place-items-center text-[12.5px] text-mute">{problem}</div>}
      </div>
    </div>
  )
}
