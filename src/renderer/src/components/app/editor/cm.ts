import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, highlightSpecialChars, rectangularSelection, crosshairCursor, dropCursor } from '@codemirror/view'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, foldGutter, foldKeymap, HighlightStyle, indentOnInput, LanguageDescription, syntaxHighlighting } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { tags as t } from '@lezer/highlight'

/** Editor chrome in the app's palette: same background as the chat, accent caret. */
export const theme = EditorView.theme(
  {
    '&': { height: '100%', fontSize: '12.5px', backgroundColor: 'var(--color-bg)', color: 'var(--color-ink)' },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6' },
    '.cm-content': { caretColor: 'var(--color-accent)', padding: '8px 0' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-accent)', borderLeftWidth: '2px' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection': {
      backgroundColor: 'rgba(77,159,255,.22) !important'
    },
    '.cm-gutters': { backgroundColor: 'var(--color-bg)', color: 'var(--color-mute)', border: 'none', paddingLeft: '6px' },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 4px', minWidth: '32px' },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,.03)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--color-dim)' },
    '.cm-foldGutter .cm-gutterElement': { color: 'var(--color-mute)', cursor: 'default' },
    '.cm-matchingBracket': { backgroundColor: 'rgba(255,255,255,.1)', outline: '1px solid rgba(255,255,255,.18)' },
    '.cm-selectionMatch': { backgroundColor: 'rgba(255,255,255,.07)' },
    '.cm-searchMatch': { backgroundColor: 'rgba(242,184,75,.25)', outline: '1px solid rgba(242,184,75,.45)' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'rgba(242,184,75,.45)' },
    '.cm-panels': { backgroundColor: 'var(--color-panel)', color: 'var(--color-ink)', borderColor: 'var(--color-line)' },
    '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--color-line)' },
    '.cm-panel input, .cm-panel button': { fontSize: '12px' },
    '.cm-textfield': { backgroundColor: 'var(--color-input)', border: '1px solid var(--color-line-strong)', borderRadius: '5px', color: 'var(--color-ink)' },
    '.cm-button': { backgroundImage: 'none', backgroundColor: 'var(--color-raised)', border: '1px solid var(--color-line-strong)', borderRadius: '5px', color: 'var(--color-ink)' },
    '.cm-tooltip': { backgroundColor: 'var(--color-raised)', border: '1px solid var(--color-line-strong)', borderRadius: '6px' },
    // Diffs (@codemirror/merge)
    '.cm-changedLine, &.cm-merge-b .cm-changedLine': { backgroundColor: 'rgba(79,195,138,.09)' },
    '&.cm-merge-a .cm-changedLine, .cm-deletedChunk': { backgroundColor: 'rgba(255,122,107,.09)' },
    '.cm-changedText, .cm-deletedText': { backgroundImage: 'none !important', textDecoration: 'none !important' },
    '&.cm-merge-b .cm-changedText, .cm-insertedLine .cm-changedText': { backgroundColor: 'rgba(79,195,138,.22)' },
    '&.cm-merge-a .cm-changedText, .cm-deletedChunk .cm-deletedText': { backgroundColor: 'rgba(255,122,107,.22)' },
    '.cm-deletedChunk del': { textDecoration: 'none' },
    '.cm-scroller::-webkit-scrollbar-corner': { background: 'transparent' },
    '.cm-insertedLine': { backgroundColor: 'rgba(79,195,138,.09)' },
    '.cm-deletedLine': { backgroundColor: 'rgba(255,122,107,.09)' },
    '.cm-changeGutter': { width: '3px', paddingLeft: '0' },
    '&.cm-merge-b .cm-changedLineGutter, .cm-changedLineGutter': { backgroundColor: 'var(--color-ok)' },
    '&.cm-merge-a .cm-changedLineGutter, .cm-deletedLineGutter': { backgroundColor: 'var(--color-bad)' },
    '.cm-collapsedLines': {
      color: 'var(--color-mute)', backgroundColor: 'var(--color-panel)', backgroundImage: 'none',
      borderTop: '1px solid var(--color-line)', borderBottom: '1px solid var(--color-line)', fontFamily: 'var(--font-sans)', fontSize: '11.5px'
    },
    '.cm-chunkButtons button': { fontSize: '11px', borderRadius: '4px' }
  },
  { dark: true }
)

/** Token colors close to the CodeBlock palette, on dark. */
export const highlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: '#6f7a86', fontStyle: 'italic' },
    { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword, t.modifier], color: '#c792ea' },
    { tag: [t.string, t.special(t.string), t.regexp, t.character], color: '#a5d6a7' },
    { tag: [t.number, t.bool, t.null, t.atom], color: '#f2b84b' },
    { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#82aaff' },
    { tag: [t.typeName, t.className, t.namespace], color: '#ffcb6b' },
    { tag: [t.propertyName, t.attributeName], color: '#89ddff' },
    { tag: [t.tagName], color: '#f07178' },
    { tag: [t.definition(t.variableName)], color: '#ededed' },
    { tag: [t.operator, t.punctuation, t.bracket], color: '#a1a1a1' },
    { tag: [t.heading], color: '#ededed', fontWeight: '700' },
    { tag: [t.link, t.url], color: '#82aaff', textDecoration: 'underline' },
    { tag: [t.emphasis], fontStyle: 'italic' },
    { tag: [t.strong], fontWeight: '700' },
    { tag: [t.invalid], color: '#ff7a6b' }
  ])
)

/** The language for a file name, loaded on demand (empty when unknown). */
export async function languageFor(path: string): Promise<Extension> {
  const d = LanguageDescription.matchFilename(languages, path.slice(path.lastIndexOf('/') + 1))
  if (!d) return []
  try {
    return await d.load()
  } catch {
    return []
  }
}

/** What every editor gets: gutters, history, search, brackets, our look. */
export function base(opts: { readOnly?: boolean; onSave?: () => void } = {}): Extension {
  return [
    lineNumbers(),
    foldGutter({ openText: '▾', closedText: '▸' }),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    highlightSelectionMatches(),
    EditorState.tabSize.of(2),
    keymap.of([
      ...(opts.onSave ? [{ key: 'Mod-s', preventDefault: true, run: () => (opts.onSave!(), true) }] : []),
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      indentWithTab
    ]),
    EditorState.readOnly.of(!!opts.readOnly),
    EditorView.editable.of(!opts.readOnly),
    theme,
    highlight
  ]
}

export { Compartment, EditorState, EditorView }
