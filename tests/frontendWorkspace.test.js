const assert = require('node:assert/strict')
const { it } = require('node:test')
const { JSDOM } = require(require.resolve('jsdom', { paths: [require('node:path').resolve('vendor/api-enhanced')] }))
const tick = () => new Promise(resolve => setImmediate(resolve))
const track = { source: 'local', sourceId: '1', trackKey: 'local:1', title: '本地歌曲', artists: [{ name: '测试歌手' }], album: { name: '专辑' }, durationMs: 100000, coverUrl: null, playable: true }
it('工作区重复切换页面保持队列和音频所有权，清空后其他页面仍可点击', async () => {
  const dom = new JSDOM('<div id="app"></div>', { url: 'http://localhost' })
  const globals = ['window','document','Element','HTMLElement','HTMLButtonElement','HTMLImageElement','HTMLInputElement','HTMLFormElement','Node','FormData','AbortController','requestAnimationFrame','cancelAnimationFrame']
  const originals = Object.fromEntries(globals.map(key => [key, global[key]]))
  for (const key of globals) if (dom.window[key]) global[key] = dom.window[key]
  const frames = new Map(); let frameId = 0
  global.requestAnimationFrame = dom.window.requestAnimationFrame = fn => { frames.set(++frameId, fn); return frameId }
  global.cancelAnimationFrame = dom.window.cancelAnimationFrame = id => frames.delete(id)
  dom.window.matchMedia = () => ({ matches: true })
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false }
  dom.window.fetch = async url => ({ ok: true, status: 200, json: async () => url === '/api/local/music' ? { success: true, tracks: [track] } : { code: 200, result: { songs: [] } } })
  const { MusicQueue } = await import('../frontend/src/music-queue.ts')
  const { createPlayerController } = await import('../frontend/src/features/player/player-core.ts')
  const { mountMusicWorkspace } = await import('../frontend/src/app/music-workspace.ts')
  let audios = 0, audioLoads = 0, sceneDisposals = 0, saves = 0
  class FakeAudio extends dom.window.EventTarget {
    paused = true; volume = .62; currentTime = 0; duration = 100; src = ''
    play() { this.paused = false; this.dispatchEvent(new dom.window.Event('play')); return Promise.resolve() }
    pause() { this.paused = true; this.dispatchEvent(new dom.window.Event('pause')) }
    removeAttribute() { this.src = '' }
    load() { audioLoads++ }
  }
  const queue = new MusicQueue(), player = createPlayerController({ queue, resolveUrl: async () => '/mock/stream', createAudio: () => { audios++; return new FakeAudio() } })
  const api = { queue: async () => [track], saveQueue: async () => { saves++ }, isLiked: async () => false,
    profile: async () => ({ id: 1, nickname: '测试成员', avatarUrl: null }), playlists: async () => [], likes: async () => [], uploads: async () => [track] }
  const scene = { load: async () => {}, dispose: () => sceneDisposals++, setReduced() {}, setMode() {}, select() {}, resize() {}, update() {}, finishDecryption() {}, detailVisibility: 0 }
  const root = dom.window.document.querySelector('#app')
  let destroy
  try {
    destroy = mountMusicWorkspace(root, { queue, player, personalLibrary: api, loadScene: async () => scene })
    await tick()
    assert.equal(queue.items.length, 1); assert.equal(saves, 0)
    root.querySelector('[data-queue-clear]').click(); await tick()
    assert.equal(root.querySelectorAll('[data-queue-items] li').length, 0, '尚未播放时清空也必须更新队列视图')
    assert.equal(root.querySelector('[data-queue-count]').textContent, '00')
    queue.add((await import('../frontend/src/services/music/personal-library.ts')).toPersonalSong(track))
    for (let i = 0; i < 3; i++) for (const page of ['search','upload','user','library']) { root.querySelector(`[data-nav="${page}"]`).click(); await tick() }
    assert.equal(audios, 1); assert.equal(audioLoads, 0); assert.equal(queue.items.length, 1)
    root.querySelector('[data-nav="search"]').click(); await tick()
    root.querySelector('[data-search-play]').click(); await tick()
    assert.equal(player.get().track.source, 'local')
    root.querySelector('[data-queue-clear]').click(); await tick()
    assert.equal(queue.items.length, 0); assert.equal(player.get().track, null)
    assert.equal(root.querySelectorAll('[data-player-queue-panel]').length, 1)
    root.querySelector('[data-nav="user"]').click(); await tick()
    assert.equal(root.querySelector('[data-album-archive]').dataset.view, 'user')
    assert.equal(root.querySelector('[data-user-page]').inert, false)
    await player.play((await import('../frontend/src/services/music/personal-library.ts')).toPersonalSong(track)); await tick()
    let releaseLike, lateWrites = 0
    api.isLiked = () => new Promise(resolve => { releaseLike = resolve })
    api.setLiked = async () => { lateWrites++; throw new Error('测试请求终止') }
    root.querySelector('[data-player-like]').click()
    destroy(); destroy(); assert.equal(sceneDisposals, 1); assert.equal(frames.size, 0)
    releaseLike(false); await tick()
    assert.equal(lateWrites, 0, '退出工作区后不继续提交尚未发送的收藏操作')
    assert.equal(audioLoads, 0, '工作区视图不能销毁应用音频')
    api.isLiked = async () => false
    destroy = mountMusicWorkspace(root, { queue, player, personalLibrary: api, loadScene: async () => scene })
    await tick()
    assert.equal(root.querySelector('[data-player-track] strong').textContent, '本地歌曲', '新视图应直接读取仍然存在的播放器状态')
    assert.equal(audios, 1)
    destroy(); assert.equal(sceneDisposals, 2)
    player.destroy(); assert.equal(audioLoads, 1)
  } finally {
    destroy?.(); player.destroy(); dom.window.close()
    for (const [key,value] of Object.entries(originals)) { if(value === undefined) delete global[key]; else global[key] = value }
  }
})
