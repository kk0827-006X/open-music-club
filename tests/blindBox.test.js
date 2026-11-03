const assert = require('node:assert/strict')
const { afterEach, beforeEach, describe, it } = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const bcrypt = require('bcrypt')
const request = require('supertest')

const { createApp } = require('../src/app')
const QUIET = { warn() {}, error() {}, info() {} }
const { createDatabase, initializeSchema } = require('../src/db/database')
const { createUser } = require('../src/db/users')
const { createBlindBoxService, sampleTracks, styleOfGenre } = require('../src/services/blindBox.service')

function addLocalMusic(database, { genre = null, title = '本地歌曲', uploaderId = 1 }) {
  const stored = `track-${Math.random().toString(36).slice(2)}.mp3`
  return Number(database.prepare(
    `INSERT INTO uploaded_music
      (title, artist, album, genre, original_filename, stored_filename, file_path, mime_type, file_size, duration_ms, uploader_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(title, '本地歌手', '本地专辑', genre, stored, stored, `music/${stored}`, 'audio/mpeg', 1024, 180000, uploaderId).lastInsertRowid)
}

describe('音乐盲盒抽样与标签规则', () => {
  it('音频风格元数据映射为盲盒标签，未知风格进入综合', () => {
    assert.equal(styleOfGenre('Jazz; Vocal').key, 'jazz')
    assert.equal(styleOfGenre('Rock').key, 'rock')
    assert.equal(styleOfGenre('电子').key, 'electronic')
    assert.equal(styleOfGenre('R&B/Soul').key, 'rnb')
    assert.equal(styleOfGenre('戏曲').key, 'other')
    assert.equal(styleOfGenre(null).key, 'other')
  })

  it('随机抽样在范围内不重复，并避开上一箱的曲目', () => {
    const pool = Array.from({ length: 10 }, (_, index) => ({ source: 'local', sourceId: String(index + 1) }))
    const picked = sampleTracks(pool, 3, () => 0, new Set())
    assert.deepEqual(picked.map((track) => track.sourceId), ['1', '2', '3'])

    const avoided = sampleTracks(pool, 2, () => 0, new Set(['local:1', 'local:2']))
    assert.deepEqual(avoided.map((track) => track.sourceId), ['3', '4'])

    // 曲库不足 2 倍数量时不做排除，否则抽不满；随机值越界也要被钳制。
    const tiny = sampleTracks(pool.slice(0, 3), 3, () => 9, new Set(['local:1']))
    assert.equal(tiny.length, 3)
    assert.equal(new Set(tiny.map((track) => track.sourceId)).size, 3)
  })

  let database
  beforeEach(() => {
    database = createDatabase(':memory:')
    initializeSchema(database)
    createUser(database, { email: 'unit@example.com', nickname: '单元', passwordHash: 'x', status: 'active', role: 'user', mustChangePassword: false })
    addLocalMusic(database, { genre: '流行', title: '流行一号' })
    addLocalMusic(database, { genre: 'Jazz', title: '爵士一号' })
    addLocalMusic(database, { genre: 'Jazz', title: '爵士二号' })
    addLocalMusic(database, { genre: null, title: '无标签一号' })
  })
  afterEach(() => database.close())

  it('连续抽取同一风格时每首都累加抽取次数', async () => {
    const service = createBlindBoxService({ database, neteaseService: null, random: () => 0 })
    const first = await service.draw({ userId: 1, style: 'jazz', count: 2 })
    const second = await service.draw({ userId: 1, style: 'jazz', count: 2 })
    assert.deepEqual(new Set(first.tracks.map((track) => track.title)), new Set(['爵士一号', '爵士二号']))
    assert.equal(second.tracks.length, 2)
    // 曲库只有两首时无法完全避开，但必须仍然返回两首合法曲目且计数累加。
    const drawCount = database.prepare('SELECT SUM(draw_count) AS total FROM blind_box_track_stats').get().total
    assert.equal(drawCount, 4)
  })

  it('空曲库抛出可读的业务错误，不写入抽取记录', async () => {
    const service = createBlindBoxService({ database, neteaseService: null, random: () => 0 })
    await assert.rejects(() => service.draw({ userId: 1, style: 'classical', count: 3 }), (error) => error.status === 409)
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM blind_box_draws').get().count, 0)
  })

  it('网易云旧字段形状（artists/album/duration）同样补齐歌手、专辑、封面与时长', async () => {
    const repository = require('../src/db/blindBox')
    const service = createBlindBoxService({
      database,
      random: () => 0,
      neteaseService: {
        async call() {
          // 旧版搜索契约：artists/album/duration（新版才是 ar/al/dt），两套都要能解析。
          return { code: 200, result: { songs: [{
            id: 77, name: '旧协议歌',
            artists: [{ name: '老歌手' }, { name: '' }],
            album: { name: '老专辑', picUrl: 'http://p2.music.126.net/old.jpg' },
            duration: 255000,
          }] } }
        },
      },
    })
    const box = await service.draw({ userId: 1, style: 'folk', count: 1 })
    const track = box.tracks[0]
    assert.equal(track.key, 'netease:song:77')
    assert.equal(track.artist, '老歌手')
    assert.equal(track.album, '老专辑')
    assert.equal(track.coverUrl, 'https://p2.music.126.net/old.jpg')
    assert.equal(track.durationMs, 255000)
    assert.equal(track.duration, '4:15')
    const cached = repository.listCachedTracks(database, 'folk')
    assert.equal(cached.length, 1)
    assert.equal(cached[0].artist, '老歌手')
    assert.equal(cached[0].duration_ms, 255000)
  })

  it('缓存数量达标但已过期时会重新补池，未过期或冷却期内则复用', async () => {
    const repository = require('../src/db/blindBox')
    repository.saveCachedTracks(database, Array.from({ length: 30 }, (_, index) => ({
      source: 'netease', sourceId: String(9000 + index), style: 'jazz', tagSource: 'keyword',
      title: `旧爵士 ${index + 1}`, artist: '旧歌手', album: '旧专辑', coverUrl: null, durationMs: 1000,
    })))
    database.prepare("UPDATE blind_box_tracks SET created_at = '2020-01-01 00:00:00'").run()
    let calls = 0
    let clock = Date.now()
    const service = createBlindBoxService({
      database, now: () => clock, random: () => 0,
      neteaseService: { async call() { calls += 1; return { code: 200, result: { songs: [] } } } },
    })
    await service.draw({ userId: 1, style: 'jazz', count: 1 })
    assert.equal(calls, 1, '缓存过期后必须重新补池，即使数量已达标')
    clock += 1000
    await service.draw({ userId: 1, style: 'jazz', count: 1 })
    assert.equal(calls, 1, '刚刷新过且在冷却期内，不应重复打上游')
    clock += 25 * 60 * 60 * 1000
    await service.draw({ userId: 1, style: 'jazz', count: 1 })
    assert.equal(calls, 2, '再次越过 TTL 后要继续刷新')
  })
})

describe('音乐盲盒 API', () => {
  let directory
  let app
  let database
  let member
  let other
  let neteaseSearch

  const songsFor = (keywords) => Array.from({ length: 4 }, (_, index) => ({
    id: 9000 + index,
    name: `${keywords}候选 ${index + 1}`,
    ar: [{ id: 1, name: '网易云歌手' }],
    al: { id: 2, name: '网易云专辑', picUrl: 'http://p1.music.126.net/cover.jpg' },
    dt: 210000,
  }))

  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'open-music-blindbox-'))
    neteaseSearch = (keywords) => keywords.includes('古典') ? [] : songsFor(keywords)
    app = createApp({
      databasePath: path.join(directory, 'database.sqlite'),
      sessionSecret: 'test-session-secret',
      security: { logger: QUIET },
      neteaseService: {
        async call(moduleName, parameters) {
          if (moduleName !== 'search') throw new Error('未预期的上游调用')
          return { code: 200, result: { songs: neteaseSearch(String(parameters.keywords)) } }
        },
      },
    })
    database = app.locals.database
    const passwordHash = await bcrypt.hash('test-password', 4)
    for (const email of ['member@example.com', 'other@example.com']) {
      createUser(database, { email, nickname: email.split('@')[0], passwordHash, status: 'active', role: 'user', mustChangePassword: false })
    }
    member = request.agent(app)
    other = request.agent(app)
    await member.post('/api/auth/login').send({ email: 'member@example.com', password: 'test-password' })
    await other.post('/api/auth/login').send({ email: 'other@example.com', password: 'test-password' })
    addLocalMusic(database, { genre: '流行', title: '站内流行' })
    addLocalMusic(database, { genre: 'Jazz', title: '站内爵士' })
  })
  afterEach(() => {
    if (database.open) database.close()
    app.locals.sessionStore.stopInterval?.()
    fs.rmSync(directory, { recursive: true, force: true })
  })

  it('未登录不能读取盲盒或抽取；风格清单包含标签与曲库数量', async () => {
    assert.equal((await request(app).get('/api/me/blind-box/styles')).status, 401)
    assert.equal((await request(app).post('/api/me/blind-box/draw').send({ style: 'pop' })).status, 401)

    const response = await member.get('/api/me/blind-box/styles')
    assert.equal(response.status, 200)
    const style = (key) => response.body.styles.find((entry) => entry.key === key)
    assert.equal(style('pop').count, 1)
    assert.equal(style('jazz').count, 1)
    assert.equal(response.body.total, 2)
    assert.equal(response.headers['cache-control'], 'no-store')
  })

  it('按风格抽取：本地曲目按 genre 命中，网易云候选按关键词补充并缓存', async () => {
    const local = await member.post('/api/me/blind-box/draw').send({ style: 'pop', count: 1 })
    assert.equal(local.status, 201)
    assert.equal(local.body.box.tracks.length, 1)
    assert.equal(local.body.box.styleLabel, '流行')
    assert.match(local.body.box.tracks[0].key, /^(local:\d+|netease:song:\d+)$/)
    // 抽取时补进了关键词候选，风格池不再只有一首站内歌曲。
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM blind_box_tracks WHERE style = 'pop'").get().count, 4)

    const neteaseBox = await member.post('/api/me/blind-box/draw').send({ style: 'jazz', count: 5 })
    assert.equal(neteaseBox.status, 201)
    assert.equal(neteaseBox.body.box.tracks.length, 5)
    const sources = new Set(neteaseBox.body.box.tracks.map((track) => track.source))
    assert.ok(sources.has('local') && sources.has('netease'), '本地与网易云来源应保持独立并同时可被抽到')
    assert.match(neteaseBox.body.box.tracks.find((track) => track.source === 'netease').key, /^netease:song:\d+$/)

    const styles = await member.get('/api/me/blind-box/styles')
    assert.equal(styles.body.styles.find((entry) => entry.key === 'jazz').count, 5)
  })

  it('曲库没有该风格的歌时返回 409，参数非法返回 400', async () => {
    const empty = await member.post('/api/me/blind-box/draw').send({ style: 'classical', count: 3 })
    assert.equal(empty.status, 409)
    assert.match(empty.body.message, /曲库/)

    assert.equal((await member.post('/api/me/blind-box/draw').send({ style: 'pop', count: 9 })).status, 400)
    assert.equal((await member.post('/api/me/blind-box/draw').send({ style: 'unknown' })).status, 400)
    assert.equal((await member.get('/api/me/blind-box/ranking?metric=crazy')).status, 400)
  })

  it('收藏盲盒写入关联表，取消收藏后回落；榜单按被收藏与被抽取次数排序', async () => {
    const drawn = await member.post('/api/me/blind-box/draw').send({ style: 'jazz', count: 2 })
    const id = drawn.body.box.id

    const favorited = await member.post(`/api/me/blind-box/boxes/${id}/favorite`)
    assert.equal(favorited.status, 200)
    assert.equal(favorited.body.box.favorited, true)

    const favorites = await member.get('/api/me/blind-box/boxes')
    assert.equal(favorites.body.total, 1)
    assert.equal(favorites.body.boxes[0].id, id)
    assert.equal(favorites.body.boxes[0].trackCount, 2)
    assert.equal(favorites.body.boxes[0].styleLabel, '爵士')
    assert.ok(favorites.body.boxes[0].covers.length >= 1)

    // 重复收藏是幂等的，不会重复累加榜单收藏次数。
    await member.post(`/api/me/blind-box/boxes/${id}/favorite`)
    const favoriteRanking = await member.get('/api/me/blind-box/ranking?metric=favorite&style=jazz')
    assert.equal(favoriteRanking.status, 200)
    assert.equal(favoriteRanking.body.entries[0].favoriteCount, 1)
    assert.equal(favoriteRanking.body.entries[0].drawCount >= 1, true)

    const drawRanking = await member.get('/api/me/blind-box/ranking?metric=draw&style=jazz')
    assert.deepEqual(drawRanking.body.entries.map((entry) => entry.drawCount).sort((a, b) => b - a), drawRanking.body.entries.map((entry) => entry.drawCount))

    await member.delete(`/api/me/blind-box/boxes/${id}/favorite`)
    assert.equal((await member.get('/api/me/blind-box/boxes')).body.total, 0)
    const afterRemove = await member.get('/api/me/blind-box/ranking?metric=favorite&style=jazz')
    assert.equal(afterRemove.body.entries[0].favoriteCount, 0)
  })

  it('别人抽到的盲盒不能打开、收藏或取消收藏', async () => {
    const drawn = await member.post('/api/me/blind-box/draw').send({ style: 'pop', count: 1 })
    const id = drawn.body.box.id
    assert.equal((await other.get(`/api/me/blind-box/boxes/${id}`)).status, 404)
    assert.equal((await other.post(`/api/me/blind-box/boxes/${id}/favorite`)).status, 404)
    assert.equal((await other.delete(`/api/me/blind-box/boxes/${id}/favorite`)).status, 404)
    assert.equal((await member.get('/api/me/blind-box/boxes/9999')).status, 404)
    assert.equal((await member.get('/api/me/blind-box/boxes/abc')).status, 400)
  })

  it('本地歌曲被删除后，它的盲盒标签与榜单统计一起清理', async () => {
    // 古典没有关键词候选，池子里只有这一首本地曲目，抽取结果是确定的。
    const localId = addLocalMusic(database, { genre: 'classical', title: '站内古典' })
    const drawn = await member.post('/api/me/blind-box/draw').send({ style: 'classical', count: 1 })
    assert.equal(drawn.status, 201)
    assert.equal(drawn.body.box.tracks[0].key, `local:${localId}`)
    await member.delete(`/api/local/music/${localId}`)
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM blind_box_track_stats WHERE source = ?').get('local').count, 0)
    const styles = await member.get('/api/me/blind-box/styles')
    assert.equal(styles.body.styles.find((entry) => entry.key === 'classical').count, 0)
  })
})
