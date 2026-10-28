const assert = require('node:assert/strict')
const { afterEach, beforeEach, describe, it } = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const request = require('supertest')
const { createHash } = require('node:crypto')
const { createApp } = require('../src/app')
const { initializeSchema } = require('../src/db/database')
const { createUser, findUserByEmail } = require('../src/db/users')
const KEY = Buffer.alloc(32, 13).toString('base64')
const CANDIDATE = { email: 'candidate@example.com', nickname: '候选成员', reason: '私密申请理由' }
const NEW_PASSWORD = 'Private-Password-2026!'

describe('简化流程的自动邮件任务与持久化恢复', () => {
  let directory, apps, sent, checks, clock, sendError, delivery, logs
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'omc-access-mail-'))
    apps = []; sent = []; checks = []; logs = []; clock = 1800000000000; sendError = null; delivery = 'pending'
  })
  afterEach(() => {
    for (const app of apps) { app.locals.accessLifecycle?.stop(); if (app.locals.database.open) app.locals.database.close(); app.locals.sessionStore.stopInterval?.() }
    fs.rmSync(directory, { recursive: true, force: true })
  })
  function build({ mail = {}, security = {}, filename = 'database.sqlite' } = {}) {
    const app = createApp({ databasePath: path.join(directory, filename), sessionSecret: 'mail-queue-isolated-test',
      security: { publicOrigin: 'https://club.example.com', logger: { info: value => logs.push(value), warn: value => logs.push(value), error: value => logs.push(value) }, ...security },
      mail: { now: () => clock,
        env: { MAIL_ENABLED: 'true', SMTP_HOST: 'smtp.example.com', MAIL_FROM: 'club@example.com', MAIL_ADMIN_TO: 'admin@example.com', APPLICATION_MAIL_ENCRYPTION_KEY: KEY },
        transport: { async sendMail(message) {
          // 发信前事务必须提交，独立数据库连接能读取申请与任务。
          const { createDatabase } = require('../src/db/database')
          const reader = createDatabase(path.join(directory, filename))
          try { assert.ok(reader.prepare('SELECT count(*) count FROM access_requests').get().count >= 1); assert.ok(reader.prepare('SELECT count(*) count FROM access_mail_jobs').get().count >= 1) } finally { reader.close() }
          sent.push(message)
          if (sendError) throw sendError
          return { accepted: [message.to] }
        } },
        deliveryClient: { configured: true, async check(query) { checks.push(query); if (delivery instanceof Error) throw delivery; return delivery } },
        ...mail,
      },
    })
    apps.push(app); return app
  }
  const submit = app => request(app).post('/api/applications').send(CANDIDATE)
  const applicationId = app => app.locals.database.prepare('SELECT id FROM access_requests ORDER BY id DESC LIMIT 1').get().id
  const approve = (app, id, approved = true) => app.locals.accessLifecycle.review(id, null, approved)
  const activationLink = () => sent.filter(message => message.to === CANDIDATE.email && message.text.includes('/activate#')).at(-1)
  const credential = () => activationLink().text.match(/#token=([A-Za-z0-9_-]+)/)[1]

  it('缺少邮件、加密密钥或站点配置时安全关闭且不落库', async () => {
    const variations = [
      { mail: { env: { MAIL_ENABLED: 'false' } } },
      { mail: { env: { MAIL_ENABLED: 'true', SMTP_HOST: 'smtp.example.com', MAIL_FROM: 'club@example.com', MAIL_ADMIN_TO: 'admin@example.com' } } },
      { security: { publicOrigin: '' } },
    ]
    for (let index = 0; index < variations.length; index++) {
      const app = build({ ...variations[index], filename: `missing-${index}.sqlite` })
      await submit(app).expect(503)
      assert.equal(app.locals.database.prepare('SELECT count(*) count FROM access_requests').get().count, 0)
    }
    assert.equal(sent.length, 0)
  })
  it('提交只入队管理员提醒，不生成验证邮件；审批后只入队激活邮件', async () => {
    const app = build()
    const response = await submit(app).expect(202)
    assert.equal(response.body.success, true); assert.equal(sent.length, 0)
    const db = app.locals.database
    assert.equal(db.prepare("SELECT count(*) count FROM access_mail_jobs WHERE kind='verify'").get().count, 0)
    assert.equal(db.prepare("SELECT count(*) count FROM access_mail_jobs WHERE kind='admin'").get().count, 1)
    await app.locals.accessLifecycle.tick()
    assert.equal(sent.length, 1); assert.equal(sent[0].to, 'admin@example.com')
    assert.doesNotMatch(sent[0].text, /candidate@example\.com|私密申请理由|#token=/)
    assert.equal(checks.length <= 1, true)
    await approve(app, applicationId(app))
    assert.equal(db.prepare("SELECT count(*) count FROM access_mail_jobs WHERE kind='activate'").get().count, 1)
    await app.locals.accessLifecycle.tick()
    const activation = activationLink()
    assert.ok(activation); assert.equal(activation.to, CANDIDATE.email)
    assert.equal(activation.disableFileAccess, true); assert.equal(activation.disableUrlAccess, true)
    assert.doesNotMatch(activation.text, /私密申请理由/)
    assert.match(activation.text, /24 小时内/)
    assert.equal(db.prepare("SELECT count(*) count FROM access_mail_jobs WHERE kind='verify'").get().count, 0)
  })
  it('激活凭证只存摘要，任务密文在发送后清除且日志没有敏感内容', async () => {
    const app = build(); await submit(app).expect(202)
    const db = app.locals.database
    const applicationIdValue = applicationId(app)
    await approve(app, applicationIdValue)
    const before = JSON.stringify(db.prepare('SELECT * FROM access_mail_jobs').all())
    assert.doesNotMatch(before, /#token=/)
    const encoded = db.prepare("SELECT ciphertext FROM access_mail_jobs WHERE kind='activate'").get().ciphertext
    assert.ok(encoded); assert.doesNotMatch(encoded, /#token=/)
    await app.locals.accessLifecycle.tick()
    const token = credential()
    const tokens = JSON.stringify(db.prepare('SELECT * FROM access_tokens').all())
    assert.equal(tokens.includes(token), false)
    assert.equal(tokens.includes(createHash('sha256').update(token).digest('hex')), true)
    const jobs = JSON.stringify(db.prepare('SELECT * FROM access_mail_jobs').all())
    assert.equal(jobs.includes(token), false)
    assert.equal(db.prepare("SELECT ciphertext FROM access_mail_jobs WHERE kind='activate'").get().ciphertext, null)
    assert.doesNotMatch(JSON.stringify(logs), /candidate@example\.com|私密申请理由|#token=|smtp-password|private\/database/)
  })
  it('并发 worker 通过数据库领取资格仅发送一次', async () => {
    const first = build(); await submit(first).expect(202)
    const second = build()
    await Promise.all([first.locals.accessLifecycle.tick(), second.locals.accessLifecycle.tick()])
    assert.equal(sent.filter(message => message.to === 'admin@example.com').length, 1)
  })
  it('服务重启恢复未发送任务且不创建第二份申请', async () => {
    const first = build(); await submit(first).expect(202)
    first.locals.accessLifecycle.stop(); first.locals.database.close()
    const restarted = build()
    await restarted.locals.accessLifecycle.tick()
    assert.equal(sent.length, 1); assert.equal(sent[0].to, 'admin@example.com')
    assert.equal(restarted.locals.database.prepare('SELECT count(*) count FROM access_requests').get().count, 1)
  })
  it('明确 SMTP 失败按冷却重试，未知 DATA 失败不盲目重发且响应日志脱敏', async () => {
    const app = build()
    sendError = Object.assign(new Error('smtp-password /private/database.sqlite candidate@example.com'), { code: 'EAUTH' })
    const response = await submit(app).expect(202)
    await app.locals.accessLifecycle.tick(); assert.equal(sent.length, 1)
    await app.locals.accessLifecycle.tick(); assert.equal(sent.length, 1)
    clock += 60001; sendError = null
    await app.locals.accessLifecycle.tick(); assert.equal(sent.length, 2)
    assert.doesNotMatch(JSON.stringify(response.body) + JSON.stringify(logs), /smtp-password|private\/database|candidate@example\.com/)
    // 已接受后即使投递状态迟迟未明确，也不会再次发送相同任务。
    clock += 60 * 60000
    delivery = new Error('upstream-secret /private/database.sqlite')
    await app.locals.accessLifecycle.tick(); assert.equal(sent.length, 2)
  })
  it('DATA 后网络断开标为未知，后续仅查询而不重复发送', async () => {
    const app = build()
    sendError = Object.assign(new Error('smtp DATA timeout secret'), { code: 'ETIMEDOUT', command: 'DATA' })
    await submit(app).expect(202); await app.locals.accessLifecycle.tick()
    assert.equal(sent.length, 1)
    sendError = null
    clock += 10001
    await app.locals.accessLifecycle.tick()
    assert.equal(app.locals.database.prepare('SELECT status FROM access_mail_jobs').get().status, 'unknown')
    for (let index = 0; index < 4; index++) { clock += 16 * 60000; await app.locals.accessLifecycle.tick() }
    assert.equal(sent.length, 1)
    assert.doesNotMatch(JSON.stringify(logs), /smtp DATA|secret/)
  })
  it('历史迁移保留编号、审核记录、账号与激活链接，只撤销验证凭证且幂等', async () => {
    const app = build(), db = app.locals.database
    const pending = db.prepare('INSERT INTO access_requests(email,nickname,reason) VALUES(?,?,?)').run('legacy-pending@example.com', '历史待审', '历史理由')
    const pendingId = Number(pending.lastInsertRowid)
    db.prepare('INSERT INTO access_workflow(application_id,verified_at,legacy_invited) VALUES(?,0,0)').run(pendingId)
    const verifyToken = db.prepare('INSERT INTO access_tokens(application_id,purpose,digest,expires_at,created_at) VALUES(?,?,?,?,?)')
      .run(pendingId, 'verify', 'b'.repeat(64), clock + 60000, clock)
    db.prepare(`INSERT INTO access_mail_jobs(application_id,kind,token_id,ciphertext,status,subject,message_id,next_at,lease,lease_until,started_at,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(pendingId, 'verify', Number(verifyToken.lastInsertRowid), 'legacy-verify-cipher', 'queued', 'legacy-verify', '<legacy-verify@example.com>', clock, 'legacy-lease', clock + 30000, clock, clock)
    // 历史已通过申请：既有账号和激活链接必须保留。
    createUser(db, { email: 'legacy-approved@example.com', nickname: '历史成员', passwordHash: 'x', role: 'user', status: 'active', mustChangePassword: false })
    const approved = db.prepare("INSERT INTO access_requests(email,nickname,status,reviewed_by,reviewed_at) VALUES(?,?,'approved',NULL,?)")
      .run('legacy-approved@example.com', '历史成员', new Date(clock).toISOString())
    const approvedId = Number(approved.lastInsertRowid)
    // 旧版可能已置过 legacy_invited=1，但仍残留 verify 凭证；它也必须被清理，且不能影响该申请的激活链接。
    db.prepare('INSERT INTO access_workflow(application_id,verified_at,activated_at,legacy_invited) VALUES(?,?,?,1)').run(approvedId, clock, null)
    const approvedVerifyToken = db.prepare('INSERT INTO access_tokens(application_id,purpose,digest,expires_at,created_at) VALUES(?,?,?,?,?)')
      .run(approvedId, 'verify', 'e'.repeat(64), clock + 60000, clock)
    db.prepare(`INSERT INTO access_mail_jobs(application_id,kind,token_id,ciphertext,status,subject,message_id,next_at,lease,lease_until,started_at,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(approvedId, 'verify', Number(approvedVerifyToken.lastInsertRowid), 'legacy-approved-verify-cipher', 'queued', 'legacy-approved-verify', '<legacy-approved-verify@example.com>', clock, null, 0, clock, clock)
    const activateToken = db.prepare('INSERT INTO access_tokens(application_id,purpose,digest,expires_at,created_at) VALUES(?,?,?,?,?)')
      .run(approvedId, 'activate', 'c'.repeat(64), clock + 24 * 60 * 60000, clock)
    db.prepare(`INSERT INTO access_mail_jobs(application_id,kind,token_id,ciphertext,status,subject,message_id,next_at,lease,lease_until,started_at,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(approvedId, 'activate', Number(activateToken.lastInsertRowid), null, 'accepted', 'legacy-activate', '<legacy-activate@example.com>', clock + 24 * 60 * 60000, null, 0, clock, clock)
    initializeSchema(db); initializeSchema(db)
    await app.locals.accessLifecycle.migrateLegacy(); await app.locals.accessLifecycle.migrateLegacy()
    assert.deepEqual(db.prepare('SELECT id,email,status,reviewed_at FROM access_requests ORDER BY id').all().map(row => ({ ...row })), [
      { id: pendingId, email: 'legacy-pending@example.com', status: 'pending', reviewed_at: null },
      { id: approvedId, email: 'legacy-approved@example.com', status: 'approved', reviewed_at: new Date(clock).toISOString() },
    ])
    assert.equal(db.prepare('SELECT legacy_invited FROM access_workflow WHERE application_id=?').get(pendingId).legacy_invited, 1)
    assert.notEqual(db.prepare('SELECT consumed_at FROM access_tokens WHERE id=?').get(Number(verifyToken.lastInsertRowid)).consumed_at, null)
    const verifyJob = db.prepare("SELECT status,ciphertext,lease,lease_until FROM access_mail_jobs WHERE subject='legacy-verify'").get()
    assert.deepEqual(verifyJob, { status: 'cancelled', ciphertext: null, lease: null, lease_until: 0 })
    // 已经标记 legacy_invited=1 的历史申请，其残留 verify 凭证同样停用。
    assert.notEqual(db.prepare('SELECT consumed_at FROM access_tokens WHERE id=?').get(Number(approvedVerifyToken.lastInsertRowid)).consumed_at, null)
    const approvedVerifyJob = db.prepare("SELECT status,ciphertext,lease,lease_until FROM access_mail_jobs WHERE subject='legacy-approved-verify'").get()
    assert.deepEqual(approvedVerifyJob, { status: 'cancelled', ciphertext: null, lease: null, lease_until: 0 })
    // 激活链接与既有账号保持不变。
    assert.equal(db.prepare('SELECT consumed_at FROM access_tokens WHERE id=?').get(Number(activateToken.lastInsertRowid)).consumed_at, null)
    assert.equal(db.prepare("SELECT status FROM access_mail_jobs WHERE subject='legacy-activate'").get().status, 'accepted')
    assert.ok(findUserByEmail(db, 'legacy-approved@example.com'))
    assert.equal(db.prepare("SELECT count(*) count FROM access_mail_jobs WHERE kind='admin'").get().count, 0)
    await app.locals.accessLifecycle.tick()
    assert.equal(sent.filter(message => message.to === 'legacy-pending@example.com' || message.to === 'legacy-approved@example.com').length, 0)
    assert.equal(sent.filter(message => message.to === 'admin@example.com').length, 0)
    // 迁移后旧待审申请直接可审核。
    assert.equal(app.locals.accessLifecycle.list('pending').applications[0].canReview, true)
  })
  it('申请提交的冷却不会阻塞首次审批激活邮件，但会限制随后补发', async () => {
    const app = build(); await submit(app).expect(202)
    const id = applicationId(app)
    await approve(app, id)
    assert.equal(app.locals.database.prepare("SELECT count(*) count FROM access_mail_jobs WHERE kind='activate'").get().count, 1)
    await app.locals.accessLifecycle.tick()
    const first = credential()
    assert.throws(() => app.locals.accessLifecycle.resendActivation(id), /操作过于频繁/)
    const active = app.locals.database.prepare("SELECT digest,consumed_at FROM access_tokens WHERE purpose='activate' AND consumed_at IS NULL").get()
    assert.equal(active.digest, createHash('sha256').update(first).digest('hex'))
  })
  it('崩溃遗留发送任务 lease 到期后转未知并查询，不重复发送', async () => {
    const app = build(); await submit(app).expect(202)
    const db = app.locals.database
    db.prepare("UPDATE access_mail_jobs SET status='sending',lease='crashed-worker',lease_until=?").run(clock + 30000)
    await app.locals.accessLifecycle.tick(); assert.equal(sent.length, 0)
    clock += 30001
    await app.locals.accessLifecycle.tick()
    assert.equal(sent.length, 0); assert.ok(checks.length)
    const job = db.prepare('SELECT * FROM access_mail_jobs').get()
    assert.equal(job.ciphertext, null); assert.equal(job.lease, null)
  })
  it('最终投递失败不会被激活链接过期清理覆盖，仍保留通知异常', async () => {
    const app = build(); await submit(app).expect(202)
    const id = applicationId(app)
    await approve(app, id)
    await app.locals.accessLifecycle.tick()
    delivery = 'failed'
    clock += 10001
    await app.locals.accessLifecycle.tick()
    assert.equal(app.locals.database.prepare("SELECT status FROM access_mail_jobs WHERE kind='activate'").get().status, 'failed')
    clock += 24 * 60 * 60000 + 1
    await app.locals.accessLifecycle.tick()
    assert.equal(app.locals.database.prepare("SELECT status FROM access_mail_jobs WHERE kind='activate'").get().status, 'failed')
    assert.equal(app.locals.accessLifecycle.list('notification_error').total, 1)
    assert.equal(app.locals.accessLifecycle.list('notification_error').applications[0].activationMailStatus, 'failed')
  })
  it('重发撤销正在发送的旧任务，晚到 SMTP 结果不能覆盖撤销状态', async () => {
    let completeSend, signalStarted
    const started = new Promise(resolve => { signalStarted = resolve })
    const app = build({ mail: { transport: { async sendMail(message) {
      sent.push(message)
      if (message.to === CANDIDATE.email && !completeSend) { signalStarted(); return new Promise(resolve => { completeSend = () => resolve({ accepted: [message.to] }) }) }
      return { accepted: [message.to] }
    } } } })
    await submit(app).expect(202)
    const id = applicationId(app)
    await approve(app, id)
    const tick = app.locals.accessLifecycle.tick(); await started
    const first = credential()
    const firstJob = app.locals.database.prepare("SELECT id FROM access_mail_jobs WHERE kind='activate'").get().id
    clock += 61000
    app.locals.accessLifecycle.resendActivation(id)
    completeSend(); await tick
    assert.equal(app.locals.database.prepare('SELECT status FROM access_mail_jobs WHERE id=?').get(firstJob).status, 'cancelled')
    await app.locals.accessLifecycle.tick()
    const replacement = credential()
    assert.notEqual(first, replacement)
    await request(app).post('/api/auth/activate').send({ token: first, password: NEW_PASSWORD }).expect(400)
    await request(app).post('/api/auth/activate').send({ token: replacement, password: NEW_PASSWORD }).expect(200)
  })
  it('30 个慢速旧查询不会饿死新邮件，独立批次按 next_at 和 id 公平推进', async () => {
    const events = []
    const app = build({ mail: {
      transport: { async sendMail(message) { events.push('send'); sent.push(message); return { accepted: [message.to] } } },
      deliveryClient: { configured: true, async check(query) { events.push('query'); checks.push(query); clock += 4500; return 'unknown' } },
    } })
    await submit(app).expect(202)
    const id = applicationId(app)
    await approve(app, id)
    const db = app.locals.database
    const expected = []
    for (let index = 0; index < 30; index++) {
      const jobId = index - 30, subject = `old-admin-${index}`, nextAt = clock - 3000 + index % 3 * 1000
      db.prepare(`INSERT INTO access_mail_jobs(id,application_id,kind,status,subject,message_id,next_at,started_at,created_at)
        VALUES(?,?,'admin','unknown',?,?,?,?,?)`).run(jobId, id, subject, `<old-${index}@example.com>`, nextAt, clock - 1000, clock - 1000)
      expected.push({ id: jobId, subject, nextAt })
    }
    expected.sort((a, b) => a.nextAt - b.nextAt || a.id - b.id)
    await app.locals.accessLifecycle.tick()
    assert.equal(events[0], 'send')
    assert.equal(sent.filter(message => message.to === 'admin@example.com').length, 1)
    assert.equal(sent.filter(message => message.to === CANDIDATE.email).length, 1)
    assert.equal(checks.length, 10)
    assert.deepEqual(checks.map(query => query.subject), expected.slice(0, 10).map(job => job.subject))
    // 查询结果会把 next_at 推到一分钟后再查；推进时钟验证后续批次仍按顺序推进。
    clock += 61000
    await app.locals.accessLifecycle.tick()
    assert.equal(checks.length, 20)
    assert.deepEqual(checks.slice(10).map(query => query.subject), expected.slice(10, 20).map(job => job.subject))
    clock += 61000
    await app.locals.accessLifecycle.tick()
    assert.equal(checks.length, 30)
    assert.deepEqual(checks.slice(20).map(query => query.subject), expected.slice(20).map(job => job.subject))
    assert.equal(new Set(checks.map(query => query.subject)).size, 30)
    assert.equal(sent.filter(message => message.to === CANDIDATE.email).length, 1)
  })
  it('accepted 与 unknown 到达发送起点 24 小时后停止查询，保留未知且清除密文', async () => {
    const app = build(); await submit(app).expect(202)
    const db = app.locals.database
    const id = applicationId(app)
    const reminder = db.prepare("SELECT id FROM access_mail_jobs WHERE kind='admin'").get()
    db.prepare("UPDATE access_mail_jobs SET status='cancelled',ciphertext=NULL").run()
    const started = clock - 24 * 60 * 60000 + 1
    const horizonIds = []
    for (const status of ['accepted', 'unknown']) {
      const inserted = db.prepare(`INSERT INTO access_mail_jobs(application_id,kind,status,ciphertext,subject,message_id,next_at,started_at,created_at)
        VALUES(?,'admin',?,'obsolete-encrypted-payload',?,?,?, ?,?)`).run(id, status, `horizon-${status}`, `<horizon-${status}@example.com>`, clock, started, started)
      horizonIds.push(Number(inserted.lastInsertRowid))
    }
    const horizonWhere = `id IN (${horizonIds.map(() => '?').join(',')})`
    await app.locals.accessLifecycle.tick()
    assert.equal(checks.length, 2)
    clock += 1
    db.prepare(`UPDATE access_mail_jobs SET next_at=? WHERE ${horizonWhere}`).run(clock, ...horizonIds)
    await app.locals.accessLifecycle.tick()
    assert.equal(checks.length, 2)
    for (const job of db.prepare(`SELECT status,ciphertext FROM access_mail_jobs WHERE ${horizonWhere} ORDER BY id`).all(...horizonIds)) {
      assert.equal(job.status, 'unknown'); assert.equal(job.ciphertext, null)
    }
    // 初始管理员提醒早已取消，不能混入 horizon 任务断言。
    assert.deepEqual(db.prepare('SELECT status,ciphertext FROM access_mail_jobs WHERE id=?').get(Number(reminder.id)), { status: 'cancelled', ciphertext: null })
    clock += 7 * 24 * 60 * 60000
    await app.locals.accessLifecycle.tick()
    assert.equal(checks.length, 2); assert.equal(sent.length, 0)
  })
  it('明确系统 connect 失败遵守 1/5/15 分钟重试，通用 socket 及读写失败保持未知', async () => {
    const app = build()
    sendError = Object.assign(new Error('isolated-connect-refused'), { code: 'ESOCKET', command: 'CONN', syscall: 'connect', errno: -61 })
    await submit(app).expect(202); await app.locals.accessLifecycle.tick()
    assert.equal(sent.length, 1)
    for (const [index, delay] of [60000, 300000, 900000].entries()) {
      clock += delay - 1; await app.locals.accessLifecycle.tick(); assert.equal(sent.length, index + 1)
      clock += 1; await app.locals.accessLifecycle.tick(); assert.equal(sent.length, index + 2)
    }
    assert.equal(app.locals.database.prepare('SELECT status FROM access_mail_jobs').get().status, 'failed')
    const errors = [
      { code: 'ESOCKET', command: 'CONN' },
      { code: 'ESOCKET', command: 'CONN', syscall: 'read', errno: -54 },
      { code: 'ESOCKET', command: 'DATA', syscall: 'write', errno: -32 },
    ]
    for (const [index, error] of errors.entries()) {
      const unknown = build({ filename: `unknown-socket-${index}.sqlite` })
      sendError = Object.assign(new Error('isolated-unknown-socket'), error)
      const before = sent.length
      await submit(unknown).expect(202); await unknown.locals.accessLifecycle.tick()
      assert.equal(sent.length, before + 1)
      clock += 16 * 60000; await unknown.locals.accessLifecycle.tick()
      assert.equal(unknown.locals.database.prepare('SELECT status FROM access_mail_jobs').get().status, 'unknown')
      assert.equal(sent.length, before + 1)
    }
  })
  it('激活专用限流在 auth 路由前执行，全局额度未耗尽时也拦截', async () => {
    const app = build({ security: { rateLimitEnabled: true, rateLimits: {
      global: { limit: 100 }, applicationActivation: { limit: 1 },
    } } })
    await request(app).post('/api/auth/activate').send({ token: 'invalid', password: 'Rate-Limit-Pass1' }).expect(400)
    await request(app).post('/api/auth/activate').send({ token: 'invalid', password: 'Rate-Limit-Pass1' }).expect(429)
    await request(app).get('/health').expect(200)
  })

  it('worker 缺少配置时记录配置名并停止，日志不包含配置值或邮箱', async () => {
    const configuredEnv = { MAIL_ENABLED: 'true', SMTP_HOST: 'smtp.example.com', MAIL_FROM: 'club@example.com', MAIL_ADMIN_TO: 'admin@example.com', APPLICATION_MAIL_ENCRYPTION_KEY: KEY }
    const { MAIL_ENABLED, ...withoutEnabled } = configuredEnv
    const { APPLICATION_MAIL_ENCRYPTION_KEY, ...withoutKey } = configuredEnv
    const cases = [
      { name: 'MAIL_ENABLED', options: { mail: { env: withoutEnabled } } },
      { name: 'PUBLIC_ORIGIN', options: { security: { publicOrigin: '' } } },
      { name: 'APPLICATION_MAIL_ENCRYPTION_KEY', options: { mail: { env: withoutKey } } },
    ]
    for (const [index, entry] of cases.entries()) {
      const app = build({ ...entry.options, filename: `unavailable-${index}.sqlite` })
      const before = logs.length
      app.locals.accessLifecycle.start(); await app.locals.accessLifecycle.stop()
      const unavailable = logs.slice(before).find(event => event.event === 'access_mail_unavailable')
      assert.ok(unavailable, `${entry.name} 缺失时必须留下可诊断事件`)
      assert.deepEqual(unavailable.missingConfiguration, [entry.name])
      assert.doesNotMatch(JSON.stringify(unavailable), /example\.com|smtp\.|#token=/)
      assert.equal(JSON.stringify(unavailable).includes(KEY), false)
    }
    assert.equal(sent.length, 0); assert.equal(checks.length, 0)
  })
})
