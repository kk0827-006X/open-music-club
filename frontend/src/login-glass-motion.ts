// 移植自 liquid-glass/index.html 的 leaveWake 与 animate。
// 固定大小的环形数组保存拖尾，避免鼠标移动时不断分配或积累波源。
export const GLASS_TRAIL_SIZE = 16
export function createGlassMotion() {
  const trail = Array.from({ length: GLASS_TRAIL_SIZE }, () => [0, 0, -100, 0])
  let index = 0, previous: number[] | null = null, previousTime = 0
  let motionTarget = 0, motion = 0, hover = 0, targetHover = 0
  let x = 0, y = 0, targetX = 0, targetY = 0, time = 0, last = -1
  let ripple = [0, 0, -100]
  return {
    point(clientX: number, clientY: number, width: number, height: number, now: number, click = false) {
      targetX = (clientX / Math.max(width, 1) - .5) * width / Math.max(height, 1) * 4
      targetY = (.5 - clientY / Math.max(height, 1)) * 4
      const elapsed = Math.max((now - previousTime) / 1000, .008)
      if (previous && elapsed < .25) {
        const dx = targetX - previous[0], dy = targetY - previous[1]
        const distance = Math.hypot(dx, dy)
        motionTarget = Math.min(distance / elapsed / 5, 1.5)
        if (distance > .035) {
          const steps = Math.min(Math.ceil(distance / .12), GLASS_TRAIL_SIZE)
          for (let i = 1; i <= steps; i++) {
            trail[index] = [previous[0] + dx * i / steps, previous[1] + dy * i / steps, now / 1000, Math.min(.35 + motionTarget * .45, 1)]
            index = (index + 1) % GLASS_TRAIL_SIZE
          }
        }
      }
      previous = [targetX, targetY]; previousTime = now; targetHover = 1
      if (click) ripple = [targetX, targetY, time]
    },
    leave() { targetHover = 0; previous = null },
    sample(now: number) {
      const dt = last < 0 ? 0 : Math.min(Math.max((now - last) / 1000, 0), .05)
      last = now; time += dt * 1.15 * 1.7
      motionTarget *= Math.exp(-dt * 3)
      motion += (motionTarget - motion) * (1 - Math.exp(-dt * 10))
      const smooth = 1 - Math.exp(-dt * 12)
      x += (targetX - x) * smooth; y += (targetY - y) * smooth
      hover += (targetHover - hover) * smooth
      return { x, y, hover, motion, time, clock: now / 1000, trail, ripple }
    },
  }
}
export type GlassState = ReturnType<ReturnType<typeof createGlassMotion>['sample']>

export function glassResolution(width: number, height: number) {
  const scale = Math.min(1, Math.sqrt(300000 / Math.max(1, width * height)))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}
