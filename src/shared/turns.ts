import type { Block, Message } from './types'

/*
 * A chat as turns: one user request and what the agent did for it.
 * The agent starts each request with short notes of the earlier turns (no model needed: they come from
 * the saved messages) and reads a whole turn back with the history tools only when it needs the details.
 */

type Tool = Extract<Block, { kind: 'tool' }>
export type Turn = { n: number; request: string; replies: Extract<Message, { role: 'assistant' }>[]; at: number }

export function turnsOf(messages: Message[]): Turn[] {
  const out: Turn[] = []
  for (const m of messages) {
    if (m.role === 'user') out.push({ n: out.length + 1, request: m.text, replies: [], at: m.at })
    else if (out.length) out[out.length - 1].replies.push(m)
    else out.push({ n: 1, request: '', replies: [m], at: m.at })
  }
  return out
}

const one = (s: string, max: number) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max - 1) + '…' : t
}
const textOf = (t: Turn) => t.replies.map((r) => r.blocks.filter((b) => b.kind === 'text').map((b: any) => b.text).join('\n')).join('\n').trim()
const toolsOf = (t: Turn) => t.replies.flatMap((r) => r.blocks.filter((b): b is Tool => b.kind === 'tool'))

function filesOf(t: Turn): string[] {
  return [...new Set(toolsOf(t).map((x) => x.file?.path).filter((p): p is string => !!p))]
}
function commitsOf(t: Turn): string[] {
  return toolsOf(t)
    .filter((x) => x.name === 'Bash' && x.status === 'success' && /\bgit\s+commit\b/.test(String((x.input as any)?.command ?? '')))
    .map((x) => String(x.result ?? '').match(/\[[^\]]+ ([0-9a-f]{7,})\] (.+)/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => `${m[1]} ${one(m[2], 70)}`)
}

/** One short line per turn: what was asked, what came of it. */
export function noteOf(t: Turn): string {
  const reply = textOf(t)
  const last = reply.split(/\n\s*\n/).filter(Boolean).pop() ?? ''
  const files = filesOf(t)
  const commits = commitsOf(t)
  const failed = t.replies.find((r) => r.error)?.error
  return [
    `#${t.n} Asked: ${one(t.request, 220) || '(nothing)'}`,
    reply ? `   Result: ${one(last || reply, 320)}` : '',
    files.length ? `   Files: ${files.slice(0, 8).join(', ')}${files.length > 8 ? ` +${files.length - 8}` : ''}` : '',
    commits.length ? `   Commits: ${commits.slice(0, 4).join('; ')}` : '',
    failed ? `   Failed: ${one(failed, 160)}` : ''
  ].filter(Boolean).join('\n')
}

/**
 * What a new request starts with: notes of the recent turns, the last reply in full (it's what the user answers to),
 * and how to get more. Empty for a new chat.
 */
export function compactContext(messages: Message[], keep = 12): string {
  const turns = turnsOf(messages)
  if (!turns.length) return ''
  const prev = turns[turns.length - 1]
  const shown = turns.slice(-keep)
  const older = turns.length - shown.length
  const ask = prev.replies.flatMap((r) => r.blocks.filter((b) => b.kind === 'ask')).flatMap((b: any) => b.questions.map((q: any) => `- ${q.title}`))
  return (
    'EARLIER IN THIS CHAT. You start fresh on each request: these are short notes of the earlier turns, not the whole conversation. ' +
    'When you need what was said or done in a turn (exact wording, commands, errors, decisions), read it with mcp__cm2__history_read {turn}; ' +
    'find a turn with mcp__cm2__history_search {query}. Don\'t re-read files or redo work just to recover context the notes or the history give you.\n' +
    (older ? `(${older} earlier ${older === 1 ? 'turn' : 'turns'} not listed: search the history.)\n` : '') +
    shown.map(noteOf).join('\n') +
    `\n\nYOUR LAST REPLY (turn #${prev.n}), which the user may be answering:\n${one(textOf(prev), 2500) || '(none)'}` +
    (ask.length ? `\nYou asked:\n${ask.join('\n')}` : '') +
    '\n\nNEW REQUEST:\n'
  )
}

/** A whole turn, for history_read: the request, the replies, and a trace of the tools (commands, files, errors). */
export function turnDetail(t: Turn, max = 12000): string {
  const trace = toolsOf(t).map((x) => {
    const i: any = x.input ?? {}
    const what = x.file?.path ?? i.command?.split('\n')[0] ?? i.file_path ?? i.pattern ?? i.query ?? i.url ?? ''
    const err = x.status === 'error' ? ` → ERROR ${one(String(x.result ?? ''), 300)}` : ''
    return `- ${x.name}${what ? ` ${one(String(what), 160)}` : ''}${err}`
  })
  const s =
    `Turn #${t.n} · ${new Date(t.at).toISOString().slice(0, 16).replace('T', ' ')}\n\nREQUEST:\n${t.request}\n\n` +
    `REPLY:\n${textOf(t) || '(none)'}\n\nTOOLS (${trace.length}):\n${trace.join('\n') || '(none)'}`
  return s.length > max ? s.slice(0, max) + '\n… (cut)' : s
}

/** Turns matching the words of a query, best first, as short lines. */
export function searchTurns(turns: Turn[], query: string, limit = 8): string {
  const words = query.toLowerCase().split(/[^\p{L}\p{N}_./-]+/u).filter((w) => w.length > 2)
  const scored = turns
    .map((t) => {
      const hay = `${t.request}\n${textOf(t)}\n${filesOf(t).join(' ')}\n${toolsOf(t).map((x) => String((x.input as any)?.command ?? '')).join(' ')}`.toLowerCase()
      return { t, score: words.length ? words.filter((w) => hay.includes(w)).length : 0 }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.t.n - a.t.n)
    .slice(0, limit)
  return scored.length ? scored.map(({ t }) => noteOf(t)).join('\n') : 'No turn matches.'
}
