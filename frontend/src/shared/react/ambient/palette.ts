// 只在封面变化时读取一张 32×32 离屏画布，不参与音频或逐帧渲染。
export type AlbumPalette = readonly string[]
export const FALLBACK_PALETTE: AlbumPalette = Object.freeze([
  'rgb(109 74 88)', 'rgb(46 66 92)', 'rgb(127 91 64)', 'rgb(49 88 81)',
])

type Bucket = { count: number; r: number; g: number; b: number }
const rgb = (r: number, g: number, b: number) => `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)})`

export function colorsFromPixels(pixels: Uint8ClampedArray): AlbumPalette {
  const buckets = new Map<number, Bucket>()
  for (let i = 0; i < pixels.length; i += 4) {
    const [r, g, b, a] = pixels.subarray(i, i + 4)
    const light = (.2126 * r + .7152 * g + .0722 * b) / 255
    if (a < 128 || light < .04 || light > .94) continue
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 }
    bucket.count++; bucket.r += r; bucket.g += g; bucket.b += b
    buckets.set(key, bucket)
  }
  const candidates = [...buckets.values()].map(bucket => {
    const color = [bucket.r / bucket.count, bucket.g / bucket.count, bucket.b / bucket.count]
    const saturation = (Math.max(...color) - Math.min(...color)) / 255
    return { color, weight: bucket.count * (.4 + saturation) }
  }).sort((a, b) => b.weight - a.weight)
  if (!candidates.length) return FALLBACK_PALETTE
  const chosen: number[][] = []
  for (const { color, weight } of candidates) {
    if (weight < candidates[0].weight * .02) continue
    if (chosen.every(previous => color.reduce((sum, value, i) => sum + (value - previous[i]) ** 2, 0) > 48 ** 2)) chosen.push(color)
    if (chosen.length === 5) break
  }
  // 单色封面衍生同色系明暗，仍保持 3～5 色，而不混入无关色相。
  const dominant = chosen[0]
  for (const factor of [.72, 1.12]) {
    if (chosen.length >= 3) break
    chosen.push(dominant.map(value => Math.min(239, value * factor)))
  }
  return Object.freeze(chosen.map(color => rgb(color[0], color[1], color[2])))
}

export function extractAlbumPalette(source: string): Promise<AlbumPalette> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    let settled = false
    const finish = (palette?: AlbumPalette) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      image.onload = null; image.onerror = null
      if (palette) resolve(palette)
      else { image.src = ''; reject(new Error('封面无法用于取色')) }
    }
    const timer = setTimeout(() => finish(), 5000)
    image.crossOrigin = 'anonymous'
    image.referrerPolicy = 'no-referrer'
    image.decoding = 'async'
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = 32; canvas.height = 32
        const context = canvas.getContext('2d', { willReadFrequently: true })
        if (!context) { finish(); return }
        context.drawImage(image, 0, 0, 32, 32)
        finish(colorsFromPixels(context.getImageData(0, 0, 32, 32).data))
      } catch { finish() }
    }
    image.onerror = () => finish()
    image.src = source
  })
}

export function createPaletteCache(loader = extractAlbumPalette, limit = 64, now = Date.now) {
  const entries = new Map<string, { promise: Promise<AlbumPalette>; expires: number }>()
  return (source?: string | null): Promise<AlbumPalette> => {
    if (!source || source.includes('/images/album-placeholder-')) return Promise.resolve(FALLBACK_PALETTE)
    const existing = entries.get(source)
    if (existing && existing.expires > now()) {
      entries.delete(source); entries.set(source, existing)
      return existing.promise
    }
    entries.delete(source)
    const entry = { promise: Promise.resolve(FALLBACK_PALETTE), expires: Infinity }
    entry.promise = Promise.resolve().then(() => loader(source)).catch(() => {
      // 失败也短暂缓存，避免不支持 CORS 的封面反复重试。
      entry.expires = now() + 60_000
      return FALLBACK_PALETTE
    })
    entries.set(source, entry)
    while (entries.size > limit) entries.delete(entries.keys().next().value!)
    return entry.promise
  }
}

export const loadAlbumPalette = createPaletteCache()
