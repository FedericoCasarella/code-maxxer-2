import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

type Hook = { type: 'command'; command: string; timeout?: number }
type Group = { matcher?: string; hooks: Hook[] }
export type Hooks = Record<string, Group[]>

// Primitive's guards, by the event they belong to: anything else stays out (token diet).
const GUARDS: Record<string, string> = { UserPromptSubmit: ' --prompt-guard', PreToolUse: ' --tool-guard' }

/** Keeps only Primitive's hooks (prompt and file/command guards) out of a Claude settings object. */
export function primitiveHooks(settings: unknown): Hooks {
  const out: Hooks = {}
  const all = (settings as { hooks?: unknown } | null)?.hooks
  if (!all || typeof all !== 'object') return out
  for (const [event, suffix] of Object.entries(GUARDS)) {
    const groups = (all as Record<string, unknown>)[event]
    if (!Array.isArray(groups)) continue
    for (const g of groups) {
      if (!g || typeof g !== 'object' || !Array.isArray(g.hooks)) continue
      const hooks: Hook[] = []
      for (const h of g.hooks) {
        if (!h || h.type !== 'command' || typeof h.command !== 'string' || !h.command.trimEnd().endsWith(suffix)) continue
        hooks.push({ type: 'command', command: h.command, ...(typeof h.timeout === 'number' ? { timeout: h.timeout } : {}) })
      }
      if (hooks.length) (out[event] ??= []).push({ ...(typeof g.matcher === 'string' ? { matcher: g.matcher } : {}), hooks })
    }
  }
  return out
}

/** Primitive's hooks from ~/.claude/settings.json, read on every run; missing or broken file → none. */
export async function userPrimitiveHooks(): Promise<Hooks> {
  try {
    return primitiveHooks(JSON.parse(await readFile(join(homedir(), '.claude', 'settings.json'), 'utf8')))
  } catch {
    return {}
  }
}
