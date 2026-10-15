const assert = require('node:assert/strict')
const { it } = require('node:test')
const tick = () => new Promise(resolve => setImmediate(resolve))
it('场景加载、显示、暂停和销毁只有一个 RAF，延迟加载退出不会重新创建资源', async () => {
  const { mountArchiveScene } = await import('../frontend/src/graphics/archive/scene-host.ts')
  const originals = { window: global.window, document: global.document }
  const frames = new Map(), listeners = new Map(); let id = 0, disposed = 0, updates = 0, loaded
  global.window = { requestAnimationFrame: fn => { frames.set(++id, fn); return id }, cancelAnimationFrame: id => frames.delete(id),
    addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) }
  global.document = { hidden: false, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) }
  const themes = []
  const scene = { load: () => new Promise(resolve => { loaded = resolve }), dispose: () => disposed++, setTheme: (...args) => themes.push(args),
    setReduced() {}, setMode() {}, select() {}, resize() {}, update() { updates++ }, detailVisibility: 0, finishDecryption() {} }
  try {
    const host = mountArchiveScene({}, { reduced: false, initialRecord: 16, covers: [], loadScene: async () => scene, afterUpdate: () => true, onSelect() {}, onNavigate() {} })
    await tick(); host.destroy(); loaded(); await tick()
    assert.equal(disposed, 1); assert.equal(frames.size, 0); assert.equal(listeners.size, 0)
    const next = mountArchiveScene({}, { reduced: false, initialRecord: 16, covers: [], loadScene: async () => ({ ...scene, load: async () => {} }), afterUpdate: () => true, onSelect() {}, onNavigate() {} })
    await tick(); next.wake(); next.wake(); assert.equal(frames.size, 1)
    assert.deepEqual(themes.at(-1), [false, true])
    global.document.documentElement = { dataset: { theme: 'dark' } }
    listeners.get('omc:themechange')()
    assert.deepEqual(themes.at(-1), [true, true]); assert.equal(frames.size, 1)
    const fn = [...frames.values()][0]; frames.clear(); fn(1000)
    assert.equal(updates, 1); assert.equal(frames.size, 1)
    next.setVisible(false); assert.equal(frames.size, 0)
    global.document.documentElement.dataset.theme = 'light'
    listeners.get('omc:themechange')()
    assert.equal(updates, 2, '设置弹窗暂停场景时，切换主题只补画一帧，背景也立即更新')
    assert.equal(frames.size, 0)
    next.setVisible(true); assert.equal(frames.size, 1)
    global.document.hidden = true; listeners.get('visibilitychange')(); assert.equal(frames.size, 0)
    next.destroy(); next.destroy(); assert.equal(disposed, 2); assert.equal(listeners.size, 0)
  } finally { for(const [key,value] of Object.entries(originals)) { if(value === undefined) delete global[key]; else global[key] = value } }
})
