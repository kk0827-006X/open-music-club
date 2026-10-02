const assert = require('node:assert/strict')
const { it } = require('node:test')
const { pathToFileURL } = require('node:url')
const path = require('node:path')
const load = () => import(pathToFileURL(path.resolve(__dirname, '../frontend/src/personal-library-client.ts')).href)

it('个人音乐客户端写操作携带 Session、最新 CSRF，并保存具体来源引用而非播放地址', async () => {
  const { createPersonalLibraryClient } = await load()
  const calls = []
  const api = createPersonalLibraryClient(async (url, init) => {
    calls.push({ url, init })
    return { ok: true, status: 200, json: async () => url.endsWith('csrf-token') ? { csrfToken: 'token' } : { success: true } }
  })
  await api.setLiked({ source: 'local', sourceId: '12' }, true)
  await api.addTrack(3, { source: 'netease', sourceId: '12' })
  assert.equal(calls[1].url, '/api/me/likes/local/12')
  assert.equal(calls[1].init.headers['X-CSRF-Token'], 'token')
  assert.equal(calls[1].init.credentials, 'same-origin')
  assert.equal(calls[3].url, '/api/me/playlists/3/tracks')
  assert.deepEqual(JSON.parse(calls[3].init.body), { source: 'netease', sourceId: '12' })
})
it('客户端只在服务端成功后返回，失败不会冒充已保存', async () => {
  const { createPersonalLibraryClient } = await load()
  const api = createPersonalLibraryClient(async () => ({ ok: false, status: 401, json: async () => ({ stack: 'secret' }) }))
  await assert.rejects(api.profile(), /重新登录/)
  await assert.rejects(api.createPlaylist('test'), /重新登录/)
})
it('统一 Track 转为原播放器歌曲，来源隔离且不采信任意封面地址', async () => {
  const { toPersonalSong } = await load()
  const song = toPersonalSong({ source: 'netease', sourceId: '12', title: '<歌名>', artists: [{ name: '歌手' }],
    album: { name: '专辑' }, coverUrl: 'javascript:alert(1)', durationMs: 200000, playable: true })
  assert.equal(song.key, 'netease:12')
  assert.equal(song.duration, '3:20')
  assert.equal(song.coverUrl, '/images/album-placeholder-01.svg')
})
it('歌单客户端拉取第二页，避免超过 50 个歌单后丢失数据', async () => {
  const { createPersonalLibraryClient } = await load()
  const calls = []
  const api = createPersonalLibraryClient(async (url) => {
    calls.push(url)
    return { ok: true, status: 200, json: async () => ({ playlists: Array.from({ length: calls.length === 1 ? 50 : 1 }, (_, id) => ({ id })) }) }
  })
  assert.equal((await api.playlists()).length, 51)
  assert.deepEqual(calls, ['/api/me/playlists?limit=50&offset=0', '/api/me/playlists?limit=50&offset=50'])
})
it('头像以 multipart 上传，不手工设置 boundary，失败响应不泄漏内部错误', async () => {
  const { createPersonalLibraryClient } = await load()
  const calls = []
  const api = createPersonalLibraryClient(async (url, init) => {
    calls.push({ url, init })
    return { ok: true, status: 200, json: async () => url.endsWith('csrf-token') ? { csrfToken: 'new-token' } : { profile: { id: 1 } } }
  })
  await api.uploadAvatar(new File(['image'], 'avatar.png', { type: 'image/png' }))
  assert.equal(calls[1].url, '/api/me/avatar')
  assert.ok(calls[1].init.body instanceof FormData)
  assert.equal(calls[1].init.headers['Content-Type'], undefined)
  const failure = createPersonalLibraryClient(async () => ({ ok: false, status: 500, json: async () => ({ message: '/secret/db.sqlite' }) }))
  await assert.rejects(failure.profile(), (error) => !error.message.includes('secret') && error.status === 500)
})
