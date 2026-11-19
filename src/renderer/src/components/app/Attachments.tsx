import { useState } from 'react'
import { FileText, X } from 'lucide-react'
import type { Attachment } from '@shared/types'
import { cn } from '@/lib/utils'
import { Spinner } from '../affect/spinner'
import { Marquee } from './Marquee'
import { t } from '@/lib/i18n'

/** Claude reads at most this many images per message. */
export const MAX_IMAGES = 5
const MAX_FILES = 10
const IMAGE_RE = /\.(png|jpe?g|gif|webp)$/i

export type Pending = { id: string; name: string; size: number; kind: 'image' | 'file'; preview?: string; att?: Attachment; error?: string }

const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

/** Files waiting to go with the next prompt: saved right away so sending is instant. */
export function useAttachments(wsId: string | null) {
  const [files, setFiles] = useState<Pending[]>([])
  const [notice, setNotice] = useState<string | null>(null)

  const add = (list: File[]) => {
    if (!wsId || !list.length) return
    let images = files.filter((f) => f.kind === 'image').length
    let total = files.length
    const skipped: string[] = []
    const next: Pending[] = []
    for (const f of list) {
      const kind = IMAGE_RE.test(f.name) || f.type.startsWith('image/') ? 'image' : 'file'
      if (kind === 'image' && images >= MAX_IMAGES) {
        skipped.push(t('up to {n} images per message', { n: MAX_IMAGES }))
        continue
      }
      if (total >= MAX_FILES) {
        skipped.push(t('up to {n} files per message', { n: MAX_FILES }))
        continue
      }
      if (kind === 'image') images++
      total++
      // Pasted screenshots have no useful name.
      const name = f.name && f.name !== 'image.png' ? f.name : `screenshot-${Date.now().toString(36)}.png`
      const p: Pending = { id: crypto.randomUUID(), name, size: f.size, kind, preview: kind === 'image' ? URL.createObjectURL(f) : undefined }
      next.push(p)
      void f
        .arrayBuffer()
        .then((buf) => window.cm.saveAttachment(wsId, name, buf))
        .then(
          (att) => setFiles((l) => l.map((x) => (x.id === p.id ? { ...x, att } : x))),
          (e: Error) => setFiles((l) => l.map((x) => (x.id === p.id ? { ...x, error: e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') } : x)))
        )
    }
    setFiles((l) => [...l, ...next])
    setNotice(skipped.length ? t('Skipped {n}: {reasons}.', { n: skipped.length, reasons: [...new Set(skipped)].join(', ') }) : null)
  }

  const remove = (id: string) =>
    setFiles((l) => {
      const f = l.find((x) => x.id === id)
      if (f?.preview) URL.revokeObjectURL(f.preview)
      return l.filter((x) => x.id !== id)
    })

  const clear = () => {
    files.forEach((f) => f.preview && URL.revokeObjectURL(f.preview))
    setFiles([])
    setNotice(null)
  }

  const ready = files.every((f) => f.att || f.error)
  const attachments = files.flatMap((f) => (f.att ? [f.att] : []))
  return { files, notice, add, remove, clear, ready, attachments }
}

export function AttachmentChips({ files, notice, onRemove }: { files: Pending[]; notice: string | null; onRemove: (id: string) => void }) {
  if (!files.length && !notice) return null
  return (
    <div className="px-3 pt-3">
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {files.map((f) => (
            <div
              key={f.id}
              title={f.error ?? f.name}
              className={cn(
                'cm-in group relative flex h-11 max-w-[220px] items-center gap-2 rounded-xl border bg-raised pl-1.5 pr-2.5',
                f.error ? 'border-bad/40' : 'border-line'
              )}
            >
              {f.preview ? (
                <img src={f.preview} alt="" className="size-8 shrink-0 rounded-lg object-cover" />
              ) : (
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/[.05] text-dim">
                  <FileText size={15} />
                </span>
              )}
              <span className="min-w-0">
                <Marquee className="text-[12px] text-ink" delay={300}>{f.name}</Marquee>
                <span className={cn('block text-[10.5px]', f.error ? 'text-bad' : 'text-mute')}>{f.error ? t('Not attached') : fmtSize(f.size)}</span>
              </span>
              {!f.att && !f.error && <Spinner size={11} className="shrink-0 text-mute" />}
              <button
                aria-label={t('Remove {name}', { name: f.name })}
                onClick={() => onRemove(f.id)}
                className="absolute -right-1.5 -top-1.5 grid size-[18px] place-items-center rounded-full border border-line-strong bg-raised text-dim opacity-0 transition-opacity hover:text-ink group-hover:opacity-100"
              >
                <X size={10} strokeWidth={2.5} />
              </button>
            </div>
          ))}
        </div>
      )}
      {notice && <div className="cm-in pt-1.5 text-[11.5px] text-warn">{notice}</div>}
    </div>
  )
}
