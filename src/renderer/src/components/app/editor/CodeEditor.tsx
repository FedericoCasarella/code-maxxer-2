import { useEffect, useRef } from 'react'
import { placeholder as placeholderExt } from '@codemirror/view'
import { cn } from '@/lib/utils'
import { base, Compartment, EditorState, EditorView, languageFor } from './cm'

/** A controlled code editor (same look as the file tabs): text in, text out, language from the file name. */
export function CodeEditor({
  value, onChange, filename, placeholder, onSave, className
}: { value: string; onChange: (v: string) => void; filename: string; placeholder?: string; onSave?: () => void; className?: string }) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const lang = useRef(new Compartment())
  const cb = useRef({ onChange, onSave })
  cb.current = { onChange, onSave }

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          base({ onSave: () => cb.current.onSave?.() }),
          lang.current.of([]),
          placeholder ? placeholderExt(placeholder) : [],
          EditorView.updateListener.of((u) => u.docChanged && cb.current.onChange(u.state.doc.toString()))
        ]
      })
    })
    view.current = v
    void languageFor(filename).then((l) => view.current?.dispatch({ effects: lang.current.reconfigure(l) }))
    return () => {
      v.destroy()
      view.current = null
    }
  }, [filename])

  // Text replaced from outside (load, revert): take it without losing the cursor more than needed.
  useEffect(() => {
    const v = view.current
    if (!v || v.state.doc.toString() === value) return
    const head = Math.min(v.state.selection.main.head, value.length)
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value }, selection: { anchor: head } })
  }, [value])

  return (
    <div
      ref={host}
      className={cn(
        'overflow-hidden rounded-xl border border-line focus-within:border-line-strong [&_.cm-editor]:h-full [&_.cm-placeholder]:text-mute',
        className
      )}
    />
  )
}
