import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

const reducedQuery = '(prefers-reduced-motion: reduce)'
const subscribeReduced = (notify: () => void) => {
  const media = window.matchMedia(reducedQuery)
  media.addEventListener('change', notify)
  return () => media.removeEventListener('change', notify)
}
const readReduced = () => typeof window !== 'undefined' && window.matchMedia(reducedQuery).matches

export function useReducedMotion() {
  return useSyncExternalStore(subscribeReduced, readReduced, () => false)
}

// 活动与可见生命周期分开：离开立即 inert，淡出完成后才 display:none。
export function usePageVisibility(active: boolean, delay: number) {
  const [visible, setVisible] = useState(active)
  const reduced = useReducedMotion()
  useEffect(() => {
    if (active) { setVisible(true); return }
    const timer = setTimeout(() => setVisible(false), reduced ? 0 : delay)
    return () => clearTimeout(timer)
  }, [active, delay, reduced])
  return active || visible
}

// 外部引擎的回调总是读取当前 React props，不因此重复创建 Audio 或 WebGL。
export function useLatest<T>(value: T) {
  const ref = useRef(value)
  useEffect(() => { ref.current = value }, [value])
  return ref
}
