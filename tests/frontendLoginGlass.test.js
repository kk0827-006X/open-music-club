const assert = require('node:assert/strict')
const path = require('node:path')
const { it, beforeEach, afterEach } = require('node:test')
const { JSDOM } = require(require.resolve('jsdom', { paths: [path.resolve(__dirname, '../vendor/api-enhanced')] }))
let dom, shell, cleanup, previous, frames, draws, clears, disposals, media
const settle = () => new Promise(resolve => setImmediate(resolve))
beforeEach(() => {
  dom = new JSDOM('<div><header class="archive-brand"></header><form><input type="password"></form><dialog></dialog></div>', { pretendToBeVisual: true })
  previous = ['window', 'document'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)])
  globalThis.window = dom.window; globalThis.document = dom.window.document
  media = { matches: false, addEventListener() {}, removeEventListener() {} }
  window.matchMedia = query => query.includes('reduced') ? media : { matches: false }
  frames = new Map(); let id = 0
  window.requestAnimationFrame = callback => { frames.set(++id, callback); return id }
  window.cancelAnimationFrame = id => frames.delete(id)
  shell = document.querySelector('div')
  shell.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1200, height: 800 })
  for (const el of shell.querySelectorAll('form, header')) el.getBoundingClientRect = () => ({ left: 30, top: 40, right: 400, bottom: 600 })
  draws = []; clears = 0; disposals = 0
})
afterEach(() => {
  cleanup?.(); cleanup = null; dom.window.close()
  for (const [key, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else delete globalThis[key]
  }
})
const fake = () => ({ draw: (...args) => draws.push(args), clear: () => clears++, dispose: () => disposals++ })
function point(target = shell, type = 'pointermove', pointerType = 'mouse') {
  const event = new window.MouseEvent(type, { bubbles: true, clientX: 900, clientY: 300 })
  Object.defineProperty(event, 'pointerType', { value: pointerType }); target.dispatchEvent(event)
}
function tick(now) { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(now)) }

it('移植拖尾插值、凹陷缓动、点击波纹，波源固定 16 个且时间步长有界', async () => {
  const { createGlassMotion, glassResolution } = await import('../frontend/src/login-glass-motion.ts')
  const motion = createGlassMotion()
  motion.sample(0); motion.point(600, 400, 1200, 800, 10)
  motion.point(1000, 200, 1200, 800, 30, true)
  const state = motion.sample(33)
  assert.ok(state.hover > 0 && state.hover < 1)
  assert.ok(state.motion > 0)
  assert.equal(state.trail.length, 16)
  assert.ok(state.trail.some(point => point[3] > 0))
  assert.ok(Math.abs(state.ripple[0] - 2) < 1e-10)
  assert.deepEqual(state.ripple.slice(1), [1, 0])
  for (let i = 0; i < 100; i++) motion.point(i * 15, 100, 1200, 800, 35 + i)
  assert.equal(motion.sample(66).trail.length, 16)
  motion.leave()
  const before = motion.sample(99)
  const after = motion.sample(9999)
  assert.ok(after.hover < before.hover)
  assert.ok(after.time - before.time < .1)
  motion.point(0, 0, 0, 0, 10000)
  assert.ok(Number.isFinite(motion.sample(10001).x))
  assert.deepEqual(glassResolution(300, 200), { width: 300, height: 200 })
  const size = glassResolution(3840, 2160)
  assert.ok(size.width * size.height < 301000)
  assert.deepEqual(glassResolution(0, 0), { width: 1, height: 1 })
})
it('懒加载且点击产生涟漪，保护区域正确，鼠标离开后停帧并释放', async () => {
  const { mountLoginGlass } = await import('../frontend/src/login-glass.ts')
  let loads = 0
  cleanup = mountLoginGlass(shell, async () => { loads++; return fake() })
  assert.equal(loads, 0)
  point(); point(shell, 'pointerdown'); await settle(); tick(0); tick(40)
  assert.equal(loads, 1)
  assert.ok(draws.at(-1)[0].hover > 0)
  assert.deepEqual(draws.at(-1)[3][0], [6, 16, 424, 624])
  assert.equal(draws.at(-1)[3].length, 1, '只保留登录表单的动效遮罩')
  tick(41); assert.equal(draws.length, 2)
  shell.dispatchEvent(new window.Event('pointerleave')); tick(performance.now() + 1900)
  assert.equal(frames.size, 0); assert.ok(clears > 0)
  cleanup(); cleanup = null; assert.equal(disposals, 1)
  point(); assert.equal(frames.size, 0)
})
it('鼠标经过 Logo 时继续产生动效，不再作为保护区域排除', async () => {
  const { mountLoginGlass } = await import('../frontend/src/login-glass.ts')
  let loads = 0
  cleanup = mountLoginGlass(shell, async () => { loads++; return fake() })
  point(shell.querySelector('header'))
  await settle(); tick(0); tick(40)
  assert.equal(loads, 1)
  assert.ok(draws.at(-1)[0].hover > 0)
  assert.equal(draws.at(-1)[3].length, 1)
})
it('表单输入、2FA、触屏和后台标签不播放动效，不改变密码值', async () => {
  const { mountLoginGlass } = await import('../frontend/src/login-glass.ts')
  let loads = 0
  cleanup = mountLoginGlass(shell, async () => { loads++; return fake() })
  const input = shell.querySelector('input'); input.value = 'not-sent'
  point(input); point(shell, 'pointermove', 'touch'); assert.equal(loads, 0)
  point(); await settle(); tick(0)
  input.focus(); point(); assert.equal(frames.size, 0); assert.equal(input.value, 'not-sent')
  input.blur(); shell.querySelector('dialog').setAttribute('open', '')
  point(); assert.equal(frames.size, 0)
  shell.querySelector('dialog').removeAttribute('open'); point(); tick(50)
  Object.defineProperty(document, 'hidden', { value: true, configurable: true })
  document.dispatchEvent(new window.Event('visibilitychange')); assert.equal(frames.size, 0)
})
it('减少动态效果不加载，WebGL 失败保留静态页面，延迟加载销毁后正确清理', async () => {
  const { mountLoginGlass } = await import('../frontend/src/login-glass.ts')
  let loads = 0
  media.matches = true
  cleanup = mountLoginGlass(shell, async () => { loads++; return fake() })
  point(); assert.equal(loads, 0); cleanup()
  media.matches = false
  cleanup = mountLoginGlass(shell, async () => { loads++; throw new Error('WebGL unavailable') })
  point(); await settle(); point(); assert.equal(loads, 1); assert.equal(frames.size, 0); cleanup()
  let resolve
  cleanup = mountLoginGlass(shell, () => new Promise(done => { resolve = done }))
  point(); cleanup(); cleanup = null; resolve(fake()); await settle()
  assert.equal(disposals, 1); assert.equal(frames.size, 0)
})
