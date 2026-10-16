import { createGlassMotion } from './login-glass-motion.ts'
import type { GlassState } from './login-glass-motion.ts'
export interface GlassRenderer {
  draw(state: GlassState, width: number, height: number, masks: number[][], presence: number): void
  clear(): void
  dispose(): void
}

export function mountLoginGlass(
  shell: HTMLElement,
  load: () => Promise<GlassRenderer> = () => import('./login-glass-renderer.ts').then(module => module.createGlassRenderer(shell)),
) {
  const media = window.matchMedia('(prefers-reduced-motion: reduce)')
  if (media.matches || window.matchMedia('(pointer: coarse)').matches) return () => {}
  const motion = createGlassMotion()
  const logo = shell.querySelector<HTMLElement>('.archive-brand')
  let renderer: GlassRenderer | undefined
  let disposed = false, loading = false, failed = false, hovering = false
  let frame = 0, lastDraw = -Infinity, leftAt = -Infinity
  const protectedArea = () => media.matches || document.hidden || !!shell.querySelector('dialog[open]') || !!shell.querySelector('form')?.contains(document.activeElement)
  const reset = () => {
    hovering = false; leftAt = -Infinity; motion.leave()
    window.cancelAnimationFrame(frame); frame = 0; renderer?.clear()
    logo?.style.removeProperty('--login-logo-wave-y')
    logo?.style.removeProperty('--login-logo-wave-tilt')
  }
  const animate = (now: number) => {
    frame = 0
    if (disposed || protectedArea()) { reset(); return }
    const presence = .72 + .28 * (hovering ? 1 : Math.max(0, 1 - (now - leftAt) / 1800))
    if (now - lastDraw >= 1000 / 30) {
      lastDraw = now
      const rect = shell.getBoundingClientRect()
      const masks = ['form'].map(selector => {
        const box = shell.querySelector(selector)!.getBoundingClientRect()
        return [box.left - rect.left - 24, box.top - rect.top - 24, box.right - rect.left + 24, box.bottom - rect.top + 24]
      })
      const state = motion.sample(now)
      // 与背景共享时钟，只移动合成层，不改变字号和布局。
      logo?.style.setProperty('--login-logo-wave-y', `${state.logoY}px`)
      logo?.style.setProperty('--login-logo-wave-tilt', `${state.logoTilt}deg`)
      renderer?.draw(state, rect.width, rect.height, masks, presence)
    }
    frame = window.requestAnimationFrame(animate)
  }
  const wake = () => { if (renderer && !frame && !disposed && !protectedArea()) frame = window.requestAnimationFrame(animate) }
  const resume = () => {
    if (disposed || protectedArea() || failed) return
    if (!renderer && !loading) {
      loading = true
      void load().then(value => {
        if (disposed) { value.dispose(); return }
        renderer = value; wake()
      }).catch(() => {
        // WebGL 或动效分块加载失败不能影响认证，安全降级为原背景。
        failed = true; reset()
      }).finally(() => { loading = false })
    }
    wake()
  }
  const leave = () => {
    if (hovering) leftAt = performance.now()
    hovering = false; motion.leave(); wake()
  }
  const point = (event: PointerEvent) => {
    if (event.pointerType === 'touch' || protectedArea()) { reset(); return }
    const target = event.target as Element | null
    if (target?.closest('form, dialog, button, input, a')) { leave(); return }
    const rect = shell.getBoundingClientRect()
    motion.point(event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height, performance.now(), event.type === 'pointerdown')
    hovering = true
    resume()
  }
  const focus = () => { if (protectedArea()) reset() }
  const visibility = () => { if (document.hidden) reset(); else resume() }
  const change = () => { if (media.matches) reset(); else resume() }
  shell.addEventListener('pointermove', point, { passive: true })
  shell.addEventListener('pointerdown', point, { passive: true })
  shell.addEventListener('pointerleave', leave)
  shell.addEventListener('pointercancel', leave)
  shell.addEventListener('focusin', focus)
  shell.addEventListener('focusout', resume)
  document.addEventListener('visibilitychange', visibility)
  media.addEventListener?.('change', change)
  resume()
  return () => {
    disposed = true; reset(); renderer?.dispose()
    shell.removeEventListener('pointermove', point); shell.removeEventListener('pointerdown', point)
    shell.removeEventListener('pointerleave', leave); shell.removeEventListener('pointercancel', leave)
    shell.removeEventListener('focusin', focus)
    shell.removeEventListener('focusout', resume)
    document.removeEventListener('visibilitychange', visibility)
    media.removeEventListener?.('change', change)
  }
}
