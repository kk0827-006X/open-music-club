const assert = require('node:assert/strict')
const { it } = require('node:test')
const { JSDOM } = require(require.resolve('jsdom', { paths: [require('node:path').resolve('vendor/api-enhanced')] }))
const tick = () => new Promise(resolve => setImmediate(resolve))
it('页面协调保留同一个服务与页面实例，清理过渡和页面生命周期', async () => {
  const { createNavigation } = await import('../frontend/src/app/navigation.ts')
  const dom = new JSDOM('<main></main>'), root = dom.window.document.querySelector('main')
  const oldWindow = global.window; global.window = dom.window
  const timers = new Map(), frames = new Map(); let id = 0, reset = 0
  dom.window.setTimeout = fn => { timers.set(++id, fn); return id }
  dom.window.clearTimeout = id => timers.delete(id)
  dom.window.requestAnimationFrame = fn => { frames.set(++id, fn); return id }
  dom.window.cancelAnimationFrame = id => frames.delete(id)
  const mounts = {}, destroyed = {}, changed = []
  const pages = Object.fromEntries(['upload','user'].map(name => [name, { delay: 300,
    mount() { mounts[name] = (mounts[name] || 0) + 1; const element = dom.window.document.createElement('section'); root.append(element);
      return { element, refresh() {}, focus() {}, destroy() { destroyed[name] = (destroyed[name] || 0) + 1; element.remove() } } },
  }]))
  try {
    const nav = createNavigation(root, { pages, reduced: false, resetArchive: () => reset++, changed: name => changed.push(name) })
    nav.show('upload'); nav.show('user'); nav.show('upload')
    for (const fn of [...frames.values()]) fn(); frames.clear()
    for (const fn of [...timers.values()]) fn(); timers.clear()
    assert.deepEqual(mounts, { upload: 1, user: 1 }); assert.equal(reset, 3)
    assert.equal(nav.current, 'upload'); assert.equal(root.dataset.view, 'upload')
    nav.hide(); assert.equal(nav.current, 'archive')
    nav.show('upload'); nav.destroy(); nav.destroy()
    assert.equal(frames.size, 0); assert.equal(timers.size, 0)
    assert.deepEqual(destroyed, { upload: 1, user: 1 })
    nav.show('user'); assert.equal(root.childElementCount, 0)
    await tick()
  } finally { dom.window.close(); if (oldWindow === undefined) delete global.window; else global.window = oldWindow }
})
