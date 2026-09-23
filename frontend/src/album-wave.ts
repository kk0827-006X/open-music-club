// 直接复用 RhineLabUI/src/motion.ts 的选中波包公式（MIT）。
const smooth = (value: number) => {
  const clamped = Math.max(0, Math.min(1, value))
  return clamped * clamped * clamped * (10 + clamped * (-15 + 6 * clamped))
}

const bell = (value: number, width: number) => Math.exp(-0.5 * (value / width) ** 2)

export function sampleAlbumWave(distance: number, age: number, reducedMotion = false) {
  if (reducedMotion || age < 0 || age > 3.2) return 0
  return (
    0.8
    * smooth(age / 0.2)
    * Math.exp(-age * 1.15)
    * Math.cos((distance - age * 8) * 0.58)
    * bell(distance - age * 8, 3.4)
  )
}
