import { spawn, type ChildProcess } from 'node:child_process'
import { type ClaudeLoginState, type EngineEvent } from '@shared/types'
import { bin, shellEnv } from './bins'

let state: ClaudeLoginState = { status: 'idle' }
let child: ChildProcess | null = null
let emit: (e: EngineEvent) => void = () => {}
export const setLoginEmitter = (fn: (e: EngineEvent) => void) => (emit = fn)
export const loginState = () => state

const publish = (next: ClaudeLoginState) => {
  state = next
  emit({ type: 'claudeLogin', state })
}

/** `claude auth login`: the CLI opens the browser and waits for the sign-in. One at a time. */
export function startClaudeLogin(): ClaudeLoginState {
  if (child) return state
  publish({ status: 'pending' })
  let out = ''
  const p = spawn(bin('claude'), ['auth', 'login'], { env: shellEnv(), stdio: ['ignore', 'pipe', 'pipe'] })
  child = p
  const add = (d: Buffer) => {
    out = (out + String(d)).slice(-4000)
    // The link to open by hand when the browser didn't open.
    const url = out.match(/https:\/\/\S+/)?.[0]
    if (url && state.status === 'pending' && state.url !== url) publish({ status: 'pending', url })
  }
  p.stdout!.on('data', add)
  p.stderr!.on('data', add)
  const kill = setTimeout(() => p.kill('SIGTERM'), 10 * 60_000)
  p.on('error', (e) => publish({ status: 'error', message: e.message }))
  p.on('close', (code) => {
    clearTimeout(kill)
    child = null
    if (code === 0) publish({ status: 'ok' })
    else if (state.status !== 'error') publish({ status: 'error', message: out.trim().split('\n').slice(-2).join(' ') || `Sign-in exited with code ${code}` })
  })
  return state
}
