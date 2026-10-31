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

async function withEntryHost(run, setup = {}) {
  const { mountArchiveScene } = await import('../frontend/src/graphics/archive/scene-host.ts')
  const originals = { window: global.window, document: global.document }
  const frames = new Map(), listeners = new Map(), phases = [], samples = [], modes = [], finishes = []
  let id = 0, selected = 0
  global.window = { requestAnimationFrame: fn => { frames.set(++id, fn); return id }, cancelAnimationFrame: key => frames.delete(key),
    addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key) }
  global.document = { hidden: false, addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key) }
  const scene = { load: setup.load ?? (async () => {}), dispose() {}, setReduced() {}, setTheme() {},
    setMode: mode => modes.push(mode), finishOpening: immediate => finishes.push(immediate), select() {}, resize() {},
    update: (time, cinematic) => samples.push({ time, cinematic }), finishDecryption() {}, detailVisibility: 0 }
  const container = {}
  const host = mountArchiveScene(container, { entry: true, reduced: false, initialRecord: 16, covers: [], loadScene: async () => scene,
    onEntryPhase: phase => phases.push(phase), onSelect: () => selected++, onNavigate() {}, afterUpdate: () => true })
  const frame = ms => { assert.ok(frames.size <= 1); const entry = [...frames][0]; assert.ok(entry); frames.delete(entry[0]); entry[1](ms) }
  try { await run({ host, scene, frame, phases, samples, modes, finishes, listeners, container, selected: () => selected }) }
  finally { host.destroy(); assert.equal(frames.size, 0); for (const [key, value] of Object.entries(originals)) { if (value === undefined) delete global[key]; else global[key] = value } }
}

it('入场只播放阵列镜头，后台暂停时间轴，结束后恢复交互且不重播', async () => {
  await withEntryHost(async h => {
    await tick()
    assert.equal(h.host.entryPhase, 'entering'); assert.equal(h.host.ready, false)
    h.scene.onSelect(1); assert.equal(h.selected(), 0)
    h.frame(1000); h.frame(1100)
    const before = h.samples.at(-1).cinematic.time
    global.document.hidden = true; h.listeners.get('visibilitychange')()
    global.document.hidden = false; h.listeners.get('visibilitychange')()
    h.frame(100000)
    assert.equal(h.samples.at(-1).cinematic.time, before, '后台停留不能跳过入场')
    for (let i = 1; i <= 55; i++) h.frame(100000 + i * 100)
    assert.equal(h.host.entryPhase, 'ready'); assert.equal(h.host.ready, true)
    const cinema = h.samples.filter(sample => sample.cinematic).map(sample => sample.cinematic)
    assert.ok(cinema.length > 20)
    assert.ok(cinema.every(sample => sample.time < 25.05 && sample.zoom === 0 && sample.lift === 0), '不进入特定档案聚焦、抽取或详情镜头')
    assert.deepEqual(h.phases, ['entering', 'settling', 'ready'])
    assert.equal(h.modes.includes('detail'), false)
    h.scene.onSelect(1); assert.equal(h.selected(), 1)
    h.host.setVisible(false); h.host.setVisible(true); h.frame(200000)
    assert.equal(h.samples.at(-1).cinematic, undefined)
  })
})

it('加载中或运行时启用减少动态效果，以及加载失败均安全结束入场', async () => {
  let loaded
  await withEntryHost(async h => {
    await tick(); h.host.setReduced(true); assert.equal(h.host.entryPhase, 'ready'); assert.equal(h.host.ready, false); loaded(); await tick()
    assert.equal(h.host.entryPhase, 'ready'); assert.deepEqual(h.finishes, [true])
  }, { load: () => new Promise(resolve => { loaded = resolve }) })
  await withEntryHost(async h => {
    await tick(); h.frame(1000); h.host.setReduced(true)
    assert.equal(h.host.entryPhase, 'ready'); assert.equal(h.finishes.at(-1), true)
  })
  await withEntryHost(async h => {
    await tick(); assert.equal(h.host.entryPhase, 'failed')
    assert.match(h.container.textContent, /暂时无法加载/)
  }, { load: async () => { throw new Error('synthetic') } })
})

it('低帧率按实际可见时间完成入场，不因帧数不足延长等待', async () => {
  await withEntryHost(async h => {
    const progress = []
    h.scene.setOpeningProgress = value => progress.push(value)
    await tick()
    h.frame(1000); h.frame(2500); h.frame(4200)
    assert.equal(h.host.entryPhase, 'settling')
    h.frame(5800)
    assert.equal(h.host.entryPhase, 'ready')
    assert.deepEqual(progress, [0, 1])
  })
})


it('GPU 预热完成之前不启动入场计时，不创建额外渲染循环', async () => {
  let warmed
  await withEntryHost(async h => {
    h.scene.prepareEntry = () => new Promise(resolve => { warmed = resolve })
    await tick()
    assert.equal(h.host.entryPhase, 'loading')
    assert.equal(h.samples.length, 0)
    warmed(); await tick()
    assert.equal(h.host.entryPhase, 'entering')
    h.frame(100000)
    assert.equal(h.samples.at(-1).cinematic.time, 21.9, '预热耗时不占用入场时间')
  })
})
