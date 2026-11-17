import { useEffect, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Brain } from 'lucide-react'
import { ShimmerText } from '../affect/shimmer-loader'

// The lucide brain as a mask, so the same light that sweeps the label sweeps the icon.
const MASK = `url("data:image/svg+xml,${encodeURIComponent(renderToStaticMarkup(<Brain size={24} color="#000" />))}")`

/** Agent at work: a brain and a label, both with affectUI's shimmer, walking through phases. */
export function Working({ phases, interval = 2600 }: { phases: string[]; interval?: number }) {
  const [i, setI] = useState(0)
  useEffect(() => {
    if (phases.length < 2) return
    const id = setInterval(() => setI((x) => (x + 1) % phases.length), interval)
    return () => clearInterval(id)
  }, [phases.length, interval])
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px]">
      {/* Same class as the label (its styles come with it), masked to the icon's shape and painted edge to edge. */}
      <span
        aria-hidden
        className="ui-shm-text size-[15px] shrink-0"
        style={{
          WebkitMask: `${MASK} center / contain no-repeat`,
          mask: `${MASK} center / contain no-repeat`,
          WebkitBackgroundClip: 'border-box',
          backgroundClip: 'border-box'
        }}
      />
      <ShimmerText key={i} className="cm-in">
        {phases[i % phases.length]}
      </ShimmerText>
    </span>
  )
}
