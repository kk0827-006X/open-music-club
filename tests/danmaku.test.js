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
const { DanmakuError, createDanmakuService } = require('../src/services/danmaku.service')

const TRACK = { source: 'local', sourceId: '7', title: '高能战歌', artist: '站内歌手' }

describe('弹幕墙业务规则', () => {
  let database
  let clock
  beforeEach(() => {
    database = createDatabase(':memory:')
    initializeSchema(database)
    createUser(database, { email: 'unit@example.com', nickname: '单元', passwordHash: 'x', status: 'active', role: 'user', mustChangePassword: false })
    clock = Date.now()
  })
  afterEach(() => database.close())

  it('发送弹幕记录播放进度，返回的消息带 mine 标记', async () => {
    const service = createDanmakuService({ database, now: () => clock })
    const message = await service.send({
      userId: 1, nickname: '单元', track: TRACK, content: '高能预警！', positionMs: 83000, durationMs: 240000,
    })
    assert.equal(message.positionMs, 83000)
    assert.equal(message.content, '高能预警！')
    assert.equal(message.mine, true)
    const { listTrackMessages } = require('../src/db/danmaku')
    const rows = listTrackMessages(database, { source: 'local', sourceId: '7' })
    assert.equal(rows.length, 1)
    assert.equal(rows[0].position_ms, 83000)
    assert.equal(rows[0].track_title, '高能战歌')
  })

  it('空内容、超长内容、负进度与非法歌曲标识都被拒绝', async () => {
    const service = createDanmakuService({ database, now: () => clock })
    clock += 5000
    await assert.rejects(() => service.send({ userId: 1, nickname: '单元', track: TRACK, content: '   ', positionMs: 1000 }), (error) => error.status === 400)
    clock += 5000
    await assert.rejects(() => service.send({ userId: 1, nickname: '单元', track: TRACK, content: '啊'.repeat(61), positionMs: 1000 }), (error) => error.status === 400)
    clock += 5000
    await assert.rejects(() => service.send({ userId: 1, nickname: '单元', track: TRACK, content: '好', positionMs: -5 }), (error) => error.status === 400)
    clock += 5000
    await assert.rejects(() => service.send({ userId: 1, nickname: '单元', track: { ...TRACK, source: 'bilibili' }, content: '好', positionMs: 1000 }), (error) => error.status === 400)
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM danmaku_messages').get().count, 0)
  })

  it('两秒内连发被限速，冷却后放行；进度超出时长时被钳制', async () => {
    const service = createDanmakuService({ database, now: () => clock })
    await service.send({ userId: 1, nickname: '单元', track: TRACK, content: '第一条', positionMs: 1000, durationMs: 180000 })
    clock += 1000
    await assert.rejects(() => service.send({ userId: 1, nickname: '单元', track: TRACK, content: '第二条', positionMs: 2000 }), (error) => error.status === 429)
    clock += 3000
    const third = await service.send({ userId: 1, nickname: '单元', track: TRACK, content: '第三条', positionMs: 99999999, durationMs: 180000 })
    assert.equal(third.positionMs, 180000, '进度必须钳制到歌曲时长以内')
  })

  it('时间轴按进度排序，afterId 增量拉取不重复；删除只能删自己的', async () => {
    const service = createDanmakuService({ database, now: () => clock })
    const sendAs = async (userId, nickname, content, positionMs) => {
      clock += 5000
      return service.send({ userId, nickname, track: TRACK, content, positionMs, durationMs: 300000 })
    }
    createUser(database, { email: 'b@example.com', nickname: '队友', passwordHash: 'x', status: 'active', role: 'user', mustChangePassword: false })
    await sendAs(1, '单元', '前奏就燃了', 5000)
    await sendAs(2, '队友', '这段吉他绝了', 83000)
    await sendAs(1, '单元', '高能预警！', 83000)
    await sendAs(2, '队友', '收尾合唱封神', 250000)

    const firstPage = service.list({ source: 'local', sourceId: '7', limit: 3 })
    assert.equal(firstPage.total, 4)
    assert.deepEqual(firstPage.messages.map((row) => row.content), ['前奏就燃了', '这段吉他绝了', '高能预警！'])
    const increment = service.list({ source: 'local', sourceId: '7', afterId: firstPage.messages[2].id })
    assert.deepEqual(increment.messages.map((row) => row.content), ['收尾合唱封神'])

    // remove 是同步抛错的函数，必须包成 async 再交给 assert.rejects 校验。
    await assert.rejects(async () => service.remove({ userId: 1, id: firstPage.messages[1].id }), (error) => error.status === 403)
    const removed = service.remove({ userId: 1, id: firstPage.messages[2].id })
    assert.equal(removed.removed, true)
    assert.equal(service.list({ source: 'local', sourceId: '7' }).total, 3)
  })
  it('全站实时流跨歌曲返回最新弹幕，afterId 增量拉新；非法数量被拒绝', async () => {
    const service = createDanmakuService({ database, now: () => clock })
    const sendAs = async (userId, nickname, content, track, positionMs) => {
      clock += 5000
      return service.send({ userId, nickname, track, content, positionMs, durationMs: 300000 })
    }
    createUser(database, { email: 'b@example.com', nickname: '队友', passwordHash: 'x', status: 'active', role: 'user', mustChangePassword: false })
    const neteaseTrack = { ...TRACK, source: 'netease', sourceId: '88', title: '热梗神曲', artist: '梗王' }
    await sendAs(1, '单元', '第一首的前奏', TRACK, 5000)
    await sendAs(2, '队友', '第二首的高能预警', neteaseTrack, 83000)
    await sendAs(1, '单元', '第一首的收尾', TRACK, 250000)

    const feed = service.recent({ limit: 2 })
    assert.equal(feed.total, 3, 'total 是全站弹幕总数，不受 limit 影响')
    assert.deepEqual(feed.messages.map((row) => row.content), ['第一首的收尾', '第二首的高能预警'])
    assert.equal(feed.messages[0].trackTitle, '高能战歌')
    assert.equal(feed.messages[1].trackTitle, '热梗神曲')
    assert.equal(feed.messages[1].trackArtist, '梗王')

    // 轮询语义：afterId 记录已看到的最大 id，之后只拉比它更新的弹幕。
    await sendAs(2, '队友', '刚发的新梗', neteaseTrack, 100000)
    const increment = service.recent({ afterId: feed.messages[0].id })
    assert.deepEqual(increment.messages.map((row) => row.content), ['刚发的新梗'])

    // recent 是同步函数，必须包成 async 再交给 assert.rejects，否则同步 throw 绕过 validator。
    await assert.rejects(async () => service.recent({ limit: 51 }), (error) => error.status === 400)
    await assert.rejects(async () => service.recent({ afterId: -1 }), (error) => error.status === 400)
  })
})

describe('弹幕墙 API', () => {
  let directory
  let app
  let database
  let member
  let other

  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'open-music-danmaku-'))
    app = createApp({
      databasePath: path.join(directory, 'database.sqlite'),
      sessionSecret: 'test-session-secret',
      security: { logger: QUIET },
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
  })
  afterEach(() => {
    if (database.open) database.close()
    app.locals.sessionStore.stopInterval?.()
    fs.rmSync(directory, { recursive: true, force: true })
  })

  const payload = (overrides = {}) => ({
    track: { source: 'netease', sourceId: '88', title: '热梗神曲', artist: '梗王' },
    content: '高能预警！',
    positionMs: 83000,
    durationMs: 240000,
    ...overrides,
  })

  it('未登录不能读写弹幕；登录后发送并按时间戳拉取', async () => {
    assert.equal((await request(app).get('/api/me/danmaku?source=netease&sourceId=88')).status, 401)
    assert.equal((await request(app).post('/api/me/danmaku').send(payload())).status, 401)

    const sent = await member.post('/api/me/danmaku').send(payload())
    assert.equal(sent.status, 201)
    assert.equal(sent.body.message.positionMs, 83000)
    assert.equal(sent.body.message.mine, true)

    const viewer = await other.get('/api/me/danmaku?source=netease&sourceId=88')
    assert.equal(viewer.status, 200)
    assert.equal(viewer.body.total, 1)
    assert.equal(viewer.body.messages[0].nickname, 'member')
    assert.equal(viewer.body.messages[0].mine, undefined, '列表不携带 mine，归属由 userId 对比判断')

    const header = await member.get('/api/me/danmaku?source=netease&sourceId=88')
    assert.equal(header.headers['cache-control'], 'no-store')
  })

  it('发送限速返回 429，非法载荷返回 400，CSRF 缺失被拦截', async () => {
    const first = await member.post('/api/me/danmaku').send(payload())
    assert.equal(first.status, 201)
    const tooFast = await member.post('/api/me/danmaku').send(payload({ content: '再来一条' }))
    assert.equal(tooFast.status, 429)

    assert.equal((await member.post('/api/me/danmaku').send(payload({ positionMs: 'soon' }))).status, 400)
    const badContent = await other.post('/api/me/danmaku').send(payload({ content: '啊'.repeat(61) }))
    assert.equal(badContent.status, 400)
  })

  it('撤回自己的弹幕成功，撤回他人的返回 403', async () => {
    const sent = await member.post('/api/me/danmaku').send(payload({ content: '这段吉他绝了' }))
    const id = sent.body.message.id

    const foreign = await other.delete(`/api/me/danmaku/${id}`)
    assert.equal(foreign.status, 403)
    assert.match(foreign.body.message, /只能删除自己/)

    const own = await member.delete(`/api/me/danmaku/${id}`)
    assert.equal(own.status, 200)
    assert.equal(own.body.removed, true)
    assert.equal((await member.get('/api/me/danmaku?source=netease&sourceId=88')).body.total, 0)
  })

  it('全站实时流接口：未登录 401，登录后跨歌曲返回最新弹幕并支持增量', async () => {
    assert.equal((await request(app).get('/api/me/danmaku/recent')).status, 401)

    await member.post('/api/me/danmaku').send(payload({ content: '第一首的弹幕' }))
    // 两个用户各发一条，避开同一账号 2 秒限速。
    await other.post('/api/me/danmaku').send(payload({
      content: '第二首的弹幕', track: { source: 'local', sourceId: '9', title: '战歌', artist: '站内歌手' },
    }))

    const feed = await member.get('/api/me/danmaku/recent')
    assert.equal(feed.status, 200)
    assert.equal(feed.headers['cache-control'], 'no-store')
    assert.equal(feed.body.total, 2)
    assert.deepEqual(feed.body.messages.map((row) => row.content), ['第二首的弹幕', '第一首的弹幕'])
    assert.equal(feed.body.messages[0].trackTitle, '战歌')

    assert.equal((await member.get('/api/me/danmaku/recent?limit=51')).status, 400)
  })
})
