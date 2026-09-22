import { track } from './rhine-motion/boot-tracks.ts'

export interface LoginMotionFrame {
  brand: number
  panel: number
  protocol: number
  status: number
  orbit: number
  pulse: number
}

export function sampleLoginMotion(
  elapsedMs: number,
  reducedMotion: boolean,
): LoginMotionFrame {
  if (reducedMotion) {
    return {
      brand: 1,
      panel: 1,
      protocol: 1,
      status: 1,
      orbit: 0,
      pulse: 1,
    }
  }

  const safeElapsed = Math.max(0, elapsedMs)
  const frame = (safeElapsed / 1000) * 25

  return {
    brand: track([[2, 0], [17, 1]], frame),
    panel: track([[9, 0], [35, 1]], frame),
    protocol: track([[16, 0], [40, 1]], frame),
    status: track([[22, 0], [44, 1]], frame),
    orbit: (safeElapsed / 1000) * 0.28,
    pulse: 0.55 + Math.sin(safeElapsed / 420) * 0.45,
  }
}

function pointOnCircle(
  centerX: number,
  centerY: number,
  radius: number,
  angle: number,
) {
  const radians = (angle * Math.PI) / 180
  return {
    x: centerX + radius * Math.cos(radians),
    y: centerY + radius * Math.sin(radians),
  }
}

function stableNumber(value: number) {
  const rounded = Math.round(value * 1000) / 1000
  return Object.is(rounded, -0) ? '0' : String(rounded)
}

export function describeArc(
  centerX: number,
  centerY: number,
  radius: number,
  startAngle: number,
  endAngle: number,
) {
  const start = pointOnCircle(centerX, centerY, radius, startAngle)
  const end = pointOnCircle(centerX, centerY, radius, endAngle)
  const span = Math.abs(endAngle - startAngle)
  const largeArc = span > 180 ? 1 : 0
  const sweep = endAngle >= startAngle ? 1 : 0

  return [
    'M', stableNumber(start.x), stableNumber(start.y), 'A',
    stableNumber(radius), stableNumber(radius), '0', String(largeArc),
    String(sweep), stableNumber(end.x), stableNumber(end.y),
  ].join(' ')
}
