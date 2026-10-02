const assert = require('node:assert/strict')
const { it } = require('node:test')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const load = name => import(pathToFileURL(path.resolve(__dirname, '../frontend/src', name)).href)
const song = id => ({ kind: 'song', key: `netease:${id}`, source: 'netease', sourceId: String(id), title: '歌曲' })
const tick = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }

it('恢复队列不写回、不自动播放；相同快照不重复保存', async () => {
  const { createQueuePersistence } = await load('queue-persistence.ts')
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
  const { createQueuePersistence } = await load('queue-persistence.ts')
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
  const { createQueuePersistence } = await load('queue-persistence.ts')
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
  const { createQueuePersistence } = await load('queue-persistence.ts')
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
  const { createPersonalLibraryClient } = await load('personal-library-client.ts')
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
  const { createPersonalLibraryClient } = await load('personal-library-client.ts')
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
it('恢复器保留顺序和去重，最多 500 首；全站挂载恢复并清理生命周期监听', async () => {
  const { MusicQueue } = await load('music-queue.ts')
  const queue = new MusicQueue()
  queue.restore([song(3), song(3), { ...song(5), kind: 'album' }, song(1)])
  assert.deepEqual(queue.items.map(item => item.key), ['netease:3', 'netease:1'])
  queue.restore(Array.from({ length: 501 }, (_, i) => song(i + 1)))
  assert.equal(queue.items.length, 500)
  const fs = require('node:fs')
  const source = fs.readFileSync(path.resolve(__dirname, '../frontend/src/album-archive.ts'), 'utf8')
  assert.match(source, /const updateQueue = \(\) => \{\s*queuePersistence.changed\(\)/)
  assert.match(source, /restore: tracks => \{ queue.restore\(tracks\); updateQueue\(\) \}/)
  assert.match(source, /queuePersistence.start\(\)/)
  assert.match(source, /queuePersistence.destroy\(\)/)
  for (const event of ['online', 'pagehide']) {
    assert.ok(source.includes(`addEventListener('${event}'`))
    assert.ok(source.includes(`removeEventListener('${event}'`))
  }
})
