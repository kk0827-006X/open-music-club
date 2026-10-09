const { it, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const request = require('supertest')
const bcrypt = require('bcrypt')
const { createApp } = require('../src/app')
const { createUser } = require('../src/db/users')
const { createTwoFactorService } = require('../src/services/twoFactor.service')

let app, agent, now
beforeEach(async () => {
  now = 1800000000000
  app = createApp({ databasePath: ':memory:', sessionSecret: 'two-factor-test', twoFactor: {
    encryptionKey: Buffer.alloc(32, 7).toString('base64'), now: () => now,
  }, security: { logger: { info() {}, warn() {}, error() {} } } })
  createUser(app.locals.database, { email: 'member@example.com', nickname: '成员', passwordHash: await bcrypt.hash('password', 4), role: 'user', status: 'active' })
  agent = request.agent(app)
})
afterEach(() => { app.locals.database.close(); app.locals.sessionStore.stopInterval?.() })
const login = (client = agent) => client.post('/api/auth/login').send({ email: 'member@example.com', password: 'password', rememberMe: true })
async function code(secret) { const { generateSync } = require('otplib'); return generateSync({ secret, epoch: now / 1000 }) }
async function enroll() {
  await login()
  const setup = await agent.post('/api/auth/2fa/setup').send({ password: 'password' }).expect(200)
  const confirmed = await agent.post('/api/auth/2fa/confirm').send({ code: await code(setup.body.secret) }).expect(200)
  return { secret: setup.body.secret, codes: confirmed.body.recoveryCodes }
}
it('绑定后密码登录只是待验证状态，验证码完成后恢复正式身份', async () => {
  const { secret } = await enroll()
  await agent.post('/api/auth/logout').expect(200)
  const pending = await login(); assert.equal(pending.body.requiresTwoFactor, true)
  await agent.get('/api/protected').expect(401)
  assert.equal((await agent.get('/api/auth/me')).body.authenticated, false)
  now += 30000
  const result = await agent.post('/api/auth/2fa/verify').send({ code: await code(secret) }).expect(200)
  assert.equal(result.body.user.role, 'user')
  await agent.get('/api/protected').expect(200)
})
it('恢复码只保存哈希且只能使用一次，密钥不明文入库', async () => {
  const { secret, codes } = await enroll()
  assert.equal(codes.length, 10)
  const state = app.locals.database.prepare('SELECT * FROM user_two_factor').get()
  assert.ok(!JSON.stringify(state).includes(secret))
  const rows = app.locals.database.prepare('SELECT * FROM two_factor_recovery_codes').all()
  assert.ok(!JSON.stringify(rows).includes(codes[0]))
  await agent.post('/api/auth/logout'); await login()
  await agent.post('/api/auth/2fa/recovery').send({ code: codes[0] }).expect(200)
  await agent.post('/api/auth/logout'); await login()
  await agent.post('/api/auth/2fa/recovery').send({ code: codes[0] }).expect(401)
})
it('同一时间窗不可重放，待验证超时或失败五次后不可继续', async () => {
  const { secret } = await enroll()
  await agent.post('/api/auth/logout'); await login()
  await agent.post('/api/auth/2fa/verify').send({ code: await code(secret) }).expect(401)
  now += 30000
  for (let i = 0; i < 4; i++) await agent.post('/api/auth/2fa/verify').send({ code: 'invalid' }).expect(401)
  await agent.post('/api/auth/2fa/verify').send({ code: await code(secret) }).expect(429)
  now += 16 * 60 * 1000
  await login(); now += 6 * 60 * 1000
  await agent.post('/api/auth/2fa/verify').send({ code: await code(secret) }).expect(401)
})
it('关闭需密码和第二因子，操作后旧会话立即失效', async () => {
  const { secret } = await enroll()
  const other = request.agent(app); await login(other); now += 30000
  await other.post('/api/auth/2fa/verify').send({ code: await code(secret) }).expect(200)
  await agent.post('/api/auth/2fa/disable').send({ password: 'wrong', code: '123456' }).expect(401)
  now += 30000
  await agent.post('/api/auth/2fa/disable').send({ password: 'password', code: await code(secret) }).expect(200)
  await other.get('/api/protected').expect(401)
  assert.equal((await agent.get('/api/auth/2fa/status')).body.enabled, false)
})
it('未登录不得绑定或管理，未验证的会话不得管理恢复码', async () => {
  for (const action of ['setup', 'confirm', 'disable', 'recovery-codes/regenerate']) await agent.post(`/api/auth/2fa/${action}`).send({}).expect(401)
  await agent.get('/api/auth/2fa/status').expect(401)
  await agent.post('/api/auth/2fa/verify').send({ code: '123456' }).expect(401)
  await enroll(); await agent.post('/api/auth/logout'); await login()
  await agent.get('/api/auth/2fa/status').expect(401)
  await agent.post('/api/auth/2fa/recovery-codes/regenerate').send({}).expect(401)
})
it('绑定必须重新验证密码，确认绑定不能跨 Session，过期需重绑', async () => {
  await login()
  await agent.post('/api/auth/2fa/setup').send({ password: 'wrong' }).expect(401)
  const setup = await agent.post('/api/auth/2fa/setup').send({ password: 'password' }).expect(200)
  const other = request.agent(app); await login(other)
  await other.post('/api/auth/2fa/confirm').send({ code: await code(setup.body.secret) }).expect(401)
  now += 11 * 60000
  await agent.post('/api/auth/2fa/confirm').send({ code: await code(setup.body.secret) }).expect(401)
  assert.equal(app.locals.twoFactor.state(1).enabled, 0)
})
it('重新生成恢复码使旧码与其他会话失效，错误验证码不更改数据', async () => {
  const { secret, codes } = await enroll()
  await agent.post('/api/auth/2fa/setup').send({ password: 'password' }).expect(409)
  await agent.post('/api/auth/2fa/recovery-codes/regenerate').send({ password: 'password', code: 'bad' }).expect(401)
  assert.equal((await agent.get('/api/auth/2fa/status')).body.recoveryCodesRemaining, 10)
  now += 30000
  const result = await agent.post('/api/auth/2fa/recovery-codes/regenerate').send({ password: 'password', code: await code(secret) }).expect(200)
  assert.equal(result.body.recoveryCodes.length, 10)
  assert.notEqual(result.body.recoveryCodes[0], codes[0])
  await agent.post('/api/auth/logout'); await login()
  await agent.post('/api/auth/2fa/recovery').send({ code: codes[0] }).expect(401)
  await agent.post('/api/auth/2fa/recovery').send({ code: result.body.recoveryCodes[0] }).expect(200)
})
it('禁用账号、版本变化和过期验证不得获得权限', async () => {
  const { secret } = await enroll()
  await agent.post('/api/auth/logout'); await login()
  app.locals.database.prepare('UPDATE user_two_factor SET session_version = session_version + 1').run()
  now += 30000
  await agent.post('/api/auth/2fa/verify').send({ code: await code(secret) }).expect(401)
  await login()
  app.locals.database.prepare("UPDATE users SET status = 'disabled'").run()
  await agent.post('/api/auth/2fa/verify').send({ code: await code(secret) }).expect(401)
})
it('重新尝试密码登录会撤销上一个账号挑战，即使新密码错误', async () => {
  const { secret } = await enroll()
  await agent.post('/api/auth/logout'); await login()
  await agent.post('/api/auth/login').send({ email: 'member@example.com', password: 'wrong' }).expect(401)
  now += 30000
  await agent.post('/api/auth/2fa/verify').send({ code: await code(secret) }).expect(401)
})
it('绑定、验证码、正式登录均轮换 Session，不泄漏安全状态', async () => {
  const first = await login()
  const setup = await agent.post('/api/auth/2fa/setup').send({ password: 'password' })
  const confirm = await agent.post('/api/auth/2fa/confirm').send({ code: await code(setup.body.secret) }).expect(200)
  assert.notEqual(first.headers['set-cookie'][0].split(';')[0], confirm.headers['set-cookie'][0].split(';')[0])
  assert.equal(confirm.headers['cache-control'], 'no-store')
  const status = await agent.get('/api/auth/2fa/status')
  assert.doesNotMatch(JSON.stringify(status.body), /secret|cipher|session_version|code_hash/)
  await agent.post('/api/auth/logout')
  const pending = await login(); now += 30000
  const final = await agent.post('/api/auth/2fa/verify').send({ code: await code(setup.body.secret) })
  assert.notEqual(pending.headers['set-cookie'][0].split(';')[0], final.headers['set-cookie'][0].split(';')[0])
  assert.match(final.headers['set-cookie'][0], /Expires=/)
})
it('事务错误回滚恢复码消费与密钥状态，损坏密钥只返回安全错误', async () => {
  const { secret } = await enroll()
  now += 30000
  const before = app.locals.twoFactor.state(1)
  app.locals.database.exec("CREATE TRIGGER fail_codes BEFORE DELETE ON two_factor_recovery_codes BEGIN SELECT RAISE(ABORT, 'internal-test-path'); END")
  const failed = await agent.post('/api/auth/2fa/recovery-codes/regenerate').send({ password: 'password', code: await code(secret) }).expect(500)
  assert.doesNotMatch(JSON.stringify(failed.body), /internal-test-path|sqlite|stack/)
  assert.equal(app.locals.twoFactor.state(1).last_used_counter, before.last_used_counter)
  app.locals.database.exec('DROP TRIGGER fail_codes')
  app.locals.database.prepare("UPDATE user_two_factor SET secret_ciphertext = 'corrupt'").run()
  await agent.post('/api/auth/logout'); await login()
  const corrupt = await agent.post('/api/auth/2fa/verify').send({ code: '123456' }).expect(500)
  assert.doesNotMatch(JSON.stringify(corrupt.body), /cipher|Buffer|stack/)
})
it('IP 限流保护所有安全修改接口', async () => {
  for (let i = 0; i < 40; i++) await agent.post('/api/auth/2fa/verify').send({}).expect(401)
  await agent.post('/api/auth/2fa/verify').send({}).expect(429)
})
it('管理员不能自行关闭，未配置密钥不能绑定，非法配置拒绝启动', async () => {
  await enroll()
  app.locals.database.prepare("UPDATE users SET role = 'admin'").run()
  await agent.post('/api/auth/2fa/disable').send({}).expect(403)
  assert.throws(() => createTwoFactorService(app.locals.database, { encryptionKey: 'invalid' }), /TOTP_ENCRYPTION_KEY/)
  app.locals.twoFactor = createTwoFactorService(app.locals.database, { encryptionKey: '' })
  await agent.post('/api/auth/2fa/setup').send({ password: 'password' }).expect(503)
})
it('公网管理员只能先绑定，CSRF 与 Origin 保护全部 2FA 修改接口', async () => {
  const session = require('express-session'), { MemoryStore } = require('express-rate-limit')
  const prod = createApp({ databasePath: ':memory:', sessionSecret: 'prod-test',
    twoFactor: { encryptionKey: Buffer.alloc(32, 5).toString('base64'), now: () => now },
    security: { production: true, publicOrigin: 'https://music.example.com', trustProxyHops: 1, logger: { info() {}, error() {} } },
    infrastructure: { sessionStore: new session.MemoryStore(), createRateLimitStore: () => new MemoryStore() },
  })
  try {
    createUser(prod.locals.database, { email: 'admin@example.com', nickname: '管理员', passwordHash: await bcrypt.hash('password', 4), role: 'admin', status: 'active' })
    let cookie
    const send = (operation) => operation.set('X-Forwarded-Proto', 'https').set('Origin', 'https://music.example.com').set('Cookie', cookie || '')
    const csrf = async () => { const r = await send(request(prod).get('/api/security/csrf-token')); if (r.headers['set-cookie']) cookie = r.headers['set-cookie'][0].split(';')[0]; return r.body.csrfToken }
    const post = async (path, body) => {
      const token = await csrf(); const r = await send(request(prod).post(path)).set('X-CSRF-Token', token).send(body)
      if (r.headers['set-cookie']) cookie = r.headers['set-cookie'][0].split(';')[0]
      return r
    }
    const pending = await post('/api/auth/login', { email: 'admin@example.com', password: 'password' })
    assert.equal(pending.body.enrollmentRequired, true)
    await send(request(prod).get('/api/admin/test')).expect(401)
    for (const action of ['setup', 'confirm', 'verify', 'recovery', 'disable', 'recovery-codes/regenerate']) await send(request(prod).post(`/api/auth/2fa/${action}`)).send({}).expect(403)
    const setup = await post('/api/auth/2fa/setup', { password: 'password' }); assert.equal(setup.status, 200)
    const confirmed = await post('/api/auth/2fa/confirm', { code: await code(setup.body.secret) }); assert.equal(confirmed.status, 200)
    assert.match(confirmed.headers['set-cookie'][0], /Secure/)
    await send(request(prod).get('/api/admin/test')).expect(200)
    assert.equal((await post('/api/auth/2fa/disable', { password: 'password', code: '123456' })).status, 403)
  } finally { prod.locals.database.close() }
})
it('重建数据库连接仍能验证认证器，密钥必须独立备份', async () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
  const { createDatabase, initializeSchema } = require('../src/db/database')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'omc-factor-persist-'))
  const location = path.join(directory, 'database.sqlite')
  const options = { encryptionKey: Buffer.alloc(32, 8).toString('base64'), now: () => now }
  let db = createDatabase(location)
  try {
    initializeSchema(db)
    const user = createUser(db, { email: 'saved@example.com', nickname: '持久化', passwordHash: await bcrypt.hash('password', 4), role: 'user', status: 'active' })
    const service = createTwoFactorService(db, options)
    const setup = service.setup(user, 'session')
    service.confirm(user.id, 'session', await code(setup.secret))
    db.close(); db = createDatabase(location); initializeSchema(db)
    now += 30000
    const restored = createTwoFactorService(db, options)
    assert.equal(restored.consume(user.id, await code(setup.secret)), true)
    now += 30000
    const wrongKey = createTwoFactorService(db, { ...options, encryptionKey: Buffer.alloc(32, 9).toString('base64') })
    assert.throws(() => wrongKey.consume(user.id, require('otplib').generateSync({ secret: setup.secret, epoch: now / 1000 })))
  } finally { if (db.open) db.close(); fs.rmSync(directory, { recursive: true, force: true }) }
})
