const assert = require('node:assert/strict')
const { afterEach, beforeEach, describe, it } = require('node:test')
const { createHash } = require('node:crypto')
const bcrypt = require('bcrypt')
const request = require('supertest')
const { generateSync } = require('otplib')
const { createApp } = require('../src/app')
const { createUser, findUserByEmail } = require('../src/db/users')
const { VERIFY_DISABLED_MESSAGE } = require('../src/routes/applications.routes')
const PASSWORD = 'test-password'
const NEW_PASSWORD = 'Private-Password-2026!'
const KEY = Buffer.alloc(32, 9).toString('base64')
const CANDIDATE = { email: 'candidate@example.com', nickname: '候选成员', reason: '小组成员申请' }
const GENERIC = '符合条件的申请会进入审核，审核结果通过邮件通知。'

describe('简化申请、审核与一次性激活 HTTP 闭环', () => {
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
  const workflow = id => database.prepare('SELECT * FROM access_workflow WHERE application_id = ?').get(id)
  async function activationToken() {
    await app.locals.accessLifecycle.tick()
    const message = messages.filter(item => item.to === CANDIDATE.email && item.text.includes('/activate#')).at(-1)
    assert.ok(message, '激活邮件必须发给申请人')
    const match = message.text.match(/https:\/\/club\.example\.com\/activate#token=([A-Za-z0-9_-]+)/)
    assert.ok(match, '激活链接使用 PUBLIC_ORIGIN 和 fragment')
    assert.equal(Buffer.from(match[1], 'base64url').length, 32)
    return match[1]
  }
  async function submittedId() {
    await submit().expect(202)
    return stored().id
  }
  const activationDigest = email => createHash('sha256').update(`omc:access:activation:${email}`).digest('hex')
  async function approved() {
    const id = await submittedId()
    await admin.post(`/api/admin/applications/${id}/approve`).send({}).expect(200)
    return { id, credential: await activationToken() }
  }
  function privateResponse(body) {
    assert.doesNotMatch(JSON.stringify(body), /candidate@example\.com|password_hash|token_hash|ciphertext|initialPassword/)
    assert.equal(body.user, undefined)
  }
  it('提交直接进入待审核，不签发验证凭证或验证邮件，可立即审核', async () => {
    const response = await submit({ email: ' CANDIDATE@EXAMPLE.COM ', nickname: ' 候选成员 ', reason: ' 申请理由 ', role: 'admin', status: 'approved' }).expect(202)
    assert.equal(response.body.success, true); assert.equal(response.body.message, GENERIC)
    for (const key of ['application', 'email', 'id']) assert.equal(response.body[key], undefined)
    const row = stored()
    assert.equal(row.status, 'pending'); assert.equal(row.nickname, '候选成员'); assert.equal(row.reason, '申请理由'); assert.equal(row.reviewed_by, null)
    assert.equal(workflow(row.id).verified_at, null); assert.equal(workflow(row.id).legacy_invited, 1)
    assert.equal(database.prepare('SELECT count(*) count FROM access_tokens').get().count, 0)
    assert.equal(database.prepare("SELECT count(*) count FROM access_mail_jobs WHERE kind='verify'").get().count, 0)
    assert.equal(database.prepare("SELECT count(*) count FROM access_mail_jobs WHERE kind='admin'").get().count, 1)
    assert.equal(messages.filter(item => item.to === CANDIDATE.email).length, 0)
    const rows = (await admin.get('/api/admin/applications?status=pending').expect(200)).body
    assert.equal(rows.total, 1)
    assert.equal(rows.applications[0].status, 'pending'); assert.equal(rows.applications[0].canReview, true)
    assert.equal(rows.applications[0].activationMailStatus, null); assert.equal(rows.applications[0].canResendActivation, false)
    privateResponse(rows)
    await admin.post(`/api/admin/applications/${row.id}/approve`).send({}).expect(200)
    assert.equal(stored().status, 'approved'); assert.equal(findUserByEmail(database, CANDIDATE.email), undefined)
    await app.locals.accessLifecycle.tick()
    const reminder = messages.find(item => item.to === 'admin@example.com')
    assert.ok(reminder); assert.doesNotMatch(reminder.text, /candidate@example\.com|申请理由|#token=/)
  })
  it('通过后只发激活链接，激活才创建 bcrypt 账号并记录本人确认', async () => {
    const { id, credential } = await approved()
    assert.equal(stored().status, 'approved'); assert.equal(findUserByEmail(database, CANDIDATE.email), undefined)
    assert.equal(workflow(id).verified_at, null)
    assert.equal(database.prepare("SELECT count(*) count FROM access_mail_jobs WHERE kind='verify'").get().count, 0)
    const visitor = request.agent(app)
    await visitor.post('/api/auth/login').send({ email: CANDIDATE.email, password: NEW_PASSWORD }).expect(401)
    privateResponse((await visitor.post('/api/auth/activate').send({ token: credential, password: NEW_PASSWORD }).expect(200)).body)
    await visitor.get('/api/protected').expect(401)
    const user = findUserByEmail(database, CANDIDATE.email)
    assert.equal(user.role, 'user'); assert.equal(user.must_change_password, 0); assert.equal(bcrypt.getRounds(user.password_hash), 12)
    assert.equal(await bcrypt.compare(NEW_PASSWORD, user.password_hash), true)
    const record = workflow(id)
    assert.equal(record.verified_at, clock); assert.equal(record.activated_at, clock)
    await visitor.post('/api/auth/login').send({ email: CANDIDATE.email, password: NEW_PASSWORD }).expect(200)
    await visitor.post('/api/auth/activate').send({ token: credential, password: NEW_PASSWORD }).expect(400)
    const activated = (await admin.get('/api/admin/applications?status=activated').expect(200)).body
    assert.equal(activated.total, 1); assert.equal(activated.applications[0].status, 'approved'); assert.ok(activated.applications[0].activatedAt)
    assert.equal(activated.applications[0].canResendActivation, false)
  })
  it('旧 pending 迁移后无需验证即可审核，旧验证凭证与任务被撤销且不补发邀请', async () => {
    const result = database.prepare('INSERT INTO access_requests(email,nickname,reason) VALUES(?,?,?)').run('legacy@example.com', '历史申请', '历史理由')
    const id = Number(result.lastInsertRowid)
    database.prepare('INSERT INTO access_workflow(application_id,verified_at,legacy_invited) VALUES(?,?,0)').run(id, null)
    const token = database.prepare('INSERT INTO access_tokens(application_id,purpose,digest,expires_at,created_at) VALUES(?,?,?,?,?)')
      .run(id, 'verify', 'a'.repeat(64), clock + 60000, clock)
    const job = database.prepare(`INSERT INTO access_mail_jobs(application_id,kind,token_id,ciphertext,status,subject,message_id,next_at,lease,lease_until,started_at,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, 'verify', Number(token.lastInsertRowid), 'encrypted-verify-token', 'queued', 'legacy-subject', '<legacy@example.com>', clock, 'legacy-lease', clock + 30000, clock, clock)
    await app.locals.accessLifecycle.migrateLegacy()
    await app.locals.accessLifecycle.migrateLegacy()
    assert.equal(workflow(id).legacy_invited, 1)
    assert.notEqual(database.prepare('SELECT consumed_at FROM access_tokens WHERE id=?').get(Number(token.lastInsertRowid)).consumed_at, null)
    const migratedJob = database.prepare('SELECT status,ciphertext,lease,lease_until FROM access_mail_jobs WHERE id=?').get(Number(job.lastInsertRowid))
    assert.equal(migratedJob.status, 'cancelled'); assert.equal(migratedJob.ciphertext, null)
    assert.equal(migratedJob.lease, null); assert.equal(migratedJob.lease_until, 0)
    assert.equal(database.prepare("SELECT count(*) count FROM access_mail_jobs WHERE kind='admin'").get().count, 0)
    await app.locals.accessLifecycle.tick()
    assert.equal(messages.filter(item => item.to === 'legacy@example.com').length, 0)
    assert.equal(messages.filter(item => item.to === 'admin@example.com').length, 0)
    const rows = (await admin.get('/api/admin/applications?status=pending').expect(200)).body
    assert.equal(rows.total, 1); assert.equal(rows.applications[0].canReview, true)
    await admin.post(`/api/admin/applications/${id}/approve`).send({}).expect(200)
    assert.equal(database.prepare('SELECT status FROM access_requests WHERE id=?').get(id).status, 'approved')
  })
  it('迁移也撤销旧版已标记邀请但尚未消费的验证凭证', async () => {
    const result = database.prepare('INSERT INTO access_requests(email,nickname,reason) VALUES(?,?,?)').run('already-invited@example.com', '已邀请历史申请', null)
    const id = Number(result.lastInsertRowid)
    database.prepare('INSERT INTO access_workflow(application_id,verified_at,legacy_invited) VALUES(?,?,1)').run(id, null)
    const token = database.prepare('INSERT INTO access_tokens(application_id,purpose,digest,expires_at,created_at) VALUES(?,?,?,?,?)')
      .run(id, 'verify', 'd'.repeat(64), clock + 60000, clock)
    const job = database.prepare(`INSERT INTO access_mail_jobs(application_id,kind,token_id,ciphertext,status,subject,message_id,next_at,lease,lease_until,started_at,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, 'verify', Number(token.lastInsertRowid), 'legacy-invited-cipher', 'queued', 'legacy-invited', '<legacy-invited@example.com>', clock, null, 0, clock, clock)
    await app.locals.accessLifecycle.migrateLegacy()
    assert.notEqual(database.prepare('SELECT consumed_at FROM access_tokens WHERE id=?').get(Number(token.lastInsertRowid)).consumed_at, null)
    assert.deepEqual(database.prepare('SELECT status,ciphertext,lease FROM access_mail_jobs WHERE id=?').get(Number(job.lastInsertRowid)), { status: 'cancelled', ciphertext: null, lease: null })
    await app.locals.accessLifecycle.tick()
    assert.equal(messages.filter(item => item.to === 'already-invited@example.com').length, 0)
    assert.equal(messages.filter(item => item.to === 'admin@example.com').length, 0)
    assert.equal(database.prepare("SELECT count(*) count FROM access_mail_jobs WHERE kind='admin'").get().count, 0)
  })
  it('旧 pending 即使没有验证送达证据也可审核', async () => {
    const result = database.prepare('INSERT INTO access_requests(email,nickname,reason) VALUES(?,?,?)').run('never-verified@example.com', '未验证历史申请', null)
    const id = Number(result.lastInsertRowid)
    database.prepare('INSERT INTO access_workflow(application_id,verified_at,legacy_invited) VALUES(?,?,0)').run(id, null)
    await app.locals.accessLifecycle.migrateLegacy()
    const rows = (await admin.get('/api/admin/applications?status=pending').expect(200)).body
    const target = rows.applications.find(item => item.id === id)
    assert.ok(target); assert.equal(target.canReview, true); assert.equal(target.emailVerified, false)
    await admin.post(`/api/admin/applications/${id}/approve`).send({}).expect(200)
  })
  it('申请频率限制沿用旧邮箱摘要，升级前额度仍然生效', async () => {
    database.prepare('INSERT INTO access_resend_limits(email_digest,last_at,window_at,count) VALUES(?,?,?,1)')
      .run(createHash('sha256').update(CANDIDATE.email).digest('hex'), clock, clock)
    await submit().expect(202)
    assert.equal(database.prepare('SELECT count(*) count FROM access_requests').get().count, 0)
    clock += 61000
    await submit().expect(202)
    assert.equal(database.prepare('SELECT count(*) count FROM access_requests').get().count, 1)
  })
  it('非法申请不产生数据库申请与邮件', async () => {
    for (const fields of [{ email: undefined }, { email: 'invalid' }, { nickname: '  ' }, { nickname: undefined }, { reason: 42 }]) await submit(fields).expect(400)
    assert.equal(database.prepare('SELECT count(*) count FROM access_requests').get().count, 0); assert.equal(messages.length, 0)
  })
  it('verify API 停用并返回固定 410，不消费凭证也不改变审核资格', async () => {
    const id = await submittedId()
    for (const method of ['post', 'get']) {
      const response = await request(app)[method]('/api/applications/verify-email').send({ token: 'invalid-token' }).expect(410)
      assert.equal(response.body.success, false); assert.equal(response.body.message, VERIFY_DISABLED_MESSAGE)
      assert.doesNotMatch(JSON.stringify(response.body), /invalid-token|sqlite|stack/)
    }
    assert.equal(stored().status, 'pending'); assert.equal(workflow(id).verified_at, null)
    assert.equal((await admin.get('/api/admin/applications?status=pending').expect(200)).body.total, 1)
  })
  it('公开 resend 仅允许 activate，verify 用途返回 400', async () => {
    await submit().expect(202)
    const verify = await request(app).post('/api/applications/resend').send({ email: CANDIDATE.email, purpose: 'verify' }).expect(400)
    assert.match(verify.body.message, /无需验证邮箱/)
    await request(app).post('/api/applications/resend').send({ email: 'invalid', purpose: 'activate' }).expect(400)
    await request(app).post('/api/applications/resend').send({ email: CANDIDATE.email, purpose: 'other' }).expect(400)
  })
  it('未批准或未知邮箱的公开重发不消耗激活额度，审批仍原子生成激活任务', async () => {
    await submit().expect(202)
    const id = stored().id
    for (let index = 0; index < 6; index++) {
      clock += 61000
      await request(app).post('/api/applications/resend').send({ email: CANDIDATE.email, purpose: 'activate' }).expect(202)
    }
    clock += 61000
    await request(app).post('/api/applications/resend').send({ email: 'missing@example.com', purpose: 'activate' }).expect(202)
    assert.equal(database.prepare('SELECT count(*) count FROM access_resend_limits WHERE email_digest=?').get(activationDigest(CANDIDATE.email)).count, 0)
    assert.equal(database.prepare('SELECT count(*) count FROM access_resend_limits WHERE email_digest=?').get(activationDigest('missing@example.com')).count, 0)
    await admin.post(`/api/admin/applications/${id}/approve`).send({}).expect(200)
    assert.equal(database.prepare("SELECT count(*) count FROM access_mail_jobs WHERE kind='activate'").get().count, 1)
    assert.equal(database.prepare("SELECT count(*) count FROM access_tokens WHERE purpose='activate'").get().count, 1)
  })
  it('激活邮件额度不可用时审批回滚，不产生无激活任务的已通过状态', async () => {
    await submit().expect(202)
    const id = stored().id
    database.prepare('INSERT INTO access_resend_limits(email_digest,last_at,window_at,count) VALUES(?,?,?,5)')
      .run(activationDigest(CANDIDATE.email), clock, clock)
    const failed = await admin.post(`/api/admin/applications/${id}/approve`).send({}).expect(429)
    assert.equal(failed.body.success, false)
    const row = stored()
    assert.equal(row.status, 'pending'); assert.equal(row.reviewed_at, null); assert.equal(row.reviewed_by, null)
    assert.equal(database.prepare("SELECT count(*) count FROM access_mail_jobs WHERE kind='activate'").get().count, 0)
    assert.equal(database.prepare("SELECT count(*) count FROM access_tokens WHERE purpose='activate'").get().count, 0)
    clock += 24 * 60 * 60000 + 1
    await admin.post(`/api/admin/applications/${id}/approve`).send({}).expect(200)
    assert.equal(stored().status, 'approved')
    assert.equal(database.prepare("SELECT count(*) count FROM access_mail_jobs WHERE kind='activate'").get().count, 1)
    assert.equal(database.prepare("SELECT count(*) count FROM access_tokens WHERE purpose='activate'").get().count, 1)
  })
  it('激活任务入队失败时审批整体回滚，不残留 Token 或审核记录', async () => {
    await submit().expect(202)
    const id = stored().id
    database.exec("CREATE TRIGGER fail_activation_job BEFORE INSERT ON access_mail_jobs WHEN NEW.kind='activate' BEGIN SELECT RAISE(ABORT, 'isolated-enqueue-failure'); END")
    const failed = await admin.post(`/api/admin/applications/${id}/approve`).send({}).expect(500)
    assert.doesNotMatch(JSON.stringify(failed.body), /isolated-enqueue-failure|sqlite|stack/)
    const row = stored()
    assert.equal(row.status, 'pending'); assert.equal(row.reviewed_at, null); assert.equal(row.reviewed_by, null)
    assert.equal(database.prepare("SELECT count(*) count FROM access_tokens WHERE purpose='activate'").get().count, 0)
    assert.equal(database.prepare("SELECT count(*) count FROM access_mail_jobs WHERE kind='activate'").get().count, 0)
    database.exec('DROP TRIGGER fail_activation_job')
    await admin.post(`/api/admin/applications/${id}/approve`).send({}).expect(200)
    assert.equal(stored().status, 'approved')
    assert.equal(database.prepare("SELECT count(*) count FROM access_tokens WHERE purpose='activate'").get().count, 1)
    assert.equal(database.prepare("SELECT count(*) count FROM access_mail_jobs WHERE kind='activate'").get().count, 1)
  })
  it('公开重发撤销旧激活链接，未知邮箱及冷却响应保持统一提示', async () => {
    const { id, credential } = await approved()
    clock += 61000
    const resent = await request(app).post('/api/applications/resend').send({ email: CANDIDATE.email, purpose: 'activate' }).expect(202)
    assert.deepEqual(resent.body, { success: true, message: GENERIC })
    await app.locals.accessLifecycle.tick()
    const replacement = messages.filter(item => item.to === CANDIDATE.email && item.text.includes('/activate#')).at(-1)
      .text.match(/#token=([A-Za-z0-9_-]+)/)[1]
    assert.notEqual(credential, replacement)
    await request(app).post('/api/auth/activate').send({ token: credential, password: NEW_PASSWORD }).expect(400)
    for (const email of ['missing@example.com', CANDIDATE.email]) {
      const response = await request(app).post('/api/applications/resend').send({ email, purpose: 'activate' }).expect(202)
      assert.deepEqual(response.body, resent.body)
    }
    assert.equal(workflow(id).activated_at, null)
  })
  it('激活密码严格为 8～72 位且四类字符齐全，失败不消费 Token', async () => {
    const { credential } = await approved()
    const invalid = [
      'Abc1!xy', // 7 位
      'Aa1!' + 'x'.repeat(69), // 73 位
      'abcdef1!', // 缺大写
      'ABCDEF1!', // 缺小写
      'Abcdefg!', // 缺数字
      'Abcdefg1', // 缺符号
      'Abcdef1 !', // 空格
      ' Abcdef1!', // 前导空格不得被 trim 成合法密码
      'Abcdef1! ', // 末尾空格同样拒绝
      'Abcdef1!\n', // 换行
      'Abcdef1!\t', // 控制字符
      'Abcdef1!\u0000', // NUL
      'Abcdef1!\u007f', // DEL
      'Abcdef1!中', // 中文
      'Aa1!' + 'x'.repeat(67) + '中', // 长度在 72 位内但含中文，仍须拒绝
      'Abcdef1!😀', // 其他 Unicode
      null,
      undefined,
      12345678,
    ]
    for (const password of invalid) {
      const response = await request(app).post('/api/auth/activate').send({ token: credential, password }).expect(400)
      assert.match(response.body.message, /8～72 位/)
      assert.doesNotMatch(JSON.stringify(response.body), /字节|UTF-?8/)
      assert.equal(findUserByEmail(database, CANDIDATE.email), undefined)
      assert.equal(database.prepare("SELECT count(*) count FROM access_tokens WHERE purpose='activate' AND consumed_at IS NULL").get().count, 1)
    }
    // 恰好 8 位的合规密码可以激活，并可用同一密码正常登录。
    await request(app).post('/api/auth/activate').send({ token: credential, password: 'Abcdef1!' }).expect(200)
    const user = findUserByEmail(database, CANDIDATE.email)
    assert.equal(await bcrypt.compare('Abcdef1!', user.password_hash), true)
    await request(app).post('/api/auth/login').send({ email: CANDIDATE.email, password: 'Abcdef1!' }).expect(200)
  })
  it('72 位合规密码可激活，73 位被拒绝且不消费 Token', async () => {
    const { credential } = await approved()
    const maximum = 'Aa1!' + 'x'.repeat(68)
    assert.equal(maximum.length, 72)
    await request(app).post('/api/auth/activate').send({ token: credential, password: `${maximum}x` }).expect(400)
    assert.equal(findUserByEmail(database, CANDIDATE.email), undefined)
    assert.equal(database.prepare("SELECT count(*) count FROM access_tokens WHERE purpose='activate' AND consumed_at IS NULL").get().count, 1)
    await request(app).post('/api/auth/activate').send({ token: credential, password: maximum }).expect(200)
    const user = findUserByEmail(database, CANDIDATE.email)
    assert.equal(bcrypt.getRounds(user.password_hash), 12)
    assert.equal(await bcrypt.compare(maximum, user.password_hash), true)
    await request(app).post('/api/auth/login').send({ email: CANDIDATE.email, password: maximum }).expect(200)
  })
  it('并发审批只允许一个结果，不能覆盖审核记录', async () => {
    const id = await submittedId()
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
  it('激活 24 小时后过期，重发激活无需重新审核', async () => {
    const { id, credential } = await approved()
    clock += 24 * 60 * 60000 + 1
    await request(app).post('/api/auth/activate').send({ token: credential, password: NEW_PASSWORD }).expect(400)
    await request(app).post('/api/applications/resend').send({ email: CANDIDATE.email, purpose: 'activate' }).expect(202)
    await app.locals.accessLifecycle.tick()
    const replacement = messages.filter(item => item.to === CANDIDATE.email && item.text.includes('/activate#')).at(-1)
      .text.match(/#token=([A-Za-z0-9_-]+)/)[1]
    assert.equal(workflow(id).activated_at, null)
    await request(app).post('/api/auth/activate').send({ token: replacement, password: NEW_PASSWORD }).expect(200)
  })
  it('拒绝后七天冷却，不发送激活链接也不能借重发修改资料', async () => {
    const id = await submittedId()
    await admin.post(`/api/admin/applications/${id}/reject`).send({}).expect(200)
    await app.locals.accessLifecycle.tick()
    const rejection = messages.filter(item => item.to === CANDIDATE.email).at(-1)
    assert.doesNotMatch(rejection.text, /#token=|initial-password/)
    await submit({ nickname: '被篡改' })
    assert.equal(stored().status, 'rejected'); assert.equal(stored().nickname, CANDIDATE.nickname)
    await request(app).post('/api/applications/resend').send({ email: CANDIDATE.email, purpose: 'activate' }).expect(202)
    assert.equal(database.prepare("SELECT count(*) count FROM access_mail_jobs WHERE kind='activate'").get().count, 0)
    clock += 7 * 24 * 60 * 60000 + 1
    await submit().expect(202)
    assert.equal(stored().status, 'pending'); assert.equal(findUserByEmail(database, CANDIDATE.email), undefined)
  })
  it('后台 DTO 统一状态并只暴露激活邮件状态，不返回邮箱或凭证', async () => {
    const { id } = await approved()
    // 首次 tick 发送并接受，再推进冷却让模拟投递查询确认送达。
    clock += 10001
    await app.locals.accessLifecycle.tick()
    // 更晚的管理员提醒即使失败也不能覆盖激活邮件状态。
    database.prepare(`INSERT INTO access_mail_jobs(application_id,kind,status,subject,message_id,next_at,started_at,created_at)
      VALUES(?,'admin','failed',?,?,?,?,?)`).run(id, 'newer-admin-reminder', '<newer@example.com>', clock, clock, clock)
    const response = await admin.get('/api/admin/applications?status=awaiting_activation&page=1').expect(200)
    const application = response.body.applications[0]
    assert.equal(response.body.page, 1); assert.equal(response.body.pageSize, 20); privateResponse(response.body)
    assert.deepEqual(Object.keys(application).sort(), ['id', 'nickname', 'reason', 'status', 'canReview', 'canResendActivation', 'activationMailStatus', 'notificationStatus', 'emailVerified', 'createdAt', 'reviewedAt', 'reviewedBy', 'activatedAt'].sort())
    assert.equal(application.status, 'approved'); assert.equal(application.canReview, false)
    assert.equal(application.activationMailStatus, 'delivered')
    assert.equal(application.canResendActivation, true)
    assert.equal(application.emailVerified, false)
    assert.match(application.createdAt, /T.*Z$/)
    assert.equal(new Date(application.createdAt).getTime(), Date.parse(`${stored().created_at.replace(' ', 'T')}Z`))
  })
  it('管理员补发接口校验权限与状态，成功签发新 Token 且保留原审核记录', async () => {
    const id = await submittedId()
    await admin.post(`/api/admin/applications/${id}/approve`).send({}).expect(200)
    const reviewed = stored()
    const first = await activationToken()
    clock += 61000
    const response = await admin.post(`/api/admin/applications/${id}/resend-activation`).send({}).expect(200)
    privateResponse(response.body)
    assert.equal(response.body.application.id, id); assert.equal(response.body.application.status, 'approved')
    assert.equal(response.body.application.canResendActivation, true)
    const after = stored()
    assert.equal(after.reviewed_by, reviewed.reviewed_by); assert.equal(after.reviewed_at, reviewed.reviewed_at)
    await app.locals.accessLifecycle.tick()
    const replacement = messages.filter(item => item.to === CANDIDATE.email && item.text.includes('/activate#')).at(-1)
      .text.match(/#token=([A-Za-z0-9_-]+)/)[1]
    assert.notEqual(first, replacement)
    await request(app).post('/api/auth/activate').send({ token: first, password: NEW_PASSWORD }).expect(400)
    await request(app).post('/api/auth/activate').send({ token: replacement, password: NEW_PASSWORD }).expect(200)
  })
  it('并发补发只有一个成功，429 不撤销已签发的新链接', async () => {
    const id = await submittedId()
    await admin.post(`/api/admin/applications/${id}/approve`).send({}).expect(200)
    const first = await activationToken()
    clock += 61000
    const results = await Promise.all([
      admin.post(`/api/admin/applications/${id}/resend-activation`).send({}),
      admin.post(`/api/admin/applications/${id}/resend-activation`).send({}),
    ])
    assert.deepEqual(results.map(item => item.status).sort(), [200, 429])
    const active = database.prepare("SELECT digest FROM access_tokens WHERE purpose='activate' AND consumed_at IS NULL").all()
    assert.equal(active.length, 1)
    assert.notEqual(active[0].digest, createHash('sha256').update(first).digest('hex'))
  })
  it('管理员补发拒绝不存在、未通过、已激活、已拒绝及带参数请求', async () => {
    await admin.post('/api/admin/applications/999999/resend-activation').send({}).expect(404)
    const pending = await submittedId()
    await admin.post(`/api/admin/applications/${pending}/resend-activation`).send({}).expect(409)
    await admin.post(`/api/admin/applications/${pending}/resend-activation`).send({ email: 'x@example.com' }).expect(400)
    await admin.post('/api/admin/applications/not-a-number/resend-activation').send({}).expect(400)
    const { id } = await approved()
    clock += 61000
    await admin.post(`/api/admin/applications/${id}/resend-activation`).send({}).expect(200)
    await request(app).post('/api/auth/activate').send({ token: await activationToken(), password: NEW_PASSWORD }).expect(200)
    await admin.post(`/api/admin/applications/${id}/resend-activation`).send({}).expect(409)
    const rejected = database.prepare("INSERT INTO access_requests(email,nickname,status,reviewed_at) VALUES(?,?,?,?)")
      .run('rejected@example.com', '已拒绝申请', 'rejected', new Date(clock).toISOString())
    const rejectedId = Number(rejected.lastInsertRowid)
    database.prepare('INSERT INTO access_workflow(application_id,verified_at,activated_at,legacy_invited) VALUES(?,0,NULL,1)').run(rejectedId)
    await admin.post(`/api/admin/applications/${rejectedId}/resend-activation`).send({}).expect(409)
  })
  it('首次审批激活邮件不受申请提交 60 秒冷却影响，随后补发受共享额度约束', async () => {
    await submit().expect(202)
    const id = stored().id
    // 同一时刻审批：申请命名空间的 60 秒冷却不能阻塞首次激活邮件。
    await admin.post(`/api/admin/applications/${id}/approve`).send({}).expect(200)
    assert.equal(database.prepare("SELECT count(*) count FROM access_mail_jobs WHERE kind='activate'").get().count, 1)
    const first = await activationToken()
    await admin.post(`/api/admin/applications/${id}/resend-activation`).send({}).expect(429)
    // 429 不能撤销仍可用的旧链接。
    const active = database.prepare("SELECT digest,consumed_at FROM access_tokens WHERE purpose='activate' AND consumed_at IS NULL").get()
    assert.ok(active); assert.equal(active.consumed_at, null)
    assert.equal(active.digest, createHash('sha256').update(first).digest('hex'))
    clock += 61000
    await admin.post(`/api/admin/applications/${id}/resend-activation`).send({}).expect(200)
    await app.locals.accessLifecycle.tick()
    const replacement = messages.filter(item => item.to === CANDIDATE.email && item.text.includes('/activate#')).at(-1)
      .text.match(/#token=([A-Za-z0-9_-]+)/)[1]
    await request(app).post('/api/auth/activate').send({ token: first, password: NEW_PASSWORD }).expect(400)
    await request(app).post('/api/auth/activate').send({ token: replacement, password: NEW_PASSWORD }).expect(200)
  })
  it('公开与管理员补发共享每邮箱额度，跨入口不能绕过 24 小时五次上限', async () => {
    const { id } = await approved()
    await app.locals.accessLifecycle.tick()
    // 审批首次激活邮件占用第 1 次；公开入口再重发 4 次达到当日上限。
    for (let index = 0; index < 4; index++) {
      clock += 61000
      await request(app).post('/api/applications/resend').send({ email: CANDIDATE.email, purpose: 'activate' }).expect(202)
      await app.locals.accessLifecycle.tick()
    }
    const before = database.prepare("SELECT id,digest FROM access_tokens WHERE purpose='activate' AND consumed_at IS NULL ORDER BY id DESC LIMIT 1").get()
    const tokenCount = database.prepare('SELECT count(*) count FROM access_tokens WHERE purpose=\'activate\'').get().count
    clock += 61000
    await admin.post(`/api/admin/applications/${id}/resend-activation`).send({}).expect(429)
    const after = database.prepare("SELECT id,digest FROM access_tokens WHERE purpose='activate' AND consumed_at IS NULL ORDER BY id DESC LIMIT 1").get()
    assert.deepEqual(after, before)
    assert.equal(database.prepare('SELECT count(*) count FROM access_tokens WHERE purpose=\'activate\'').get().count, tokenCount)
    clock += 24 * 60 * 60000
    await admin.post(`/api/admin/applications/${id}/resend-activation`).send({}).expect(200)
  })
  it('后台通知异常只按当前业务相关邮件判断，管理员提醒失败不混淆待审申请', async () => {
    // 待审申请只有管理员提醒失败：不属于用户通知异常。
    await submit().expect(202)
    const pendingId = stored().id
    database.prepare("UPDATE access_mail_jobs SET status='failed' WHERE application_id=? AND kind='admin'").run(pendingId)
    assert.equal((await admin.get('/api/admin/applications?status=notification_error').expect(200)).body.total, 0)
    // 已通过申请的最新激活邮件失败：属于通知异常。
    await admin.post(`/api/admin/applications/${pendingId}/approve`).send({}).expect(200)
    database.prepare("UPDATE access_mail_jobs SET status='failed' WHERE application_id=? AND kind='activate'").run(pendingId)
    assert.equal((await admin.get('/api/admin/applications?status=notification_error').expect(200)).body.total, 1)
    // 已拒绝只看最新拒绝通知；更晚的已送达记录会清除异常，管理员提醒不参与判断。
    const rejected = database.prepare("INSERT INTO access_requests(email,nickname,status,reviewed_at) VALUES(?,?,?,?)")
      .run('rejected-filter@example.com', '拒绝通知筛选', 'rejected', new Date(clock).toISOString())
    const rejectedId = Number(rejected.lastInsertRowid)
    database.prepare('INSERT INTO access_workflow(application_id,verified_at,activated_at,legacy_invited) VALUES(?,0,NULL,1)').run(rejectedId)
    database.prepare(`INSERT INTO access_mail_jobs(application_id,kind,status,subject,message_id,next_at,started_at,created_at)
      VALUES(?,'rejected','failed',?,?,?,?,?)`).run(rejectedId, 'rejected-failed', '<rej-failed@example.com>', clock, clock, clock)
    assert.equal((await admin.get('/api/admin/applications?status=notification_error').expect(200)).body.total, 2)
    database.prepare(`INSERT INTO access_mail_jobs(application_id,kind,status,subject,message_id,next_at,started_at,created_at)
      VALUES(?,'rejected','delivered',?,?,?,?,?)`).run(rejectedId, 'rejected-delivered', '<rej-ok@example.com>', clock, clock, clock)
    assert.equal((await admin.get('/api/admin/applications?status=notification_error').expect(200)).body.total, 1)
  })
  it('访客、普通成员与未完成 2FA 的管理员不能读写后台或补发', async () => {
    const id = await submittedId()
    const unverified = request.agent(app)
    createUser(database, { email: 'unenrolled@example.com', nickname: '未绑定管理员', passwordHash: await bcrypt.hash(PASSWORD, 4), role: 'admin', status: 'active', mustChangePassword: false })
    const unenrolled = request.agent(app)
    await unenrolled.post('/api/auth/login').send({ email: 'unenrolled@example.com', password: PASSWORD }).expect(200)
    await unverified.post('/api/auth/login').send({ email: 'admin@example.com', password: PASSWORD }).expect(200)
    for (const client of [request(app), member, unverified, unenrolled]) {
      const responses = [
        await client.get('/api/admin/applications'),
        await client.post(`/api/admin/applications/${id}/approve`).send({}),
        await client.post(`/api/admin/applications/${id}/reject`).send({}),
        await client.post(`/api/admin/applications/${id}/resend-activation`).send({}),
      ]
      for (const response of responses) assert.ok([401, 403].includes(response.status), `意外状态 ${response.status}`)
    }
    assert.equal(stored().status, 'pending')
  })
  it('CSRF 覆盖全部新写接口并拒绝跨站来源', async () => {
    app.locals.security.csrfEnabled = true
    for (const route of ['/api/applications', '/api/applications/verify-email', '/api/applications/resend', '/api/auth/activate', '/api/admin/applications/1/resend-activation']) {
      await request(app).post(route).send({ ...CANDIDATE, token: 'invalid', password: NEW_PASSWORD, purpose: 'activate' }).expect(403)
      await request(app).post(route).set('Origin', 'https://evil.example').send({}).expect(403)
    }
    const visitor = request.agent(app), csrf = await visitor.get('/api/security/csrf-token').expect(200)
    await visitor.post('/api/applications').set('Origin', 'https://club.example.com').set('X-CSRF-Token', csrf.body.csrfToken).send(CANDIDATE).expect(202)
  })
  it('Host 伪造不影响激活邮件链接且敏感接口禁止缓存', async () => {
    const response = await request(app).post('/api/applications').set('Host', 'evil.example').send(CANDIDATE).expect(202)
    assert.match(response.headers['cache-control'], /no-store/)
    await admin.post(`/api/admin/applications/${stored().id}/approve`).send({}).expect(200)
    await activationToken()
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
    const id = await submittedId()
    await admin.post(`/api/admin/applications/${id}/approve`).send({ initialPassword: 'administrator-known-password' }).expect(400)
    assert.equal(stored().status, 'pending')
    for (const query of ['page=0', 'page=1.5', 'page=-1', 'status=invalid', 'status=awaiting_verification', 'status[]=pending']) await admin.get(`/api/admin/applications?${query}`).expect(400)
    await admin.post(`/api/admin/applications/${id}/approve`).send({}).expect(200)
  })
})
