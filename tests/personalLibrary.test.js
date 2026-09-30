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

  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'open-music-personal-'))
    calls = []
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
            songs: ids.map((id) => ({
              id,
              name: `网易云歌曲 ${id}`,
              ar: [{ id: 8, name: '测试歌手' }],
              al: { id: 9, name: '测试专辑', picUrl: 'http://p.music.126.net/a.jpg' },
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
