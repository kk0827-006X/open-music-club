const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { describe, it } = require('node:test')
const { pathToFileURL } = require('node:url')
const { withReactHarness } = require('./helpers/reactHarness')

const load = relative => import(pathToFileURL(path.resolve(__dirname, '../frontend/src', relative)).href)

const withPlayerHarness = withReactHarness

// 统一的歌曲数据；恶意字段由各测试按需覆盖，避免把字符串模板当成受测对象。
const song = (id, source = 'local', overrides = {}) => ({
  key: `${source}:${id}`,
  source,
  sourceId: String(id),
  kind: 'song',
  title: `歌曲 ${id}`,
  artist: '歌手',
  album: '专辑',
  coverUrl: '/images/album-placeholder-01.svg',
  duration: '1:00',
  year: '2024',
  description: '',
  ...overrides,
})

const panelProps = (items, overrides = {}) => ({
  open: true,
  items,
  activeKey: undefined,
  reduced: false,
  likes: new Map(),
  pendingLikes: new Set(),
  orderStatus: '',
  onClose() {},
  onFocusToggle() {},
  onClear() {},
  onPlay() {},
  onRemove() {},
  onSave() {},
  onLike() {},
  onReorder() {},
  ...overrides,
})

// 只注入假音频，绝不创建真实 Audio，也不发起真实网络请求。
function createFakeAudio(harness) {
  class FakeAudio extends harness.window.EventTarget {
    paused = true
    currentTime = 0
    duration = NaN
    volume = 1
    src = ''
    preload = ''
    plays = 0
    loads = 0
    play() {
      this.paused = false
      this.plays++
      this.dispatchEvent(new harness.window.Event('play'))
      return Promise.resolve()
    }
    pause() {
      if (this.paused) return
      this.paused = true
      this.dispatchEvent(new harness.window.Event('pause'))
    }
    removeAttribute(name) { if (name === 'src') this.src = '' }
    load() { this.loads++ }
  }
  return new FakeAudio()
}

function stubPersonalLibrary(overrides = {}) {
  return {
    // 队列恢复保持 pending，避免覆盖各测试显式注入的队列快照。
    queue: () => new Promise(() => {}),
    saveQueue: async () => {},
    isLiked: async () => false,
    setLiked: async () => {},
    playlists: async () => [],
    addTrack: async () => {},
    ...overrides,
  }
}

async function mountPlayerView(harness, options = {}) {
  const { PlayerView } = await load('features/player/PlayerView.tsx')
  const { createPlayerController } = await load('features/player/player-core.ts')
  const { MusicQueue } = await load('features/queue/model.ts')
  const queue = options.queue || new MusicQueue()
  const audio = createFakeAudio(harness)
  let created = 0
  const player = createPlayerController({
    queue,
    resolveUrl: async track => `/media/${track.source}/${track.sourceId}`,
    createAudio: () => { created++; return audio },
  })
  const root = harness.React.createRef()
  root.current = harness.query('#app')
  const view = harness.React.createRef()
  const expandedChanges = []
  const collectionChanges = []
  const selectedAlbum = {
    title: '测试专辑',
    artist: '测试歌手',
    coverUrl: '/images/album-placeholder-01.svg',
    tracks: [{ title: '预览曲目', duration: '3:00' }],
  }
  const defaultTrack = options.defaultTrack || song(99)
  await harness.render(harness.React.createElement(PlayerView, {
    ref: view,
    player,
    queue,
    personalLibrary: options.personalLibrary || stubPersonalLibrary(),
    selectedAlbum,
    defaultTrack,
    onExpandedChanged: open => expandedChanges.push(open),
    collectionChanged: () => collectionChanges.push(1),
    root,
  }))
  return { view, player, queue, audio, created: () => created, expandedChanges, collectionChanges }
}

describe('播放队列面板交互（真实 React 组件）', () => {
  it('生产播放器只挂载一个队列面板，初始隐藏并可由队标开关', async () => {
    await withPlayerHarness(async harness => {
      await mountPlayerView(harness)
      const panel = harness.require('[data-player-queue-panel]')
      assert.equal(harness.document.querySelectorAll('[data-player-queue-panel]').length, 1)
      assert.equal(panel.hidden, true)
      assert.equal(panel.getAttribute('aria-label'), '播放队列')

      const toggle = harness.require('[data-player-queue-toggle]')
      await harness.click('[data-player-queue-toggle]')
      assert.equal(panel.hidden, false)
      assert.equal(toggle.getAttribute('aria-expanded'), 'true')
      assert.equal(toggle.getAttribute('aria-controls'), 'player-queue-panel')

      await harness.click('[data-player-queue-toggle]')
      assert.equal(panel.hidden, true)
      assert.equal(toggle.getAttribute('aria-expanded'), 'false')
    })
  })

  it('队列操作全部复用图标，方框加号区别于加入队列，爱心包含真实状态', async () => {
    await withPlayerHarness(async harness => {
      const { QueuePanel } = await load('features/queue/QueuePanel.tsx')
      const items = [song(1), song(1, 'netease'), song(2, 'netease')]
      const likes = new Map([['local:1', true], ['netease:1', false]])
      await harness.render(harness.React.createElement(QueuePanel, panelProps(items, {
        activeKey: 'local:1',
        likes,
        pendingLikes: new Set(['netease:1']),
        orderStatus: '歌曲已移动到第 1 位',
      })))

      const rows = [...harness.document.querySelectorAll('[data-queue-key]')]
      assert.equal(rows.length, 3)
      assert.equal(rows[0].dataset.queueKey, 'local:1')
      assert.ok(rows[0].classList.contains('is-active'))
      assert.equal(rows[0].querySelector('[data-queue-drag]').textContent, '01')
      assert.equal(rows[1].querySelector('[data-queue-drag]').textContent, '02')

      for (const row of rows) {
        for (const action of ['play', 'save', 'like', 'remove']) {
          const button = row.querySelector(`[data-queue-${action}]`)
          assert.ok(button, `缺少队列操作 ${action}`)
          // 动作按钮只包含图标，不渲染“歌单/播放/移除”文字。
          assert.doesNotMatch(button.textContent, /歌单|播放|移除|收藏/)
          assert.equal(button.querySelectorAll('[data-ui-icon]').length, 1)
        }
        assert.match(row.querySelector('.queue-copy small').textContent, /LOCAL|NETEASE/)
      }
      // 旧的上移/下移按钮已被拖拽和键盘排序取代，不应重新出现。
      assert.equal(harness.document.querySelectorAll('[data-queue-up], [data-queue-down]').length, 0)

      const saveIcon = rows[0].querySelector('[data-queue-save] [data-ui-icon="playlistAdd"]')
      assert.ok(saveIcon)
      assert.equal(saveIcon.querySelector('rect').getAttribute('rx'), '4')
      assert.equal(rows[0].querySelector('[data-queue-save] [data-ui-icon="plus"]'), null)
      assert.ok(rows[0].querySelector('[data-queue-play] [data-ui-icon="play"]'))
      assert.ok(rows[0].querySelector('[data-queue-remove] [data-ui-icon="close"]'))

      const liked = rows[0].querySelector('[data-queue-like="local:1"]')
      assert.equal(liked.getAttribute('aria-pressed'), 'true')
      assert.equal(liked.disabled, false)
      assert.equal(liked.querySelector('[data-ui-icon="heart"]').dataset.filled, 'true')

      const unliked = rows[1].querySelector('[data-queue-like="netease:1"]')
      assert.equal(unliked.getAttribute('aria-pressed'), 'false')
      assert.equal(unliked.disabled, true, '收藏状态请求中必须禁用')
      assert.equal(unliked.querySelector('[data-ui-icon="heart"]').dataset.filled, 'false')

      const unknown = rows[2].querySelector('[data-queue-like="netease:2"]')
      assert.equal(unknown.disabled, true, '未知收藏状态不能直接点击')

      const clear = harness.require('[data-queue-clear]')
      assert.equal(clear.getAttribute('aria-label'), '清空队列')
      assert.ok(clear.querySelector('[data-ui-icon="trash"]'))
      assert.equal(clear.disabled, false)

      assert.equal(harness.require('[data-queue-empty]').hidden, true)
      const status = harness.require('[data-queue-order-status]')
      assert.equal(status.getAttribute('role'), 'status')
      assert.equal(status.textContent, '歌曲已移动到第 1 位')
    })
  })

  it('队列渲染转义歌曲标题、艺术家和来源 ID，不插入 HTML', async () => {
    await withPlayerHarness(async harness => {
      const { QueuePanel } = await load('features/queue/QueuePanel.tsx')
      const title = '<img onerror="alert(1)">'
      const item = song(1, 'local', { key: 'local:"1', title, artist: '<script>' })
      await harness.render(harness.React.createElement(QueuePanel, panelProps([item])))

      const row = harness.require('[data-queue-key]')
      assert.equal(row.dataset.queueKey, 'local:"1')
      // 整个队列只允许每行的封面图，恶意标题不会变成额外元素。
      assert.equal(harness.document.querySelectorAll('[data-queue-items] img').length, 1)
      assert.equal(harness.document.querySelectorAll('[data-queue-items] img[onerror]').length, 0)
      assert.equal(harness.document.querySelectorAll('script').length, 0)
      assert.equal(row.querySelector('.queue-copy strong').textContent, title)
      assert.match(row.querySelector('.queue-copy small').textContent, /<script> \/ LOCAL/)
      assert.match(row.querySelector('[data-queue-play]').getAttribute('aria-label'), /<img onerror="alert\(1\)">/)
      assert.match(row.querySelector('[data-queue-drag]').getAttribute('aria-label'), /<img onerror="alert\(1\)">/)
      assert.equal(row.querySelector('[data-queue-play]').dataset.queuePlay, 'local:"1')
    })
  })

  it('单击播放、加入歌单、收藏、移除和清空各只触发一次对应回调', async () => {
    await withPlayerHarness(async harness => {
      const { QueuePanel } = await load('features/queue/QueuePanel.tsx')
      const calls = []
      await harness.render(harness.React.createElement(QueuePanel, panelProps([song(1)], {
        likes: new Map([['local:1', false]]),
        onPlay: item => calls.push(['play', item.key]),
        onSave: item => calls.push(['save', item.key]),
        onLike: item => calls.push(['like', item.key]),
        onRemove: item => calls.push(['remove', item.key]),
        onClear: () => calls.push(['clear']),
        onReorder: () => calls.push(['reorder']),
      })))

      await harness.click('[data-queue-play="local:1"]')
      await harness.click('[data-queue-save="local:1"]')
      await harness.click('[data-queue-like="local:1"]')
      await harness.click('[data-queue-remove="local:1"]')
      await harness.click('[data-queue-clear]')
      assert.deepEqual(calls, [
        ['play', 'local:1'], ['save', 'local:1'], ['like', 'local:1'], ['remove', 'local:1'], ['clear'],
      ])

      // 点击行内容不直接播放或排序，整行拖拽仍由 Motion 手柄/阈值控制。
      await harness.React.act(async () => {
        harness.require('.queue-copy').dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }))
      })
      assert.equal(calls.length, 5)
    })
  })

  it('外部点击关闭但不吞掉点击；内部和队标不关闭，卸载移除监听', async () => {
    await withPlayerHarness(async harness => {
      const document = harness.document
      const pointerdownHandlers = new Set()
      const rawAdd = document.addEventListener.bind(document)
      const rawRemove = document.removeEventListener.bind(document)
      document.addEventListener = (type, handler, options) => {
        if (type === 'pointerdown' && options === true) pointerdownHandlers.add(handler)
        return rawAdd(type, handler, options)
      }
      document.removeEventListener = (type, handler, options) => {
        if (type === 'pointerdown' && options === true) pointerdownHandlers.delete(handler)
        return rawRemove(type, handler, options)
      }

      await mountPlayerView(harness)
      // 以挂载后的监听数为基准，避免把 React 自己挂到 document 上的监听算成本组件泄漏。
      const baseline = pointerdownHandlers.size
      const panel = harness.require('[data-player-queue-panel]')
      await harness.click('[data-player-queue-toggle]')
      assert.equal(panel.hidden, false)
      assert.equal(pointerdownHandlers.size, baseline + 1, '队列打开时应注册一个外部点击监听')

      let pageClicks = 0
      const outside = document.createElement('button')
      outside.type = 'button'
      outside.textContent = '页面其他按钮'
      outside.addEventListener('click', () => pageClicks++)
      document.body.append(outside)
      const pointerdown = new harness.window.MouseEvent('pointerdown', { bubbles: true, cancelable: true })
      await harness.React.act(async () => { outside.dispatchEvent(pointerdown) })
      await harness.flush()
      assert.equal(pointerdown.defaultPrevented, false, '关闭浮层不能阻止页面点击')
      assert.equal(panel.hidden, true)
      assert.equal(pointerdownHandlers.size, baseline, '关闭浮层后应移除外部点击监听')
      outside.dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }))
      assert.equal(pageClicks, 1, '外部点击仍应触发原按钮')

      await harness.click('[data-player-queue-toggle]')
      assert.equal(panel.hidden, false)
      assert.equal(pointerdownHandlers.size, baseline + 1)
      await harness.React.act(async () => {
        panel.querySelector('header').dispatchEvent(new harness.window.MouseEvent('pointerdown', { bubbles: true }))
      })
      await harness.flush()
      assert.equal(panel.hidden, false, '面板内部按下不应关闭')

      const toggle = harness.require('[data-player-queue-toggle]')
      await harness.React.act(async () => {
        toggle.dispatchEvent(new harness.window.MouseEvent('pointerdown', { bubbles: true }))
      })
      await harness.flush()
      assert.equal(panel.hidden, false, '队标按下不应关闭')

      await harness.unmount()
      assert.equal(pointerdownHandlers.size, baseline, '卸载后不得残留本组件的外部点击监听')
      outside.remove()
    })
  })

  it('键盘上下方向键立即提交排序、边界不提交，并在两帧后把焦点还给同一手柄', async () => {
    await withPlayerHarness(async harness => {
      const { QueuePanel } = await load('features/queue/QueuePanel.tsx')
      const items = [song(1), song(2), song(3)]
      const reorders = []
      const props = panelProps(items, {
        onReorder: (next, movedKey) => reorders.push({ keys: next.map(item => item.key), movedKey }),
      })
      await harness.render(harness.React.createElement(QueuePanel, props))

      const handle = harness.require('[data-queue-drag="local:1"]')
      const initialFocus = harness.document.createElement('button')
      initialFocus.type = 'button'
      initialFocus.textContent = '排序前焦点'
      harness.document.body.append(initialFocus)
      initialFocus.focus()
      const runFrames = async () => {
        const ids = [...harness.frames.keys()]
        if (!ids.length) return
        await harness.React.act(async () => {
          for (const id of ids) {
            const callback = harness.frames.get(id)
            harness.frames.delete(id)
            callback?.(16)
          }
        })
      }
      const advanceFocus = async () => {
        for (let step = 0; step < 5 && harness.document.activeElement !== handle; step++) await runFrames()
      }

      let pageKeydowns = 0
      const countKeydown = () => pageKeydowns++
      harness.document.addEventListener('keydown', countKeydown)
      harness.frames.clear()
      const down = new harness.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
      await harness.React.act(async () => { handle.dispatchEvent(down) })
      assert.equal(down.defaultPrevented, true)
      assert.equal(pageKeydowns, 0, '排序按键不应冒泡到页面')
      assert.deepEqual(reorders, [{ keys: ['local:2', 'local:1', 'local:3'], movedKey: 'local:1' }])
      await advanceFocus()
      assert.equal(harness.document.activeElement, handle, '排序后焦点应回到同一首歌的手柄')
      initialFocus.remove()

      // 到达列表上边界时仍然消费按键，但不产生新的排序提交。
      harness.frames.clear()
      const up = new harness.window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })
      await harness.React.act(async () => { handle.dispatchEvent(up) })
      assert.equal(up.defaultPrevented, true)
      assert.equal(reorders.length, 1)
      harness.document.removeEventListener('keydown', countKeydown)

      // 面板关闭时挂起的两帧焦点回填不能再抢焦点。
      await harness.render(harness.React.createElement(QueuePanel, { ...props, open: false }))
      const other = harness.document.createElement('button')
      other.type = 'button'
      other.textContent = '面板外焦点'
      harness.document.body.append(other)
      other.focus()
      const closedHandle = harness.require('[data-queue-drag="local:1"]')
      harness.frames.clear()
      const closedDown = new harness.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
      await harness.React.act(async () => { closedHandle.dispatchEvent(closedDown) })
      assert.equal(reorders.length, 2)
      for (let step = 0; step < 5; step++) await runFrames()
      assert.equal(harness.document.activeElement, other, '面板隐藏后不得把焦点抢回手柄')
      other.remove()
    })
  })

  it('Escape 关闭队列、归还焦点且不提交排序', async () => {
    await withPlayerHarness(async harness => {
      const { QueuePanel } = await load('features/queue/QueuePanel.tsx')
      const calls = []
      const props = panelProps([song(1)], {
        onClose: () => calls.push('close'),
        onFocusToggle: () => calls.push('focus'),
        onReorder: () => calls.push('reorder'),
      })
      await harness.render(harness.React.createElement(QueuePanel, props))

      const panel = harness.require('[data-player-queue-panel]')
      const escape = new harness.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      await harness.React.act(async () => { panel.dispatchEvent(escape) })
      assert.equal(escape.defaultPrevented, true)
      assert.deepEqual(calls, ['close', 'focus'])

      // 已关闭时 Escape 不再触发关闭，避免重复归还焦点。
      await harness.render(harness.React.createElement(QueuePanel, { ...props, open: false }))
      await harness.React.act(async () => {
        harness.require('[data-player-queue-panel]').dispatchEvent(new harness.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      })
      assert.deepEqual(calls, ['close', 'focus'])
    })
  })

  it('真实入队保留去重和来源区分，队列计数同步更新', async () => {
    await withPlayerHarness(async harness => {
      const { view, queue } = await mountPlayerView(harness)
      const enqueue = async item => {
        await harness.React.act(async () => { view.current.enqueue(item) })
        await harness.flush()
      }
      await enqueue(song(1))
      assert.equal(harness.require('[data-queue-count]').textContent, '01')
      await enqueue(song(1))
      assert.equal(harness.require('[data-queue-count]').textContent, '01')
      await enqueue(song(1, 'netease'))
      assert.equal(harness.require('[data-queue-count]').textContent, '02')
      await enqueue(song(2, 'local', { kind: 'album' }))
      assert.equal(harness.require('[data-queue-count]').textContent, '02')
      assert.deepEqual(queue.items.map(item => item.key), ['local:1', 'netease:1'])
    })
  })
})
