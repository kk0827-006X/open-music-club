import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useReducedMotion } from '../hooks.ts'
import { FALLBACK_PALETTE, loadAlbumPalette, type AlbumPalette } from './palette.ts'

export const AMBIENT_CROSSFADE_MS = 1400
const paletteKey = (palette: AlbumPalette) => palette.join('|')

export function AmbientAlbumBackground({ coverUrl, active, loadPalette = loadAlbumPalette }: {
  coverUrl?: string | null; active: boolean; loadPalette?: (source?: string | null) => Promise<AlbumPalette>
}) {
  const reduced = useReducedMotion()
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden)
  const [layers, setLayers] = useState<AlbumPalette[]>([FALLBACK_PALETTE, FALLBACK_PALETTE])
  const [front, setFront] = useState(0)
  const [fading, setFading] = useState(false)
  const frontRef = useRef(0)
  const busy = useRef(false)
  const target = useRef(paletteKey(FALLBACK_PALETTE))
  const pending = useRef<AlbumPalette | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const paintRef = useRef<(palette: AlbumPalette) => void>(() => {})
  const reduceRef = useRef(reduced)
  reduceRef.current = reduced
  paintRef.current = palette => {
    // 交叉淡入未结束时只排队最新颜色，不能改写仍然可见的旧背景。
    if (busy.current) { pending.current = palette; return }
    if (paletteKey(palette) === target.current) return
    target.current = paletteKey(palette)
    const next = 1 - frontRef.current
    setLayers(previous => previous.map((value, index) => index === next ? palette : value))
    frontRef.current = next; setFront(next)
    if (reduceRef.current) return
    busy.current = true; setFading(true)
    timer.current = setTimeout(() => {
      timer.current = null; busy.current = false; setFading(false)
      const latest = pending.current
      pending.current = null
      if (latest) paintRef.current(latest)
    }, AMBIENT_CROSSFADE_MS)
  }
  useEffect(() => {
    const visibility = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', visibility)
    return () => document.removeEventListener('visibilitychange', visibility)
  }, [])
  useEffect(() => {
    pending.current = null
    if (!active || hidden) return
    let cancelled = false
    void loadPalette(coverUrl).then(palette => {
      if (!cancelled) paintRef.current(palette)
    }).catch(() => { if (!cancelled) paintRef.current(FALLBACK_PALETTE) })
    return () => { cancelled = true }
  }, [coverUrl, active, hidden, loadPalette])
  useEffect(() => {
    if (!reduced) return
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null; busy.current = false; setFading(false)
    const latest = pending.current
    pending.current = null
    if (latest) paintRef.current(latest)
  }, [reduced])
  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current) }, [])
  const running = active && !hidden && !reduced
  return <div className="ambient-album-background" data-album-ambient data-visible={active} aria-hidden="true">
    {layers.map((palette, index) => <div key={index} className="ambient-album-scene"
      data-ambient-layer data-front={index === front} data-running={running && (index === front || fading)}
      style={{ opacity: index === front ? 1 : 0, '--ambient-crossfade': `${AMBIENT_CROSSFADE_MS}ms`,
        ...Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`--ambient-color-${i + 1}`, palette[i % palette.length]])) } as CSSProperties}>
      <div className="ambient-album-colors">{[0, 1, 2, 3].map(i => <i key={i} className={`ambient-album-blob ambient-album-blob-${i}`} />)}</div>
    </div>)}
    <div className="ambient-album-veil" />
  </div>
}
