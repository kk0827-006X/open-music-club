const assert = require('node:assert/strict')
const { afterEach, beforeEach, describe, it } = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const request = require('supertest')
const { createHash } = require('node:crypto')
const { createApp } = require('../src/app')
const { initializeSchema } = require('../src/db/database')
const KEY = Buffer.alloc(32, 13).toString('base64')
const CANDIDATE = { email: 'candidate@example.com', nickname: '候选成员', reason: '私密申请理由' }

describe('自动邮件任务与持久化恢复', () => {
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
          try { assert.equal(reader.prepare('SELECT count(*) count FROM access_requests').get().count, 1); assert.ok(reader.prepare('SELECT count(*) count FROM access_mail_jobs').get().count >= 1) } finally { reader.close() }
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
  const credential = () => sent.filter(message => message.to === CANDIDATE.email).at(-1).text.match(/#token=([A-Za-z0-9_-]+)/)[1]

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
  it('提交只落库入队，tick 才发信且不以管理员邮件送达作为审核前提', async () => {
    const app = build()
    const response = await submit(app).expect(202)
    assert.equal(response.body.success, true); assert.equal(sent.length, 0)
    await app.locals.accessLifecycle.tick()
    assert.equal(sent.length, 1); assert.equal(sent[0].to, CANDIDATE.email)
    assert.equal(sent[0].disableFileAccess, true); assert.equal(sent[0].disableUrlAccess, true)
    assert.doesNotMatch(sent[0].text, /私密申请理由/)
    await request(app).post('/api/applications/verify-email').send({ token: credential() }).expect(200)
    assert.ok(app.locals.database.prepare('SELECT verified_at FROM access_workflow').get().verified_at)
    assert.equal(checks.length <= 1, true)
  })
  it('凭证校验只存摘要，任务密文在接受后清除且日志没有敏感内容', async () => {
    const app = build(); await submit(app).expect(202)
    const before = JSON.stringify(app.locals.database.prepare('SELECT * FROM access_mail_jobs').all())
    assert.doesNotMatch(before, /#token=/)
    await app.locals.accessLifecycle.tick()
    const token = credential()
    const tokens = JSON.stringify(app.locals.database.prepare('SELECT * FROM access_tokens').all())
    assert.equal(tokens.includes(token), false)
    assert.equal(tokens.includes(createHash('sha256').update(token).digest('hex')), true)
    const jobs = JSON.stringify(app.locals.database.prepare('SELECT * FROM access_mail_jobs').all())
    assert.equal(jobs.includes(token), false)
    assert.equal(app.locals.database.prepare('SELECT ciphertext FROM access_mail_jobs').get().ciphertext, null)
    assert.doesNotMatch(JSON.stringify(logs), /candidate@example\.com|私密申请理由|#token=|smtp-password|private\/database/)
  })
  it('并发 worker 通过数据库领取资格仅发送一次', async () => {
    const first = build(); await submit(first).expect(202)
    const second = build()
    await Promise.all([first.locals.accessLifecycle.tick(), second.locals.accessLifecycle.tick()])
    assert.equal(sent.filter(message => message.to === CANDIDATE.email).length, 1)
  })
  it('服务重启恢复未发送任务且不创建第二份申请', async () => {
    const first = build(); await submit(first).expect(202)
    first.locals.accessLifecycle.stop(); first.locals.database.close()
    const restarted = build()
    await restarted.locals.accessLifecycle.tick()
    assert.equal(sent.length, 1)
    assert.equal(restarted.locals.database.prepare('SELECT count(*) count FROM access_requests').get().count, 1)
    await request(restarted).post('/api/applications/verify-email').send({ token: credential() }).expect(200)
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
    // 已接受后即使投递状态迟迟未明确，也不会再次发送相同凭证。
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
  it('历史待审申请只迁移一次且保留编号和已有账号', async () => {
    const app = build(), db = app.locals.database
    const result = db.prepare('INSERT INTO access_requests(email,nickname,reason) VALUES(?,?,?)').run(CANDIDATE.email, CANDIDATE.nickname, CANDIDATE.reason)
    initializeSchema(db); initializeSchema(db)
    await app.locals.accessLifecycle.migrateLegacy(); await app.locals.accessLifecycle.migrateLegacy()
    assert.equal(db.prepare('SELECT count(*) count FROM access_requests').get().count, 1)
    assert.equal(db.prepare('SELECT id FROM access_requests').get().id, Number(result.lastInsertRowid))
    assert.equal(db.prepare('SELECT verified_at FROM access_workflow').get().verified_at, null)
    await app.locals.accessLifecycle.tick(); await app.locals.accessLifecycle.tick()
    assert.equal(sent.filter(message => message.to === CANDIDATE.email).length, 1)
    await request(app).post('/api/applications/verify-email').send({ token: credential() }).expect(200)
  })
  it('重发每日五次额度耗尽后保持统一响应且不再签发邮件', async () => {
    const app = build(); await submit(app).expect(202); await app.locals.accessLifecycle.tick()
    for (let index = 0; index < 7; index++) {
      clock += 61000
      const response = await request(app).post('/api/applications/resend').send({ email: CANDIDATE.email, purpose: 'verify' }).expect(202)
      assert.equal(response.body.success, true)
      await app.locals.accessLifecycle.tick()
    }
    assert.ok(sent.length <= 6)
    assert.ok(sent.length >= 5)
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
  it('SMTP 明确失败初次加三次重试后停止，遵守 1/5/15 分钟间隔', async () => {
    const app = build()
    sendError = Object.assign(new Error('isolated-auth-failure'), { code: 'EAUTH' })
    await submit(app).expect(202); await app.locals.accessLifecycle.tick(); assert.equal(sent.length, 1)
    for (const [index, delay] of [60000, 300000, 900000].entries()) {
      clock += delay - 1; await app.locals.accessLifecycle.tick(); assert.equal(sent.length, index + 1)
      clock += 1; await app.locals.accessLifecycle.tick(); assert.equal(sent.length, index + 2)
    }
    const job = app.locals.database.prepare('SELECT * FROM access_mail_jobs').get()
    assert.equal(job.status, 'failed'); assert.equal(job.attempts, 4); assert.equal(job.ciphertext, null)
    clock += 600000; await app.locals.accessLifecycle.tick(); assert.equal(sent.length, 4)
  })
  it('接受后的投递查询失败只更新状态且不会重新发送凭证', async () => {
    const app = build(); await submit(app).expect(202); await app.locals.accessLifecycle.tick()
    delivery = 'failed'; clock += 10001; await app.locals.accessLifecycle.tick()
    assert.equal(sent.length, 1)
    assert.equal(app.locals.database.prepare('SELECT status FROM access_mail_jobs').get().status, 'failed')
  })
  it('激活专用限流在 auth 路由前执行，全局额度未耗尽时也拦截', async () => {
    const app = build({ security: { rateLimitEnabled: true, rateLimits: {
      global: { limit: 100 }, applicationActivation: { limit: 1 },
    } } })
    await request(app).post('/api/auth/activate').send({ token: 'invalid', password: 'valid-length-password' }).expect(400)
    await request(app).post('/api/auth/activate').send({ token: 'invalid', password: 'valid-length-password' }).expect(429)
    await request(app).get('/health').expect(200)
  })

  it('重发撤销正在发送的旧任务，晚到 SMTP 结果不能覆盖撤销状态', async () => {
    let completeSend, signalStarted
    const started = new Promise(resolve => { signalStarted = resolve })
    const app = build({ mail: { transport: { async sendMail(message) {
      sent.push(message)
      if (sent.length === 1) { signalStarted(); return new Promise(resolve => { completeSend = () => resolve({ accepted: [message.to] }) }) }
      return { accepted: [message.to] }
    } } } })
    await submit(app).expect(202)
    const tick = app.locals.accessLifecycle.tick(); await started
    const first = app.locals.database.prepare('SELECT id FROM access_mail_jobs').get().id
    clock += 61000
    await request(app).post('/api/applications/resend').send({ email: CANDIDATE.email, purpose: 'verify' }).expect(202)
    completeSend(); await tick
    assert.equal(app.locals.database.prepare('SELECT status FROM access_mail_jobs WHERE id=?').get(first).status, 'cancelled')
    await app.locals.accessLifecycle.tick()
    assert.equal(sent.length, 2)
    const oldToken = sent[0].text.match(/#token=([A-Za-z0-9_-]+)/)[1]
    await request(app).post('/api/applications/verify-email').send({ token: oldToken }).expect(400)
    await request(app).post('/api/applications/verify-email').send({ token: credential() }).expect(200)
  })

})
