import { app, crashReporter, shell, type WebContents } from 'electron'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { totalmem } from 'node:os'
import { join } from 'node:path'
import { format } from 'node:util'

/*
 * One log file for support: ~/Library/Logs/Code-Maxxer/main.log. Errors and warnings from the main process,
 * the window (crashes, failed loads, errors thrown while drawing) and anything uncaught. Kept under 5 MB
 * (the previous file is main.old.log).
 */
const MAX = 5 * 1024 * 1024
export const logDir = () => app.getPath('logs')
const file = () => join(logDir(), 'main.log')

export function log(level: 'error' | 'warn' | 'info', ...args: unknown[]) {
  try {
    const dir = logDir()
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const f = file()
    if (existsSync(f) && statSync(f).size > MAX) renameSync(f, join(dir, 'main.old.log'))
    appendFileSync(f, `${new Date().toISOString()} ${level.toUpperCase()} ${format(...args)}\n`)
  } catch { /* logging never breaks the app */ }
}

/**
 * Native crashes (a segfault in the main process leaves no JS error): Electron's crash reporter writes a minidump,
 * kept on this Mac only (never uploaded). Must start before the app is ready.
 */
export function startCrashReporter() {
  try {
    crashReporter.start({ uploadToServer: false, compress: true })
  } catch { /* never breaks the launch */ }
}

/** Minidumps written since the last launch: their paths go in the log, so a crash can be looked at afterwards. */
function reportCrashDumps() {
  try {
    const dir = app.getPath('crashDumps')
    const mark = join(logDir(), 'crash-seen')
    const seen = existsSync(mark) ? Number(readFileSync(mark, 'utf8')) || 0 : 0
    const dumps: { path: string; at: number }[] = []
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name)
        if (e.isDirectory()) walk(p)
        else if (e.name.endsWith('.dmp')) dumps.push({ path: p, at: statSync(p).mtimeMs })
      }
    }
    if (existsSync(dir)) walk(dir)
    for (const d of dumps.filter((x) => x.at > seen).sort((a, b) => a.at - b.at))
      log('error', `native crash at ${new Date(d.at).toISOString()}: minidump ${d.path}`)
    writeFileSync(mark, String(Date.now()))
  } catch { /* never breaks the launch */ }
}

/** Called once at launch: console errors/warnings and uncaught failures also go to the file. */
export function startLogger() {
  const err = console.error.bind(console)
  const warn = console.warn.bind(console)
  console.error = (...a: unknown[]) => (log('error', ...a), err(...a))
  console.warn = (...a: unknown[]) => (log('warn', ...a), warn(...a))
  process.on('uncaughtException', (e) => log('error', 'uncaught', e?.stack ?? e))
  process.on('unhandledRejection', (e: any) => log('error', 'unhandled rejection', e?.stack ?? e))
  app.on('child-process-gone', (_e, d) => log('error', 'child process gone', d.type, d.reason, d.exitCode))
  reportCrashDumps()
  log('info', `start ${app.getName()} ${app.getVersion()} ${process.platform}-${process.arch} macOS ${process.getSystemVersion()} ram ${Math.round(totalmem() / 2 ** 30)}GB`)
}

/** The window: crashes, pages that don't load, errors in its console. */
export function watchWindow(wc: WebContents) {
  wc.on('render-process-gone', (_e, d) => log('error', 'window crashed', d.reason, d.exitCode))
  wc.on('did-fail-load', (_e, code, desc, url) => log('error', 'load failed', code, desc, url))
  wc.on('preload-error', (_e, path, e) => log('error', 'preload', path, e?.stack ?? e))
  wc.on('unresponsive', () => log('warn', 'window not responding'))
  wc.on('console-message', (e: any) => {
    const level = e.level ?? ''
    if (level === 'error' || level === 3) log('error', 'window:', e.message, e.sourceId ? `(${e.sourceId}:${e.lineNumber})` : '')
  })
}

export const openLogs = () => {
  if (!existsSync(file())) log('info', 'log opened')
  shell.showItemInFolder(file())
}
