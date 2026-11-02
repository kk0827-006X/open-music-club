const assert = require('node:assert/strict')
const { it } = require('node:test')

it('音频节点按会话复用、只出声一次，采样限频且暂停收敛、退出释放', async () => {
  const { createAudioAnalysis } = await import('../frontend/src/features/player/audio-analysis.ts')
  let created = 0, reads = 0, closed = 0, disconnected = 0
  const connections = []
  const meter = { fftSize: 0, getFloatFrequencyData(data) { reads++; data.fill(-Infinity); data[2] = -20 }, disconnect() { disconnected++ } }
  const input = { connect(node) { connections.push(node) }, disconnect() { disconnected++ } }
  const context = { state: 'suspended', sampleRate: 48000, destination: {}, createAnalyser: () => meter,
    createMediaElementSource: () => input, async resume() { this.state = 'running' }, async close() { closed++; this.state = 'closed' } }
  const audio = { paused: false, ended: false, seeking: false, readyState: 4, volume: .6, muted: false }
  const analysis = createAudioAnalysis(audio, () => { created++; return context })
  assert.equal(created, 0)
  await analysis.prepare(); await analysis.prepare()
  assert.equal(created, 1); assert.deepEqual(connections, [context.destination, meter])
  analysis.read(0); analysis.read(.01); analysis.read(.02)
  assert.equal(reads, 1)
  const bands = analysis.read(.04)
  assert.ok(bands.low > 0); assert.equal(bands.mid, 0); assert.equal(bands.high, 0)
  analysis.reset()
  assert.equal(analysis.read(1).low, 0, '显式恢复后从零渐入，不携带旧包络')
  analysis.read(1.04)
  audio.paused = true
  for (let i = 1; i <= 150; i++) analysis.read(1.04 + i / 30)
  assert.equal(bands.low, 0); assert.equal(reads, 4)
  audio.paused = false; audio.muted = true; analysis.read(6)
  assert.equal(reads, 4)
  analysis.destroy(); await analysis.prepare(); analysis.read(7)
  assert.equal(created, 1); assert.equal(closed, 1); assert.equal(disconnected, 2)
})

it('不支持 Web Audio 时保留普通音频，恢复上下文失败明确报告', async () => {
  const { createAudioAnalysis } = await import('../frontend/src/features/player/audio-analysis.ts')
  const unavailable = createAudioAnalysis({}, () => { throw Error('unsupported') })
  await unavailable.prepare(); assert.equal(unavailable.read(0).activity, 0); unavailable.destroy()
  const context = { state: 'suspended', destination: {}, createAnalyser: () => ({ disconnect() {} }),
    createMediaElementSource: () => ({ connect() {}, disconnect() {} }), resume: async () => { throw Error('blocked') }, close: async () => {} }
  const blocked = createAudioAnalysis({}, () => context)
  await assert.rejects(blocked.prepare(), /blocked/); blocked.destroy()
})

it('每档独立读取稳定频谱，峰值明显、邻域连续且静音不自动造浪', async () => {
  const { audioWave, archiveSpectrumPosition, AUDIO_MAX_LIFT, interactionGain } = await import('../frontend/src/rhine/archive-play-motion.ts')
  const spectrum = new Float32Array(32)
  spectrum[10] = 1
  const loud = { low: 1, mid: 1, high: 1, activity: 1, spectrum }
  const peak = audioWave(10, 0, 0, loud)
  assert.ok(peak > 1.5, '单档峰值应清晰可见，不再是第一版微幅起伏')
  assert.equal(audioWave(20, 0, 0, loud), 0, '远离该频段的档案不应跟随共同抬升')
  assert.ok(audioWave(9, 0, 0, loud) < peak)
  assert.equal(audioWave(10, 0, 30, loud), peak, '相同音频不因预设正弦时钟自行变形')
  assert.equal(audioWave(4, 1, 0, loud), peak, '跨列相位错开但映射保持稳定')
  for (let row = -100; row < 100; row++) {
    const value = audioWave(row, 0, 0, loud)
    assert.ok(value >= 0 && value <= AUDIO_MAX_LIFT)
    assert.ok(Math.abs(value - audioWave(row + .001, 0, 0, loud)) < .01, '连续插值无槽位断层')
    assert.equal(archiveSpectrumPosition(row, 0), archiveSpectrumPosition(row + 62, 0))
  }
  spectrum.fill(0)
  assert.equal(audioWave(10, 0, 3, loud), 0)
  let gain = 1
  for (let i = 0; i < 60; i++) gain = interactionGain(gain, true, false, 1 / 60)
  assert.ok(Math.abs(gain - .2) < .001)
  const start = gain
  gain = interactionGain(gain, false, false, 1 / 60)
  assert.ok(gain > start && gain < start + .1)
  for (let i = 0; i < 60; i++) gain = interactionGain(gain, false, true, 1 / 60)
  assert.ok(gain < .001)
})

it('频段映射使用真实采样率，高频不会混入低频', async () => {
  const { createAudioAnalysis } = await import('../frontend/src/features/player/audio-analysis.ts')
  const audio = { paused: false, ended: false, seeking: false, readyState: 4, volume: 1, muted: false }
  const meter = { fftSize: 2048, getFloatFrequencyData(data) { data.fill(-Infinity); data[200] = -15 }, disconnect() {} }
  const context = { state: 'running', sampleRate: 48000, destination: {}, createAnalyser: () => meter,
    createMediaElementSource: () => ({ connect() {}, disconnect() {} }), close: async () => {} }
  const analysis = createAudioAnalysis(audio, () => context)
  await analysis.prepare(); analysis.read(0)
  const bands = analysis.read(.1)
  assert.equal(bands.low, 0); assert.equal(bands.mid, 0); assert.ok(bands.high > 0)
  assert.equal(bands.spectrum.length, 32)
  assert.ok(bands.spectrum.slice(0, 12).every(n => n === 0))
  assert.ok(bands.spectrum.slice(20).some(n => n > .1))
  analysis.destroy()
})

it('场景宿主先读频段再更新，隐藏和减少动态效果停止读取且只保留一个 RAF', async () => {
  const { withReactHarness } = require('./helpers/reactHarness')
  await withReactHarness(async h => {
    const { mountArchiveScene } = await import('../frontend/src/graphics/archive/scene-host.ts')
    const order = []
    const bands = { low: .5, mid: 0, high: 0, activity: 1 }
    const scene = { async load() {}, setReduced() {}, setMode() {}, select() {}, resize() {}, finishDecryption() {},
      detailVisibility: 0, setAudioBands(value) { order.push(value ? 'bands' : 'off') }, update() { order.push('update') }, dispose() {} }
    const host = mountArchiveScene(h.document.createElement('div'), { reduced: false, initialRecord: 0, covers: [],
      loadScene: async () => scene, readAudioBands() { order.push('read'); return bands },
      afterUpdate: () => true, onSelect() {}, onNavigate() {} })
    await new Promise(r => setImmediate(r))
    const frame = now => { const callbacks = [...h.frames.values()]; h.frames.clear(); callbacks.forEach(fn => fn(now)) }
    order.length = 0; frame(100)
    assert.deepEqual(order.slice(0, 3), ['read', 'bands', 'update'])
    assert.equal(h.frames.size, 1)
    host.setVisible(false); order.length = 0; frame(200)
    assert.equal(order.length, 0); assert.equal(h.frames.size, 0)
    host.setVisible(true); host.setAudioEnabled(false); order.length = 0; frame(250)
    assert.deepEqual(order, ['off', 'update'], '关闭播放动效后不读取频谱')
    host.setAudioEnabled(true); order.length = 0; frame(275)
    assert.deepEqual(order.slice(0, 3), ['read', 'bands', 'update'])
    host.setReduced(true); order.length = 0; frame(300)
    assert.deepEqual(order, ['off', 'update'])
    host.destroy(); assert.equal(h.frames.size, 0)
  })
})

it('低帧率连续采样仍保留包络，不误判为重新显示页面', async () => {
  const { createAudioAnalysis } = await import('../frontend/src/features/player/audio-analysis.ts')
  const meter = { fftSize: 2048, getFloatFrequencyData(data) { data.fill(-Infinity); data[2] = -20 }, disconnect() {} }
  const context = { state: 'running', sampleRate: 48000, destination: {}, createAnalyser: () => meter,
    createMediaElementSource: () => ({ connect() {}, disconnect() {} }), close: async () => {} }
  const analysis = createAudioAnalysis({ paused: false, readyState: 4, volume: 1 }, () => context)
  await analysis.prepare(); analysis.read(0)
  assert.ok(analysis.read(1).low > 0)
  assert.ok(analysis.read(2).low > 0)
  analysis.destroy()
})
