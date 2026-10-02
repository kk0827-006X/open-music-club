const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { beforeEach, afterEach, describe, it } = require('node:test')
const bcrypt = require('bcrypt')
const request = require('supertest')
const { createApp } = require('../src/app')
const { createUser } = require('../src/db/users')

const sharp = require('sharp')
let png

describe('个人资料和音乐库持久化', () => {
  let directory, app, member, other
  const login = async (agent, email = 'member@example.com') => {
    const csrf = (await agent.get('/api/security/csrf-token')).body.csrfToken
    assert.equal((await agent.post('/api/auth/login').set('X-CSRF-Token', csrf)
      .send({ email, password: 'test-password' })).status, 200)
    return (await agent.get('/api/security/csrf-token')).body.csrfToken
  }
  const open = () => createApp({ databasePath: path.join(directory, 'db.sqlite'), sessionSecret: 'test-secret',
    security: { csrfEnabled: true, publicOrigin: 'http://localhost:3000', logger: { error() {} } } })
  beforeEach(async () => {
    png = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#a8793d' } }).png().toBuffer()
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'omc-profile-'))
    app = open()
    const passwordHash = await bcrypt.hash('test-password', 4)
    for (const email of ['member@example.com', 'other@example.com']) createUser(app.locals.database, {
      email, nickname: email.split('@')[0], passwordHash, role: 'user', status: 'active',
    })
    member = request.agent(app).set('Origin', 'http://localhost:3000')
    other = request.agent(app).set('Origin', 'http://localhost:3000')
    await login(member)
    await login(other, 'other@example.com')
  })
  afterEach(() => {
    if (app.locals.database.open) app.locals.database.close()
    fs.rmSync(directory, { recursive: true, force: true })
  })
  const upload = async (buffer = png, filename = 'avatar.png', mime = 'image/png', agent = member) => {
    const token = (await agent.get('/api/security/csrf-token')).body.csrfToken
    return agent.put('/api/me/avatar').set('X-CSRF-Token', token)
      .attach('file', buffer, { filename, contentType: mime })
  }

  it('读取真实身份，未登录不能读写头像或资料', async () => {
    const profile = await member.get('/api/me/profile')
    assert.equal(profile.status, 200)
    assert.equal(profile.body.profile.nickname, 'member')
    assert.equal(profile.body.profile.avatarUrl, null)
    for (const url of ['/api/me/profile', '/api/me/avatar']) assert.equal((await request(app).get(url)).status, 401)
    assert.equal((await member.get('/api/me/avatar')).status, 404)
  })
  it('头像经过转码后写入数据库，其他账号看不到，响应不泄漏内部数据', async () => {
    const uploaded = await upload()
    assert.equal(uploaded.status, 200)
    assert.match(uploaded.body.profile.avatarUrl, /^\/api\/me\/avatar\?v=/)
    assert.doesNotMatch(JSON.stringify(uploaded.body), /password|avatar_data|sqlite|file_path/)
    const avatar = await member.get('/api/me/avatar')
    assert.equal(avatar.status, 200)
    assert.match(avatar.headers['content-type'], /image\/webp/)
    assert.equal(avatar.headers['cache-control'], 'private, no-store')
    assert.equal(avatar.body.toString('ascii', 0, 4), 'RIFF')
    assert.equal((await other.get('/api/me/avatar')).status, 404)
    const row = app.locals.database.prepare('SELECT avatar_data FROM user_profiles WHERE user_id = 1').get()
    assert.deepEqual(row.avatar_data, avatar.body)
  })
  it('拒绝伪造、SVG、过大、损坏文件，CSRF 错误不覆盖已有头像', async () => {
    assert.equal((await upload()).status, 200)
    const previous = (await member.get('/api/me/avatar')).body
    for (const [buffer, name, mime] of [[Buffer.from('hello'), 'avatar.png', 'image/png'],
      [Buffer.from('<svg/>'), 'avatar.svg', 'image/svg+xml'], [png, 'avatar.txt', 'image/png'],
      [png, 'avatar.png', 'image/jpeg'], [png.subarray(0, 30), 'avatar.png', 'image/png']]) {
      assert.equal((await upload(buffer, name, mime)).status, 400)
    }
    assert.equal((await upload(Buffer.alloc(5 * 1024 * 1024 + 1))).status, 413)
    assert.equal((await member.put('/api/me/avatar').attach('file', png, 'avatar.png')).status, 403)
    assert.deepEqual((await member.get('/api/me/avatar')).body, previous)
  })
  it('支持 JPEG 和 WebP，替换失败时旧头像保持完整', async () => {
    const input = sharp({ create: { width: 40, height: 40, channels: 3, background: '#333333' } })
    assert.equal((await upload(await input.clone().jpeg().toBuffer(), 'avatar.jpg', 'image/jpeg')).status, 200)
    assert.equal((await upload(await input.clone().webp().toBuffer(), 'avatar.webp', 'image/webp')).status, 200)
    const old = (await member.get('/api/me/avatar')).body
    app.locals.database.exec(`CREATE TRIGGER fail_avatar BEFORE UPDATE ON user_profiles BEGIN SELECT RAISE(ABORT, 'internal-secret-path'); END`)
    const response = await upload()
    assert.equal(response.status, 500)
    assert.doesNotMatch(JSON.stringify(response.body), /internal-secret|sqlite|stack/)
    assert.deepEqual((await member.get('/api/me/avatar')).body, old)
  })
  it('缺少图片、多文件和额外字段被拒绝', async () => {
    const token = (await member.get('/api/security/csrf-token')).body.csrfToken
    assert.equal((await member.put('/api/me/avatar').set('X-CSRF-Token', token)).status, 400)
    assert.equal((await member.put('/api/me/avatar').set('X-CSRF-Token', token)
      .attach('file', png, 'a.png').attach('file', png, 'b.png')).status, 400)
    assert.equal((await member.put('/api/me/avatar').set('X-CSRF-Token', token)
      .field('userId', '2').attach('file', png, 'a.png')).status, 400)
  })
  it('超大像素图片被拒绝，普通头像缩放至最多 512 像素', async () => {
    const large = await sharp({ create: { width: 4001, height: 4001, channels: 3, background: '#ffffff' } }).png().toBuffer()
    assert.equal((await upload(large)).status, 400)
    const normal = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: '#ffffff' } }).png().toBuffer()
    assert.equal((await upload(normal)).status, 200)
    const avatar = (await member.get('/api/me/avatar')).body
    const metadata = await sharp(avatar).metadata()
    assert.equal(metadata.width, 512)
    assert.equal(metadata.height, 512)
    assert.ok(avatar.length <= 262144)
  })
  it('头像写接口使用上传限流，未登录即使有 CSRF 也不能上传', async () => {
    const guest = request.agent(app).set('Origin', 'http://localhost:3000')
    assert.equal((await upload(png, 'avatar.png', 'image/png', guest)).status, 401)
    const limited = createApp({ databasePath: path.join(directory, 'db.sqlite'), sessionSecret: 'test-secret',
      security: { csrfEnabled: true, publicOrigin: 'http://localhost:3000', rateLimitEnabled: true,
        rateLimits: { upload: { limit: 1 } } } })
    try {
      const agent = request.agent(limited).set('Origin', 'http://localhost:3000')
      await login(agent)
      assert.equal((await upload(png, 'avatar.png', 'image/png', agent)).status, 200)
      assert.equal((await upload(png, 'avatar.png', 'image/png', agent)).status, 429)
    } finally { limited.locals.database.close() }
  })
  it('重建服务、重新登录后仍有头像、歌单、歌曲和收藏，用户之间隔离', async () => {
    assert.equal((await upload()).status, 200)
    const db = app.locals.database
    db.prepare(`INSERT INTO uploaded_music
      (title, artist, original_filename, stored_filename, file_path, mime_type, file_size, duration_ms, uploader_id)
      VALUES ('持久化测试', '歌手', 'song.mp3', 'unique.mp3', 'music/unique.mp3', 'audio/mpeg', 100, 1000, 1)`).run()
    const token = (await member.get('/api/security/csrf-token')).body.csrfToken
    const created = await member.post('/api/me/playlists').set('X-CSRF-Token', token).send({ name: '保存的歌单' })
    const id = created.body.playlist.id
    assert.equal((await member.post(`/api/me/playlists/${id}/tracks`).set('X-CSRF-Token', token).send({ source: 'local', sourceId: '1' })).status, 201)
    assert.equal((await member.put('/api/me/likes/local/1').set('X-CSRF-Token', token)).status, 200)
    assert.equal((await member.get('/api/me/likes/local/1')).body.liked, true)
    assert.equal((await other.get('/api/me/likes/local/1')).body.liked, false)
    assert.equal((await member.get('/api/me/likes/invalid/1')).status, 400)
    db.close()
    app = open()
    member = request.agent(app).set('Origin', 'http://localhost:3000')
    other = request.agent(app).set('Origin', 'http://localhost:3000')
    await login(member)
    await login(other, 'other@example.com')
    assert.equal((await member.get('/api/me/avatar')).status, 200)
    assert.equal((await member.get('/api/me/playlists')).body.playlists[0].name, '保存的歌单')
    assert.equal((await member.get(`/api/me/playlists/${id}`)).body.tracks[0].title, '持久化测试')
    assert.equal((await member.get(`/api/me/playlists/${id}`)).body.tracks[0].liked, true)
    assert.equal((await member.get('/api/me/likes')).body.tracks[0].trackKey, 'local:1')
    assert.deepEqual((await other.get('/api/me/playlists')).body.playlists, [])
    assert.deepEqual((await other.get('/api/me/likes')).body.tracks, [])
    assert.equal((await other.get(`/api/me/playlists/${id}`)).status, 404)
  })
})
