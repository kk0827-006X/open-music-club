import { useCallback, useEffect, useRef, useState } from 'react'
import { usePageVisibility, useReducedMotion } from './hooks.ts'

// 页面进出统一用 Motion，hidden 延迟到淡出结束，离开立即停止交互。
export function usePageMotion(active: boolean) {
  const reduced = useReducedMotion()
  const visible = usePageVisibility(active, 300)
  return {
    hidden: !visible,
    inert: !active,
    initial: reduced ? false as const : { opacity: 0, y: 12 },
    animate: active ? { opacity: 1, y: 0 } : { opacity: 0, y: 12 },
    transition: reduced ? { duration: 0 } : { duration: .3, ease: [.2, .7, .2, 1] as [number, number, number, number] },
  }
}

// 两个侧栏共用先淡出、再切换、最后由最新数据请求结束淡出的时序。
// 数据读取与请求作废仍属于各业务模块，不在这里混合业务状态。
export function useSectionTransition(active: boolean) {
  const reduced = useReducedMotion()
  const [changing, setChanging] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mounted = useRef(false)
  const clear = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }, [])
  useEffect(() => {
    mounted.current = true
    if (!active) { clear(); setChanging(false) }
    return () => { mounted.current = false; clear() }
  }, [active, clear])
  const run = useCallback((apply: () => void) => {
    if (!active) return
    clear()
    setChanging(true)
    if (reduced) { apply(); return }
    timer.current = setTimeout(() => {
      timer.current = null
      if (mounted.current) apply()
    }, 190)
  }, [active, clear, reduced])
  const finish = useCallback(() => {
    if (mounted.current && timer.current === null) setChanging(false)
  }, [])
  return { changing, run, finish }
}
