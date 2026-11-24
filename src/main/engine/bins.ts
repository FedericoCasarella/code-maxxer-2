import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'

/*
 * GUI apps on macOS don't inherit the shell's PATH, and many installs only exist in the interactive shell:
 * an alias in .zshrc (Claude Code's "local" install: ~/.claude/local/claude), nvm/volta/bun folders added there.
 * A CLI is looked for in the known folders first, then asked to the login shell, then to the interactive one.
 */
const cache = new Map<string, string>()
/** Folders of the CLIs found: added to PATH, so a CLI installed with npm under nvm finds its own node */
const binDirs = new Set<string>()

const shell = () => process.env.SHELL || '/bin/zsh'
const MARK = '__CM2__'

/** Runs a command in the user's shell (login, or login + interactive) and returns what it printed after the marker. */
function ask(cmd: string, interactive: boolean): string {
  try {
    const out = execFileSync(shell(), [interactive ? '-ilc' : '-lc', `echo ${MARK}; ${cmd}`], {
      encoding: 'utf8',
      timeout: 8000,
      stdio: ['ignore', 'pipe', 'ignore']
    })
    return out.slice(out.lastIndexOf(MARK) + MARK.length).trim()
  } catch {
    return ''
  }
}

/** What `command -v` printed, as a path: a plain path, or the target of an alias (alias claude='~/.claude/local/claude'). */
function pathFrom(out: string): string | null {
  const line = out.split('\n').map((l) => l.trim()).filter(Boolean).pop() ?? ''
  let p = line.startsWith('alias ') || /^\w[\w-]*=/.test(line) ? line.slice(line.indexOf('=') + 1) : line
  p = p.replace(/^['"]|['"]$/g, '').split(/\s+/)[0].replace(/^~(?=\/)/, homedir())
  return p.startsWith('/') && existsSync(p) ? p : null
}

/** The newest node under nvm that has this CLI. */
function nvmGuess(name: string): string | null {
  const root = join(homedir(), '.nvm/versions/node')
  try {
    const versions = readdirSync(root).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    for (const v of versions) {
      const p = join(root, v, 'bin', name)
      if (existsSync(p)) return p
    }
  } catch { /* no nvm */ }
  return null
}

export function bin(name: 'claude' | 'codex' | 'git' | 'gh'): string {
  const hit = cache.get(name)
  if (hit) return hit
  const home = homedir()
  const guesses = [
    join(home, '.local/bin', name),
    ...(name === 'claude' ? [join(home, '.claude/local', name)] : []),
    '/opt/homebrew/bin/' + name,
    '/usr/local/bin/' + name,
    join(home, '.npm-global/bin', name),
    join(home, '.bun/bin', name),
    join(home, '.volta/bin', name),
    join(home, 'Library/pnpm', name),
    join(home, '.local/share/pnpm', name)
  ]
  const found =
    guesses.find((p) => existsSync(p)) ??
    pathFrom(ask(`command -v ${name}`, false)) ??
    pathFrom(ask(`command -v ${name}`, true)) ??
    nvmGuess(name) ??
    name
  // Not found stays uncached: installed later, it's picked up without restarting the app
  if (found !== name) {
    cache.set(name, found)
    binDirs.add(dirname(found))
  }
  return found
}

/** PATH of the user's shell (interactive, so .zshrc counts), plus the folders of the CLIs found. */
let shellPath: string | null = null
export function shellEnv(): NodeJS.ProcessEnv {
  if (shellPath === null) shellPath = ask('echo $PATH', true).split('\n').pop() || ask('echo $PATH', false) || process.env.PATH || ''
  const parts = shellPath.split(':')
  const extra = [...binDirs].filter((d) => !parts.includes(d))
  return { ...process.env, PATH: [...parts, ...extra].join(':') }
}
