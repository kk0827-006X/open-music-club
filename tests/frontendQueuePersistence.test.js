const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { it } = require('node:test')
const { pathToFileURL } = require('node:url')
const { withReactHarness } = require('./helpers/reactHarness')

const load = name => import(pathToFileURL(path.resolve(__dirname, '../frontend/src', name)).href)
const tick = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const song = (id, source = 'netease', overrides = {}) => ({
  kind: 'song',
  key: `${source}:${id}`,
  source,
  sourceId: String(id),
  title: `歌曲 ${id}`,
  artist: '歌手',
  album: '专辑',
  coverUrl: '/images/album-placeholder-01.svg',
  duration: '1:00',
  year: '2024',
  description: '',
  ...overrides,
})

// Radix/Motion 在浏览器使用 ResizeObserver；JSDOM 提供最小桩。
function withPlayerHarness(callback) {
  return withReactHarness(async harness => {
    const previous = globalThis.ResizeObserver
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    harness.window.ResizeObserver = ResizeObserverStub
    globalThis.ResizeObserver = ResizeObserverStub
    try {
      return await callback(harness)
    } finally {
      if (previous === undefined) delete globalThis.ResizeObserver
      else globalThis.ResizeObserver = previous
      delete harness.window.ResizeObserver
    }
  })
}

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

const response = body => ({ ok: true, status: 200, json: async () => body })
const personalTrack = item => ({
  source: item.source,
  sourceId: item.sourceId,
  trackKey: item.key,
  title: item.title,
  artists: [{ name: item.artist }],
  album: { name: item.album },
  durationMs: 60000,
  coverUrl: item.coverUrl,
  playable: true,
})

// 全部请求由内存 fetcher 应答，不连接真实网络。
function createApi(options = {}) {
  const calls = []
  const writes = []
  const fetcher = async (url, init = {}) => {
    calls.push({ url, init })
    if (url === '/api/security/csrf-token') return response({ csrfToken: 'test-token' })
    if (url === '/api/me/queue') {
      if ((init.method || 'GET') === 'PUT') {
        const tracks = JSON.parse(init.body).tracks
        writes.push(tracks)
        return options.save ? options.save(tracks, writes.length) : response({ success: true })
      }
      return response({ tracks: options.tracks || [] })
    }
    if (/^\/api\/me\/likes\/[^/]+\/[^/]+$/.test(url)) {
      return init.method === 'PUT' || init.method === 'DELETE' ? response({ success: true }) : response({ liked: false })
    }
    throw new Error(`测试未声明网络请求：${url}`)
  }
  return { fetcher, calls, writes }
}

async function mountPlayerView(harness, { api, tracks = [] }) {
  const { MusicQueue } = await load('features/queue/model.ts')
  const { createPlayerController } = await load('features/player/player-core.ts')
  const { PlayerView } = await load('features/player/PlayerView.tsx')
  const { createPersonalLibraryClient } = await load('services/music/personal-library.ts')
  const queue = new MusicQueue()
  queue.restore(tracks)
  const audio = createFakeAudio(harness)
  const player = createPlayerController({
    queue,
    resolveUrl: async track => `/media/${track.source}/${track.sourceId}`,
    createAudio: () => audio,
  })
  const personalLibrary = createPersonalLibraryClient(api.fetcher)
  const root = harness.React.createRef()
  root.current = harness.query('#app')
  const view = harness.React.createRef()
  await harness.render(harness.React.createElement(PlayerView, {
    ref: view,
    player,
    queue,
    personalLibrary,
    selectedAlbum: {
      title: '测试专辑',
      artist: '测试歌手',
      coverUrl: '/images/album-placeholder-01.svg',
      tracks: [{ title: '预览曲目', duration: '3:00' }],
    },
    defaultTrack: song(99, 'local'),
    onExpandedChanged() {},
    collectionChanged() {},
    root,
  }))
  return { view, queue, audio, player }
}

it('恢复队列不写回、不自动播放；相同快照不重复保存', async () => {
  const { createQueuePersistence } = await load('features/queue/persistence.ts')
  let items = [], writes = []
  const sync = createQueuePersistence({ read: () => items, restore: saved => { items = saved; sync.changed() },
    load: async () => [song(2), song(1)], save: async refs => { writes.push(refs) }, notice() {} })
  await sync.start()
  assert.deepEqual(items.map(item => item.key), ['netease:2', 'netease:1'])
  sync.changed(); await tick(); assert.equal(writes.length, 0)
  items = [song(1)]; sync.changed(); await tick()
  assert.deepEqual(writes, [[{ source: 'netease', sourceId: '1' }]])
  sync.destroy()
})
it('保存串行且合并快速操作；排序、移除和清空都保存最终顺序', async () => {
  const { createQueuePersistence } = await load('features/queue/persistence.ts')
  const first = deferred(), writes = []
  let items = []
  const sync = createQueuePersistence({ read: () => items, restore: saved => { items = saved }, load: async () => [],
    save: async refs => { writes.push(refs); if (writes.length === 1) await first.promise }, notice() {} })
  await sync.start()
  items = [song(1)]; sync.changed()
  items = [song(2), song(1)]; sync.changed()
  items = [song(2)]; sync.changed()
  assert.equal(writes.length, 1)
  first.resolve(); await tick()
  assert.deepEqual(writes[1], [{ source: 'netease', sourceId: '2' }])
  items = []; sync.changed(); await tick(); assert.deepEqual(writes[2], [])
  sync.destroy()
})
it('加载较慢时不覆盖用户的新操作，加载失败不把空队列写到服务器', async () => {
  const { createQueuePersistence } = await load('features/queue/persistence.ts')
  const loading = deferred(), writes = []
  let items = []
  const sync = createQueuePersistence({ read: () => items, restore: saved => { items = saved }, load: () => loading.promise,
    save: async refs => { writes.push(refs) }, notice() {} })
  const started = sync.start()
  items = [song(9)]; sync.changed(); loading.resolve([song(1)]); await started; await tick()
  assert.deepEqual(items.map(item => item.key), ['netease:9', 'netease:1'])
  assert.deepEqual(writes[0].map(item => item.sourceId), ['9', '1'])
  sync.destroy()
  const failedWrites = [], notices = []
  const failed = createQueuePersistence({ read: () => [], restore() { assert.fail() }, load: async () => { throw new Error('offline') },
    save: async refs => { failedWrites.push(refs) }, notice: text => notices.push(text) })
  await failed.start(); failed.changed(); await tick()
  assert.equal(failedWrites.length, 0); assert.equal(notices.length, 1); failed.destroy()
})
it('保存失败保留待写内容，重试后恢复；卸载不写空快照', async () => {
  const { createQueuePersistence } = await load('features/queue/persistence.ts')
  let items = [], fail = true
  const writes = [], notices = []
  const sync = createQueuePersistence({ read: () => items, restore() {}, load: async () => [],
    save: async refs => { if (fail) throw new Error('offline'); writes.push(refs) }, notice: text => notices.push(text) })
  await sync.start(); items = [song(3)]; sync.changed(); await tick()
  assert.equal(writes.length, 0); assert.equal(notices.length, 1)
  fail = false; await sync.retry(); await tick()
  assert.equal(writes[0][0].sourceId, '3')
  sync.destroy(); items = []; sync.changed(); await tick(); assert.equal(writes.length, 1)
})
it('队列 API 客户端使用真实 GET/PUT、CSRF 和 keepalive，剔除歌曲元数据', async () => {
  const { createPersonalLibraryClient } = await load('services/music/personal-library.ts')
  const calls = []
  const api = createPersonalLibraryClient(async (url, init) => {
    calls.push({ url, init }); return { ok: true, status: 200, json: async () => url.endsWith('csrf-token') ? { csrfToken: 'test' } : { tracks: [] } }
  })
  assert.deepEqual(await api.queue(), [])
  await api.saveQueue([song(1)])
  assert.equal(calls[0].url, '/api/me/queue')
  assert.equal(calls[2].init.method, 'PUT')
  assert.equal(calls[2].init.headers['X-CSRF-Token'], 'test')
  assert.equal(calls[1].init.keepalive, true); assert.equal(calls[2].init.keepalive, true)
  assert.deepEqual(JSON.parse(calls[2].init.body), { tracks: [{ source: 'netease', sourceId: '1' }] })
  await api.saveQueue([song(2)])
  assert.equal(calls[3].url, '/api/me/queue')
  assert.equal(calls[3].init.keepalive, true)
  assert.equal(calls.length, 4)
})
it('会话变更导致 403 后，下次写入重新获取 CSRF，不复用失效令牌', async () => {
  const { createPersonalLibraryClient } = await load('services/music/personal-library.ts')
  let tokens = 0, writes = 0
  const api = createPersonalLibraryClient(async (url, init) => {
    if (url.endsWith('csrf-token')) return { ok: true, status: 200, json: async () => ({ csrfToken: `token-${++tokens}` }) }
    assert.equal(init.headers['X-CSRF-Token'], `token-${tokens}`)
    return { ok: ++writes > 1, status: writes > 1 ? 200 : 403, json: async () => ({ success: true }) }
  })
  await assert.rejects(api.saveQueue([song(1)]), /安全校验/)
  await api.saveQueue([song(1)])
  assert.equal(tokens, 2)
})
it('恢复器保留顺序和去重，最多 500 首', async () => {
  const { MusicQueue } = await load('features/queue/model.ts')
  const queue = new MusicQueue()
  queue.restore([song(3), song(3), { ...song(5), kind: 'album' }, song(1)])
  assert.deepEqual(queue.items.map(item => item.key), ['netease:3', 'netease:1'])
  queue.restore(Array.from({ length: 501 }, (_, i) => song(i + 1)))
  assert.equal(queue.items.length, 500)
})

it('真实播放器挂载时恢复服务端队列但不自动播放，卸载清理生命周期监听', async () => {
  const restored = [song(3), song(1)]
  const api = createApi({ tracks: restored.map(personalTrack) })
  await withPlayerHarness(async harness => {
    const window = harness.window
    const online = new Set()
    const pagehide = new Set()
    const rawAdd = window.addEventListener.bind(window)
    const rawRemove = window.removeEventListener.bind(window)
    window.addEventListener = (type, handler, options) => {
      if (type === 'online') online.add(handler)
      if (type === 'pagehide') pagehide.add(handler)
      return rawAdd(type, handler, options)
    }
    window.removeEventListener = (type, handler, options) => {
      if (type === 'online') online.delete(handler)
      if (type === 'pagehide') pagehide.delete(handler)
      return rawRemove(type, handler, options)
    }

    const { queue, audio, player } = await mountPlayerView(harness, { api })
    try {
      await harness.until(() => harness.query('[data-queue-count]')?.textContent === '02', '应恢复服务端的两首歌')
      await harness.flush(10)
      assert.deepEqual(queue.items.map(item => item.key), ['netease:3', 'netease:1'])
      assert.equal(player.get().track, null, '恢复队列不能自动播放')
      assert.equal(audio.plays, 0)
      assert.equal(api.writes.length, 0, '恢复本身不应写回服务器')
      assert.equal(online.size, 1)
      assert.equal(pagehide.size, 1)

      await harness.unmount()
      assert.equal(online.size, 0, '卸载后必须移除 online 重试监听')
      assert.equal(pagehide.size, 0, '卸载后必须移除 pagehide flush 监听')
      await tick()
      assert.equal(api.writes.length, 0, '卸载不能写空快照')
    } finally {
      player.destroy()
      window.addEventListener = rawAdd
      window.removeEventListener = rawRemove
    }
  })
})

it('入队后串行 PUT 最终顺序；清空时 UI 立即更新，不被未完成写入阻塞', async () => {
  const initial = [song(1, 'local'), song(2, 'local')]
  const gate = deferred()
  const api = createApi({
    tracks: initial.map(personalTrack),
    save(tracks, writeIndex) {
      return writeIndex === 1 ? gate.promise : response({ success: true })
    },
  })
  await withPlayerHarness(async harness => {
    const act = harness.React.act
    const { view, queue, audio, player } = await mountPlayerView(harness, { api, tracks: initial })
    try {
      await harness.until(() => harness.query('[data-queue-count]')?.textContent === '02')
      await harness.flush(10)
      await act(async () => { await player.play(queue.items[0]) })
      await harness.flush()

      // 加入第三首后，第一次保存保持 pending，用于验证清空不会等待它完成。
      await act(async () => { view.current.enqueue(song(3, 'local')) })
      await harness.flush()
      await harness.until(() => api.writes.length === 1, '入队应触发一次 PUT')
      assert.deepEqual(api.writes[0].map(item => item.sourceId), ['1', '2', '3'])

      await harness.click('[data-player-queue-toggle]')
      const panel = harness.require('[data-player-queue-panel]')
      assert.equal(harness.document.querySelectorAll('[data-queue-key]').length, 3)
      await harness.click('[data-queue-clear]')
      await harness.flush()

      // 第一次 PUT 仍未完成，但队列、播放器和面板已经同步清空。
      assert.equal(api.writes.length, 1)
      assert.equal(queue.items.length, 0)
      assert.equal(harness.require('[data-queue-count]').textContent, '00')
      assert.equal(panel.hidden, true)
      assert.equal(player.get().track, null)
      assert.equal(audio.src, '')

      gate.resolve(response({ success: true }))
      await harness.until(() => api.writes.length === 2, '清空后应继续串行写入最终空队列')
      assert.deepEqual(api.writes[1], [])

      await harness.unmount()
      await tick()
      assert.equal(api.writes.length, 2, '卸载后不应再写空快照')
    } finally {
      gate.resolve(response({ success: true }))
      player.destroy()
    }
  })
})
