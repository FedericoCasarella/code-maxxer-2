import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Dialog } from '../affect/dialog'
import { Skeleton } from '../affect/shimmer-loader'
import { Marquee } from './Marquee'

/** A small image card with its caption: a browser check or an image the agent read. Null src: still loading. */
export function Shot({ src, caption, onOpen }: { src: string | null; caption: string; onOpen: () => void }) {
  const [loaded, setLoaded] = useState(false)
  return (
    <button
      onClick={onOpen}
      disabled={!src}
      title={caption}
      className="msg-shot-card w-[118px] shrink-0 overflow-hidden rounded-lg border border-line bg-raised text-left hover:border-line-strong"
      style={{ animation: 'cm-fade-up .45s cubic-bezier(.22,1,.36,1) both' }}
    >
      <div className="relative aspect-[16/10] w-full">
        {!loaded && <Skeleton className="absolute inset-0" width="100%" height="100%" radius={0} />}
        {src && (
          <img
            src={src}
            alt={caption}
            onLoad={() => setLoaded(true)}
            className={cn('block size-full object-cover object-top transition-opacity duration-200', loaded ? 'opacity-100' : 'opacity-0')}
          />
        )}
      </div>
      <Marquee className="px-2 py-1 text-[10.5px] text-dim" delay={300} hoverTarget=".msg-shot-card">{caption}</Marquee>
    </button>
  )
}

/** The image at full size. */
export function ShotDialog({ src, title, onClose }: { src: string; title: string; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={title} size="lg">
      <img src={src} alt="" className="block w-full rounded-lg border border-line" />
    </Dialog>
  )
}
