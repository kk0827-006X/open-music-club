const assert = require('node:assert/strict')
const { afterEach, beforeEach, describe, it } = require('node:test')
const bcrypt = require('bcrypt')
const request = require('supertest')
const { generateSync } = require('otplib')
const { createApp } = require('../src/app')
const { createUser, findUserByEmail } = require('../src/db/users')
const PASSWORD = 'test-password'
const NEW_PASSWORD = 'a-long-private-password'
const KEY = Buffer.alloc(32, 9).toString('base64')
const CANDIDATE = { email: 'candidate@example.com', nickname: '候选成员', reason: '小组成员申请' }

describe('申请、审核与一次性激活 HTTP 闭环', () => {
  let app, database, admin, member, messages, clock
  beforeEach(async () => {
    messages = []; clock = 1800000000000
    app = createApp({ databasePath: ':memory:', sessionSecret: 'isolated-application-test',
      security: { publicOrigin: 'https://club.example.com', logger: { warn() {}, info() {}, error() {} } },
      twoFactor: { encryptionKey: KEY, now: () => clock },
      mail: { now: () => clock,
        env: { MAIL_ENABLED: 'true', SMTP_HOST: 'smtp.example.com', MAIL_FROM: 'club@example.com', MAIL_ADMIN_TO: 'admin@example.com', APPLICATION_MAIL_ENCRYPTION_KEY: KEY },
        transport: { async sendMail(message) { messages.push(message); return { accepted: [message.to] } } },
        deliveryClient: { configured: true, async check() { return 'delivered' } },
      },
    })
    database = app.locals.database
    const passwordHash = await bcrypt.hash(PASSWORD, 4)
    for (const [email, role] of [['admin@example.com', 'admin'], ['member@example.com', 'user']]) createUser(database, { email, nickname: role, passwordHash, role, status: 'active', mustChangePassword: false })
    admin = request.agent(app); member = request.agent(app)
    await admin.post('/api/auth/login').send({ email: 'admin@example.com', password: PASSWORD }).expect(200)
    const setup = await admin.post('/api/auth/2fa/setup').send({ password: PASSWORD }).expect(200)
    await admin.post('/api/auth/2fa/confirm').send({ code: generateSync({ secret: setup.body.secret, epoch: clock / 1000 }) }).expect(200)
    await member.post('/api/auth/login').send({ email: 'member@example.com', password: PASSWORD }).expect(200)
  })
  afterEach(() => { app.locals.accessLifecycle.stop(); database.close(); app.locals.sessionStore.stopInterval?.() })
  const submit = (overrides = {}) => request(app).post('/api/applications').send({ ...CANDIDATE, ...overrides })
  const stored = () => database.prepare('SELECT * FROM access_requests WHERE email = ? ORDER BY id DESC LIMIT 1').get(CANDIDATE.email)
  async function token(purpose) {
    await app.locals.accessLifecycle.tick()
    const route = purpose === 'verify' ? 'verify-email' : 'activate'
    const message = messages.filter(item => item.to === CANDIDATE.email && item.text.includes(`/${route}#`)).at(-1)
    assert.ok(message, `${purpose} 邮件必须发给申请人`)
    const match = message.text.match(new RegExp(`https://club\\.example\\.com/${route}#token=([A-Za-z0-9_-]+)`))
    assert.ok(match, '链接使用 PUBLIC_ORIGIN 和 fragment')
    assert.equal(Buffer.from(match[1], 'base64url').length, 32)
    return match[1]
  }
  async function verified() {
    await submit().expect(202)
    await request(app).post('/api/applications/verify-email').send({ token: await token('verify') }).expect(200)
    return stored().id
  }
  async function approved() {
    const id = await verified()
    await admin.post(`/api/admin/applications/${id}/approve`).send({}).expect(200)
    return { id, credential: await token('activate') }
  }
  function privateResponse(body) {
    assert.doesNotMatch(JSON.stringify(body), /candidate@example\.com|password_hash|token_hash|ciphertext|initialPassword/)
    assert.equal(body.user, undefined)
  }
  it('提交统一返回提示，归一化字段且验证前不可审核', async () => {
    const response = await submit({ email: ' CANDIDATE@EXAMPLE.COM ', nickname: ' 候选成员 ', reason: ' 申请理由 ', role: 'admin', status: 'approved' }).expect(202)
    assert.equal(response.body.success, true)
    for (const key of ['application', 'email', 'id']) assert.equal(response.body[key], undefined)
    assert.equal(messages.length, 0)
    const row = stored()
    assert.equal(row.status, 'pending'); assert.equal(row.nickname, '候选成员'); assert.equal(row.reason, '申请理由'); assert.equal(row.reviewed_by, null)
    assert.equal(database.prepare('SELECT verified_at FROM access_workflow WHERE application_id = ?').get(row.id).verified_at, null)
    assert.equal((await admin.get('/api/admin/applications?status=pending').expect(200)).body.total, 0)
    await admin.post(`/api/admin/applications/${row.id}/approve`).send({}).expect(409)
    assert.equal(findUserByEmail(database, CANDIDATE.email), undefined)
  })
  it('非法申请不产生数据库申请与邮件', async () => {
    for (const fields of [{ email: undefined }, { email: 'invalid' }, { nickname: '  ' }, { nickname: undefined }, { reason: 42 }]) await submit(fields).expect(400)
    assert.equal(database.prepare('SELECT count(*) count FROM access_requests').get().count, 0); assert.equal(messages.length, 0)
  })
  it('验证仅主动 POST 消费，重复验证及用途混用失败', async () => {
    await submit().expect(202)
    const credential = await token('verify')
    await request(app).get(`/api/applications/verify-email?token=${credential}`).expect(404)
    await request(app).post('/api/auth/activate').send({ token: credential, password: NEW_PASSWORD }).expect(400)
    await request(app).post('/api/applications/verify-email').send({ token: credential }).expect(200)
    await request(app).post('/api/applications/verify-email').send({ token: credential }).expect(400)
    const rows = (await admin.get('/api/admin/applications?status=pending').expect(200)).body
    assert.equal(rows.total, 1); assert.equal(rows.applications[0].emailVerified, true); privateResponse(rows)
  })
  it('通过只发激活链接，激活才创建 bcrypt 账号且不自动登录', async () => {
    const { id, credential } = await approved()
    assert.equal(stored().status, 'approved'); assert.equal(findUserByEmail(database, CANDIDATE.email), undefined)
    const visitor = request.agent(app)
    await visitor.post('/api/auth/login').send({ email: CANDIDATE.email, password: NEW_PASSWORD }).expect(401)
    privateResponse((await visitor.post('/api/auth/activate').send({ token: credential, password: NEW_PASSWORD }).expect(200)).body)
    await visitor.get('/api/protected').expect(401)
    const user = findUserByEmail(database, CANDIDATE.email)
    assert.equal(user.role, 'user'); assert.equal(user.must_change_password, 0); assert.equal(bcrypt.getRounds(user.password_hash), 12)
    assert.equal(await bcrypt.compare(NEW_PASSWORD, user.password_hash), true)
    assert.ok(database.prepare('SELECT activated_at FROM access_workflow WHERE application_id = ?').get(id).activated_at)
    await visitor.post('/api/auth/login').send({ email: CANDIDATE.email, password: NEW_PASSWORD }).expect(200)
    await visitor.post('/api/auth/activate').send({ token: credential, password: NEW_PASSWORD }).expect(400)
    assert.equal((await admin.get('/api/admin/applications?status=activated').expect(200)).body.total, 1)
  })
  it('密码按 UTF-8 字节校验，失败不消费 Token', async () => {
    const { credential } = await approved()
    for (const password of ['a'.repeat(14), 'a'.repeat(73), '密'.repeat(25), null]) {
      await request(app).post('/api/auth/activate').send({ token: credential, password }).expect(400)
      assert.equal(findUserByEmail(database, CANDIDATE.email), undefined)
    }
    await request(app).post('/api/auth/activate').send({ token: credential, password: '密'.repeat(24) }).expect(200)
    assert.equal(await bcrypt.compare('密'.repeat(24), findUserByEmail(database, CANDIDATE.email).password_hash), true)
  })
  it('并发审批只允许一个结果，不能覆盖审核记录', async () => {
    const id = await verified()
    const reviews = await Promise.all([admin.post(`/api/admin/applications/${id}/approve`).send({}), admin.post(`/api/admin/applications/${id}/reject`).send({})])
    assert.deepEqual(reviews.map(item => item.status).sort(), [200, 409])
    assert.equal(findUserByEmail(database, CANDIDATE.email), undefined)
  })
  it('并发激活只消费一次并创建一个账号', async () => {
    const { credential } = await approved()
    const results = await Promise.all([1, 2].map(() => request(app).post('/api/auth/activate').send({ token: credential, password: NEW_PASSWORD })))
    assert.deepEqual(results.map(item => item.status).sort(), [200, 400])
    assert.equal(database.prepare('SELECT count(*) count FROM users WHERE email = ?').get(CANDIDATE.email).count, 1)
  })
  it('重发撤销旧链接，未知邮箱及冷却响应保持一致', async () => {
    await submit().expect(202)
    const first = await token('verify'); clock += 61000
    const resent = await request(app).post('/api/applications/resend').send({ email: CANDIDATE.email, purpose: 'verify' }).expect(202)
    const second = await token('verify'); assert.notEqual(first, second)
    await request(app).post('/api/applications/verify-email').send({ token: first }).expect(400)
    for (const email of ['missing@example.com', CANDIDATE.email]) {
      const response = await request(app).post('/api/applications/resend').send({ email, purpose: 'verify' }).expect(202)
      assert.deepEqual(response.body, resent.body)
    }
    await request(app).post('/api/applications/verify-email').send({ token: second }).expect(200)
  })
  it('验证 30 分钟、激活 24 小时后过期，激活重发无需重新审核', async () => {
    await submit().expect(202)
    const first = await token('verify'); clock += 30 * 60000 + 1
    await request(app).post('/api/applications/verify-email').send({ token: first }).expect(400)
    await request(app).post('/api/applications/resend').send({ email: CANDIDATE.email, purpose: 'verify' }).expect(202)
    await request(app).post('/api/applications/verify-email').send({ token: await token('verify') }).expect(200)
    await admin.post(`/api/admin/applications/${stored().id}/approve`).send({}).expect(200)
    const activation = await token('activate'); clock += 24 * 60 * 60000 + 1
    await request(app).post('/api/auth/activate').send({ token: activation, password: NEW_PASSWORD }).expect(400)
    await request(app).post('/api/applications/resend').send({ email: CANDIDATE.email, purpose: 'activate' }).expect(202)
    await request(app).post('/api/auth/activate').send({ token: await token('activate'), password: NEW_PASSWORD }).expect(200)
  })
  it('拒绝后七天冷却，不能借重发修改资料或获得激活资格', async () => {
    const id = await verified()
    await admin.post(`/api/admin/applications/${id}/reject`).send({}).expect(200)
    await app.locals.accessLifecycle.tick()
    assert.doesNotMatch(messages.filter(item => item.to === CANDIDATE.email).at(-1).text, /#token=|initial-password/)
    await submit({ nickname: '被篡改' })
    await request(app).post('/api/applications/resend').send({ email: CANDIDATE.email, purpose: 'activate' }).expect(202)
    assert.equal(stored().status, 'rejected'); assert.equal(stored().nickname, CANDIDATE.nickname)
    clock += 7 * 24 * 60 * 60000 + 1
    await submit().expect(202)
    assert.equal(stored().status, 'pending'); assert.equal(findUserByEmail(database, CANDIDATE.email), undefined)
  })
  it('后台使用脱敏字段，管理员提醒不含申请邮箱、理由与 Token', async () => {
    const id = await verified(); await app.locals.accessLifecycle.tick()
    const response = await admin.get('/api/admin/applications?status=pending&page=1').expect(200)
    assert.equal(response.body.page, 1); assert.equal(response.body.pageSize, 20); privateResponse(response.body)
    assert.match(response.body.applications[0].createdAt, /T.*Z$/)
    assert.equal(new Date(response.body.applications[0].createdAt).getTime(), Date.parse(`${stored().created_at.replace(' ', 'T')}Z`))
    assert.deepEqual(Object.keys(response.body.applications[0]).sort(), ['id', 'nickname', 'reason', 'status', 'emailVerified', 'createdAt', 'reviewedAt', 'reviewedBy', 'activatedAt', 'notificationStatus'].sort())
    privateResponse((await admin.post(`/api/admin/applications/${id}/approve`).send({}).expect(200)).body)
    const reminders = messages.filter(item => item.to === 'admin@example.com'); assert.ok(reminders.length)
    for (const message of reminders) assert.doesNotMatch(message.text, /candidate@example\.com|小组成员申请|#token=/)
  })
  it('访客、普通成员与未完成 2FA 的管理员不能读写后台', async () => {
    const id = await verified()
    const unverified = request.agent(app)
    createUser(database, { email: 'unenrolled@example.com', nickname: '未绑定管理员', passwordHash: await bcrypt.hash(PASSWORD, 4), role: 'admin', status: 'active', mustChangePassword: false })
    const unenrolled = request.agent(app)
    await unenrolled.post('/api/auth/login').send({ email: 'unenrolled@example.com', password: PASSWORD }).expect(200)
    await unverified.post('/api/auth/login').send({ email: 'admin@example.com', password: PASSWORD }).expect(200)
    for (const client of [request(app), member, unverified, unenrolled]) {
      for (const response of [await client.get('/api/admin/applications'), await client.post(`/api/admin/applications/${id}/approve`).send({}), await client.post(`/api/admin/applications/${id}/reject`).send({})]) assert.ok([401, 403].includes(response.status))
    }
    assert.equal(stored().status, 'pending')
  })
  it('CSRF 覆盖全部新写接口并拒绝跨站来源', async () => {
    app.locals.security.csrfEnabled = true
    for (const route of ['/api/applications', '/api/applications/verify-email', '/api/applications/resend', '/api/auth/activate']) {
      await request(app).post(route).send({ ...CANDIDATE, token: 'invalid', password: NEW_PASSWORD, purpose: 'verify' }).expect(403)
      await request(app).post(route).set('Origin', 'https://evil.example').send({}).expect(403)
    }
    const visitor = request.agent(app), csrf = await visitor.get('/api/security/csrf-token').expect(200)
    await visitor.post('/api/applications').set('Origin', 'https://club.example.com').set('X-CSRF-Token', csrf.body.csrfToken).send(CANDIDATE).expect(202)
  })
  it('Host 伪造不影响邮件链接且敏感接口禁止缓存', async () => {
    const response = await request(app).post('/api/applications').set('Host', 'evil.example').send(CANDIDATE).expect(202)
    assert.match(response.headers['cache-control'], /no-store/); await token('verify')
    assert.equal(messages.some(message => message.text.includes('evil.example')), false)
    assert.match((await admin.get('/api/admin/applications').expect(200)).headers['cache-control'], /no-store/)
  })
  it('激活事务后半段失败时回滚用户与凭证消费，修复后仍可激活', async () => {
    const { credential } = await approved()
    database.exec("CREATE TRIGGER fail_activation BEFORE UPDATE OF activated_at ON access_workflow WHEN NEW.activated_at IS NOT NULL BEGIN SELECT RAISE(ABORT, 'isolated-failure'); END")
    const failed = await request(app).post('/api/auth/activate').send({ token: credential, password: NEW_PASSWORD }).expect(500)
    assert.equal(findUserByEmail(database, CANDIDATE.email), undefined)
    assert.doesNotMatch(JSON.stringify(failed.body), /isolated-failure|sqlite|stack/)
    database.exec('DROP TRIGGER fail_activation')
    await request(app).post('/api/auth/activate').send({ token: credential, password: NEW_PASSWORD }).expect(200)
  })
  it('审批不再接受手动初始密码，分页和状态参数不能注入', async () => {
    const id = await verified()
    await admin.post(`/api/admin/applications/${id}/approve`).send({ initialPassword: 'administrator-known-password' }).expect(400)
    assert.equal(stored().status, 'pending')
    for (const query of ['page=0', 'page=1.5', 'page=-1', 'status=invalid', 'status[]=pending']) await admin.get(`/api/admin/applications?${query}`).expect(400)
    await admin.post(`/api/admin/applications/${id}/approve`).send({}).expect(200)
  })

})
