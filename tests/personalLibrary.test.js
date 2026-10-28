const assert = require('node:assert/strict')
const { afterEach, beforeEach, describe, it } = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const bcrypt = require('bcrypt')
const request = require('supertest')

const { createApp } = require('../src/app')
const { createUser } = require('../src/db/users')

describe('个人音乐库 API', () => {
  let directory
  let app
  let database
  let member
  let other
  let neteaseUnavailable
  let calls
  let limitedApp
  let songCovers
  let missingIds

  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'open-music-personal-'))
    calls = []
    songCovers = new Map()
    missingIds = new Set()
    neteaseUnavailable = false
    app = createApp({
      databasePath: path.join(directory, 'database.sqlite'),
      sessionSecret: 'test-session-secret',
      neteaseService: {
        async call(moduleName, parameters) {
          calls.push({ moduleName, parameters })
          if (neteaseUnavailable) throw new Error('上游内部错误')
          const ids = String(parameters.ids).split(',').map(Number)
          return {
            code: 200,
            songs: ids.filter(id => !missingIds.has(id)).map((id) => ({
              id,
              name: `网易云歌曲 ${id}`,
              ar: [{ id: 8, name: '测试歌手' }],
              al: { id: 9, name: '测试专辑', picUrl: songCovers.get(id) ?? 'http://p.music.126.net/a.jpg' },
              dt: 180000,
            })),
          }
        },
      },
    })
    database = app.locals.database
    const passwordHash = await bcrypt.hash('test-password', 4)
    for (const email of ['member@example.com', 'other@example.com']) {
      createUser(database, {
        email,
        nickname: email.split('@')[0],
        passwordHash,
        status: 'active',
        role: 'user',
      })
    }
    member = request.agent(app)
    other = request.agent(app)
    await member.post('/api/auth/login').send({ email: 'member@example.com', password: 'test-password' })
    await other.post('/api/auth/login').send({ email: 'other@example.com', password: 'test-password' })
  })

  afterEach(() => {
    if (limitedApp?.locals.database?.open) limitedApp.locals.database.close()
    if (database?.open) database.close()
    fs.rmSync(directory, { recursive: true, force: true })
  })

  function addLocalSong() {
    return Number(database.prepare(`INSERT INTO uploaded_music
      (title, artist, album, original_filename, stored_filename, file_path, mime_type, file_size, duration_ms, uploader_id)
      VALUES ('本地歌曲', '本地歌手', '本地专辑', 'song.mp3', 'unique-song.mp3', 'music/unique-song.mp3', 'audio/mpeg', 100, 200000, 1)`)
      .run().lastInsertRowid)
  }

  async function createPlaylist(agent = member, name = '我的歌单') {
    const response = await agent.post('/api/me/playlists').send({ name, description: '  周末听  ' })
    assert.equal(response.status, 201)
    return response.body.playlist.id
  }

  it('增量建立歌单、曲目与喜爱表，保留现有 users 数据', () => {
    for (const table of ['user_playlists', 'user_playlist_tracks', 'user_liked_tracks']) {
      assert.equal(Boolean(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)), true)
    }
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM users').get().count, 2)
    assert.equal(database.pragma('foreign_keys', { simple: true }), 1)
  })

  it('未登录不能读取或写入个人音乐库', async () => {
    for (const [method, url, body] of [
      ['get', '/api/me/playlists'],
      ['post', '/api/me/playlists', { name: '未授权' }],
      ['get', '/api/me/likes'],
      ['put', '/api/me/likes/local/1'],
    ]) {
      assert.equal((await request(app)[method](url).send(body || {})).status, 401)
    }
  })

  it('本人可创建、列出、修改和删除歌单，忽略客户端伪造的所属人', async () => {
    const created = await member.post('/api/me/playlists').send({ name: '  我的歌单  ', description: '  简介  ', ownerUserId: 2 })
    assert.equal(created.status, 201)
    assert.equal(created.body.playlist.name, '我的歌单')
    assert.equal(created.body.playlist.description, '简介')
    const id = created.body.playlist.id
    assert.equal(database.prepare('SELECT owner_user_id FROM user_playlists WHERE id = ?').get(id).owner_user_id, 1)
    const list = await member.get('/api/me/playlists')
    assert.equal(list.status, 200)
    assert.equal(list.body.playlists.length, 1)
    const updated = await member.patch(`/api/me/playlists/${id}`).send({ name: '新名字' })
    assert.equal(updated.status, 200)
    assert.equal(updated.body.playlist.name, '新名字')
    assert.equal((await member.delete(`/api/me/playlists/${id}`)).status, 200)
    assert.equal((await member.get(`/api/me/playlists/${id}`)).status, 404)
  })

  it('其他用户无法读取、修改或删除本人的歌单', async () => {
    const id = await createPlaylist()
    assert.equal((await other.get(`/api/me/playlists/${id}`)).status, 404)
    assert.equal((await other.patch(`/api/me/playlists/${id}`).send({ name: '夺取' })).status, 404)
    assert.equal((await other.delete(`/api/me/playlists/${id}`)).status, 404)
    assert.deepEqual((await other.get('/api/me/playlists')).body.playlists, [])
  })

  it('歌单名称和标识校验拒绝空值、超长值与无效 ID', async () => {
    for (const name of ['', '  ', 'x'.repeat(101), 12]) {
      assert.equal((await member.post('/api/me/playlists').send({ name })).status, 400)
    }
    assert.equal((await member.get('/api/me/playlists/abc')).status, 400)
    assert.equal((await member.patch('/api/me/playlists/999').send({ name: '不存在' })).status, 404)
  })

  it('本地与网易云同数字 ID 可同时加入歌单，响应可供统一播放器使用', async () => {
    const localId = addLocalSong()
    const id = await createPlaylist()
    const local = await member.post(`/api/me/playlists/${id}/tracks`).send({ source: 'local', sourceId: String(localId), title: '伪造标题' })
    const netease = await member.post(`/api/me/playlists/${id}/tracks`).send({ source: 'netease', sourceId: String(localId) })
    assert.equal(local.status, 201)
    assert.equal(netease.status, 201)
    const detail = await member.get(`/api/me/playlists/${id}`)
    assert.equal(detail.status, 200)
    assert.deepEqual(detail.body.tracks.map((track) => track.trackKey), [`local:${localId}`, `netease:${localId}`])
    assert.equal(detail.body.tracks[0].title, '本地歌曲')
    assert.equal(detail.body.tracks[1].title, `网易云歌曲 ${localId}`)
    assert.equal(detail.body.tracks[1].coverUrl, 'https://p.music.126.net/a.jpg')
    assert.equal(JSON.stringify(detail.body).includes('file_path'), false)
    assert.equal(JSON.stringify(detail.body).includes('stored_filename'), false)
    assert.equal(calls.some((call) => call.moduleName === 'songDetail'), true)
  })

  it('重复歌曲不增加歌单项，且无效来源和不存在的本地音乐不能保存', async () => {
    const localId = addLocalSong()
    const id = await createPlaylist()
    const endpoint = `/api/me/playlists/${id}/tracks`
    assert.equal((await member.post(endpoint).send({ source: 'local', sourceId: localId })).status, 201)
    assert.equal((await member.post(endpoint).send({ source: 'local', sourceId: localId })).status, 409)
    assert.equal((await member.post(endpoint).send({ source: 'other', sourceId: localId })).status, 400)
    assert.equal((await member.post(endpoint).send({ source: 'local', sourceId: 9999 })).status, 404)
    assert.equal((await member.post(endpoint).send({ source: 'netease', sourceId: 'abc' })).status, 400)
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM user_playlist_tracks').get().count, 1)
  })

  it('歌单排序要求完整且不重复的曲目 ID，失败时不改变原顺序', async () => {
    addLocalSong()
    const id = await createPlaylist()
    await member.post(`/api/me/playlists/${id}/tracks`).send({ source: 'netease', sourceId: '10' })
    await member.post(`/api/me/playlists/${id}/tracks`).send({ source: 'netease', sourceId: '11' })
    const before = (await member.get(`/api/me/playlists/${id}`)).body.tracks
    assert.equal((await member.put(`/api/me/playlists/${id}/tracks/order`).send({ trackIds: [before[0].entryId] })).status, 400)
    assert.equal((await member.put(`/api/me/playlists/${id}/tracks/order`).send({ trackIds: [before[0].entryId, before[0].entryId] })).status, 400)
    assert.equal((await member.get(`/api/me/playlists/${id}`)).body.tracks[0].entryId, before[0].entryId)
    const after = await member.put(`/api/me/playlists/${id}/tracks/order`).send({ trackIds: [before[1].entryId, before[0].entryId] })
    assert.equal(after.status, 200)
    assert.deepEqual((await member.get(`/api/me/playlists/${id}`)).body.tracks.map((track) => track.entryId), [before[1].entryId, before[0].entryId])
  })

  it('未打开详情就批量返回本地和网易云首曲封面，同数字 ID 不串来源且隔离他人歌单', async () => {
    const localId = addLocalSong()
    database.prepare("UPDATE uploaded_music SET cover_path = 'covers/synthetic.jpg' WHERE id = ?").run(localId)
    const localList = await createPlaylist(member, '本地封面')
    const cloudList = await createPlaylist(member, '云端封面')
    const duplicate = await createPlaylist(member, '相同云端首曲')
    const empty = await createPlaylist(member, '空歌单')
    const foreign = await createPlaylist(other, '别人的歌单')
    const repository = require('../src/db/personalLibrary')
    repository.addPlaylistTrack(database, localList, 'local', String(localId))
    repository.addPlaylistTrack(database, cloudList, 'netease', String(localId))
    repository.addPlaylistTrack(database, duplicate, 'netease', String(localId))
    repository.addPlaylistTrack(database, foreign, 'netease', '999')
    calls.length = 0
    const result = await member.get('/api/me/playlists?limit=50')
    assert.equal(result.status, 200)
    assert.equal(result.headers['cache-control'], 'no-store')
    const covers = new Map(result.body.playlists.map(list => [list.id, list.coverUrl]))
    assert.equal(covers.get(localList), `/api/local/music/${localId}/cover`)
    assert.equal(covers.get(cloudList), 'https://p.music.126.net/a.jpg')
    assert.equal(covers.get(duplicate), covers.get(cloudList))
    assert.equal(covers.get(empty), null)
    assert.equal(covers.has(foreign), false)
    assert.deepEqual(calls, [{ moduleName: 'songDetail', parameters: { ids: String(localId) } }])
    assert.equal(JSON.stringify(result.body).includes('covers/synthetic.jpg'), false)
    assert.equal(JSON.stringify(result.body).includes('first_source'), false)
  })

  it('首曲排序和删除后列表封面实时改变，空歌单不保留旧封面', async () => {
    const repository = require('../src/db/personalLibrary')
    const id = await createPlaylist()
    const first = repository.addPlaylistTrack(database, id, 'netease', '801')
    const second = repository.addPlaylistTrack(database, id, 'netease', '802')
    songCovers.set(801, 'https://p.music.126.net/801.jpg')
    songCovers.set(802, 'https://p.music.126.net/802.jpg')
    const readCover = async () => {
      const response = await member.get('/api/me/playlists')
      assert.equal(response.status, 200)
      return response.body.playlists[0].coverUrl
    }
    assert.equal(await readCover(), 'https://p.music.126.net/801.jpg')
    assert.equal((await member.put(`/api/me/playlists/${id}/tracks/order`).send({ trackIds: [second, first] })).status, 200)
    assert.equal(await readCover(), 'https://p.music.126.net/802.jpg')
    assert.equal((await member.delete(`/api/me/playlists/${id}/tracks/netease/802`)).status, 200)
    assert.equal(await readCover(), 'https://p.music.126.net/801.jpg')
    assert.equal((await member.delete(`/api/me/playlists/${id}/tracks/netease/801`)).status, 200)
    assert.equal(await readCover(), null)
  })

  it('已删除或没有封面的首曲使用默认值，不改用后续曲目的封面', async () => {
    const repository = require('../src/db/personalLibrary')
    const id = await createPlaylist()
    const localId = addLocalSong()
    repository.addPlaylistTrack(database, id, 'local', String(localId))
    repository.addPlaylistTrack(database, id, 'netease', '42')
    const readCover = async () => (await member.get('/api/me/playlists')).body.playlists[0].coverUrl
    assert.equal(await readCover(), null)
    database.prepare('DELETE FROM uploaded_music WHERE id = ?').run(localId)
    calls.length = 0
    assert.equal(await readCover(), null)
    assert.equal(calls.length, 0, '不为非首曲请求封面')
  })

  it('网易云上游失败、无效封面和缺失歌曲不影响列表与本地封面', async () => {
    const repository = require('../src/db/personalLibrary')
    const localId = addLocalSong()
    database.prepare("UPDATE uploaded_music SET cover_path = 'covers/synthetic.jpg' WHERE id = ?").run(localId)
    const localList = await createPlaylist(member, '本地')
    const cloudList = await createPlaylist(member, '网易云')
    repository.addPlaylistTrack(database, localList, 'local', String(localId))
    repository.addPlaylistTrack(database, cloudList, 'netease', '42')
    for (const mode of ['unsafe', 'missing', 'offline']) {
      songCovers.set(42, 'https://invalid.example/private.jpg')
      missingIds = new Set(mode === 'missing' ? [42] : [])
      neteaseUnavailable = mode === 'offline'
      const response = await member.get('/api/me/playlists')
      assert.equal(response.status, 200)
      const covers = new Map(response.body.playlists.map(list => [list.id, list.coverUrl]))
      assert.equal(covers.get(localList), `/api/local/music/${localId}/cover`)
      assert.equal(covers.get(cloudList), null)
      assert.doesNotMatch(JSON.stringify(response.body), /上游内部错误|invalid.example|synthetic.jpg/)
    }
  })

  it('封面解析仅处理当前分页的首曲，不加载下一页或整张歌单', async () => {
    const repository = require('../src/db/personalLibrary')
    const older = await createPlaylist(member, '较早')
    const newer = await createPlaylist(member, '较新')
    repository.addPlaylistTrack(database, older, 'netease', '51')
    repository.addPlaylistTrack(database, newer, 'netease', '52')
    repository.addPlaylistTrack(database, newer, 'netease', '53')
    calls.length = 0
    const response = await member.get('/api/me/playlists?limit=1&offset=0')
    assert.equal(response.status, 200)
    assert.equal(response.body.playlists[0].id, newer)
    assert.deepEqual(calls, [{ moduleName: 'songDetail', parameters: { ids: '52' } }])
  })

  it('歌曲可设为喜爱并在个人列表显示，取消操作幂等', async () => {
    const localId = addLocalSong()
    const endpoint = `/api/me/likes/local/${localId}`
    assert.equal((await member.put(endpoint)).status, 200)
    assert.equal((await member.put(endpoint)).status, 200)
    assert.deepEqual((await member.get('/api/me/likes')).body.tracks.map((track) => track.trackKey), [`local:${localId}`])
    assert.deepEqual((await other.get('/api/me/likes')).body.tracks, [])
    assert.equal((await member.delete(endpoint)).status, 200)
    assert.equal((await member.delete(endpoint)).status, 200)
    assert.deepEqual((await member.get('/api/me/likes')).body.tracks, [])
  })

  it('上游不可用时安全返回 502，已有网易云引用仍可列出为不可用并移除', async () => {
    const id = await createPlaylist()
    await member.post(`/api/me/playlists/${id}/tracks`).send({ source: 'netease', sourceId: '42' })
    assert.equal((await member.put('/api/me/likes/netease/42')).status, 200)
    neteaseUnavailable = true
    const failed = await member.put('/api/me/likes/netease/43')
    assert.equal(failed.status, 502)
    assert.equal(JSON.stringify(failed.body).includes('上游内部错误'), false)
    const detail = await member.get(`/api/me/playlists/${id}`)
    assert.equal(detail.status, 200)
    assert.equal(detail.body.tracks[0].playable, false)
    assert.equal((await member.put('/api/me/likes/netease/42')).status, 200)
    assert.equal((await member.get('/api/me/likes')).body.tracks[0].playable, false)
    assert.equal((await member.post(`/api/me/playlists/${id}/tracks`).send({ source: 'netease', sourceId: '42' })).status, 409)
    assert.equal((await member.delete(`/api/me/playlists/${id}/tracks/netease/42`)).status, 200)
  })

  it('跨用户不能添加、排序或移除别人的歌单曲目', async () => {
    const id = await createPlaylist()
    for (const [method, url, body] of [
      ['post', `/api/me/playlists/${id}/tracks`, { source: 'netease', sourceId: '1' }],
      ['put', `/api/me/playlists/${id}/tracks/order`, { trackIds: [] }],
      ['delete', `/api/me/playlists/${id}/tracks/netease/1`],
    ]) {
      assert.equal((await other[method](url).send(body || {})).status, 404)
    }
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM user_playlist_tracks').get().count, 0)
  })

  it('被删除的本地歌曲在个人音乐库中保留引用，但标记为不可播放', async () => {
    const localId = addLocalSong()
    const id = await createPlaylist()
    await member.post(`/api/me/playlists/${id}/tracks`).send({ source: 'local', sourceId: localId })
    await member.put(`/api/me/likes/local/${localId}`)
    database.prepare('DELETE FROM uploaded_music WHERE id = ?').run(localId)
    const detail = await member.get(`/api/me/playlists/${id}`)
    assert.equal(detail.body.tracks[0].playable, false)
    assert.equal((await member.get('/api/me/likes')).body.tracks[0].playable, false)
    assert.equal((await member.delete(`/api/me/playlists/${id}/tracks/local/${localId}`)).status, 200)
  })

  it('个人音乐库写操作按登录用户限流，读取仍可用', async () => {
    limitedApp = createApp({
      databasePath: path.join(directory, 'limited.sqlite'),
      sessionSecret: 'test-session-secret',
      security: {
        rateLimitEnabled: true,
        rateLimits: {
          personalLibrary: { windowMs: 60000, limit: 1 },
          global: { windowMs: 60000, limit: 100 },
        },
      },
    })
    const hash = await bcrypt.hash('test-password', 4)
    createUser(limitedApp.locals.database, {
      email: 'rate@example.com', nickname: '限流用户', passwordHash: hash,
      role: 'user', status: 'active',
    })
    const agent = request.agent(limitedApp)
    await agent.post('/api/auth/login').send({ email: 'rate@example.com', password: 'test-password' })
    assert.equal((await agent.post('/api/me/playlists').send({ name: '第一张' })).status, 201)
    assert.equal((await agent.post('/api/me/playlists').send({ name: '第二张' })).status, 429)
    assert.equal((await agent.get('/api/me/playlists')).status, 200)
  })
})
