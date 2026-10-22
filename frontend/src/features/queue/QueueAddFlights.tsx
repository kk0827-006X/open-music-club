import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type RefObject } from 'react'
import { animate } from 'motion'
import { motion } from 'motion/react'
import { Icon } from '../../shared/react/ui.tsx'
import { queueFlightFrames } from './add-animation.ts'

export interface QueueAddFlightsHandle {
  readonly active: boolean
  added(): void
}
type Flight = { id: number; x: number; y: number; transforms: string[]; opacity: number[] }

// 一处捕获来源、一处 Motion 粒子；所有页面的 + 都调用相同 enqueue 动作。
export const QueueAddFlights = forwardRef<QueueAddFlightsHandle, {
  root: RefObject<HTMLElement | null>; reduced: boolean; reveal(): void; finish(): void
}>(function QueueAddFlights({ root, reduced, reveal, finish }, ref) {
  const [flights, setFlights] = useState<Flight[]>([])
  const active = useRef(new Set<number>())
  const origin = useRef<{ x: number; y: number } | null>(null)
  const timer = useRef(0)
  const nextId = useRef(0)
  const alive = useRef(false)
  const bounces = useRef(new Set<ReturnType<typeof animate>>())
  useEffect(() => {
    alive.current = true
    const element = root.current
    const capture = (event: MouseEvent) => {
      clearTimeout(timer.current); origin.current = null
      const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button') : null
      const glyph = button?.querySelector('[data-ui-icon="plus"]')
      if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true' || !glyph) return
      const bounds = glyph.getBoundingClientRect()
      origin.current = { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }
      timer.current = window.setTimeout(() => { origin.current = null }, 0)
    }
    element?.addEventListener('click', capture, true)
    return () => {
      alive.current = false; clearTimeout(timer.current); origin.current = null
      element?.removeEventListener('click', capture, true)
      active.current.clear(); bounces.current.forEach(control => control.stop()); bounces.current.clear()
    }
  }, [root])
  useImperativeHandle(ref, () => ({
    get active() { return active.current.size > 0 },
    added() {
      const start = origin.current
      origin.current = null; clearTimeout(timer.current)
      if (!start || reduced || !alive.current) return
      const target = root.current?.querySelector<HTMLElement>('[data-player-queue-toggle]')
      const player = root.current?.querySelector<HTMLElement>('[data-global-player]')
      if (!target || !player) return
      reveal()
      const bounds = target.getBoundingClientRect(), footer = player.getBoundingClientRect()
      const end = { x: bounds.left + bounds.width / 2, y: window.innerHeight - footer.height + bounds.top - footer.top + bounds.height / 2 }
      const id = ++nextId.current
      const frames = queueFlightFrames(start, end)
      active.current.add(id)
      if (active.current.size > 6) active.current.delete(active.current.values().next().value!)
      setFlights(previous => [...previous.slice(-5), { id, x: start.x - 14, y: start.y - 14,
        transforms: frames.map(frame => String(frame.transform)), opacity: frames.map(frame => Number(frame.opacity)),
      }])
    },
  }), [finish, reduced, reveal, root])
  const complete = (id: number) => {
    if (!alive.current) return
    active.current.delete(id); setFlights(previous => previous.filter(flight => flight.id !== id))
    const target = root.current?.querySelector<HTMLElement>('[data-player-queue-toggle]')
    if (target) {
      const bounce = animate(target, { scale: [1, 1.18, 1] }, { duration: .32 })
      bounces.current.add(bounce)
      void bounce.then(() => bounces.current.delete(bounce))
    }
    if (!active.current.size) finish()
  }
  return flights.map(flight => <motion.span key={flight.id} className="queue-add-flight" aria-hidden="true" style={{ left: flight.x, top: flight.y }}
    initial={{ transform: flight.transforms[0], opacity: 1 }} animate={{ transform: flight.transforms, opacity: flight.opacity }}
    transition={{ duration: .95, ease: [.32, .05, .64, 1], times: Array.from({ length: 13 }, (_, index) => index / 12) }}
    onAnimationComplete={() => complete(flight.id)}><Icon name="plus" /></motion.span>)
})
