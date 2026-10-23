import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Icon } from './ui.tsx'

interface SidebarLayoutProps {
  active: boolean
  variant: 'user' | 'footprint'
  sidebarClassName: string
  sidebar: ReactNode | ((expanded: boolean) => ReactNode)
  children: ReactNode
}
const minimumWidth = 150
const collapseWidth = 90
const maximumRatio = 0.4

// 布局只拥有展开状态与指针捕获，不接触页面数据、播放器或持久化。
export function CollapsibleSidebarLayout({ active, variant, sidebarClassName, sidebar, children }: SidebarLayoutProps) {
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLElement>(null)
  const divider = useRef<HTMLButtonElement>(null)
  const gesture = useRef<{ id: number; startX: number; width: number; nextWidth: number; moved: boolean } | null>(null)
  const suppressClick = useRef(false)
  const [collapsed, setCollapsed] = useState(false)
  const [width, setWidth] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && window.matchMedia(`(max-width: ${variant === 'user' ? 600 : 860}px)`).matches)
  const hidden = collapsed && !compact

  const release = () => {
    const current = gesture.current
    gesture.current = null
    if (current && divider.current?.hasPointerCapture?.(current.id)) divider.current.releasePointerCapture(current.id)
  }
  useEffect(() => {
    if (!active || compact) {
      release()
      root.current?.style.removeProperty('--sidebar-drag-width')
      setDragging(false)
    }
    return () => release()
  }, [active, compact])
  useEffect(() => {
    const media = window.matchMedia(`(max-width: ${variant === 'user' ? 600 : 860}px)`)
    const update = () => setCompact(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [variant])

  function toggle() {
    setCollapsed(value => !value)
  }
  function finish(cancelled: boolean) {
    const drag = gesture.current
    if (!drag) return
    suppressClick.current = drag.moved
    if (!cancelled && drag.moved) {
      if (drag.nextWidth < collapseWidth) {
        setWidth(Math.max(minimumWidth, drag.width))
        setCollapsed(true)
        if (panel.current?.contains(document.activeElement)) divider.current?.focus()
      } else {
        setWidth(Math.max(minimumWidth, drag.nextWidth))
        setCollapsed(false)
      }
    }
    release()
    root.current?.style.removeProperty('--sidebar-drag-width')
    setDragging(false)
  }

  return <div ref={root} className={`sidebar-layout sidebar-layout--${variant}`} data-collapsed={String(hidden)}
    data-dragging={String(dragging)} style={width === null ? undefined : { '--sidebar-width': `${width}px` } as CSSProperties}>
    <aside ref={panel} id={id} className={sidebarClassName} inert={hidden} aria-hidden={hidden || undefined}>{typeof sidebar === 'function' ? sidebar(!hidden) : sidebar}</aside>
    <button ref={divider} type="button" className="sidebar-divider" role="separator" aria-orientation="vertical"
      aria-label={hidden ? '展开侧栏' : '调整侧栏宽度'} aria-controls={id} aria-expanded={!hidden}
      aria-valuemin={0} aria-valuemax={40} aria-valuenow={hidden ? 0 : Math.min(40, Math.round(width === null ? (variant === 'user' ? 25 : 23) : width / (root.current?.clientWidth || width * 4) * 100))}
      title={collapsed ? '点击或向右拖动展开侧栏' : '向左拖动收起侧栏'}
      onPointerDown={event => {
        if (event.button !== 0 || !active || compact || gesture.current) return
        suppressClick.current = false
        const currentWidth = collapsed ? 0 : panel.current?.getBoundingClientRect().width || minimumWidth
        gesture.current = { id: event.pointerId, startX: event.clientX, width: currentWidth, nextWidth: currentWidth, moved: false }
        event.currentTarget.setPointerCapture(event.pointerId)
      }} onPointerMove={event => {
        const drag = gesture.current
        if (!drag || drag.id !== event.pointerId || !root.current) return
        const delta = event.clientX - drag.startX
        if (!drag.moved && Math.abs(delta) < 4) return
        drag.moved = true
        setDragging(true)
        drag.nextWidth = Math.max(0, Math.min(root.current.clientWidth * maximumRatio, drag.width + delta))
        // 直接更新一项布局变量，拖动期间不触发右侧业务视图重建。
        root.current.style.setProperty('--sidebar-drag-width', `${drag.nextWidth}px`)
      }} onPointerUp={event => { if (event.pointerId === gesture.current?.id) finish(false) }}
      onPointerCancel={event => { if (event.pointerId === gesture.current?.id) finish(true) }}
      onLostPointerCapture={event => { if (event.pointerId === gesture.current?.id) finish(true) }}
      onClick={event => {
        const ignore = suppressClick.current && event.detail > 0
        suppressClick.current = false
        if (!ignore) toggle()
      }}
      onKeyDown={event => {
        if (event.key === 'Escape' && gesture.current) {
          event.preventDefault()
          event.stopPropagation()
          finish(true)
          return
        }
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        if (event.key === 'Home') { setCollapsed(true); return }
        if (event.key === 'End' || (collapsed && event.key === 'ArrowRight')) { setCollapsed(false); return }
        const next = (panel.current?.getBoundingClientRect().width || width || minimumWidth) + (event.key === 'ArrowLeft' ? -32 : 32)
        if (next < minimumWidth) setCollapsed(true)
        else setWidth(Math.min(next, (root.current?.clientWidth || 1000) * maximumRatio))
      }}><span className="sidebar-divider-arrow" aria-hidden="true"><Icon name={collapsed ? 'right' : 'left'} /></span></button>
    {children}
  </div>
}
