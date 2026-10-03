const assert = require('node:assert/strict')
const { it } = require('node:test')
const { readFileSync } = require('node:fs')

it('共享控制器消费一次点击、动画结束清理、减少动态效果时不创建粒子', async () => {
  const { mountQueueAddAnimation } = await import('../frontend/src/queue-add-animation.ts')
  const originals = { Element: global.Element, document: global.document, window: global.window }
  const nodes = []
  let listener, finished, reveals = 0, finishes = 0, removedListener = false
  class MockElement {
    disabled = false
    getAttribute() { return null }
    closest() { return this }
    querySelector() { return this }
    getBoundingClientRect() { return { left: 20, top: 100, width: 28, height: 28 } }
  }
  global.Element = MockElement
  global.window = { innerHeight: 800, setTimeout, clearTimeout }
  global.document = { createElement() {
    const node = {
      style: {}, setAttribute() {}, remove() { this.removed = true },
      animate() { return { finished: new Promise(resolve => { finished = resolve }), cancel() { finished() } } },
    }
    nodes.push(node)
    return node
  } }
  const root = {
    addEventListener(type, callback, capture) { assert.equal(capture, true); listener = callback },
    removeEventListener() { removedListener = true },
    querySelector() { return new MockElement() }, append() {},
  }
  try {
    const controller = mountQueueAddAnimation(root, { reduced: false, reveal() { reveals++ }, finish() { finishes++ } })
    listener({ target: new MockElement() })
    // 真实浏览器可能在捕获监听器和后续入队监听器之间执行微任务。
    await Promise.resolve()
    controller.added(); controller.added()
    assert.equal(nodes.length, 1)
    assert.equal(controller.active, true)
    assert.equal(reveals, 1)
    finished(); await Promise.resolve()
    assert.equal(controller.active, false)
    assert.equal(nodes[0].removed, true)
    assert.equal(finishes, 1)
    listener({ target: new MockElement() }); controller.added(); controller.destroy()
    await Promise.resolve()
    assert.equal(controller.active, false)
    assert.equal(removedListener, true)
    assert.equal(finishes, 1)
    const reduced = mountQueueAddAnimation(root, { reduced: true, reveal() { assert.fail('不能展开') }, finish() {} })
    listener({ target: new MockElement() }); reduced.added()
    assert.equal(nodes.length, 2)
    reduced.destroy()
  } finally {
    for (const [name, value] of Object.entries(originals)) {
      if (value === undefined) delete global[name]
      else global[name] = value
    }
  }
})

it('入队弧线从点击位置出发，抛起后落入目标', async () => {
  const { queueFlightFrames } = await import('../frontend/src/queue-add-animation.ts')
  const frames = queueFlightFrames({ x: 100, y: 200 }, { x: 500, y: 600 })
  assert.match(frames[0].transform, /translate\(0px, 0px\)/)
  assert.match(frames.at(-1).transform, /translate\(400px, 400px\)/)
  assert.equal(frames.at(-1).opacity, 0)
  assert.ok(frames.some(frame => /, -\d/.test(frame.transform)))
})

it('所有入队加号统一委托，动画不拦截点击并支持减少动态效果', () => {
  const code = readFileSync('frontend/src/queue-add-animation.ts', 'utf8')
  assert.match(code, /data-ui-icon="plus"/)
  assert.match(code, /addEventListener\('click', capture, true\)/)
  assert.match(code, /reduced/)
  assert.match(code, /uiIcons.plus/)
  const archive = readFileSync('frontend/src/album-archive.ts', 'utf8')
  assert.match(archive, /updateQueue\(\)\s+queueAddAnimation\.added\(\)/)
  const css = readFileSync('frontend/src/style.css', 'utf8')
  assert.match(css, /\.queue-add-flight[^}]*pointer-events: none/s)
  assert.match(css, /button:not\(:disabled\):not\(\[aria-disabled="true"\]\):is\(:hover, :focus-visible\)/)
})
