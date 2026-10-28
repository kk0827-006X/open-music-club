import { lazy, Suspense, useEffect, useState } from 'react'
import { useReducedMotion } from './hooks.ts'
import { ErrorBoundary } from './ErrorBoundary.tsx'

const LetterGlitch = lazy(() => import('./react-bits/LetterGlitch.tsx'))
const glitchColors = ['#a95227', '#80654e', '#44403c']

// 登录页交互不卸载背景；仅在后台或减少动态效果时释放装饰资源。
export function LoginBackgroundEffect() {
  const [ready, setReady] = useState(false)
  const [background, setBackground] = useState(false)
  const reduced = useReducedMotion()
  const active = ready && !reduced && !background
  useEffect(() => {
    setReady(true)
    const visibility = () => setBackground(document.hidden)
    visibility()
    document.addEventListener('visibilitychange', visibility)
    return () => document.removeEventListener('visibilitychange', visibility)
  }, [])
  return <div className="login-letter-background" data-login-background aria-hidden="true">
    {active && <ErrorBoundary decorative><Suspense fallback={null}>
      <LetterGlitch glitchColors={glitchColors} baseColor="#80654e" baseOpacity={.28}
        glitchAmount={.12} speed={.55} interactive={false} clickEffect="none"
        centerFade={.65} edgeFade={.08} intro={false} dpr={1} />
    </Suspense></ErrorBoundary>}
  </div>
}
