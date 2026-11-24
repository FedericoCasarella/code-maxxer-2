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

/** Claude Code found on this Mac (a bare name means the lookup found nothing). */
export const claudeInstalled = () => bin('claude') !== 'claude'

/*
 * Prices from models.dev (the public catalog OpenCode uses): provider → model → cost per million tokens.
 * Fetched once a day; offline, the pickers just show no prices.
 */
type Catalog = Record<string, { models?: Record<string, { cost?: { input?: number; output?: number } }> }>
let prices: { at: number; data: Catalog } | null = null
async function catalog(): Promise<Catalog> {
  if (prices && Date.now() - prices.at < 24 * 3600_000) return prices.data
  try {
    const r = await fetch('https://models.dev/api.json', { signal: AbortSignal.timeout(8000) })
    if (!r.ok) throw new Error(String(r.status))
    prices = { at: Date.now(), data: (await r.json()) as Catalog }
  } catch {
    return prices?.data ?? {}
  }
  return prices.data
}
function priceOf(c: Catalog, m: ModelInfo): ModelInfo['price'] {
  const [prov, id] =
    m.provider === 'claude' ? ['anthropic', m.id] : m.provider === 'codex' ? ['openai', m.id] : [m.id.split('/')[0], m.id.split('/').slice(1).join('/')]
  const cost = c[prov]?.models?.[id]?.cost
  if (cost?.output === undefined) return prov === 'ollama' ? { input: 0, output: 0 } : undefined
  return { input: cost.input ?? 0, output: cost.output }
}

export async function listModels(force = false): Promise<ModelInfo[]> {
  if (!force && cache && Date.now() - cache.at < 10 * 60_000) return cache.list
  const [codex, oc] = await Promise.all([codexModels(), opencodeModels()])
  // Without Claude Code its models can't run: they leave the pickers (unless nothing else is installed).
  const claude = claudeInstalled() || (!codex.length && !oc.length) ? CLAUDE : []
  const prices = await catalog()
  const list = [...claude, ...codex, ...oc].map((m) => {
    const p = priceOf(prices, m)
    return p ? { ...m, price: p } : m
  })
  cache = { at: Date.now(), list }
  return cache.list
}

/** The model a run will really use: a Claude model without Claude Code goes to the first installed one (Codex first). */
export async function usableModel(model: string): Promise<string> {
  if (providerOf(model) !== 'claude' || claudeInstalled()) return model
  const other = (await listModels()).find((m) => m.provider !== 'claude')
  return other?.id ?? model
}
