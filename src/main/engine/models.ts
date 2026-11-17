import { execFile, spawn } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { ModelInfo, Provider } from '@shared/types'
import { bin, shellEnv } from './bins'

/*
 * One catalogue for every place that picks a model (composer, pipelines, nodes).
 *  - claude: fixed list (Claude Code aliases are stable)
 *  - codex: live from `codex app-server` → model/list
 *  - opencode: live from `opencode models` (provider/model)
 * Provider routing: "provider/model" → opencode; gpt-*, o<n>*, codex* → codex; else claude.
 */
const run = promisify(execFile)

export function providerOf(model: string): Provider {
  if (model.includes('/')) return 'opencode'
  if (/^(gpt|o\d|codex)/i.test(model)) return 'codex'
  return 'claude'
}

const CLAUDE: ModelInfo[] = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', provider: 'claude', description: 'Most capable' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', provider: 'claude', description: 'Fast and capable' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', provider: 'claude', description: 'Fastest, cheapest' },
  { id: 'claude-fable-5-2', label: 'Claude Fable 5.2', provider: 'claude', description: 'Creative writing' }
]

/** OpenCode desktop ships its CLI under Application Support; prefer the newest, else the one on PATH. */
export function opencodeBin(): string {
  if (process.env.OPENCODE_BIN) return process.env.OPENCODE_BIN
  try {
    const dir = join(homedir(), 'Library', 'Application Support', 'ai.opencode.desktop', 'cli')
    const v = readdirSync(dir).sort().pop()
    if (v) return join(dir, v, 'opencode-cli')
  } catch { /* not installed as desktop app */ }
  const local = join(homedir(), '.opencode', 'bin', 'opencode')
  return local
}

let cache: { at: number; list: ModelInfo[] } | null = null

function codexModels(): Promise<ModelInfo[]> {
  return new Promise((resolve) => {
    const child = spawn(bin('codex'), ['app-server', '--listen', 'stdio://'], { stdio: ['pipe', 'pipe', 'ignore'], env: shellEnv() })
    let buf = ''
    const done = (list: ModelInfo[]) => {
      clearTimeout(t)
      child.kill()
      resolve(list)
    }
    const t = setTimeout(() => done([]), 8000)
    child.on('error', () => done([]))
    const send = (m: object) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n')
    child.stdout.on('data', (d) => {
      buf += d
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        let m: any
        try {
          m = JSON.parse(line)
        } catch {
          continue
        }
        if (m.id === 1) {
          send({ method: 'initialized', params: {} })
          send({ method: 'model/list', id: 2, params: {} })
        } else if (m.id === 2) {
          const data: any[] = m.result?.data ?? []
          done(
            data
              .filter((x) => !x.hidden)
              .map((x) => ({ id: x.model ?? x.id, label: x.displayName ?? x.id, provider: 'codex' as const, description: x.description ?? '' }))
          )
        }
      }
    })
    send({ method: 'initialize', id: 1, params: { clientInfo: { name: 'code-maxxer-2', title: 'code-maxxer-2', version: '0.0.1' }, capabilities: null } })
  })
}

async function opencodeModels(): Promise<ModelInfo[]> {
  try {
    const out = (await run(opencodeBin(), ['models'], { env: shellEnv(), timeout: 15_000 })).stdout
    return out
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /^[\w.@-]+\/\S+$/.test(l))
      .map((id) => ({ id, label: id.split('/').slice(1).join('/'), provider: 'opencode' as const, description: id.split('/')[0] }))
  } catch {
    return []
  }
}

export async function listModels(force = false): Promise<ModelInfo[]> {
  if (!force && cache && Date.now() - cache.at < 10 * 60_000) return cache.list
  const [codex, oc] = await Promise.all([codexModels(), opencodeModels()])
  cache = { at: Date.now(), list: [...CLAUDE, ...codex, ...oc] }
  return cache.list
}
