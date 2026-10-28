const assert = require('node:assert/strict')
const { it } = require('node:test')
const { withReactHarness } = require('./helpers/reactHarness')

const track = { source: 'local', sourceId: '1', trackKey: 'local:1', title: '本地歌曲', artists: [{ name: '测试歌手' }], album: { name: '专辑' }, durationMs: 100000, coverUrl: null, playable: true }
const response = body => ({ ok: true, status: 200, json: async () => body })

it('真实 React 工作区切页保持队列和单一音频，清空后可点击，卸载清理而不销毁外部播放器', async () => {
  await withReactHarness(async h => {
    const [{ default: Workspace }, { MusicQueue }, { createPlayerController }, { toPersonalSong }] = await Promise.all([
      import('../frontend/src/app/Workspace.tsx'), import('../frontend/src/features/queue/model.ts'),
      import('../frontend/src/features/player/player-core.ts'), import('../frontend/src/services/music/personal-library.ts'),
    ])
    let audios = 0, audioLoads = 0, sceneDisposals = 0, saves = 0, activeSubscriptions = 0
    class FakeAudio extends h.window.EventTarget {
      paused = true; volume = .62; currentTime = 0; duration = 100; src = ''
      async play() { this.paused = false; this.dispatchEvent(new h.window.Event('play')) }
      pause() { this.paused = true; this.dispatchEvent(new h.window.Event('pause')) }
      removeAttribute() { this.src = '' }
      load() { audioLoads++ }
    }
    const queue = new MusicQueue()
    const core = createPlayerController({ queue, resolveUrl: async () => '/mock/stream', createAudio: () => { audios++; return new FakeAudio() } })
    // 只观察公开订阅接口；不改引擎状态、不为页面创建第二份播放器。
    const player = { ...core, subscribe(listener) {
      activeSubscriptions++
      const unsubscribe = core.subscribe(listener)
      let released = false
      return () => { if (!released) { released = true; activeSubscriptions--; unsubscribe() } }
    } }
    const api = {
      queue: async () => [track], saveQueue: async () => { saves++ }, isLiked: async () => false,
      profile: async () => ({ id: 1, nickname: '测试成员', avatarUrl: null }), playlists: async () => [],
      likes: async () => [], uploads: async () => [track],
    }
    const scene = { load: async () => {}, dispose: () => { sceneDisposals++ }, setReduced() {}, setMode() {}, select() {}, resize() {}, update() {}, finishDecryption() {}, detailVisibility: 0 }
    const loadScene = async () => scene
    const footprintClient = { timeline: async () => ({ total: 0, events: [], timezoneOffsetMinutes: 480 }) }
    const renderedWorkspace = version => h.React.createElement(Workspace, { key: version, role: 'admin', queue, player, personalLibrary: api, footprintClient, loadScene })
    // 仅记录工作区自己的窗口计时器，照常执行原生计时以免改变生产调度逻辑。
    const nativeSetTimeout = h.window.setTimeout.bind(h.window)
    const nativeClearTimeout = h.window.clearTimeout.bind(h.window)
    const timers = new Set()
    h.window.setTimeout = (callback, delay, ...args) => {
      const id = nativeSetTimeout((...values) => { timers.delete(id); callback(...values) }, delay, ...args)
      timers.add(id)
      return id
    }
    h.window.clearTimeout = id => { timers.delete(id); nativeClearTimeout(id) }
    try {
      await h.render(renderedWorkspace(1))
      assert.equal(queue.items.length, 1)
      assert.equal(saves, 0, '恢复队列不能立即覆盖数据库')
      await h.click('[data-player-queue-toggle]')
      await h.click('[data-queue-clear]')
      assert.equal(h.document.querySelectorAll('[data-queue-items] li').length, 0, '尚未播放时清空也必须更新队列视图')
      assert.equal(h.require('[data-queue-count]').textContent, '00')
      await h.React.act(async () => queue.add(toPersonalSong(track)))
      for (let repeat = 0; repeat < 3; repeat++) for (const page of ['search', 'upload', 'user', 'footprint', 'library']) {
        await h.click(`[data-nav="${page}"]`)
        const name = page === 'library' ? 'archive' : page
        assert.equal(h.require('[data-album-archive]').dataset.view, name)
        if (page !== 'library') await h.until(() => h.query(`[data-${page}-page]`), `${page} 懒加载页面应挂载`)
      }
      assert.equal(audios, 1)
      assert.equal(audioLoads, 0)
      assert.equal(queue.items.length, 1, '多次切换页面不丢队列')
      await h.click('[data-nav="search"]')
      await h.until(() => h.query('[data-search-results] [data-search-play]'), '本地搜索结果应可播放')
      await h.click('[data-search-results] [data-search-play]')
      assert.equal(player.get().track.source, 'local')
      await h.click('[data-player-queue-toggle]')
      await h.click('[data-queue-clear]')
      assert.equal(queue.items.length, 0)
      assert.equal(player.get().track, null)
      assert.equal(h.document.querySelectorAll('[data-player-queue-panel]').length, 1)
      await h.click('[data-nav="user"]')
      assert.equal(h.require('[data-album-archive]').dataset.view, 'user')
      assert.equal(h.require('[data-user-page]').hasAttribute('inert'), false)
      assert.equal(h.query('[data-archive-navigation] .application-admin-entry'), null)
      await h.click('.user-sidebar [data-user-tab="admin"]')
      assert.ok(h.query('[data-admin-applications]'))
      assert.equal(audios, 1, '打开审核面板不重建播放器')
      assert.equal(sceneDisposals, 0, '打开审核面板不销毁当前会话场景')
      assert.equal(h.query('[data-authorized-stage]'), null)
      await h.click('[data-user-tab="playlists"]')
      assert.equal(h.query('[data-admin-applications]'), null)
      await h.React.act(async () => player.play(toPersonalSong(track)))
      await h.flush()
      let releaseLike, lateWrites = 0
      api.isLiked = () => new Promise(resolve => { releaseLike = resolve })
      api.setLiked = async () => { lateWrites++; throw new Error('测试请求终止') }
      await h.click('[data-player-like]')
      assert.equal(typeof releaseLike, 'function', '必须真的开始一个待完成的收藏读取')
      // 使用 key 卸载页面后渲染空节点，随后可在相同 React root 中重新挂载。
      await h.render(null)
      await h.render(null)
      assert.equal(sceneDisposals, 1, '同一场景只释放一次')
      assert.equal(activeSubscriptions, 0, '已退出页面不保留播放器状态订阅')
      // Motion 合并调度器可留下一个已排队空帧；执行尾帧后必须停止，不能持续循环。
      await h.React.act(async () => {
        for (let turn = 0; turn < 4 && h.frames.size; turn++) {
          const pending = [...h.frames.values()]
          h.frames.clear()
          for (const frame of pending) frame(performance.now() + turn * 16)
        }
      })
      assert.equal(h.frames.size, 0, '销毁取消页面动画循环')
      assert.equal(timers.size, 0, '销毁取消隐藏播放器、提示或切页计时器')
      await h.React.act(async () => releaseLike(false))
      await h.flush()
      assert.equal(lateWrites, 0, '退出工作区后不继续提交尚未发送的收藏操作')
      assert.equal(audioLoads, 0, '工作区视图不能销毁应用音频')
      api.isLiked = async () => false
      await h.render(renderedWorkspace(2))
      assert.equal(h.require('[data-player-track] strong').textContent, '本地歌曲', '新视图应直接读取仍然存在的播放器状态')
      assert.equal(audios, 1)
      await h.render(null)
      assert.equal(sceneDisposals, 2)
      assert.equal(activeSubscriptions, 0)
      assert.equal(timers.size, 0)
      core.destroy()
      assert.equal(audioLoads, 1, '外部所有者显式销毁时才释放音频')
    } finally {
      await h.render(null)
      core.destroy()
      h.window.setTimeout = nativeSetTimeout
      h.window.clearTimeout = nativeClearTimeout
    }
  }, { fetch: async url => response(url.startsWith('/api/admin/applications') ? {success:true,applications:[],total:0} : url === '/api/local/music' ? { success: true, tracks: [track] } : { code: 200, result: { songs: [] } }) })
})
