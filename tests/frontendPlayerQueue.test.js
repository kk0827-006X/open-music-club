const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { describe, it } = require('node:test')
const { pathToFileURL } = require('node:url')

const frontend = name => path.resolve(__dirname, '../frontend/src', name)
const load = name => import(pathToFileURL(frontend(name)).href)
const song = (id, source = 'local') => ({ key: `${source}:${id}`, source, sourceId: String(id), kind: 'song',
  title: `歌曲 ${id}`, artist: '歌手', album: '专辑', coverUrl: '/images/album-placeholder-01.svg', duration: '1:00' })

describe('播放队列面板交互', () => {
  it('清空、移除当前歌曲时重置播放器不会再次插入队列面板', async () => {
    const { createPlayerMarkup, createAlbumArchiveMarkup } = await load('album-archive.ts')
    const { demoAlbums } = await load('album-data.ts')
    assert.equal(typeof createPlayerMarkup, 'function')
    const footer = createPlayerMarkup(demoAlbums[0])
    assert.doesNotMatch(footer, /data-player-queue-panel|<aside/)
    assert.equal((createAlbumArchiveMarkup().match(/data-player-queue-panel/g) || []).length, 1)
    const source = fs.readFileSync(frontend('album-archive.ts'), 'utf8')
    assert.match(source, /outerHTML\s*=\s*createPlayerMarkup\(/)
  })

  it('队列操作全部复用图标，方框加号区别于加入队列，爱心包含真实状态', async () => {
    const { createQueueItemsMarkup, createQueuePanelMarkup } = await load('player-queue-panel.ts')
    const { uiIcons, uiIcon } = await load('ui-icons.ts')
    const markup = createQueueItemsMarkup([song(1), song(1, 'netease')], 'local:1', new Map([['local:1', true]]))
    for (const icon of [uiIcons.play, uiIcons.playlistAdd, uiIcons.close, uiIcon('heart', true)]) assert.ok(markup.includes(icon))
    assert.match(uiIcons.playlistAdd, /<rect[^>]*rx="/)
    assert.notEqual(uiIcons.plus, uiIcons.playlistAdd)
    assert.match(markup, /data-queue-like="local:1"[^>]*aria-pressed="true"/)
    assert.match(markup, /data-queue-like="netease:1"[^>]*aria-pressed="false"/)
    assert.doesNotMatch(markup, /data-queue-up|data-queue-down|>歌单<|>播放<|>移除</)
    assert.match(markup, /queue-copy/)
    assert.match(markup, /LOCAL/)
    assert.match(markup, /NETEASE/)
    assert.match(createQueuePanelMarkup(), /aria-label="清空队列"/)
  })

  it('队列渲染转义歌曲标题和来源 ID，避免插入 HTML', async () => {
    const { createQueueItemsMarkup } = await load('player-queue-panel.ts')
    const markup = createQueueItemsMarkup([{ ...song(1), title: '<img onerror="alert(1)">', artist: '<script>', key: 'local:"1' }])
    assert.doesNotMatch(markup, /<script>|<img onerror/)
    assert.match(markup, /&lt;script&gt;/)
    assert.match(markup, /local:&quot;1/)
  })

  it('根据歌曲中心计算拖动位置，支持跨多行及越界钳制', async () => {
    const { queueDropIndex } = await load('player-queue-panel.ts')
    assert.equal(queueDropIndex(-100, [30, 90, 150]), 0)
    assert.equal(queueDropIndex(92, [30, 90, 150]), 1)
    assert.equal(queueDropIndex(500, [30, 90, 150]), 2)
    assert.equal(queueDropIndex(20, []), 0)
  })

  it('外部点击关闭但不吞掉点击；内部和触发按钮不关闭，卸载移除监听', async () => {
    const { bindQueueOutsideClose } = await load('player-queue-panel.ts')
    const listeners = new Map()
    const doc = { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) }
    const inside = {}, toggle = {}, outside = {}
    let closed = 0
    const panel = { ownerDocument: doc, hidden: false, contains: target => target === inside }
    const unbind = bindQueueOutsideClose(panel, () => ({ contains: target => target === toggle }), () => closed++)
    const click = target => ({ target, preventDefault: () => assert.fail('不应阻止点击'), stopPropagation: () => assert.fail('不应吞掉页面点击') })
    listeners.get('pointerdown')(click(inside))
    listeners.get('pointerdown')(click(toggle))
    assert.equal(closed, 0)
    listeners.get('pointerdown')(click(outside))
    assert.equal(closed, 1)
    panel.hidden = true
    listeners.get('pointerdown')(click(outside))
    assert.equal(closed, 1)
    unbind()
    assert.equal(listeners.size, 0)
  })

  it('拖动跨行只在松手时提交排序，相邻行有果冻关键帧；取消和卸载释放资源', async () => {
    const { mountQueuePanel } = await load('player-queue-panel.ts')
    const originals = Object.fromEntries(['Element', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'window'].map(key => [key, globalThis[key]]))
    const callbacks = new Map(), frames = new Map(), effects = [], commits = []
    let frameId = 0, rows, capture = null
    class FakeElement {
      constructor(key) { this.dataset = { queueKey: key }; this.style = { transform: '' }; this.classes = new Set() }
      classList = { add: name => this.classes.add(name), remove: name => this.classes.delete(name) }
      closest() { return this }
      getBoundingClientRect() { return { top: rows.indexOf(this) * 66, height: 66 } }
      animate(keyframes, options) {
        const effect = { keyframes, options, cancelled: false, cancel() { this.cancelled = true } }
        effects.push(effect)
        return effect
      }
    }
    const row = key => new FakeElement(key)
    rows = [row('local:1'), row('netease:1'), row('local:2')]
    const listeners = new Map()
    const list = {
      classList: { add() {}, remove() {} }, querySelectorAll: () => rows,
      hasPointerCapture: id => capture === id, setPointerCapture: id => { capture = id }, releasePointerCapture: () => { capture = null },
      addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name),
    }
    const panel = { hidden: false, scrollTop: 0, querySelector: () => list,
      getBoundingClientRect: () => ({ top: -100, bottom: 400 }),
      addEventListener() {}, removeEventListener() {},
      ownerDocument: { addEventListener: (name, fn) => callbacks.set(name, fn), removeEventListener: name => callbacks.delete(name) },
    }
    let controller
    try {
      globalThis.Element = FakeElement
      globalThis.window = { clearTimeout, setTimeout }
      globalThis.getComputedStyle = element => ({ transform: element.style.transform || 'none' })
      globalThis.requestAnimationFrame = callback => { frames.set(++frameId, callback); return frameId }
      globalThis.cancelAnimationFrame = id => frames.delete(id)
      controller = mountQueuePanel(panel, { reduced: false, toggle: () => null, close() {}, reorder(key, index) {
        commits.push([key, index])
        const keys = rows.map(entry => entry.dataset.queueKey)
        keys.splice(index, 0, ...keys.splice(keys.indexOf(key), 1))
        rows = keys.map(row)
      } })
      const target = new FakeElement('target')
      target.closest = selector => selector.startsWith('button') ? null : rows[0]
      const event = (type, y) => ({ type, target, button: 0, pointerId: 1, clientY: y, preventDefault() {} })
      listeners.get('pointerdown')(event('pointerdown', 33))
      listeners.get('pointermove')(event('pointermove', 165))
      const paint = [...frames.values()][0]; frames.clear(); paint()
      assert.equal(commits.length, 0)
      assert.match(rows[0].style.transform, /translateY\(132px\)/)
      assert.match(rows[1].style.transform, /translateY\(-66px\)/)
      assert.ok(effects.some(effect => effect.keyframes.some(frame => frame.transform.includes('scale(.98,1.04)'))))
      listeners.get('pointerup')(event('pointerup', 165))
      assert.deepEqual(commits, [['local:1', 2]])
      assert.deepEqual(rows.map(entry => entry.dataset.queueKey), ['netease:1', 'local:2', 'local:1'])
      assert.equal(capture, null)
      listeners.get('pointerdown')(event('pointerdown', 33))
      listeners.get('pointermove')(event('pointermove', 99))
      listeners.get('pointercancel')(event('pointercancel', 99))
      assert.equal(commits.length, 1)
      assert.equal(frames.size, 0)
      assert.ok(rows.every(entry => entry.style.transform === ''))
      controller.destroy()
      assert.equal(listeners.size, 0)
      assert.equal(callbacks.size, 0)
      assert.ok(effects.every(effect => effect.cancelled))
    } finally {
      controller?.destroy()
      for (const [key, value] of Object.entries(originals)) {
        if (value === undefined) delete globalThis[key]
        else globalThis[key] = value
      }
    }
  })
})
