import { webContents, type WebContents } from 'electron'
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import type { EngineEvent } from '@shared/types'

/*
 * The built-in browser (a <webview> in the right drawer) driven by the agent.
 * The cm2 MCP server calls this local bridge (127.0.0.1, random port, random token); every action
 * moves a visible cursor in the UI first, and screenshots go both back to the agent and, briefly, to the chat.
 */
let guestId: number | null = null
let emit: ((e: EngineEvent) => void) | null = null
let waiters: (() => void)[] = []
export const bridge = { url: '', token: randomBytes(24).toString('hex') }

export function setBrowserGuest(id: number | null) {
  guestId = id
  if (id) {
    for (const w of waiters) w()
    waiters = []
  }
}

/** The webview, asking the UI to show the Browser tab first if it isn't mounted yet. */
async function guest(): Promise<WebContents> {
  const existing = guestId ? webContents.fromId(guestId) : undefined
  if (existing && !existing.isDestroyed()) return existing
  emit?.({ type: 'browser-open' })
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('The browser panel did not open')), 8000)
    waiters.push(() => {
      clearTimeout(t)
      resolve()
    })
  })
  return webContents.fromId(guestId!)!
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

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

async function point(wc: WebContents, a: any): Promise<{ x: number; y: number }> {
  if (typeof a.x === 'number' && typeof a.y === 'number') return { x: a.x, y: a.y }
  if (typeof a.index === 'number') {
    const p = await wc.executeJavaScript(
      `(() => { const el = document.querySelector('[data-cm-i="${Number(a.index)}"]'); if (!el) return null; el.scrollIntoView({block:'center'}); const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) } })()`
    )
    if (!p) throw new Error(`No element #${a.index}; call browser_read again`)
    await sleep(150)
    return p
  }
  if (a.selector) {
    const p = await wc.executeJavaScript(
      `(() => { const el = document.querySelector(${JSON.stringify(a.selector)}); if (!el) return null; el.scrollIntoView({block:'center'}); const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) } })()`
    )
    if (!p) throw new Error(`No element matches ${a.selector}`)
    return p
  }
  throw new Error('Give index, selector or x/y')
}

async function click(wc: WebContents, ws: string, p: { x: number; y: number }) {
  emit?.({ type: 'cursor', workspaceId: ws, x: p.x, y: p.y, click: false })
  await sleep(380) // let the user see the cursor travel
  emit?.({ type: 'cursor', workspaceId: ws, x: p.x, y: p.y, click: true })
  wc.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y })
  wc.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1 })
  wc.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 1 })
  await sleep(250)
}

async function shot(wc: WebContents, ws: string, caption: string) {
  const img = await wc.capturePage()
  const small = img.getSize().width > 1100 ? img.resize({ width: 1100 }) : img
  const png = small.toPNG()
  emit?.({ type: 'shot', workspaceId: ws, dataUrl: `data:image/png;base64,${png.toString('base64')}`, caption, at: Date.now() })
  return png.toString('base64')
}

type Result = { text: string; image?: string }

async function act(ws: string, action: string, a: any): Promise<Result> {
  const wc = await guest()
  switch (action) {
    case 'navigate': {
      let url = String(a.url ?? '')
      if (!/^[a-z]+:\/\//i.test(url)) url = (/^(localhost|127\.|\[::1\])/.test(url) ? 'http://' : 'https://') + url
      emit?.({ type: 'browser-open' })
      await wc.loadURL(url).catch(() => {})
      await waitLoad(wc)
      return { text: `Loaded ${wc.getURL()} — "${wc.getTitle()}". Call browser_read to see the page.` }
    }
    case 'read': {
      const snap = await wc.executeJavaScript(SNAPSHOT)
      const els = snap.elements.map((e: any) => `#${e.i} ${e.tag}${e.type ? `[${e.type}]` : ''} "${e.text}"${e.visible ? '' : ' (below/above the fold: clicking scrolls to it)'}`).join('\n')
      return { text: `${snap.title}\n${snap.url}\n\nInteractive elements (click by index):\n${els || '(none visible)'}\n\nPage text:\n${snap.text}` }
    }
    case 'click': {
      const p = await point(wc, a)
      await click(wc, ws, p)
      await waitLoad(wc)
      return { text: `Clicked at ${p.x},${p.y}. Now at ${wc.getURL()}.` }
    }
    case 'type': {
      if (a.index !== undefined || a.selector || a.x !== undefined) await click(wc, ws, await point(wc, a))
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
      await wc.executeJavaScript(`scrollBy({ top: ${Number(a.dy) || 600}, behavior: 'smooth' })`)
      await sleep(400)
      return { text: 'Scrolled.' }
    }
    case 'screenshot': {
      const image = await shot(wc, ws, String(a.caption ?? wc.getTitle() ?? 'Screenshot'))
      return { text: `Screenshot of ${wc.getURL()}`, image }
    }
  }
  throw new Error(`Unknown browser action ${action}`)
}

export function startBrowserBridge(e: (ev: EngineEvent) => void): Promise<void> {
  emit = e
  const server = createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/browser' || req.headers['x-cm2-token'] !== bridge.token) {
      res.writeHead(404).end()
      return
    }
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', async () => {
      try {
        const { ws, action, args } = JSON.parse(body)
        const r = await act(String(ws), String(action), args ?? {})
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(r))
      } catch (err: any) {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ text: `Error: ${err.message}`, error: true }))
      }
    })
  })
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      bridge.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
      resolve()
    })
  )
}
