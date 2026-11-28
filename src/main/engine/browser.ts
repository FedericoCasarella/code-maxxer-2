import { BrowserWindow, webContents, type WebContents } from 'electron'
import { createServer } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, extname, resolve, sep } from 'node:path'
import { db } from '../db'
import { randomBytes } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import type { EngineEvent } from '@shared/types'

/*
 * The built-in browser (a <webview> in the right drawer) driven by the agent.
 * The cm2 MCP server calls this local bridge (127.0.0.1, random port, random token); every action
 * moves a visible cursor in the UI first, and screenshots go both back to the agent and, briefly, to the chat.
 */
/** One webview per branch: the agent of a branch drives its own page, never the one the user is looking at. */
const guests = new Map<string, number>()
let emit: ((e: EngineEvent) => void) | null = null
const waiters = new Map<string, (() => void)[]>()
export const bridge = { url: '', token: randomBytes(24).toString('hex') }

export function setBrowserGuest(ws: string, id: number | null) {
  if (!id) return void guests.delete(ws)
  guests.set(ws, id)
  // Agents' pages never play sound: a video or audio in a preview can't be stopped by the user while the agent works
  webContents.fromId(id)?.setAudioMuted(true)
  // The panel is back: a page the agent opened in the hidden stand-in moves to it
  if (head(ws)?.fallback) closeHeadless(ws)
  for (const w of waiters.get(ws) ?? []) w()
  waiters.delete(ws)
}

const live = (ws: string) => {
  const id = guests.get(ws)
  const wc = id ? webContents.fromId(id) : undefined
  return wc && !wc.isDestroyed() ? wc : undefined
}

/**
 * The branch's webview, asking the UI to make one if there isn't one yet. When the panel can't show it (drawer
 * folded, another page open, the window hidden), the agent works in a hidden browser instead of stopping to ask
 * the user to open the panel; the page moves to the panel when it shows.
 */
async function guest(ws: string): Promise<WebContents> {
  const existing = live(ws)
  if (existing) return existing
  const stand = head(ws)
  if (stand) return stand.win.webContents
  emit?.({ type: 'browser-open', workspaceId: ws })
  const opened = await new Promise<boolean>((resolve) => {
    const t = setTimeout(() => resolve(false), 4000)
    waiters.set(ws, [
      ...(waiters.get(ws) ?? []),
      () => {
        clearTimeout(t)
        resolve(true)
      }
    ])
  })
  const g = opened ? live(ws) : undefined
  if (g) return g
  await openHeadless(ws, undefined, 1280, 800, 'Desktop 1280×800 (hidden)', true)
  return head(ws)!.win.webContents
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/*
 * A size that doesn't fit the panel (desktop in a narrow drawer, a phone taller than it) is tested in a hidden
 * browser at the real size: same session as the panel (cookies, sign-in), real layout, real screenshots.
 * The panel only says so; the agent's cursor isn't drawn there meanwhile.
 */
/** fallback: opened because the panel wasn't there (it closes when the panel shows), not for a size. */
const heads = new Map<string, { win: BrowserWindow; label: string; fallback?: boolean }>()
const head = (ws: string) => {
  const h = heads.get(ws)
  return h && !h.win.isDestroyed() ? h : undefined
}

/** The page the agent drives: the hidden browser while one is open, else the branch's webview. */
async function target(ws: string): Promise<WebContents> {
  return head(ws)?.win.webContents ?? (await guest(ws))
}

/** The hidden browser closes; the panel takes the page it was on. */
export function closeHeadless(ws: string) {
  const h = head(ws)
  heads.delete(ws)
  if (!h) return
  const url = h.win.webContents.getURL()
  // close(), not destroy(): a destroyed offscreen window breaks the next one's page loads
  h.win.close()
  const g = live(ws)
  if (g && /^https?:/.test(url) && g.getURL() !== url) void g.loadURL(url).catch(() => {})
  emit?.({ type: 'browser-headless', workspaceId: ws, label: null })
}

async function openHeadless(ws: string, from: WebContents | undefined, width: number, height: number, label: string, fallback = false): Promise<string> {
  let h = head(ws)
  if (!h) {
    const win = new BrowserWindow({
      show: false,
      width,
      height,
      useContentSize: true,
      enableLargerThanScreen: true,
      webPreferences: { partition: 'persist:cm2-browser', offscreen: true, sandbox: true, contextIsolation: true }
    })
    win.webContents.setFrameRate(30)
    win.webContents.setAudioMuted(true)
    h = { win, label, fallback }
    heads.set(ws, h)
    const url = from?.getURL() ?? ''
    if (/^https?:/.test(url)) {
      await win.loadURL(url).catch(() => {})
      await waitLoad(win.webContents)
    }
  } else {
    h.label = label
    h.fallback = fallback
  }
  // The real size from the window itself (offscreen and larger-than-screen, so nothing clamps it). No CDP device
  // override: on a page with no view yet (nothing loaded) it crashes the whole app in Chromium.
  h.win.setContentSize(width, height)
  views.set(ws, { scale: 1, label, last: null })
  emit?.({ type: 'browser-headless', workspaceId: ws, label })
  await sleep(300)
  return `Viewport ${label}, in a hidden browser at the real size (the panel is too small to show it). Take a browser_screenshot to check the layout.`
}

/** The agent asks for a size: in the panel when it fits, else in the hidden browser. */
async function agentViewport(ws: string, a: any): Promise<string> {
  const name = String(a.preset ?? '')
  if (name === 'panel' || name === 'reset') {
    closeHeadless(ws)
    return setViewport(await guest(ws), ws, a)
  }
  const preset = (VIEWPORTS as Record<string, { width: number; height: number; label: string }>)[name]
  const width = Math.round(Number(a.width) || preset?.width || 0)
  const height = Math.round(Number(a.height) || preset?.height || 0)
  if (!width || !height) throw new Error(`Give a preset (${Object.keys(VIEWPORTS).join(', ')}, panel) or width and height`)
  const g = await guest(ws)
  const ps = panelSize.get(ws)
  const [pw, ph] = ps ? [ps.w, ps.h] : await g.executeJavaScript('[innerWidth, innerHeight]')
  const label = preset && !a.width ? preset.label : `${width}×${height}`
  if (width > pw || height > ph) {
    const from = head(ws)?.win.webContents ?? g
    return openHeadless(ws, from, width, height, label)
  }
  closeHeadless(ws)
  return setViewport(g, ws, a)
}

/** The agent's cursor in the panel: not while it works in the hidden browser. */
function cursor(ws: string, c: { x: number; y: number; click: boolean; label: string }) {
  if (!head(ws)) emit?.({ type: 'cursor', workspaceId: ws, ...c })
}

/*
 * Viewports the agent tests at. The page renders at the real size and is scaled down to fit the panel,
 * so the user watches the desktop layout too, not only the narrow panel.
 */
export const VIEWPORTS = {
  iphone: { width: 393, height: 852, label: 'iPhone 393×852' },
  mobile: { width: 390, height: 844, label: 'Mobile 390×844' },
  ipad: { width: 820, height: 1180, label: 'iPad 820×1180' },
  tablet: { width: 820, height: 1180, label: 'Tablet 820×1180' },
  mac: { width: 1440, height: 900, label: 'Mac 1440×900' },
  desktop: { width: 1920, height: 1080, label: 'Desktop 1920×1080' },
  ultrawide: { width: 3440, height: 1440, label: 'Ultrawide 3440×1440' }
} as const
/** Each branch's emulated viewport: CSS px → panel px, its label, and the last one asked for (applied again on resize). */
type View = { scale: number; label: string | null; last: any }
const views = new Map<string, View>()
const viewOf = (ws: string): View => {
  let v = views.get(ws)
  if (!v) views.set(ws, (v = { scale: 1, label: null, last: null }))
  return v
}
const toView = (ws: string, p: { x: number; y: number }) => ({ x: Math.round(p.x * viewOf(ws).scale), y: Math.round(p.y * viewOf(ws).scale) })

/*
 * The panel's page never gets a CDP device override: Emulation.setDeviceMetricsOverride on a webview whose view is
 * gone for a moment (hidden, navigating, resizing) crashes the whole app in Chromium
 * (WebContentsImpl::SetDeviceEmulationSize on a null view), and no check beforehand closes that window.
 * The size is CSS instead: the renderer makes the webview element as big as the device and scales it down to fit.
 * Main only works out the size and the scale, from the panel's size the renderer reports.
 */
const panelSize = new Map<string, { w: number; h: number }>()
/** Which branch's page is on screen (kept for the renderer's calls; the CSS size is safe on any page). */
export function setShownBrowser(_ws: string | null) {}
const HIDDEN = 'The browser panel is hidden or still loading: the viewport applies when it shows again.'

function setViewport(_wc: WebContents | undefined, ws: string, a: any): Promise<string> {
  return Promise.resolve().then(() => setViewportNow(ws, a))
}

async function setViewportNow(ws: string, a: any): Promise<string> {
  const name = String(a.preset ?? '')
  const v = viewOf(ws)
  v.last = name === 'panel' || name === 'reset' ? null : a
  if (name === 'panel' || name === 'reset') {
    v.scale = 1
    v.label = null
    emit?.({ type: 'browser-viewport', workspaceId: ws, label: null, preset: null })
    return 'Back to the panel size.'
  }
  const preset = (VIEWPORTS as Record<string, { width: number; height: number; label: string }>)[name]
  const width = Math.round(Number(a.width) || preset?.width || 0)
  let height = Math.round(Number(a.height) || preset?.height || 0)
  if (!width || !height) throw new Error(`Give a preset (${Object.keys(VIEWPORTS).join(', ')}, panel) or width and height`)
  // The panel's own size decides the zoom; until the renderer has reported it, the choice waits (applied on refit)
  const ps = panelSize.get(ws)
  if (!ps || ps.w < 50 || ps.h < 50) return HIDDEN
  const { w: pw, h: ph } = ps
  let viewScale = Math.min(1, pw / width, ph / height)
  // Desktop sizes fill the panel's height (a page is as tall as the window shows); phones and tablets keep the device's
  if (width >= 1024 && !a.height) {
    // Fitted to the panel's width both ways: a panel wider than the preset zooms in instead of leaving a dark band
    viewScale = pw / width
    height = Math.max(1, Math.round(ph / viewScale))
  }
  const viewLabel = preset && !a.width ? preset.label : `${width}×${height}`
  v.scale = viewScale
  v.label = viewLabel
  emit?.({ type: 'browser-viewport', workspaceId: ws, label: viewLabel, preset: preset && !a.width ? name : null, width, height, scale: viewScale })
  await sleep(300)
  return `Viewport ${viewLabel}${viewScale !== 1 ? ` (shown at ${Math.round(viewScale * 100)}% in the panel)` : ''}. Take a browser_screenshot to check the layout.`
}

/** The user's pick in a branch's preview: a preset, or null to fit the panel. */
export async function setPreviewViewport(ws: string, preset: string | null): Promise<void> {
  closeHeadless(ws)
  await setViewport(undefined, ws, { preset: preset ?? 'panel' })
}

/** A branch's panel changed size (reported by the renderer): its viewport is fitted again. */
export async function refitViewport(ws: string, size?: { w: number; h: number }): Promise<void> {
  if (size) panelSize.set(ws, size)
  if (head(ws)) return
  const last = views.get(ws)?.last
  if (last) await setViewport(undefined, ws, last)
}

async function waitLoad(wc: WebContents) {
  if (!wc.isLoading()) return
  await Promise.race([new Promise((r) => (wc as any).once('did-stop-loading', r)), sleep(15_000)])
}

/** Interactive elements with their centers, numbered: the agent clicks by index. */
const SNAPSHOT = `(() => {
  const els = [...document.querySelectorAll('a,button,input,textarea,select,[role=button],[role=link],[role=tab],[role=menuitem],[contenteditable=true],summary,label')]
  const out = []
  for (const el of els) {
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) continue
    const s = getComputedStyle(el)
    if (s.visibility === 'hidden' || s.display === 'none' || +s.opacity === 0) continue
    const text = (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || '').trim().replace(/\\s+/g, ' ').slice(0, 80)
    // Tag it so a click by index finds the same element again (and scrolls it into view).
    el.setAttribute('data-cm-i', String(out.length))
    const visible = r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth
    out.push({ i: out.length, tag: el.tagName.toLowerCase(), type: el.getAttribute('type') || undefined, text, visible, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) })
    if (out.length >= 150) break
  }
  return { url: location.href, title: document.title, text: document.body ? document.body.innerText.slice(0, 5000) : '', elements: out }
})()`

async function point(wc: WebContents, a: any): Promise<{ x: number; y: number; label?: string }> {
  if (typeof a.x === 'number' && typeof a.y === 'number') return { x: a.x, y: a.y }
  if (typeof a.index === 'number') {
    const p = await wc.executeJavaScript(
      `(() => { const el = document.querySelector('[data-cm-i="${Number(a.index)}"]'); if (!el) return null; el.scrollIntoView({block:'center'}); const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2), label: (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim().replace(/\\s+/g,' ') } })()`
    )
    if (!p) throw new Error(`No element #${a.index}; call browser_read again`)
    await sleep(150)
    return p
  }
  if (a.selector) {
    const p = await wc.executeJavaScript(
      `(() => { const el = document.querySelector(${JSON.stringify(a.selector)}); if (!el) return null; el.scrollIntoView({block:'center'}); const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2), label: (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim().replace(/\\s+/g,' ') } })()`
    )
    if (!p) throw new Error(`No element matches ${a.selector}`)
    return p
  }
  throw new Error('Give index, selector or x/y')
}

const lastPoints = new Map<string, { x: number; y: number }>()
async function click(wc: WebContents, ws: string, p: { x: number; y: number; label?: string }, label = 'clicking…') {
  const what = p.label ? `${label.replace('…', '')} “${p.label.slice(0, 40)}”` : label
  // The page gets its own CSS px (the webview is scaled in CSS); the drawn cursor sits where that point shows in the panel
  const c = toView(ws, p)
  cursor(ws, { x: c.x, y: c.y, click: false, label: what })
  await sleep(380) // let the user see the cursor travel
  cursor(ws, { x: c.x, y: c.y, click: true, label: what })
  lastPoints.set(ws, { x: c.x, y: c.y })
  wc.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y })
  wc.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1 })
  wc.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 1 })
  await sleep(250)
}

async function shot(wc: WebContents, ws: string, caption: string) {
  const viewLabel = views.get(ws)?.label
  const h = head(ws)
  if (h) caption = `${caption} · ${h.label}`
  // The page renders at its real size (only scaled in CSS), so the capture is the whole viewport at its real layout
  if (viewLabel) caption = `${caption} · ${viewLabel}`
  const img = await wc.capturePage()
  const max = viewLabel || h ? 1600 : 1100
  const small = img.getSize().width > max ? img.resize({ width: max }) : img
  const png = small.toPNG()
  emit?.({ type: 'shot', workspaceId: ws, dataUrl: `data:image/png;base64,${png.toString('base64')}`, caption, at: Date.now() })
  return png.toString('base64')
}

type Result = { text: string; image?: string }

async function act(ws: string, action: string, a: any): Promise<Result> {
  const wc = await target(ws)
  const lastPoint = head(ws) ? undefined : lastPoints.get(ws)
  const viewLabel = views.get(ws)?.label
  switch (action) {
    case 'navigate': {
      let url = String(a.url ?? '')
      if (!/^[a-z]+:\/\//i.test(url)) url = (/^(localhost|127\.|\[::1\])/.test(url) ? 'http://' : 'https://') + url
      await wc.loadURL(url).catch(() => {})
      await waitLoad(wc)
      return { text: `Loaded ${wc.getURL()} — "${wc.getTitle()}". Call browser_read to see the page.` }
    }
    case 'read': {
      if (lastPoint) cursor(ws, { ...lastPoint, click: false, label: 'reading the page…' })
      const snap = await wc.executeJavaScript(SNAPSHOT)
      const els = snap.elements.map((e: any) => `#${e.i} ${e.tag}${e.type ? `[${e.type}]` : ''} "${e.text}"${e.visible ? '' : ' (below/above the fold: clicking scrolls to it)'}`).join('\n')
      return { text: `${snap.title}\n${snap.url}${viewLabel ? `\nViewport: ${viewLabel}` : ''}\n\nInteractive elements (click by index):\n${els || '(none visible)'}\n\nPage text:\n${snap.text}` }
    }
    case 'click': {
      const p = await point(wc, a)
      await click(wc, ws, p)
      await waitLoad(wc)
      return { text: `Clicked at ${p.x},${p.y}. Now at ${wc.getURL()}.` }
    }
    case 'type': {
      const typing = `typing “${String(a.text ?? '').slice(0, 30)}”`
      if (a.index !== undefined || a.selector || a.x !== undefined) await click(wc, ws, await point(wc, a), 'focusing…')
      const at = lastPoints.get(ws)
      if (at) cursor(ws, { ...at, click: false, label: typing })
      if (a.clear) {
        wc.selectAll()
        wc.delete()
      }
      await wc.insertText(String(a.text ?? ''))
      if (a.submit) {
        wc.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' })
        wc.sendInputEvent({ type: 'char', keyCode: '\r' })
        wc.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' })
        await sleep(300)
        await waitLoad(wc)
      }
      return { text: 'Typed.' }
    }
    case 'key': {
      const k = String(a.key ?? 'Enter')
      wc.sendInputEvent({ type: 'keyDown', keyCode: k })
      wc.sendInputEvent({ type: 'keyUp', keyCode: k })
      await sleep(200)
      return { text: `Pressed ${k}.` }
    }
    case 'scroll': {
      if (lastPoint) cursor(ws, { ...lastPoint, click: false, label: 'scrolling…' })
      await wc.executeJavaScript(`scrollBy({ top: ${Number(a.dy) || 600}, behavior: 'smooth' })`)
      await sleep(400)
      return { text: 'Scrolled.' }
    }
    case 'viewport':
      return { text: await agentViewport(ws, a) }
    case 'screenshot': {
      if (lastPoint) cursor(ws, { ...lastPoint, click: false, label: 'taking a screenshot' })
      const image = await shot(wc, ws, String(a.caption ?? wc.getTitle() ?? 'Screenshot'))
      // Kept as a file in the branch's folder (e.g. for the user manual)
      if (a.save_to) {
        const root = (await db.workspace(ws))?.worktreePath
        const file = root ? resolve(root, String(a.save_to)) : ''
        if (!root || !file.startsWith(root + sep) || extname(file).toLowerCase() !== '.png') return { text: 'save_to must be a .png path inside your folder.', image }
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(file, Buffer.from(image, 'base64'))
        return { text: `Screenshot of ${wc.getURL()}, saved to ${String(a.save_to)}`, image }
      }
      return { text: `Screenshot of ${wc.getURL()}`, image }
    }
  }
  throw new Error(`Unknown browser action ${action}`)
}

/** App features the cm2 MCP server can call (security scans, server access…): name → handler. */
type AppAction = (ws: string, args: any) => Promise<{ text: string; error?: boolean }>
const appActions = new Map<string, AppAction>()
export const registerAppAction = (name: string, fn: AppAction) => appActions.set(name, fn)

export function startBrowserBridge(e: (ev: EngineEvent) => void): Promise<void> {
  emit = e
  const server = createServer((req, res) => {
    if (req.method !== 'POST' || (req.url !== '/browser' && req.url !== '/app') || req.headers['x-cm2-token'] !== bridge.token) {
      res.writeHead(404).end()
      return
    }
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', async () => {
      try {
        const { ws, action, args } = JSON.parse(body)
        const fn = req.url === '/app' ? appActions.get(String(action)) : null
        if (req.url === '/app' && !fn) throw new Error(`Unknown action ${action}`)
        const r = fn ? await fn(String(ws), args ?? {}) : await act(String(ws), String(action), args ?? {})
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(r))
      } catch (err: any) {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ text: `Error: ${err.message}`, error: true }))
      }
    })
  })
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      bridge.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
      // Dev aid (with the CDP debug port): lets automated checks drive the browser like the agent does.
      if (process.env.CM2_DEBUG_PORT) console.log(`[bridge] ${bridge.url} ${bridge.token}`)
      resolve()
    })
  )
}
