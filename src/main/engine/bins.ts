import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

// GUI apps on macOS don't inherit the shell PATH: resolve CLIs once via the login shell.
const cache = new Map<string, string>()

export function bin(name: 'claude' | 'codex' | 'git' | 'gh'): string {
  const hit = cache.get(name)
  if (hit) return hit
  let found: string = name
  const guesses = [join(homedir(), '.local/bin', name), '/opt/homebrew/bin/' + name, '/usr/local/bin/' + name]
  const g = guesses.find((p) => existsSync(p))
  if (g) found = g
  else {
    try {
      found = execFileSync(process.env.SHELL || '/bin/zsh', ['-lc', `command -v ${name}`], { encoding: 'utf8' }).trim() || name
    } catch {
      /* keep bare name */
    }
  }
  // Not found stays uncached: installed later, it's picked up without restarting the app
  if (found !== name) cache.set(name, found)
  return found
}

/** PATH of the login shell, so spawned CLIs find node, git, etc. */
let loginPath: string | null = null
export function shellEnv(): NodeJS.ProcessEnv {
  if (loginPath === null) {
    try {
      loginPath = execFileSync(process.env.SHELL || '/bin/zsh', ['-lc', 'echo $PATH'], { encoding: 'utf8' }).trim()
    } catch {
      loginPath = process.env.PATH ?? ''
    }
  }
  return { ...process.env, PATH: loginPath }
}
