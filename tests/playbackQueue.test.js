const assert = require('node:assert/strict')
const { beforeEach, afterEach, describe, it } = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const request = require('supertest')
const bcrypt = require('bcrypt')
const { createApp } = require('../src/app')
const { createUser } = require('../src/db/users')
const { initializeSchema } = require('../src/db/database')

describe('按用户持久化播放队列', () => {
  let directory, app, member, other, unavailable
  const options = () => ({ databasePath: path.join(directory, 'queue.sqlite'), sessionSecret: 'isolated-test-secret',
    security: { csrfEnabled: true, publicOrigin: 'http://localhost', logger: { error() {} } },
    neteaseService: { async call(name, params) {
      if (unavailable) throw new Error('/secret/upstream')
      return { code: 200, songs: params.ids.split(',').map(Number).map(id => ({ id, name: `歌曲 ${id}`, ar: [], al: {}, dt: 1000 })) }
    } } })
  async function write(agent, url, body, method = 'put') {
    const token = (await agent.get('/api/security/csrf-token')).body.csrfToken
    return agent[method](url).set('Origin', 'http://localhost').set('X-CSRF-Token', token).send(body)
  }
  async function login(agent, email) {
    assert.equal((await write(agent, '/api/auth/login', { email, password: 'test-password' }, 'post')).status, 200)
  }
  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'omc-queue-'))
    unavailable = false
    app = createApp(options())
    const hash = await bcrypt.hash('test-password', 4)
    for (const email of ['member@example.com', 'other@example.com']) createUser(app.locals.database, {
      email, nickname: '隔离用户', passwordHash: hash, role: 'user', status: 'active',
    })
    member = request.agent(app); other = request.agent(app)
    await login(member, 'member@example.com'); await login(other, 'other@example.com')
  })
  afterEach(() => {
    if (app?.locals.database.open) app.locals.database.close()
    fs.rmSync(directory, { recursive: true, force: true })
  })
  const tracks = [{ source: 'netease', sourceId: '42' }, { source: 'local', sourceId: '1' }]

  it('默认空队列；增量建表不改变已有用户，重复初始化安全', async () => {
    assert.deepEqual((await member.get('/api/me/queue')).body, { success: true, tracks: [] })
    initializeSchema(app.locals.database)
    assert.equal(app.locals.database.prepare('SELECT COUNT(*) AS n FROM users').get().n, 2)
    assert.deepEqual(app.locals.database.prepare('PRAGMA table_info(user_playback_queues)').all().map(row => row.name), ['user_id', 'tracks_json'])
  })
  it('只存紧凑来源与 ID，忽略伪造用户、标题与 URL；不同来源相同 ID 不混淆', async () => {
    const response = await write(member, '/api/me/queue', { userId: 2, tracks: [...tracks, { source: 'netease', sourceId: '1', title: '伪造', url: '/secret' }] })
    assert.equal(response.status, 200)
    const stored = app.locals.database.prepare('SELECT * FROM user_playback_queues').get()
    assert.equal(stored.user_id, 1)
    assert.equal(stored.tracks_json, '[[1,"42"],[0,"1"],[1,"1"]]')
    assert.deepEqual((await member.get('/api/me/queue')).body.tracks.map(track => track.trackKey), ['netease:42', 'local:1', 'netease:1'])
    assert.deepEqual((await other.get('/api/me/queue')).body.tracks, [])
  })
  it('重新登录以及重新创建服务后顺序仍在，清空不留下历史快照', async () => {
    await write(member, '/api/me/queue', { tracks })
    await write(member, '/api/auth/logout', {}, 'post')
    await login(member, 'member@example.com')
    assert.equal((await member.get('/api/me/queue')).body.tracks.length, 2)
    app.locals.database.close(); app = createApp(options())
    member = request.agent(app); await login(member, 'member@example.com')
    assert.deepEqual((await member.get('/api/me/queue')).body.tracks.map(track => track.sourceId), ['42', '1'])
    await write(member, '/api/me/queue', { tracks: tracks.slice().reverse() })
    assert.equal((await member.get('/api/me/queue')).body.tracks[0].source, 'local')
    await write(member, '/api/me/queue', { tracks: [] })
    assert.equal(app.locals.database.prepare('SELECT COUNT(*) AS n FROM user_playback_queues').get().n, 0)
    assert.deepEqual((await member.get('/api/me/queue')).body.tracks, [])
  })
  it('无登录及无 CSRF 不能写入；账号之间相互隔离', async () => {
    assert.equal((await request(app).get('/api/me/queue')).status, 401)
    assert.equal((await write(request.agent(app), '/api/me/queue', { tracks })).status, 401)
    assert.equal((await member.put('/api/me/queue').send({ tracks })).status, 403)
    await write(member, '/api/me/queue', { tracks })
    await write(other, '/api/me/queue', { tracks: [{ source: 'netease', sourceId: '9' }] })
    assert.equal((await member.get('/api/me/queue')).body.tracks.length, 2)
    assert.equal((await other.get('/api/me/queue')).body.tracks[0].sourceId, '9')
  })
  it('非法来源、ID、重复曲目及超过 500 首拒绝，旧队列不变', async () => {
    await write(member, '/api/me/queue', { tracks })
    for (const invalid of [null, {}, [{ source: 'other', sourceId: '1' }], [null],
      [{ source: 'netease', sourceId: '../secret' }], [{ source: 'local', sourceId: 0 }],
      [{ source: 'local', sourceId: '9007199254740992' }], [tracks[0], tracks[0]],
      Array.from({ length: 501 }, (_, i) => ({ source: 'netease', sourceId: String(i + 1) }))]) {
      assert.equal((await write(member, '/api/me/queue', { tracks: invalid })).status, 400)
    }
    assert.equal((await member.get('/api/me/queue')).body.tracks.length, 2)
  })
  it('上游失败及本地歌曲被删除时保留引用，重试恢复不泄漏内部路径', async () => {
    await write(member, '/api/me/queue', { tracks })
    unavailable = true
    const response = await member.get('/api/me/queue')
    assert.equal(response.status, 200)
    assert.ok(response.body.tracks.every(track => track.playable === false))
    assert.doesNotMatch(JSON.stringify(response.body), /secret|tracks_json|password_hash/)
    unavailable = false
    assert.equal((await member.get('/api/me/queue')).body.tracks[0].title, '歌曲 42')
  })
  it('数据库写入错误不破坏旧快照，对外错误脱敏', async () => {
    await write(member, '/api/me/queue', { tracks })
    app.locals.database.exec("CREATE TRIGGER fail_queue BEFORE UPDATE ON user_playback_queues BEGIN SELECT RAISE(ABORT, '/secret/database'); END")
    const response = await write(member, '/api/me/queue', { tracks: tracks.slice(0, 1) })
    assert.equal(response.status, 500)
    assert.doesNotMatch(JSON.stringify(response.body), /secret|database/)
    assert.equal((await member.get('/api/me/queue')).body.tracks.length, 2)
  })
  it('500 首上限可以保存；来源详情分批读取，读取失败安全返回 500', async () => {
    const list = Array.from({ length: 500 }, (_, index) => ({ source: 'netease', sourceId: String(index + 1) }))
    assert.equal((await write(member, '/api/me/queue', { tracks: list })).status, 200)
    assert.equal((await member.get('/api/me/queue')).body.tracks.length, 500)
    assert.ok(app.locals.database.prepare('SELECT length(tracks_json) AS n FROM user_playback_queues').get().n <= 12000)
    app.locals.database.exec('DROP TABLE user_playback_queues')
    const response = await member.get('/api/me/queue')
    assert.equal(response.status, 500)
    assert.doesNotMatch(JSON.stringify(response.body), /sqlite|no such table|queue.sqlite/)
  })
  it('相同快照无需重写，账号删除会级联清理队列', async () => {
    await write(member, '/api/me/queue', { tracks })
    app.locals.database.exec("CREATE TRIGGER reject_queue_update BEFORE UPDATE ON user_playback_queues BEGIN SELECT RAISE(ABORT, '不应重写'); END")
    assert.equal((await write(member, '/api/me/queue', { tracks })).status, 200)
    app.locals.database.prepare('DELETE FROM users WHERE id = 1').run()
    assert.equal(app.locals.database.prepare('SELECT COUNT(*) AS n FROM user_playback_queues').get().n, 0)
  })
  it('队列沿用按用户的写入限流，读取及其他用户不受该额度影响', async () => {
    app.locals.database.close()
    app = createApp({ ...options(), security: { ...options().security, rateLimitEnabled: true,
      rateLimits: { global: { windowMs: 60000, limit: 100 }, personalLibrary: { windowMs: 60000, limit: 1 } } } })
    member = request.agent(app); other = request.agent(app)
    await login(member, 'member@example.com'); await login(other, 'other@example.com')
    assert.equal((await write(member, '/api/me/queue', { tracks })).status, 200)
    assert.equal((await write(member, '/api/me/queue', { tracks: [] })).status, 429)
    assert.equal((await member.get('/api/me/queue')).status, 200)
    assert.equal((await write(other, '/api/me/queue', { tracks: [] })).status, 200)
  })
})
