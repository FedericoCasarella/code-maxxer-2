/** An element the user clicked in the preview: what the agent needs to find it in the code. */
export type PreviewPick = {
  id: string
  /** The component that renders it (React, Vue or Svelte, from their dev builds) */
  component?: string
  /** Its source file, relative to the dev server, e.g. src/components/Card.tsx */
  file?: string
  line?: number
  selector: string
  tag: string
  text?: string
  url: string
}

/**
 * Runs inside the previewed page: outlines the element under the pointer, and on a click resolves with what it is.
 * Escape, or window.__cmPickStop(), resolves with null. The page's own click never fires.
 */
export const PICK_SCRIPT = String.raw`(() => new Promise((resolve) => {
  if (window.__cmPickStop) window.__cmPickStop();
  const box = document.createElement('div');
  const tag = document.createElement('div');
  box.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #4fb0fe;background:rgba(79,176,254,.12);border-radius:3px;transition:all 80ms ease;display:none';
  tag.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;padding:2px 6px;border-radius:5px;background:#141416;color:#fff;font:600 11px/16px Inter,system-ui,sans-serif;white-space:nowrap;display:none';
  document.documentElement.append(box, tag);
  const prevCursor = document.documentElement.style.cursor;
  document.documentElement.style.cursor = 'crosshair';

  const clean = (u) => {
    try { u = new URL(u).pathname } catch (e) {}
    u = decodeURIComponent(u.split('?')[0]).replace(/^\/@fs/, '');
    return u.replace(/^\/+/, '');
  };
  const fromStack = (s) => {
    if (!s) return null;
    for (const l of String(s).split('\n').slice(1)) {
      if (/node_modules|\.vite\/deps|react-stack-top-frame|jsx-dev-runtime|\/@react-refresh/.test(l)) continue;
      const m = l.match(/(https?:\/\/[^\s)]+?):(\d+):(\d+)/);
      if (m) return { file: clean(m[1]) };
    }
    return null;
  };
  const nameOf = (t) => t && (t.displayName || t.name || (t.render && (t.render.displayName || t.render.name)) || (t.type && (t.type.displayName || t.type.name)));
  const source = (el) => {
    const rk = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
    if (rk) {
      const f = el[rk];
      let c = f.return;
      while (c && !(typeof c.type === 'function' || (c.type && typeof c.type === 'object' && nameOf(c.type)))) c = c.return;
      const out = { component: c ? nameOf(c.type) : undefined };
      if (f._debugSource) return { ...out, file: clean(f._debugSource.fileName), line: f._debugSource.lineNumber };
      const s = fromStack(f._debugStack && f._debugStack.stack);
      return s ? { ...out, ...s } : out;
    }
    let v = el;
    while (v && !v.__vueParentComponent) v = v.parentElement;
    if (v) {
      const t = v.__vueParentComponent.type || {};
      return { component: t.name || t.__name, file: t.__file ? clean(t.__file) : undefined };
    }
    let s = el;
    while (s && !s.__svelte_meta) s = s.parentElement;
    if (s && s.__svelte_meta.loc) return { file: clean(s.__svelte_meta.loc.file), line: s.__svelte_meta.loc.line + 1 };
    return {};
  };
  const esc = (x) => (window.CSS && CSS.escape ? CSS.escape(x) : x);
  const generated = (c) => /^(css|sc|jsx|svelte|emotion|chakra|_)-|^[a-z]+-[a-z0-9]{5,}$|[0-9a-f]{6,}|__/.test(c);
  const unique = (sel) => { try { return document.querySelectorAll(sel).length === 1 } catch (e) { return false } };
  const selector = (el) => {
    if (el.id && unique('#' + esc(el.id))) return '#' + esc(el.id);
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && n !== document.documentElement && parts.length < 6; n = n.parentElement) {
      if (n.id && unique('#' + esc(n.id))) { parts.unshift('#' + esc(n.id)); break; }
      let p = n.tagName.toLowerCase();
      const cls = [...n.classList].filter((c) => !generated(c) && !c.includes(':')).slice(0, 2);
      if (cls.length) p += '.' + cls.map(esc).join('.');
      const same = n.parentElement ? [...n.parentElement.children].filter((x) => x.tagName === n.tagName) : [];
      if (same.length > 1) p += ':nth-of-type(' + (same.indexOf(n) + 1) + ')';
      parts.unshift(p);
      if (unique(parts.join(' > '))) break;
    }
    return parts.join(' > ');
  };

  let cur = null;
  const move = (e) => {
    const el = e.target instanceof Element ? e.target : document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === cur || el === box || el === tag) return;
    cur = el;
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    const s = source(el);
    tag.textContent = (s.component ? s.component + ' · ' : '') + el.tagName.toLowerCase();
    Object.assign(tag.style, { display: 'block', left: Math.max(4, r.left) + 'px', top: (r.top > 24 ? r.top - 22 : r.bottom + 4) + 'px' });
  };
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
  const end = (v) => {
    removeEventListener('mousemove', move, true);
    removeEventListener('click', click, true);
    removeEventListener('mousedown', stop, true);
    removeEventListener('mouseup', stop, true);
    removeEventListener('pointerdown', stop, true);
    removeEventListener('keydown', key, true);
    box.remove(); tag.remove();
    document.documentElement.style.cursor = prevCursor;
    window.__cmPickStop = undefined;
    resolve(v);
  };
  const click = (e) => {
    stop(e);
    const el = e.target instanceof Element && e.target !== document.documentElement ? e.target : document.elementFromPoint(e.clientX, e.clientY) || cur;
    if (!el) return end(null);
    const text = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('alt') || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    end({ ...source(el), selector: selector(el), tag: el.tagName.toLowerCase(), text: text || undefined, url: location.href });
  };
  const key = (e) => { if (e.key === 'Escape') { stop(e); end(null); } };
  addEventListener('mousemove', move, true);
  addEventListener('click', click, true);
  addEventListener('mousedown', stop, true);
  addEventListener('mouseup', stop, true);
  addEventListener('pointerdown', stop, true);
  addEventListener('keydown', key, true);
  window.__cmPickStop = () => end(null);
}))()`

/** The picked elements, as the lines that go with the message to the agent. */
export const picksText = (picks: PreviewPick[]) =>
  picks.length
    ? '\n\nElements I picked in the preview:\n' +
      picks
        .map((p) => {
          const where = p.file ? ` in \`${p.file}${p.line ? `:${p.line}` : ''}\`` : ''
          const what = p.component ? `\`<${p.component}>\` (${p.tag})` : `\`<${p.tag}>\``
          const text = p.text ? ` · text "${p.text}"` : ''
          let page = p.url
          try {
            page = new URL(p.url).pathname
          } catch { /* keep it whole */ }
          return `- ${what}${where} · selector \`${p.selector}\`${text} · page ${page}`
        })
        .join('\n')
    : ''

/** The preview tells the open chat's composer about a picked element. */
export const PICK_EVENT = 'cm-preview-pick'
