// Lightweight list editing for a plain <textarea>, Notion-style:
// "- " or "* " at line start becomes a bullet, "1. " starts a numbered list,
// Enter continues the list, Enter on an empty item leaves it, Tab / Shift-Tab nest.

export const BULLET = '•'
const ITEM = /^(\s*)(•|\d+\.) (.*)$/

type Edit = { value: string; caret: number }

const lineAt = (v: string, caret: number) => {
  const start = v.lastIndexOf('\n', caret - 1) + 1
  const endIdx = v.indexOf('\n', caret)
  const end = endIdx < 0 ? v.length : endIdx
  return { start, end, text: v.slice(start, end) }
}

/** After typing: turn "- " / "* " at the start of a line into a bullet. */
export function autoformat(value: string, caret: number): Edit | null {
  const { start, text } = lineAt(value, caret)
  const m = text.match(/^(\s*)([-*]) $/)
  if (!m || caret !== start + text.length) return null
  const next = value.slice(0, start) + `${m[1]}${BULLET} ` + value.slice(start + text.length)
  return { value: next, caret: start + m[1].length + 2 }
}

/** Enter inside a list item. Returns null when the caret isn't in a list. */
export function enterInList(value: string, caret: number): Edit | null {
  const { start, end, text } = lineAt(value, caret)
  const m = text.match(ITEM)
  if (!m) return null
  const [, indent, marker, content] = m
  if (!content.trim()) {
    // Empty item: leave the list (drop the marker).
    const next = value.slice(0, start) + value.slice(end)
    return { value: next, caret: start }
  }
  const nextMarker = marker === BULLET ? BULLET : `${parseInt(marker, 10) + 1}.`
  const insert = `\n${indent}${nextMarker} `
  return { value: value.slice(0, caret) + insert + value.slice(caret), caret: caret + insert.length }
}

/** Backspace right after an item's marker removes the marker. */
export function backspaceInList(value: string, caret: number): Edit | null {
  const { start, text } = lineAt(value, caret)
  const m = text.match(/^(\s*)(•|\d+\.) /)
  if (!m || caret !== start + m[0].length) return null
  return { value: value.slice(0, start) + m[1] + value.slice(start + m[0].length), caret: start + m[1].length }
}

/** Tab / Shift-Tab nests or un-nests the current item. */
export function indentInList(value: string, caret: number, out: boolean): Edit | null {
  const { start, text } = lineAt(value, caret)
  if (!ITEM.test(text)) return null
  if (out) {
    const strip = text.startsWith('  ') ? 2 : text.startsWith(' ') ? 1 : 0
    if (!strip) return { value, caret }
    return { value: value.slice(0, start) + value.slice(start + strip), caret: caret - strip }
  }
  return { value: value.slice(0, start) + '  ' + value.slice(start), caret: caret + 2 }
}

/** What the agent receives: bullets back to markdown dashes. */
export const toMarkdown = (v: string) => v.replace(/^(\s*)• /gm, '$1- ')
