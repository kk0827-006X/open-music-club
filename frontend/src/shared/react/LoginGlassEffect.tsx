import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { animate } from 'motion'
import { motion } from 'motion/react'
import { useReducedMotion } from './hooks.ts'
import { ErrorBoundary } from './ErrorBoundary.tsx'

const LiquidGlass = lazy(() => import('liquid-glass-react').then(module => ({ default: module.default })))

// 现成折射组件只负责透明材质；不导入它的演示背景，也不遮挡密码输入。
export function LoginGlassEffect({ paused = false }: { paused?: boolean } = {}) {
  const host = useRef<HTMLDivElement>(null)
  const mouseContainer = useRef<HTMLElement | null>(null)
  const [ready, setReady] = useState(false)
  const [editing, setEditing] = useState(false)
  const [background, setBackground] = useState(false)
  const reduced = useReducedMotion()
  const active = ready && !reduced && !paused && !editing && !background
  useEffect(() => {
    mouseContainer.current = host.current?.closest<HTMLElement>('.login-shell') ?? null
    setReady(true)
    const shell = mouseContainer.current
    const input = (target: EventTarget | null) => target instanceof Element && target.matches('input, textarea, select, [contenteditable="true"]')
    const focusIn = (event: FocusEvent) => setEditing(input(event.target))
    const focusOut = (event: FocusEvent) => setEditing(input(event.relatedTarget))
    const visibility = () => setBackground(document.hidden)
    setEditing(input(document.activeElement)); visibility()
    shell?.addEventListener('focusin', focusIn); shell?.addEventListener('focusout', focusOut)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      shell?.removeEventListener('focusin', focusIn); shell?.removeEventListener('focusout', focusOut)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [])
  useEffect(() => {
    if (!active) return
    const brand = mouseContainer.current?.querySelector<HTMLElement>('.archive-brand')
    if (!brand) return
    const breathing = animate(brand, {
      '--login-logo-wave-y': ['0px', '2.4px', '0px', '-1.6px', '0px'],
      '--login-logo-wave-tilt': ['0deg', '.12deg', '0deg', '-.08deg', '0deg'],
    }, { duration: 8, repeat: Infinity, ease: 'easeInOut' })
    return () => { breathing.stop(); brand.style.removeProperty('--login-logo-wave-y'); brand.style.removeProperty('--login-logo-wave-tilt') }
  }, [active])
  return <div ref={host} className="login-glass-effect" data-login-glass aria-hidden="true">
    {active && <ErrorBoundary decorative><Suspense fallback={null}>
      <motion.div className="login-glass-wave" animate={{ x: ['-2%', '5%', '-2%'], y: ['-2%', '3%', '-2%'], scale: [1, 1.04, 1] }} transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut' }}>
        <LiquidGlass displacementScale={46} blurAmount={0} saturation={100} aberrationIntensity={.35} elasticity={.12} cornerRadius={440} padding="0" mouseContainer={mouseContainer} className="login-library-glass" style={{ position: 'absolute', top: '46%', left: '59%' }}>
          <div className="login-glass-lens" />
        </LiquidGlass>
      </motion.div>
    </Suspense></ErrorBoundary>}
  </div>
}
