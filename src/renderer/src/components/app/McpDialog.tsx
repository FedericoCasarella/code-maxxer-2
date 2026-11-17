import { useEffect, useState } from 'react'
import { Check, Copy, Eye, EyeOff, Plug, RefreshCw } from 'lucide-react'
import { actions, useStore } from '@/lib/store'
import { ConfirmDialog } from './ConfirmDialog'

/** App menu → Connect External Agents (MCP)…: URL, token and a ready-to-paste config for Hermes & co. */
export function McpDialog() {
  const open = useStore((s) => s.mcpDialog)
  const [info, setInfo] = useState<{ url: string; token: string } | null>(null)
  const [show, setShow] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [rotate, setRotate] = useState(false)
  useEffect(() => {
    if (open) void window.cm.mcpInfo().then(setInfo)
  }, [open])
  if (!open) return null
  const close = () => {
    actions.openMcpDialog(false)
    setShow(false)
  }
  const config = info
    ? JSON.stringify({ mcpServers: { 'code-maxxer': { type: 'http', url: info.url, headers: { Authorization: `Bearer ${info.token}` } } } }, null, 2)
    : ''
  const copy = (key: string, v: string) => {
    void navigator.clipboard.writeText(v)
    setCopied(key)
    setTimeout(() => setCopied(null), 1400)
  }
  const CopyBtn = ({ k, v }: { k: string; v: string }) => (
    <button onClick={() => copy(k, v)} className="grid size-7 shrink-0 place-items-center rounded-md text-mute hover:bg-white/[.06] hover:text-ink" aria-label="Copy">
      {copied === k ? <Check size={13} /> : <Copy size={13} />}
    </button>
  )

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 backdrop-blur-[2px]" onMouseDown={close}>
      <div className="cm-in w-[520px] rounded-2xl border border-line-strong bg-raised p-5 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 text-[15px] font-semibold">
          <Plug size={16} className="text-accent" /> Connect external agents
        </div>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-dim">
          Hermes (or any MCP client) can drive code-maxxer: list projects and branches, send prompts, run pipelines, read replies, manage issues,
          brain and scheduled runs. Local only (127.0.0.1), while the app is open.
        </p>
        {info && (
          <div className="mt-4 flex flex-col gap-2.5">
            <Field label="URL (Streamable HTTP)">
              <code className="selectable min-w-0 flex-1 truncate font-mono text-[12px]">{info.url}</code>
              <CopyBtn k="url" v={info.url} />
            </Field>
            <Field label="Bearer token">
              <code className="selectable min-w-0 flex-1 truncate font-mono text-[12px]">{show ? info.token : '•'.repeat(28)}</code>
              <button onClick={() => setShow((x) => !x)} className="grid size-7 place-items-center rounded-md text-mute hover:text-ink" aria-label={show ? 'Hide' : 'Show'}>
                {show ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
              <CopyBtn k="token" v={info.token} />
            </Field>
            <div>
              <div className="mb-1 flex items-center text-[11.5px] font-medium text-dim">
                Config to paste in Hermes
                <span className="ml-auto"><CopyBtn k="cfg" v={config} /></span>
              </div>
              <pre className="selectable max-h-48 overflow-auto rounded-lg border border-line bg-panel p-3 font-mono text-[11.5px] leading-relaxed text-dim">
                {show ? config : config.replace(info.token, '•'.repeat(12))}
              </pre>
            </div>
          </div>
        )}
        <div className="mt-5 flex items-center gap-2">
          <button onClick={() => setRotate(true)} className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] text-dim hover:bg-white/5 hover:text-ink">
            <RefreshCw size={13} /> New token
          </button>
          <div className="flex-1" />
          <button onClick={close} className="h-8 rounded-lg bg-ink px-4 text-[12.5px] font-medium text-black">Done</button>
        </div>
      </div>
      {rotate && (
        <ConfirmDialog
          title="Create a new token?"
          confirmLabel="Create new token"
          onClose={() => setRotate(false)}
          onConfirm={async () => setInfo(await window.cm.rotateMcpToken())}
        >
          Clients using the current token stop working until you give them the new one.
        </ConfirmDialog>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[11.5px] font-medium text-dim">{label}</div>
      <div className="flex h-9 items-center gap-1 rounded-lg border border-line bg-input pl-3 pr-1">{children}</div>
    </div>
  )
}
