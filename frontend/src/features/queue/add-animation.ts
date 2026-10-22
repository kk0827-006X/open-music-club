
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
