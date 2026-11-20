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
  // The installed app ships the helper already built and signed: no Xcode tools needed on the user's Mac
  const shipped = join(SRC(), 'cm2-dictate')
  if (app.isPackaged && existsSync(shipped)) return shipped
  const src = join(SRC(), 'main.swift')
  if (existsSync(BIN) && statSync(BIN).mtimeMs >= statSync(src).mtimeMs) return BIN
  await mkdir(join(BIN, '..'), { recursive: true })
  await run('/usr/bin/swiftc', ['-O', src, '-o', BIN, '-Xlinker', '-sectcreate', '-Xlinker', '__TEXT', '-Xlinker', '__info_plist', '-Xlinker', join(SRC(), 'Info.plist')])
  // A stable identity, so the microphone and speech permissions stick to the helper.
  await run('/usr/bin/codesign', ['-s', '-', '-f', '-i', 'dev.codemaxxer.dictate', BIN])
  return BIN
}

let current: ChildProcess | null = null
let lastLocale = 'en-US'
/** A helper with the model already loaded, waiting for "start": dictation then begins at once */
let warm: { child: ChildProcess; locale: string; ready: boolean; attach: (emit: (e: EngineEvent) => void) => void } | null = null

/** Starts the helper; its lines go to whoever is attached (nobody while it waits warm). */
function launch(bin: string, locale: string, standby: boolean) {
  // Own process group: the helper re-launches itself, and both must go when we stop.
  const child = spawn(bin, standby ? [locale, '--standby'] : [locale], { stdio: ['pipe', 'pipe', 'pipe'], detached: true })
  let sink: ((e: EngineEvent) => void) | null = null
  const entry = { child, locale, ready: false, attach: (emit: (e: EngineEvent) => void) => (sink = emit) }
  let buf = ''
  child.stdout!.on('data', (d) => {
    buf += d
    let i: number
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i)
      buf = buf.slice(i + 1)
      try {
        const m = JSON.parse(line)
        if (m.type === 'standby') entry.ready = true
        else if (!sink) continue
        else if (m.type === 'level') sink({ type: 'dictation', event: 'level', level: Math.min(1, m.rms * 12) })
        else sink({ type: 'dictation', event: m.type, text: m.text, message: m.message })
      } catch { /* not ours */ }
    }
  })
  child.on('close', () => {
    if (warm?.child === child) warm = null
    if (current === child) {
      current = null
      sink?.({ type: 'dictation', event: 'end' })
      // The next dictation starts warm again
      setTimeout(() => void prewarmDictation(locale), 800)
    }
  })
  return entry
}

/** Keep a helper ready (model loaded, microphone closed) so pressing the mic starts listening at once. */
export async function prewarmDictation(locale: string): Promise<void> {
  lastLocale = locale
  if (process.platform !== 'darwin' || current) return
  if (warm && warm.locale === locale) return
  killGroup(warm?.child)
  warm = null
  try {
    warm = launch(await ensureBinary(), locale, true)
  } catch { /* the real start reports it */ }
}

const killGroup = (c: ChildProcess | null | undefined) => {
  if (!c) return
  try {
    process.kill(-c.pid!, 'SIGKILL')
  } catch {
    c.kill('SIGKILL')
  }
}

export async function startDictation(locale: string, emit: (e: EngineEvent) => void): Promise<void> {
  lastLocale = locale
  stopDictation(false)
  if (warm && warm.locale === locale && warm.child.exitCode === null) {
    const w = warm
    warm = null
    current = w.child
    w.attach(emit)
    // Not loaded yet: it opens the microphone as soon as it is
    w.child.stdin!.write('start\n')
    return
  }
  killGroup(warm?.child)
  warm = null
  let bin: string
  try {
    bin = await ensureBinary()
  } catch (e: any) {
    emit({ type: 'dictation', event: 'error', message: `Couldn't build the dictation helper: ${e.message}` })
    return
  }
  const entry = launch(bin, locale, false)
  current = entry.child
  entry.attach(emit)
}

/** On quit: no helper outlives the app */
export function shutdownDictation() {
  killGroup(warm?.child)
  warm = null
  stopDictation(false)
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
    killGroup(c)
    setTimeout(() => void prewarmDictation(lastLocale), 800)
  }
}
