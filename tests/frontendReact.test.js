const assert = require('node:assert/strict')
const { it } = require('node:test')
const { withReactHarness } = require('./helpers/reactHarness')

const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const localTrack = {
  source: 'local', sourceId: '1', trackKey: 'local:1', title: '相同歌名',
  artists: [{ name: '本地歌手' }], album: { name: '本地专辑' },
  durationMs: 100000, coverUrl: null, playable: true, liked: false,
}
const onlineSong = { key: 'netease:song:2', kind: 'song', source: 'netease', sourceId: '2', title: '相同歌名', artist: '云端歌手', album: '云端专辑', coverUrl: '/images/album-placeholder-01.svg', duration: '2:00', year: '2026', description: '隔离测试歌曲' }

it('React 测试环境在回调抛错后仍恢复原全局对象', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
  await assert.rejects(() => withReactHarness(async h => { assert.equal(globalThis.window, h.window); throw new Error('预期失败') }), /预期失败/)
  assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, 'window'), descriptor)
})

it('真实 React 登录表单保留密码眼睛和保持登录；认证失败不能进入应用', async () => {
  await withReactHarness(async h => {
    const { LoginPage } = await import('../frontend/src/features/auth/LoginPage.tsx')
    const calls = [], verified = []
    await h.render(h.React.createElement(LoginPage, {
      onAuthenticate: async credentials => { calls.push(credentials); throw new Error('隔离账号密码错误') },
      onVerified: role => verified.push(role),
    }))
    await h.input('[name="email"]', 'member@example.test')
    await h.input('[name="password"]', 'synthetic-secret')
    await h.click('[data-reveal-password]')
    assert.equal(h.require('[name="password"]').type, 'text')
    assert.equal(h.require('[data-reveal-password]').getAttribute('aria-pressed'), 'true')
    await h.click('[data-reveal-password]')
    assert.equal(h.require('[name="password"]').type, 'password')
    await h.click('[data-remember-me]')
    await h.submit('[data-login-form]')
    assert.deepEqual(calls, [{ email: 'member@example.test', password: 'synthetic-secret', rememberMe: true }])
    assert.deepEqual(verified, [])
    assert.match(h.require('[data-preview-status]').textContent, /隔离账号密码错误/)
    assert.equal(h.require('[name="password"]').value, '')
    assert.equal(h.require('[data-login-factor-dialog]').open, false)
    assert.equal(h.require('[data-login-form] [type="submit"]').disabled, false)
  })
})

it('真实 React 登录必须完成 2FA 并重新确认 Session；失败验证码不提升身份', async () => {
  const requests = []
  let rejectCode = true
  await withReactHarness(async h => {
    const { LoginPage } = await import('../frontend/src/features/auth/LoginPage.tsx')
    const verified = []
    await h.render(h.React.createElement(LoginPage, {
      onAuthenticate: async () => ({ requiresTwoFactor: true }),
      onVerified: role => verified.push(role),
    }))
    await h.input('[name="email"]', 'member@example.test')
    await h.input('[name="password"]', 'synthetic-secret')
    await h.submit('[data-login-form]')
    assert.deepEqual(verified, [], '只有密码正确仍不能进入应用')
    assert.equal(h.require('[data-login-factor-dialog]').open, true)
    assert.equal(h.require('[name="code"]').maxLength, 6)
    await h.input('[name="code"]', '123456')
    assert.deepEqual([...h.document.querySelectorAll('[data-factor-digit]')].map(node => node.textContent), ['1', '2', '3', '4', '5', '6'])
    await h.submit('[data-login-factor]')
    assert.deepEqual(verified, [])
    assert.match(h.require('[data-factor-feedback]').textContent, /验证码错误/)
    assert.equal(requests.filter(item => item.url === '/api/auth/me').length, 0, '错误验证码不能触发成功身份读取')
    rejectCode = false
    await h.input('[name="code"]', '654321')
    await h.submit('[data-login-factor]')
    await h.until(() => verified.length === 1, '有效验证码和实时 Session 验证后应进入应用')
    assert.deepEqual(verified, ['user'])
    const challenge = requests.filter(item => item.url === '/api/auth/2fa/verify')
    assert.equal(challenge.length, 2)
    assert.equal(challenge[1].init.credentials, 'same-origin')
    assert.equal(challenge[1].init.headers['X-CSRF-Token'], 'synthetic-csrf')
    assert.deepEqual(JSON.parse(challenge[1].init.body), { code: '654321' })
  }, { fetch: async (url, init) => {
    requests.push({ url, init })
    if (url === '/api/security/csrf-token') return response({ csrfToken: 'synthetic-csrf' })
    if (url === '/api/auth/2fa/verify') return rejectCode ? response({ message: '验证码错误' }, 401) : response({ success: true })
    if (url === '/api/auth/me') return response({ authenticated: true, user: { id: 7, email: 'member@example.test', role: 'user' } })
    throw new Error(`未声明请求 ${url}`)
  } })
})

it('React 搜索用真实输入和筛选控件区分本地与网易云歌曲、专辑和歌手', async () => {
  const plays = [], queues = [], searches = []
  await withReactHarness(async h => {
    const { SearchPage } = await import('../frontend/src/features/search/SearchPage.tsx')
    await h.render(h.React.createElement(SearchPage, {
      active: true, play: async song => plays.push(song.key), enqueue: song => queues.push(song.key),
      load: async (query, kind) => {
        searches.push({ query, kind })
        return [{ ...onlineSong, kind, key: `netease:${kind}:2` }]
      },
    }))
    assert.equal(h.document.querySelectorAll('[data-search-results] li').length, 1)
    await h.input('[data-search-input]', '相同')
    await h.submit('[data-search-form]')
    await h.until(() => h.document.querySelectorAll('[data-search-results] li').length === 2, '同名不同来源不能合并成一首')
    await h.click('[data-search-source="netease"]')
    await h.until(() => h.document.querySelectorAll('[data-search-results] li').length === 1, '网易云筛选应只留下云端结果')
    assert.match(h.require('[data-search-results]').textContent, /云端歌手/)
    await h.click('[data-search-results] [data-search-play]')
    await h.click('[data-search-results] [data-search-queue]')
    assert.deepEqual(plays, ['netease:song:2'])
    assert.deepEqual(queues, ['netease:song:2'])
    for (const kind of ['album', 'artist']) {
      await h.click(`[data-search-type="${kind}"]`)
      await h.until(() => h.query(`[data-search-select="netease:${kind}:2"]`), `${kind} 筛选应请求对应类型`)
      assert.equal(h.require('[data-search-results] [data-search-play]').disabled, true)
    }
    assert.deepEqual(searches.slice(-2).map(item => item.kind), ['album', 'artist'])
    await h.click('[data-search-type="song"]')
    await h.click('[data-search-source="local"]')
    assert.match(h.require('[data-search-results]').textContent, /本地歌手/)
    assert.doesNotMatch(h.require('[data-search-results]').textContent, /云端歌手/)
  }, { fetch: async url => {
    assert.equal(url, '/api/local/music')
    return response({ success: true, tracks: [localTrack] })
  } })
})

it('React 用户页点击爱心同步状态；删除歌单必须明确确认，取消不提交', async () => {
  const likedWrites = [], deletes = []
  let liked = false, removed = false
  const list = { id: 10, name: '隔离测试歌单', trackCount: 1 }
  const client = {
    profile: async () => ({ id: 7, nickname: '隔离成员', avatarUrl: null }),
    playlists: async () => removed ? [] : [list],
    playlist: async () => ({ playlist: list, tracks: [{ ...localTrack, liked }] }),
    likes: async () => liked ? [{ ...localTrack, liked }] : [],
    setLiked: async (track, value) => { likedWrites.push({ key: track.trackKey, value }); liked = value },
    deletePlaylist: async id => { deletes.push(id); removed = true },
  }
  await withReactHarness(async h => {
    const { UserPage } = await import('../frontend/src/features/user/UserPage.tsx')
    await h.render(h.React.createElement(UserPage, { active: true, client }))
    await h.click('[data-user-list="10"]')
    assert.equal(h.require('[data-user-like="local:1"]').getAttribute('aria-pressed'), 'false')
    await h.click('[data-user-like="local:1"]')
    assert.deepEqual(likedWrites, [{ key: 'local:1', value: true }])
    assert.equal(h.require('[data-user-like="local:1"]').getAttribute('aria-pressed'), 'true')
    await h.click('[data-user-delete="10"]')
    assert.equal(h.require('[data-user-delete-dialog]').open, true)
    assert.deepEqual(deletes, [])
    await h.click('[data-user-delete-cancel]')
    assert.deepEqual(deletes, [])
    await h.click('[data-user-delete="10"]')
    await h.click('[data-user-delete-confirm]')
    assert.deepEqual(deletes, [10])
    assert.equal(h.query('[data-user-list="10"]'), null)
  })
})

it('React 上传卸载会终止在途请求并移除页面', async () => {
  let requestSignal
  await withReactHarness(async h => {
    const { UploadPage } = await import('../frontend/src/features/upload/UploadPage.tsx')
    await h.render(h.React.createElement(UploadPage, { active: true }))
    const input = h.require('[data-upload-file]')
    const file = new h.window.File(['RIFF synthetic isolated WAV'], 'isolated.wav', { type: 'audio/wav' })
    Object.defineProperty(input, 'files', { configurable: true, value: [file] })
    const { act } = h.React
    await act(async () => input.dispatchEvent(new h.window.Event('change', { bubbles: true })))
    await h.until(() => !h.require('[data-upload-submit]').disabled, '元数据解析结束应允许填写并上传')
    await h.input('[data-upload-title]', '隔离曲目')
    await h.input('[data-upload-artist]', '隔离歌手')
    await h.submit('[data-upload-form]')
    assert.ok(requestSignal)
    assert.equal(requestSignal.aborted, false)
    await h.unmount()
    assert.equal(requestSignal.aborted, true)
    await h.flush()
    assert.equal(h.query('[data-upload-page]'), null)
  }, { fetch: async (url, init) => {
    if (url === '/api/security/csrf-token') return response({ csrfToken: 'synthetic-csrf' })
    assert.equal(url, '/api/local/music')
    requestSignal = init.signal
    return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('隔离请求取消', 'AbortError')), { once: true }))
  } })
})

it('真实 React Workspace 跨页保留唯一 Audio；混合队列恢复、清空与外部点击不锁页面', async () => {
  await withReactHarness(async h => {
    const [{ default: Workspace }, { MusicQueue }, { createPlayerController }, { toPersonalSong }] = await Promise.all([
      import('../frontend/src/app/Workspace.tsx'), import('../frontend/src/features/queue/model.ts'),
      import('../frontend/src/features/player/player-core.ts'), import('../frontend/src/services/music/personal-library.ts'),
    ])
    let audioCreations = 0, audioLoads = 0, sceneDisposals = 0
    const saved = []
    class FakeAudio extends h.window.EventTarget {
      paused = true; volume = .62; currentTime = 0; duration = 100; src = ''
      async play() { this.paused = false; this.dispatchEvent(new h.window.Event('play')) }
      pause() { this.paused = true; this.dispatchEvent(new h.window.Event('pause')) }
      removeAttribute() { this.src = '' }
      load() { audioLoads++ }
    }
    const queue = new MusicQueue()
    const player = createPlayerController({ queue, resolveUrl: async () => '/isolated/stream', createAudio: () => { audioCreations++; return new FakeAudio() } })
    const client = {
      queue: async () => [localTrack, { ...localTrack, source: 'netease', sourceId: '2', trackKey: 'netease:2' }],
      saveQueue: async refs => saved.push(refs), isLiked: async () => false,
      profile: async () => ({ id: 7, nickname: '隔离成员', avatarUrl: null }), playlists: async () => [], likes: async () => [], uploads: async () => [],
    }
    const scene = { load: async () => {}, dispose: () => { sceneDisposals++ }, setReduced() {}, setMode() {}, select() {}, resize() {}, update() {}, finishDecryption() {}, detailVisibility: 0 }
    try {
      await h.render(h.React.createElement(Workspace, { player, queue, personalLibrary: client, loadScene: async () => scene }))
      assert.equal(queue.items.length, 2)
      assert.deepEqual(queue.items.map(song => song.source), ['local', 'netease'])
      assert.equal(saved.length, 0, '恢复队列时不能马上覆盖服务器原数据')
      for (let repeat = 0; repeat < 2; repeat++) for (const page of ['search', 'upload', 'user', 'library']) {
        await h.click(`[data-nav="${page}"]`)
        await h.until(() => h.query('[data-album-archive]').dataset.view === (page === 'library' ? 'archive' : page), `应切换至 ${page}`)
      }
      assert.equal(audioCreations, 1)
      assert.equal(audioLoads, 0)
      assert.equal(queue.items.length, 2)
      await h.click('[data-player-queue-toggle]')
      await h.click('[data-queue-clear]')
      assert.equal(queue.items.length, 0)
      assert.equal(h.require('[data-queue-count]').textContent, '00')
      assert.equal(player.get().track, null)
      await h.click('[data-nav="search"]')
      await h.until(() => h.query('[data-search-page]'), '懒加载搜索页应完成挂载')
      assert.equal(h.require('[data-album-archive]').dataset.view, 'search')
      await h.click('[data-search-results] [data-search-play]')
      assert.equal(player.get().track.source, 'local')
      assert.equal(audioCreations, 1)
      await h.unmount()
      assert.equal(sceneDisposals, 1)
      assert.equal(audioLoads, 0, '页面卸载不能销毁应用所有的 Audio')
      await player.play(toPersonalSong(localTrack))
      assert.equal(player.get().track.sourceId, '1')
    } finally { player.destroy() }
    assert.equal(audioLoads, 1, '只有应用所有者销毁时才释放 Audio')
  }, { fetch: async url => {
    if (url === '/api/local/music') return response({ success: true, tracks: [localTrack] })
    if (String(url).includes('lyric')) return response({ code: 200, lrc: { lyric: '[00:00.00]隔离歌词' } })
    if (String(url).includes('/album')) return response({ code: 200, album: {}, songs: [] })
    return response({ code: 200, result: { songs: [] } })
  } })
})
