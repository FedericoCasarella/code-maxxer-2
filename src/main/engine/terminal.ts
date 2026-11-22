/**
 * The terminal tab: one shell per branch, in its folder, shared by the user and the agents.
 * zsh gets a small integration (its own ZDOTDIR that loads the user's files first) that marks each command's start and
 * end with invisible escape sequences: the agent's command runs only when the shell is idle, and it gets back exactly
 * that command's output and exit code. The user sees everything the agent types and prints.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import type { IPty } from 'node-pty'
import type { EngineEvent } from '@shared/types'
import { shellEnv } from './bins'

type Emit = (e: EngineEvent) => void
type Session = { pty: IPty; out: string; total: number; busy: boolean; cwd: string; waiters: ((code: number) => void)[] }

const sessions = new Map<string, Session>()
const KEEP = 200_000
// OSC 6973 (unknown to terminals, so not drawn): "start" before a command runs, "done;<exit code>" when the prompt is back
const MARK = /\x1b\]6973;(start|done;(-?\d+))\x07/g
let emit: Emit | null = null
export const setTerminalWiring = (e: Emit) => {
  emit = e
}

/** A ZDOTDIR whose files load the user's own and then add the two marks. */
function zdotdir(): string {
  const dir = join(app.getPath('userData'), 'terminal-zsh')
  mkdirSync(dir, { recursive: true })
  const home = homedir()
  const load = (f: string) => `[ -f "${home}/${f}" ] && ZDOTDIR="${home}" source "${home}/${f}"\n`
  writeFileSync(join(dir, '.zshenv'), load('.zshenv'))
  writeFileSync(join(dir, '.zprofile'), load('.zprofile'))
  writeFileSync(join(dir, '.zlogin'), load('.zlogin'))
  writeFileSync(
    join(dir, '.zshrc'),
    load('.zshrc') +
      `ZDOTDIR="${home}"\n` +
      "__cm2_preexec() { printf '\\e]6973;start\\a' }\n" +
      "__cm2_precmd() { printf '\\e]6973;done;%s\\a' \"$?\" }\n" +
      'autoload -Uz add-zsh-hook\nadd-zsh-hook preexec __cm2_preexec\nadd-zsh-hook precmd __cm2_precmd\n'
  )
  return dir
}

function start(wsId: string, cwd: string, cols: number, rows: number): Session {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pty: typeof import('node-pty') = require('node-pty')
  const shell = process.env.SHELL || '/bin/zsh'
  const zsh = /zsh$/.test(shell)
  const env = { ...shellEnv(), TERM: 'xterm-256color', COLORTERM: 'truecolor', ...(zsh ? { ZDOTDIR: zdotdir() } : {}) } as Record<string, string>
  const p = pty.spawn(shell, ['-il'], { name: 'xterm-256color', cols, rows, cwd, env })
  const s: Session = { pty: p, out: '', total: 0, busy: !zsh, cwd, waiters: [] }
  p.onData((d) => {
    for (const m of d.matchAll(MARK)) {
      if (m[1] === 'start') s.busy = true
      else {
        s.busy = false
        s.waiters.splice(0).forEach((w) => w(Number(m[2])))
      }
    }
    s.out = (s.out + d).slice(-KEEP)
    s.total += d.length
    emit?.({ type: 'terminal-data', workspaceId: wsId, data: d })
  })
  p.onExit(() => {
    if (sessions.get(wsId) !== s) return
    sessions.delete(wsId)
    s.waiters.splice(0).forEach((w) => w(-1))
    emit?.({ type: 'terminal-exit', workspaceId: wsId })
  })
  sessions.set(wsId, s)
  return s
}

/** The branch's terminal, started if needed: what it printed so far, to draw again. */
export function openTerminal(wsId: string, cwd: string, cols: number, rows: number): string {
  const s = sessions.get(wsId) ?? start(wsId, cwd, cols, rows)
  return s.out
}
export const writeTerminal = (wsId: string, data: string) => sessions.get(wsId)?.pty.write(data)
export function resizeTerminal(wsId: string, cols: number, rows: number) {
  try {
    if (cols > 0 && rows > 0) sessions.get(wsId)?.pty.resize(cols, rows)
  } catch { /* exited */ }
}
export function closeTerminal(wsId: string) {
  const s = sessions.get(wsId)
  sessions.delete(wsId)
  try {
    s?.pty.kill()
  } catch { /* gone */ }
}
export const closeAllTerminals = () => [...sessions.keys()].forEach(closeTerminal)

// Escapes, carriage returns and the marks out, for the agent
const plain = (s: string) =>
  s
    .replace(MARK, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[()][0-9A-B]/g, '')
    .replace(/\r+\n/g, '\n')
    .replace(/[^\n]*\r(?!\n)/g, '')

/** The last lines on the branch's terminal, as plain text. */
export function readTerminal(wsId: string, lines = 80): string | null {
  const s = sessions.get(wsId)
  if (!s) return null
  return plain(s.out).split('\n').slice(-Math.max(1, Math.min(500, lines))).join('\n')
}

/**
 * Runs a command in the branch's terminal, where the user sees it, and returns its output and exit code.
 * Only when the shell is idle: a running program (a dev server, an editor) is never typed into.
 */
export async function runInTerminal(wsId: string, cwd: string, command: string, timeoutMs: number): Promise<{ text: string; error?: boolean }> {
  const s = sessions.get(wsId) ?? start(wsId, cwd, 120, 30)
  // A new shell: wait for its first prompt
  if (!s.out.includes('\x1b]6973;done')) await new Promise<void>((res) => {
    const t = setTimeout(res, 8000)
    s.waiters.push(() => (clearTimeout(t), res()))
  })
  if (s.busy) return { text: 'The terminal is busy: something is running there (a server, an editor, a command of the user). Read it with terminal_read, or run this in your own shell.', error: true }
  const from = s.total
  const done = new Promise<number>((res) => s.waiters.push(res))
  s.pty.write(`${command.replace(/\r?\n/g, ' ')}\r`)
  const code = await Promise.race([done, new Promise<null>((res) => setTimeout(() => res(null), timeoutMs))])
  // What it printed: between the start mark (after the echoed command line) and the done mark (before the prompt)
  const raw = s.total > from ? s.out.slice(-Math.min(s.out.length, s.total - from)) : ''
  const begin = raw.indexOf('\x1b]6973;start\x07')
  const end = raw.lastIndexOf('\x1b]6973;done')
  const body = plain(raw.slice(begin >= 0 ? begin : 0, end > begin ? end : undefined)).trim()
  if (code === null) return { text: `Still running after ${Math.round(timeoutMs / 1000)}s (it keeps running in the terminal; read it later with terminal_read):\n${body.slice(-20_000)}` }
  return { text: `exit ${code}\n${body.slice(-30_000) || '(no output)'}`, error: code !== 0 }
}
