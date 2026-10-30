const assert = require('node:assert/strict')
const { it } = require('node:test')
const { withReactHarness } = require('./helpers/reactHarness')
const paletteModule = () => import('../frontend/src/shared/react/ambient/palette.ts')
const backgroundModule = () => import('../frontend/src/shared/react/ambient/AmbientAlbumBackground.tsx')
const red = ['rgb(210 40 60)', 'rgb(30 70 160)', 'rgb(230 170 40)']
const green = ['rgb(30 160 80)', 'rgb(40 100 160)', 'rgb(100 180 130)']

it('小画布像素提取3～5个代表色，忽略透明及极端黑白，单色保留同色系', async () => {
  const { colorsFromPixels, FALLBACK_PALETTE } = await paletteModule()
  const pixels = new Uint8ClampedArray(Array.from({ length: 1024 }, (_, i) => i < 500 ? [210,40,60,255] : i < 750 ? [30,70,160,255] : [230,170,40,255]).flat())
  const colors = colorsFromPixels(pixels)
  assert.ok(colors.length >= 3 && colors.length <= 5)
  for (const color of red) assert.ok(colors.includes(color))
  assert.equal(colorsFromPixels(new Uint8ClampedArray([255,255,255,255,0,0,0,255,100,150,200,0])), FALLBACK_PALETTE)
  assert.equal(colorsFromPixels(new Uint8ClampedArray([100,100,100,255])).length, 3)
})

it('缓存合并并发取色、有容量上限，失败短暂缓存后可重试，默认封面不发请求', async () => {
  const { createPaletteCache, FALLBACK_PALETTE } = await paletteModule()
  const calls = []
  const load = createPaletteCache(async src => { calls.push(src); return red }, 2)
  const first = load('a')
  assert.equal(load('a'), first)
  await first; await load('b'); await load('a'); await load('c'); await load('b')
  assert.deepEqual(calls, ['a','b','c','b'])
  let time = 100, failures = 0
  const failing = createPaletteCache(async () => { failures++; throw new Error('synthetic CORS failure') }, 2, () => time)
  assert.equal(await failing(null), FALLBACK_PALETTE)
  assert.equal(await failing('/images/album-placeholder-01.svg'), FALLBACK_PALETTE)
  assert.equal(failures, 0)
  assert.equal(await failing('blocked'), FALLBACK_PALETTE)
  await failing('blocked'); assert.equal(failures, 1)
  time += 60_001; await failing('blocked'); assert.equal(failures, 2)
})

it('图片匿名跨域加载且设置在src之前，Canvas跨域错误安全降级，不泄漏异常', async () => {
  await withReactHarness(async h => {
    const { extractAlbumPalette, createPaletteCache, FALLBACK_PALETTE } = await paletteModule()
    const originalImage = Object.getOwnPropertyDescriptor(globalThis, 'Image')
    const createElement = h.document.createElement.bind(h.document)
    let crossOriginAtLoad
    class SyntheticImage {
      set src(value) { if (value) { crossOriginAtLoad = this.crossOrigin; queueMicrotask(() => this.onload?.()) } }
    }
    Object.defineProperty(globalThis, 'Image', { configurable: true, writable: true, value: SyntheticImage })
    h.document.createElement = (name, ...rest) => {
      const element = createElement(name, ...rest)
      if (name === 'canvas') element.getContext = () => ({ drawImage() {}, getImageData() { throw new h.window.DOMException('synthetic private details', 'SecurityError') } })
      return element
    }
    try {
      assert.equal(await createPaletteCache(extractAlbumPalette)('https://p.music.126.net/cover.jpg'), FALLBACK_PALETTE)
      assert.equal(crossOriginAtLoad, 'anonymous')
    } finally {
      h.document.createElement = createElement
      if (originalImage) Object.defineProperty(globalThis, 'Image', originalImage)
      else delete globalThis.Image
    }
  })
})

it('快速切歌保持最多两层，废弃迟到和已排队的旧颜色，不在等待新图时闪回旧图', async () => {
  await withReactHarness(async h => {
    h.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
    const { AmbientAlbumBackground, AMBIENT_CROSSFADE_MS } = await backgroundModule()
    const pending = new Map(), calls = []
    const loadPalette = source => { calls.push(source); return new Promise(resolve => pending.set(source, resolve)) }
    const render = (coverUrl, active = true) => h.render(h.React.createElement(AmbientAlbumBackground, { coverUrl, active, loadPalette }))
    const current = () => h.require('[data-ambient-layer][data-front="true"]').style.getPropertyValue('--ambient-color-1')
    await render('a', false); assert.equal(calls.length, 0)
    await render('a')
    await h.React.act(async () => pending.get('a')(red))
    assert.equal(current(), red[0])
    await render('b')
    await h.React.act(async () => pending.get('b')(green))
    assert.equal(current(), red[0], '交叉淡入期间不覆写还可见的旧层')
    await render('c')
    await h.wait(AMBIENT_CROSSFADE_MS + 20)
    assert.equal(current(), red[0], '新图尚未加载时不能显示已失效的排队结果')
    await render('d')
    await h.React.act(async () => pending.get('c')(green))
    assert.equal(current(), red[0], '迟到的请求不得覆盖当前歌曲')
    await h.React.act(async () => pending.get('d')(green))
    assert.equal(current(), green[0])
    assert.equal(h.document.querySelectorAll('[data-ambient-layer]').length, 2)
    assert.equal(h.query('canvas, button, input'), null, '背景是无交互装饰，不创建播放器或可见画布')
    await render('d', false)
    assert.equal(h.document.querySelectorAll('[data-running="true"]').length, 0)
  })
})

it('减少动态效果时直接更换颜色；后台标签停止动画且不加载新封面', async () => {
  await withReactHarness(async h => {
    const { AmbientAlbumBackground } = await backgroundModule()
    const calls = []
    const loadPalette = async source => { calls.push(source); return source === 'a' ? red : green }
    const render = coverUrl => h.render(h.React.createElement(AmbientAlbumBackground, { coverUrl, active: true, loadPalette }))
    await render('a'); await render('b')
    assert.equal(h.require('[data-front="true"]').style.getPropertyValue('--ambient-color-1'), green[0])
    assert.equal(h.document.querySelectorAll('[data-running="true"]').length, 0)
    Object.defineProperty(h.document, 'hidden', { configurable: true, value: true })
    await h.React.act(async () => h.document.dispatchEvent(new h.window.Event('visibilitychange')))
    await render('c'); assert.deepEqual(calls, ['a','b'])
    Object.defineProperty(h.document, 'hidden', { configurable: true, value: false })
    await h.React.act(async () => h.document.dispatchEvent(new h.window.Event('visibilitychange')))
    await h.flush(); assert.deepEqual(calls, ['a','b','c'])
  })
})
