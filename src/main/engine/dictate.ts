import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import type { EngineEvent } from '@shared/types'

/** Source of the Swift helper (Apple's on-device speech recognizer) and where it gets built. */
const SRC = () => join(app.getAppPath(), 'resources', 'dictate')
const BIN = join(homedir(), '.code-maxxer-2', 'bin', 'cm2-dictate')

const run = (cmd: string, args: string[]) =>
  new Promise<void>((ok, fail) => execFile(cmd, args, (e, _o, err) => (e ? fail(new Error(String(err || e.message).trim())) : ok())))

/** Build the helper the first time (and again when its source changes). Needs the Xcode command line tools. */
async function ensureBinary(): Promise<string> {
  const src = join(SRC(), 'main.swift')
  if (existsSync(BIN) && statSync(BIN).mtimeMs >= statSync(src).mtimeMs) return BIN
  await mkdir(join(BIN, '..'), { recursive: true })
  await run('/usr/bin/swiftc', ['-O', src, '-o', BIN, '-Xlinker', '-sectcreate', '-Xlinker', '__TEXT', '-Xlinker', '__info_plist', '-Xlinker', join(SRC(), 'Info.plist')])
  // A stable identity, so the microphone and speech permissions stick to the helper.
  await run('/usr/bin/codesign', ['-s', '-', '-f', '-i', 'dev.codemaxxer.dictate', BIN])
  return BIN
}

let current: ChildProcess | null = null

export async function startDictation(locale: string, emit: (e: EngineEvent) => void): Promise<void> {
  stopDictation(false)
  let bin: string
  try {
    bin = await ensureBinary()
  } catch (e: any) {
    emit({ type: 'dictation', event: 'error', message: `Couldn't build the dictation helper: ${e.message}` })
    return
  }
  // Own process group: the helper re-launches itself, and both must go when we stop.
  const child = spawn(bin, [locale], { stdio: ['pipe', 'pipe', 'pipe'], detached: true })
  current = child
  let buf = ''
  child.stdout.on('data', (d) => {
    buf += d
    let i: number
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i)
      buf = buf.slice(i + 1)
      try {
        const m = JSON.parse(line)
        if (m.type === 'level') emit({ type: 'dictation', event: 'level', level: Math.min(1, m.rms * 12) })
        else emit({ type: 'dictation', event: m.type, text: m.text, message: m.message })
      } catch { /* not ours */ }
    }
  })
  child.on('close', () => {
    if (current === child) current = null
    emit({ type: 'dictation', event: 'end' })
  })
}

/** keep: let the recognizer finish the last words; otherwise drop everything now. */
export function stopDictation(keep: boolean) {
  const c = current
  if (!c) return
  if (keep) {
    c.stdin?.end('stop\n')
    // The helper's child shares the pipe: make sure the whole group ends.
    setTimeout(() => {
      try {
        process.kill(-c.pid!, 'SIGKILL')
      } catch { /* already gone */ }
    }, 2500)
  }
  else {
    current = null
    try {
      process.kill(-c.pid!, 'SIGKILL')
    } catch {
      c.kill('SIGKILL')
    }
  }
}
