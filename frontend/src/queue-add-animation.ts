import { uiIcons } from './ui-icons.ts'

type Point = { x: number; y: number }

export function queueFlightFrames(start: Point, end: Point): Keyframe[] {
  const dx = end.x - start.x, dy = end.y - start.y
  const lift = Math.min(200, Math.max(120, Math.abs(dx) * .24))
  return Array.from({ length: 13 }, (_, index) => {
    const t = index / 12
    // 二次曲线先抛起、再落下，只改变合成属性，不触发布局重排。
    const y = dy * t * t - 2 * lift * t * (1 - t)
    return {
      offset: t,
      transform: `translate(${dx * t}px, ${y}px) rotate(${t * 90}deg) scale(${1 + Math.sin(t * Math.PI) * .2 - t * .65})`,
      opacity: t < .8 ? 1 : (1 - t) * 5,
    }
  })
}

export function mountQueueAddAnimation(root: HTMLElement, options: {
  reduced: boolean; reveal: () => void; finish: () => void;
}) {
  let origin: Point | null = null
  let originTimer = 0
  let destroyed = false
  const flights = new Map<HTMLElement, Animation>()
  const capture = (event: MouseEvent) => {
    window.clearTimeout(originTimer)
    origin = null
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button') : null
    if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true'
      || !button.querySelector('[data-ui-icon="plus"]')) return
    const rect = button.querySelector('.ui-icon')!.getBoundingClientRect()
    origin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    // 微任务可能在事件监听器之间运行；等整个点击任务结束后再清理坐标。
    originTimer = window.setTimeout(() => { origin = null; originTimer = 0 }, 0)
  }
  root.addEventListener('click', capture, true)
  return {
    get active() { return flights.size > 0 },
    added() {
      const start = origin
      origin = null
      window.clearTimeout(originTimer)
      originTimer = 0
      if (!start || destroyed || options.reduced) return
      const target = root.querySelector<HTMLElement>('[data-player-queue-toggle]')
      const player = root.querySelector<HTMLElement>('[data-global-player]')
      if (!target || !player) return
      options.reveal()
      const rect = target.getBoundingClientRect(), footer = player.getBoundingClientRect()
      const end = { x: rect.left + rect.width / 2, y: window.innerHeight - footer.height + rect.top - footer.top + rect.height / 2 }
      if (flights.size >= 6) {
        const [node, animation] = flights.entries().next().value!
        animation.cancel(); node.remove(); flights.delete(node)
      }
      const particle = document.createElement('span')
      particle.className = 'queue-add-flight'
      particle.setAttribute('aria-hidden', 'true')
      particle.innerHTML = uiIcons.plus
      particle.style.left = `${start.x - 14}px`
      particle.style.top = `${start.y - 14}px`
      root.append(particle)
      const animation = particle.animate(queueFlightFrames(start, end), { duration: 950, easing: 'cubic-bezier(.32,.05,.64,1)', fill: 'forwards' })
      flights.set(particle, animation)
      const cleanup = () => { particle.remove(); flights.delete(particle); if (!destroyed && !flights.size) options.finish() }
      void animation.finished.then(() => {
        if (!destroyed && target.isConnected) target.animate([
          { transform: 'scale(1)' }, { transform: 'scale(1.18)', color: '#b77922' }, { transform: 'scale(1)' },
        ], { duration: 320 })
        cleanup()
      }, cleanup)
    },
    destroy() {
      destroyed = true
      window.clearTimeout(originTimer)
      originTimer = 0
      origin = null
      root.removeEventListener('click', capture, true)
      for (const [node, animation] of flights) { animation.cancel(); node.remove() }
      flights.clear()
    },
  }
}
