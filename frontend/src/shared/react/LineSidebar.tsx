// 基于 React Bits LineSidebar-TS-CSS；来源、版本及许可证见 react-bits/README.md。
// 保留官方距离衰减与逐帧平滑算法，补充受控选择、原生按钮和页面生命周期。
import { useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react'
import { useReducedMotion } from './hooks.ts'

type Falloff = 'linear' | 'smooth' | 'sharp'
export interface LineSidebarProps {
  items: string[]
  accentColor?: string
  textColor?: string
  markerColor?: string
  showIndex?: boolean
  showMarker?: boolean
  proximityRadius?: number
  maxShift?: number
  falloff?: Falloff
  markerLength?: number
  markerGap?: number
  tickScale?: number
  scaleTick?: boolean
  itemGap?: number
  fontSize?: number
  smoothing?: number
  defaultActive?: number | null
  activeIndex?: number | null
  onItemClick?: (index: number, label: string) => void
  className?: string
  ariaLabel?: string
  enabled?: boolean
  renderLabel?: (label: string, index: number) => ReactNode
  getItemProps?: (index: number) => ButtonHTMLAttributes<HTMLButtonElement>
}
const curves: Record<Falloff, (value: number) => number> = {
  linear: value => value,
  smooth: value => value * value * (3 - 2 * value),
  sharp: value => value * value * value,
}

export default function LineSidebar({
  items, accentColor = 'var(--amber)', textColor = 'var(--ink)', markerColor = 'var(--hairline)',
  showIndex = true, showMarker = true, proximityRadius = 100, maxShift = 30, falloff = 'smooth',
  markerLength = 60, markerGap = 0, tickScale = 0.5, scaleTick = true, itemGap = 20,
  fontSize = 1.1, smoothing = 100, defaultActive = null, activeIndex,
  onItemClick, className = '', ariaLabel = '侧栏导航', enabled = true, renderLabel, getItemProps,
}: LineSidebarProps) {
  const reduced = useReducedMotion()
  const [selected, setSelected] = useState<number | null>(defaultActive)
  const active = activeIndex === undefined ? selected : activeIndex
  const list = useRef<HTMLUListElement>(null)
  const rows = useRef<(HTMLLIElement | null)[]>([])
  const targets = useRef<number[]>([])
  const current = useRef<number[]>([])
  const frame = useRef<number | null>(null)
  const lastTime = useRef(0)
  const state = useRef({ active, smoothing, enabled, reduced })
  state.current = { active, smoothing, enabled, reduced }

  const stop = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
  }, [])
  const runFrame = useCallback(function run(now: number) {
    const config = state.current
    if (!config.enabled || document.hidden) { frame.current = null; return }
    const dt = Math.min((now - lastTime.current) / 1000, 0.05)
    lastTime.current = now
    const k = config.reduced ? 1 : 1 - Math.exp(-dt / (Math.max(config.smoothing, 1) / 1000))
    let moving = false
    rows.current.forEach((element, index) => {
      if (!element) return
      const target = Math.max(targets.current[index] || 0, config.active === index ? 1 : 0)
      const previous = current.current[index] || 0
      const next = previous + (target - previous) * k
      const settled = Math.abs(target - next) < 0.0015
      const value = settled ? target : next
      current.current[index] = value
      element.style.setProperty('--effect', value.toFixed(4))
      if (!settled) moving = true
    })
    frame.current = moving ? requestAnimationFrame(run) : null
  }, [])
  const start = useCallback(() => {
    if (!state.current.enabled || document.hidden || frame.current !== null) return
    lastTime.current = performance.now()
    frame.current = requestAnimationFrame(runFrame)
  }, [runFrame])
  const reset = useCallback(() => {
    targets.current = []
    start()
  }, [start])

  useEffect(() => {
    rows.current.length = items.length
    targets.current = []
    if (enabled) start()
    else stop()
    const onVisibility = () => {
      targets.current = []
      if (document.hidden) stop()
      else start()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => { document.removeEventListener('visibilitychange', onVisibility); stop() }
  }, [active, enabled, reduced, items.length, start, stop])

  return <nav className={`line-sidebar${showMarker ? ' line-sidebar--markers' : ''}${scaleTick ? ' line-sidebar--scale-tick' : ''} ${className}`}
    aria-label={ariaLabel} style={{
      '--accent-color': accentColor, '--text-color': textColor, '--marker-color': markerColor,
      '--marker-length': `${markerLength}px`, '--marker-gap': `${markerGap}px`, '--tick-scale': tickScale,
      '--max-shift': reduced ? '0px' : `${maxShift}px`, '--item-gap': `${itemGap}px`, '--font-size': `${fontSize}rem`,
    } as CSSProperties}>
    <ul ref={list} className="line-sidebar__list" onPointerLeave={reset} onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) reset()
    }} onPointerMove={event => {
      if (!enabled || reduced || !list.current) return
      const pointerY = event.clientY - list.current.getBoundingClientRect().top
      rows.current.forEach((element, index) => {
        if (!element) return
        const distance = Math.abs(pointerY - (element.offsetTop + element.offsetHeight / 2))
        targets.current[index] = curves[falloff](Math.max(0, 1 - distance / Math.max(1, proximityRadius)))
      })
      start()
    }}>
      {items.map((label, index) => <li key={`${label}-${index}`} ref={element => { rows.current[index] = element }}
        className="line-sidebar__item" style={{ '--effect': active === index ? 1 : 0 } as CSSProperties}>
        <button {...getItemProps?.(index)} type="button" className="line-sidebar__button"
          aria-current={active === index ? 'page' : undefined} onFocus={() => {
            targets.current = items.map((_, candidate) => candidate === index ? 1 : 0)
            start()
          }} onClick={() => {
            if (activeIndex === undefined) setSelected(index)
            onItemClick?.(index, label)
          }}>
          {showMarker && <span className="line-sidebar__marker" aria-hidden="true" />}
          <span className="line-sidebar__label">
            {showIndex && <span className="line-sidebar__index">{String(index + 1).padStart(2, '0')}</span>}
            <span className="line-sidebar__text">{renderLabel ? renderLabel(label, index) : label}</span>
          </span>
        </button>
      </li>)}
    </ul>
  </nav>
}
