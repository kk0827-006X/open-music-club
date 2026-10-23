const assert = require('node:assert/strict')
const { beforeEach, afterEach, describe, it } = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const bcrypt = require('bcrypt')
const request = require('supertest')
const session = require('express-session')
const { MemoryStore } = require('express-rate-limit')
const { createApp } = require('../src/app')
const { createUser } = require('../src/db/users')
const { initializeSchema, createDatabase } = require('../src/db/database')
const { createFootprintService, computeStreak, sanitizeCoverUrl } = require('../src/services/footprint.service')

const TRACK = { source: 'local', sourceId: '1', title: '夜航', artist: '远行', album: '灯塔', durationMs: 60000, coverUrl: '/api/local/music/1/cover' }
const QUIET = { warn() {}, error() {}, info() {} }

describe('音乐足迹安全与持久化', () => {
  let directory, app, database, member, other, applications
  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'omc-footprint-'))
    applications = []
    app = build()
    database = app.locals.database
    const passwordHash = await bcrypt.hash('test-password', 4)
    for (const email of ['member@example.com', 'other@example.com']) {
      createUser(database, { email, nickname: email.split('@')[0], passwordHash, role: 'user', status: 'active', mustChangePassword: false })
    }
    member = request.agent(app)
    other = request.agent(app)
    await login(member)
    await login(other, 'other@example.com')
  })
  afterEach(() => {
    for (const instance of applications) {
      if (instance.locals.database.open) instance.locals.database.close()
      instance.locals.sessionStore.stopInterval?.()
    }
    fs.rmSync(directory, { recursive: true, force: true })
  })
  function build(extra = {}) {
    const instance = createApp({ databasePath: path.join(directory, `db-${applications.length}.sqlite`), sessionSecret: 'footprint-test-session', security: { logger: QUIET }, ...extra })
    applications.push(instance)
    return instance
  }
  function login(agent, email = 'member@example.com') {
    return agent.post('/api/auth/login').send({ email, password: 'test-password' }).expect(200)
  }
  async function event(agent = member, fields = {}) {
    const response = await agent.post('/api/footprint/events').send({ ...TRACK, ...fields }).expect(201)
    return response.body.eventId
  }
  async function card(agent = member, ids) {
    const eventIds = ids || [await event(agent)]
    const response = await agent.post('/api/footprint/cards').send({ title: '十月晚风', eventIds }).expect(201)
    return response.body.card
  }
  async function post() {
    const ownCard = await card()
    const response = await member.post('/api/footprint/posts').send({ cardId: ownCard.id, caption: '最近的循环' }).expect(201)
    return { card: ownCard, id: response.body.postId }
  }

  it('初始化幂等并保留既有账号，重开仍保留记录、随笔与快照', async () => {
    initializeSchema(database)
    const id = await event()
    await member.put(`/api/footprint/events/${id}/note`).send({ content: '记忆' }).expect(200)
    await card(member, [id])
    const filename = database.name
    database.close()
    const reopened = createDatabase(filename)
    try {
      initializeSchema(reopened)
      assert.equal(reopened.prepare('SELECT COUNT(*) AS n FROM users').get().n, 2)
      assert.equal(reopened.prepare('SELECT content FROM footprint_notes').get().content, '记忆')
      assert.equal(reopened.prepare('SELECT COUNT(*) AS n FROM footprint_cards').get().n, 1)
      assert.equal(reopened.pragma('foreign_keys', { simple: true }), 1)
    } finally { reopened.close() }
  })

  it('全部接口要求正式登录，账号禁用后立即拒绝', async () => {
    for (const [method, url, body] of [
      ['get', '/timeline'], ['get', '/milestone'], ['get', '/cards'], ['get', '/cards/1'],
      ['get', '/posts'], ['get', '/posts/mine'], ['get', '/posts/1'], ['get', '/posts/1/comments'],
      ['post', '/events', TRACK], ['put', '/events/1/note', { content: 'x' }], ['delete', '/events/1/note'],
      ['post', '/cards', { title: 'x', eventIds: [1] }], ['delete', '/cards/1'],
      ['post', '/posts', { cardId: 1 }], ['delete', '/posts/1'], ['put', '/posts/1/like'],
      ['delete', '/posts/1/like'], ['post', '/posts/1/comments', { content: 'x' }], ['delete', '/comments/1'],
    ]) assert.equal((await request(app)[method](`/api/footprint${url}`).send(body || {})).status, 401)
    database.prepare("UPDATE users SET status = 'disabled' WHERE id = 1").run()
    await member.get('/api/footprint/timeline').expect(401)
    await member.post('/api/footprint/events').send(TRACK).expect(401)
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM playback_events').get().n, 0)
  })

  it('2FA密码阶段不能浏览或写入足迹，完成验证后才可访问', async () => {
    let now = 1800000000000
    const secure = build({ twoFactor: { encryptionKey: Buffer.alloc(32, 7).toString('base64'), now: () => now }, security: { logger: QUIET } })
    createUser(secure.locals.database, { email: 'member@example.com', nickname: '成员', passwordHash: await bcrypt.hash('test-password', 4), role: 'user', status: 'active' })
    const agent = request.agent(secure)
    await login(agent)
    const setup = await agent.post('/api/auth/2fa/setup').send({ password: 'test-password' }).expect(200)
    const { generateSync } = require('otplib')
    await agent.post('/api/auth/2fa/confirm').send({ code: generateSync({ secret: setup.body.secret, epoch: now / 1000 }) }).expect(200)
    await agent.post('/api/auth/logout').expect(200)
    assert.equal((await login(agent)).body.requiresTwoFactor, true)
    await agent.get('/api/footprint/posts').expect(401)
    await agent.post('/api/footprint/events').send(TRACK).expect(401)
    now += 30000
    await agent.post('/api/auth/2fa/verify').send({ code: generateSync({ secret: setup.body.secret, epoch: now / 1000 }) }).expect(200)
    await agent.get('/api/footprint/timeline').expect(200)
  })

  it('上报去重按账号与来源隔离，忽略伪造所属人与时间', async () => {
    const id = await event(member, { userId: 2, playedAt: '1990-01-01', id: 999 })
    assert.equal(await event(), id)
    assert.notEqual(await event(other), id)
    assert.notEqual(await event(member, { source: 'netease' }), id)
    const list = await member.get('/api/footprint/timeline').expect(200)
    assert.equal(list.body.total, 2)
    assert.equal(list.body.timezoneOffsetMinutes, 480)
    assert.deepEqual(list.body.events.map((item) => item.trackKey), ['netease:1', 'local:1'])
    assert.notEqual(list.body.events[1].playedAt, '1990-01-01')
    assert.equal(list.headers['cache-control'], 'no-store')
  })

  it('拒绝无效、过长与非标量输入，JSON null不变成500', async () => {
    for (const override of [
      { source: 'other' }, { sourceId: '1 OR 1=1' }, { sourceId: [] }, { title: '' },
      { title: 'x'.repeat(201) }, { artist: 'x'.repeat(201) }, { artist: {} }, { album: [] },
      { durationMs: null }, { durationMs: '' }, { durationMs: '1' }, { durationMs: true },
      { durationMs: -1 }, { durationMs: 86400001 }, { durationMs: 1.2 },
      { coverUrl: 'https://p.music.126.net/' + 'a'.repeat(601) }, { coverUrl: {} },
    ]) {
      const response = await member.post('/api/footprint/events').send({ ...TRACK, ...override }).expect(400)
      assert.equal(response.body.requestId, response.headers['x-request-id'])
    }
    await member.post('/api/footprint/events').set('Content-Type', 'application/json').send('null').expect(400)
    const id = await event(member, { title: "'; DROP TABLE users; --", coverUrl: 'https://evil.example/image.jpg' })
    assert.equal(database.prepare('SELECT cover_url FROM playback_events WHERE id = ?').get(id).cover_url, null)
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM users').get().n, 2)
    for (const url of ['https://u:p@p.music.126.net/a', 'javascript:alert(1)', '//evil.example/a', 'https://music.126.net.evil.example/a']) assert.equal(sanitizeCoverUrl(url), null)
    assert.equal(sanitizeCoverUrl('http://p.music.126.net/a'), 'https://p.music.126.net/a')
  })

  it('所有分页严格拒绝空值、数组、指数与越界参数', async () => {
    for (const endpoint of ['timeline', 'cards', 'posts', 'posts/mine', 'posts/1/comments']) {
      const invalidOffset = endpoint === 'timeline' ? 100001 : 10001
      for (const query of ['limit=', 'limit=0', 'limit=51', 'limit=1e1', 'limit=1&limit=2', 'offset=-1', 'offset=', `offset=${invalidOffset}`, 'offset=1.1', 'offset[]=1']) {
        await member.get(`/api/footprint/${endpoint}?${query}`).expect(400)
      }
    }
  })

  it('随笔与卡片私有，混合他人或缺失记录整体拒绝，重复记录拒绝', async () => {
    const ownId = await event()
    const otherId = await event(other)
    await member.put(`/api/footprint/events/${ownId}/note`).send({ content: '私人随笔' }).expect(200)
    await other.put(`/api/footprint/events/${ownId}/note`).send({ content: '篡改' }).expect(404)
    await other.delete(`/api/footprint/events/${ownId}/note`).expect(404)
    for (const eventIds of [[ownId, otherId], [ownId, 999]]) await member.post('/api/footprint/cards').send({ title: '混合', eventIds }).expect(404)
    for (const eventIds of [[ownId, ownId], [], Array(13).fill(ownId)]) await member.post('/api/footprint/cards').send({ title: '重复', eventIds }).expect(400)
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM footprint_cards').get().n, 0)
    const ownCard = await card(member, [ownId])
    assert.equal(ownCard.data.notes[0].content, '私人随笔')
    await other.get(`/api/footprint/cards/${ownCard.id}`).expect(404)
    await other.delete(`/api/footprint/cards/${ownCard.id}`).expect(404)
    assert.equal((await other.get('/api/footprint/cards')).body.total, 0)
    assert.equal((await other.get('/api/footprint/timeline')).body.events[0].note, null)
    await member.put(`/api/footprint/events/${ownId}/note`).send({ content: '后改' }).expect(200)
    assert.equal((await member.get(`/api/footprint/cards/${ownCard.id}`)).body.card.data.notes[0].content, '私人随笔')
    await member.delete(`/api/footprint/events/${ownId}/note`).expect(200)
    await member.delete(`/api/footprint/events/${ownId}/note`).expect(404)
  })

  it('卡片最多50张、评论最多500条，失败不留下半成品', async () => {
    const id = await event()
    for (let index = 0; index < 50; index++) await card(member, [id])
    await member.post('/api/footprint/cards').send({ title: '超限', eventIds: [id] }).expect(409)
    const published = await member.post('/api/footprint/posts').send({ cardId: 1 }).expect(201)
    const postId = published.body.postId
    const insert = database.prepare('INSERT INTO footprint_comments(post_id,user_id,content) VALUES (?,2,?)')
    database.transaction(() => { for (let index = 0; index < 500; index++) insert.run(postId, `评论${index}`) })()
    await other.post(`/api/footprint/posts/${postId}/comments`).send({ content: '超限' }).expect(409)
    assert.equal((await member.get(`/api/footprint/posts/${postId}/comments?limit=20&offset=490`)).body.comments.length, 10)
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM footprint_cards').get().n, 50)
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM footprint_comments').get().n, 500)
  })

  it('播放容量达到十万条后明确拒绝新增且不删除历史，其他成员额度独立', async () => {
    database.exec(`WITH RECURSIVE history(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM history WHERE n<100000)
      INSERT INTO playback_events(user_id,source,source_id,title,artist,duration_ms,played_at)
      SELECT 1,'local',CAST(n AS TEXT),'历史','歌手',0,'2020-01-01 00:00:00' FROM history`)
    await member.post('/api/footprint/events').send(TRACK).expect(409)
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM playback_events WHERE user_id=1').get().n, 100000)
    const history = await member.get('/api/footprint/timeline?limit=1&offset=10001').expect(200)
    assert.equal(history.body.total, 100000)
    assert.equal(history.body.events[0].sourceId, '89999')
    const end = await member.get('/api/footprint/timeline?limit=1&offset=99999').expect(200)
    assert.equal(end.body.events[0].sourceId, '1')
    assert.deepEqual((await member.get('/api/footprint/timeline?offset=100000').expect(200)).body.events, [])
    await event(other)
  })

  it('30秒外重复播放新增足迹，删除分享保留卡片并允许重新分享', async () => {
    const id = await event()
    database.prepare("UPDATE playback_events SET played_at=datetime('now','-31 seconds') WHERE id=?").run(id)
    assert.notEqual(await event(), id)
    const shared = await post()
    await other.post(`/api/footprint/posts/${shared.id}/comments`).send({ content: '评论' }).expect(201)
    await other.put(`/api/footprint/posts/${shared.id}/like`).expect(200)
    await member.delete(`/api/footprint/posts/${shared.id}`).expect(200)
    await member.get(`/api/footprint/cards/${shared.card.id}`).expect(200)
    for (const table of ['footprint_posts', 'footprint_comments', 'footprint_likes']) assert.equal(database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0)
    await member.post('/api/footprint/posts').send({ cardId: shared.card.id }).expect(201)
    assert.equal((await other.get('/api/footprint/milestone')).body.milestone.totalPlays, 0)
  })

  it('广场共享快照、赞和评论契约完整，删除权限和级联有效', async () => {
    const shared = await post()
    await member.post('/api/footprint/posts').send({ cardId: shared.card.id }).expect(409)
    await other.post('/api/footprint/posts').send({ cardId: shared.card.id }).expect(404)
    await other.delete(`/api/footprint/posts/${shared.id}`).expect(404)
    await other.put(`/api/footprint/posts/${shared.id}/like`).expect(200)
    assert.equal((await other.put(`/api/footprint/posts/${shared.id}/like`)).body.likeCount, 1)
    const created = await other.post(`/api/footprint/posts/${shared.id}/comments`).send({ content: '同感', userId: 1 }).expect(201)
    const detail = await other.get(`/api/footprint/posts/${shared.id}`).expect(200)
    assert.equal(detail.body.timezoneOffsetMinutes, 480)
    assert.equal(detail.body.card.title, '十月晚风')
    assert.equal(detail.body.card.eventIds, undefined)
    assert.equal(detail.body.canDelete, false)
    assert.equal(detail.body.post.likeCount, 1)
    assert.equal(detail.body.post.commentCount, 1)
    assert.equal(detail.body.post.liked, true)
    assert.equal(detail.body.comments[0].authorId, 2)
    assert.equal(detail.body.comments[0].canDelete, true)
    assert.equal((await member.get(`/api/footprint/posts/${shared.id}/comments`)).body.comments[0].canDelete, false)
    assert.equal((await member.get('/api/footprint/posts/mine')).body.posts[0].authorNickname, 'member')
    assert.equal((await other.get('/api/footprint/posts')).body.posts[0].commentCount, 1)
    await member.delete(`/api/footprint/comments/${created.body.commentId}`).expect(404)
    await other.delete(`/api/footprint/comments/${created.body.commentId}`).expect(200)
    await other.post(`/api/footprint/posts/${shared.id}/comments`).send({ content: '再听' }).expect(201)
    await member.delete(`/api/footprint/cards/${shared.card.id}`).expect(200)
    for (const table of ['footprint_posts', 'footprint_comments', 'footprint_likes']) assert.equal(database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0)
    await other.get(`/api/footprint/posts/${shared.id}`).expect(404)
  })

  it('所有不存在的分享操作返回404，非法评论、笔记与卡片文本返回400', async () => {
    for (const [method, endpoint, body] of [['get', '/posts/999'], ['get', '/posts/999/comments'], ['put', '/posts/999/like'], ['delete', '/posts/999/like'], ['post', '/posts/999/comments', { content: 'x' }]]) {
      const response = await member[method](`/api/footprint${endpoint}`).send(body || {}).expect(404)
      assert.equal(response.body.requestId, response.headers['x-request-id'])
    }
    for (const [endpoint, content] of [['events/1/note', 'x'.repeat(1001)], ['events/1/note', ''], ['events/1/note', {}]]) await member.put(`/api/footprint/${endpoint}`).send({ content }).expect(400)
    for (const content of ['', 'x'.repeat(301), null, {}]) await member.post('/api/footprint/posts/1/comments').send({ content }).expect(400)
    await member.post('/api/footprint/posts').send({ cardId: 1, caption: 'x'.repeat(501) }).expect(400)
    await member.post('/api/footprint/cards').send({ title: 'x'.repeat(61), eventIds: [1] }).expect(400)
  })

  it('数据库限制跨账号笔记与分享，账号删除级联全部足迹', async () => {
    const ownId = await event()
    const shared = await post()
    assert.throws(() => database.prepare('INSERT INTO footprint_notes(event_id,user_id,content) VALUES (?,2,?)').run(ownId, '越权'), /FOREIGN KEY/)
    assert.throws(() => database.prepare('INSERT INTO footprint_posts(card_id,user_id,caption) VALUES (?,2,?)').run(shared.card.id, '越权'), /UNIQUE|FOREIGN KEY/)
    await member.put(`/api/footprint/events/${ownId}/note`).send({ content: '私有' }).expect(200)
    await other.put(`/api/footprint/posts/${shared.id}/like`).expect(200)
    await other.post(`/api/footprint/posts/${shared.id}/comments`).send({ content: '评论' }).expect(201)
    database.prepare('DELETE FROM users WHERE id=1').run()
    for (const table of ['playback_events', 'footprint_notes', 'footprint_cards', 'footprint_posts', 'footprint_comments', 'footprint_likes']) assert.equal(database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0)
  })

  it('数据库内部错误统一脱敏并携带requestId，事务完整回滚', async () => {
    database.exec("CREATE TRIGGER fail_footprint BEFORE INSERT ON playback_events BEGIN SELECT RAISE(ABORT, '/private/internal/database.sqlite'); END")
    const response = await member.post('/api/footprint/events').send(TRACK).expect(500)
    assert.equal(response.body.message, '服务器内部错误')
    assert.equal(response.body.requestId, response.headers['x-request-id'])
    assert.doesNotMatch(JSON.stringify(response.body), /private|sqlite|stack|SELECT/)
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM playback_events').get().n, 0)
  })

  it('站点时区与里程一致，构造参数拒绝非法偏移，连续天数支持昨天锚点', async () => {
    database.exec(`INSERT INTO playback_events(user_id,source,source_id,title,artist,duration_ms,played_at) VALUES
      (1,'local','1','跨午夜','歌手',60000,'2026-10-19 16:30:00'),
      (1,'local','2','下午','歌手',30000,'2026-10-20 09:30:00')`)
    const data = (await member.get('/api/footprint/milestone')).body.milestone
    assert.equal(data.totalPlays, 2)
    assert.equal(data.totalDurationMs, 90000)
    assert.equal(data.activeDays, 1)
    assert.equal(data.busiestDay.date, '2026-10-20')
    assert.equal(data.hourly[0], 1)
    assert.equal(data.hourly[17], 1)
    assert.equal(data.distinctTracks, 2)
    assert.equal(data.timezoneOffsetMinutes, 480)
    assert.equal(data.monthly[0].month, '2026-10')
    assert.equal(createFootprintService({ database, timezoneOffsetMinutes: 0 }).milestone(1).activeDays, 2)
    for (const value of [null, '480', NaN, 1441, -1441, 0.5, "0'); DROP TABLE users; --"]) assert.throws(() => createFootprintService({ database, timezoneOffsetMinutes: value }), /时区/)
    assert.equal(computeStreak(['2026-10-20', '2026-10-19', '2026-10-19'], '2026-10-21'), 2)
    assert.equal(computeStreak(['2026-10-18'], '2026-10-21'), 0)
  })

  it('最爱曲目按来源和标识合并，采用最新元数据与单曲时长，再播放不会放大时长', async () => {
    database.exec(`INSERT INTO playback_events(user_id,source,source_id,title,artist,duration_ms,played_at) VALUES
      (1,'local','7','新标题','新歌手',60000,'2020-01-03 00:00:00'),
      (1,'local','7','旧标题','旧歌手',180000,'2020-01-01 00:00:00'),
      (1,'netease','7','另一个来源','另一歌手',100000,'2020-01-01 00:00:00'),
      (1,'netease','7','另一个来源','另一歌手',100000,'2020-01-02 00:00:00')`)
    const first = (await member.get('/api/footprint/milestone').expect(200)).body.milestone
    assert.deepEqual(first.topTracks.map((track) => track.trackKey), ['local:7', 'netease:7'])
    assert.deepEqual(first.topTracks.map((track) => track.plays), [2, 2])
    const favourite = first.topTracks[0]
    assert.equal(favourite.title, '新标题')
    assert.equal(favourite.artist, '新歌手')
    assert.equal(favourite.durationMs, 60000)
    assert.equal(first.totalDurationMs, 440000)
    const eventId = await event(member, favourite)
    const replayed = (await member.get('/api/footprint/milestone').expect(200)).body.milestone
    assert.equal(replayed.totalDurationMs, 500000)
    assert.equal(replayed.topTracks[0].durationMs, 60000)
    assert.equal(replayed.topTracks[0].plays, 3)
    database.prepare("UPDATE playback_events SET played_at=datetime('now','-31 seconds') WHERE id=?").run(eventId)
    await event(member, replayed.topTracks[0])
    const again = (await member.get('/api/footprint/milestone').expect(200)).body.milestone
    assert.equal(again.totalDurationMs, 560000)
    assert.equal(again.topTracks[0].durationMs, 60000)
    assert.equal(again.topTracks[0].plays, 4)
  })

  it('足迹写限流使用独立Store并按正式账号隔离，读取继续可用', async () => {
    const scopes = []
    const limited = build({ security: { logger: QUIET, rateLimitEnabled: true, rateLimits: { footprint: { windowMs: 60000, limit: 1 }, global: { windowMs: 60000, limit: 1000 } } }, infrastructure: { createRateLimitStore(scope) { scopes.push(scope); return new MemoryStore() } } })
    const hash = await bcrypt.hash('test-password', 4)
    for (const email of ['member@example.com', 'other@example.com']) createUser(limited.locals.database, { email, nickname: '成员', passwordHash: hash, role: 'user', status: 'active' })
    const first = request.agent(limited), second = request.agent(limited)
    await login(first)
    await login(second, 'other@example.com')
    assert.equal(scopes.filter((scope) => scope === 'footprint').length, 1)
    await first.post('/api/footprint/events').send(TRACK).expect(201)
    const blocked = await first.post('/api/footprint/events').send({ ...TRACK, sourceId: '2' }).expect(429)
    assert.equal(blocked.body.requestId, blocked.headers['x-request-id'])
    await second.post('/api/footprint/events').send(TRACK).expect(201)
    await first.get('/api/footprint/timeline').expect(200)
    await first.post('/api/me/playlists').send({ name: '独立额度' }).expect(201)
  })

  it('公网CSRF/CORS覆盖全部写接口，已有Session和HTTPS策略复用', async () => {
    const origin = 'https://music.example.com'
    const secure = build({ security: { production: true, publicOrigin: origin, trustProxyHops: 1, logger: QUIET }, infrastructure: { sessionStore: new session.MemoryStore(), createRateLimitStore() { return new MemoryStore() } } })
    createUser(secure.locals.database, { email: 'member@example.com', nickname: '成员', passwordHash: await bcrypt.hash('test-password', 4), role: 'user', status: 'active', mustChangePassword: false })
    const https = (operation) => operation.set('X-Forwarded-Proto', 'https').set('Origin', origin)
    let csrf = await https(request(secure).get('/api/security/csrf-token')).expect(200)
    let cookie = csrf.headers['set-cookie'][0].split(';')[0]
    const logged = await https(request(secure).post('/api/auth/login')).set('Cookie', cookie).set('X-CSRF-Token', csrf.body.csrfToken).send({ email: 'member@example.com', password: 'test-password' }).expect(200)
    assert.match(logged.headers['set-cookie'][0], /Secure/)
    cookie = logged.headers['set-cookie'][0].split(';')[0]
    csrf = await https(request(secure).get('/api/security/csrf-token')).set('Cookie', cookie).expect(200)
    for (const [method, endpoint] of [['post','events'], ['put','events/1/note'], ['delete','events/1/note'], ['post','cards'], ['delete','cards/1'], ['post','posts'], ['delete','posts/1'], ['put','posts/1/like'], ['delete','posts/1/like'], ['post','posts/1/comments'], ['delete','comments/1']]) await https(request(secure)[method](`/api/footprint/${endpoint}`)).set('Cookie', cookie).send({}).expect(403)
    await https(request(secure).post('/api/footprint/events')).set('Cookie', cookie).set('X-CSRF-Token', csrf.body.csrfToken).send(TRACK).expect(201)
    await request(secure).get('/api/footprint/timeline').set('X-Forwarded-Proto', 'https').set('Origin', 'https://evil.example').set('Cookie', cookie).expect(403)
  })
})
