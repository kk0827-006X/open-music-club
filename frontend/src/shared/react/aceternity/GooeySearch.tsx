// 基于 Aceternity UI gooey-input-demo / gooey-input，适配项目 CSS 与独立导航入口。
import { useEffect, useLayoutEffect, useId, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
// 官方组件自带的搜索图形，不使用站点图标组件。
function SearchIcon({ layoutId }: { layoutId: string }) {
  return <span className="ui-icon"><motion.svg layoutId={layoutId} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></motion.svg></span>
}

export function GooeySearch({ onSearch }: { onSearch?: (query: string) => void }) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const root = useRef<HTMLSpanElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const id = useId().replace(/:/g, '')
  const reduced = useReducedMotion()
  const transition = reduced ? { duration: 0 } : { type: 'spring' as const, duration: .4, bounce: .25 }
  useEffect(() => {
    if (!open) return
    let frame = 0
    const deadline = performance.now() + 1200
    // 等待 Motion 完成首帧几何更新；用户移开焦点后不再抢回。
    const focus = () => {
      const active = document.activeElement
      if (active !== document.body && active !== trigger.current && active !== input.current) return
      input.current?.focus({ preventScroll: true })
      if (document.activeElement !== input.current && performance.now() < deadline) frame = requestAnimationFrame(focus)
    }
    focus()
    return () => cancelAnimationFrame(frame)
  }, [open])
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])
  const restoreFocus = useRef(false)
  useLayoutEffect(() => { if (!open && restoreFocus.current) { restoreFocus.current = false; trigger.current?.focus({ preventScroll: true }) } }, [open])
  const close = () => { restoreFocus.current = true; setOpen(false) }
  return <span ref={root} className="gooey-search" onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false) }} onKeyDown={event => {
    if (open && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
  }}>
    <svg className="gooey-search-defs" aria-hidden="true"><defs><filter id={`${id}-goo`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur" /><feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -10" result="goo" /><feComposite in="SourceGraphic" in2="goo" operator="atop" /></filter></defs></svg>
    <motion.span className="gooey-search-fluid" initial={false} animate={{ opacity: open ? .12 : 0 }} transition={transition} style={{ filter: reduced ? 'none' : `url(#${id}-goo)` }} aria-hidden="true">
      <motion.span className="gooey-search-fluid-bubble" animate={{ scale: open ? 1 : 0 }} transition={transition} />
      <motion.span className="gooey-search-fluid-field" animate={{ width: open ? 200 : 115, marginLeft: open ? 50 : 0 }} transition={transition} />
    </motion.span>
    <motion.span className="gooey-search-bubble" initial={false} animate={{ scale: open ? 1 : 0, opacity: open ? 1 : 0 }} transition={transition} aria-hidden="true">{open && <SearchIcon layoutId={`${id}-icon`} />}</motion.span>
    <motion.span id={`${id}-panel`} className="gooey-search-field" onAnimationComplete={() => { if (open && (document.activeElement === trigger.current || document.activeElement === document.body)) input.current?.focus({ preventScroll: true }) }} initial={false} animate={{ width: open ? 200 : 115, marginLeft: open ? 50 : 0 }} transition={transition} data-open={open}>
      <button ref={trigger} type="button" data-nav="search" aria-expanded={open} aria-controls={`${id}-input`} tabIndex={open ? -1 : 0} aria-hidden={open} className="gooey-search-trigger" onClick={() => setOpen(true)} style={{ opacity: open ? 0 : 1, pointerEvents: open ? 'none' : 'auto' }}>{!open && <SearchIcon layoutId={`${id}-icon`} />}<span>搜索</span></button>
      {open && <input autoFocus id={`${id}-input`} ref={input} type="search" aria-label="搜索音乐" placeholder="搜索音乐…" autoComplete="off" value={value} onChange={event => setValue(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); if (value.trim()) onSearch?.(value.trim()) } }} />}
    </motion.span>
  </span>
}
