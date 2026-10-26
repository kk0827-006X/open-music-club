const assert = require('node:assert/strict')
const { afterEach, beforeEach, describe, it } = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const request = require('supertest')
const { createApp } = require('../src/app')
const { initializeSchema, createDatabase } = require('../src/db/database')
const { approveApplication } = require('../src/db/applications')
const { createAccessApplicationService } = require('../src/services/accessApplication.service')
const { findNotification, updateSendResult, acquireCheckLease, finishCheck } = require('../src/db/applicationNotifications')

describe('申请最终投递确认', () => {
  let directory
  let applications
  let sent
  let checked
  let deliveryResult
  let sendError
  const candidate = { email: 'candidate@example.com', nickname: '候选成员', reason: '申请理由' }
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'open-music-delivery-'))
    applications = []
    sent = []
    checked = []
    deliveryResult = 'pending'
    sendError = null
  })
  afterEach(() => {
    for (const app of applications) app.locals.database.close()
    fs.rmSync(directory, { recursive: true, force: true })
  })
  function buildApp(mailOverrides = {}, security = {}) {
    const app = createApp({
      databasePath: path.join(directory, `database-${applications.length}.sqlite`),
      sessionSecret: 'test-delivery-session-secret',
      security,
      mail: {
        env: { MAIL_ENABLED: 'true', SMTP_HOST: 'smtp.example.com', MAIL_FROM: 'club@example.com', MAIL_ADMIN_TO: 'admin@example.com' },
        transport: { async sendMail(message) {
          const stored = app.locals.database.prepare('SELECT count(*) AS count FROM application_notifications').get()
          assert.equal(stored.count, 1)
          sent.push(message)
          if (sendError) throw sendError
          return { accepted: [message.to] }
        } },
        deliveryClient: { configured: true, async check(query) {
          checked.push(query)
          if (deliveryResult instanceof Error) throw deliveryResult
          return deliveryResult
        } },
        ...mailOverrides,
      },
    })
    applications.push(app)
    return app
  }
  const submit = (agent, data = candidate) => agent.post('/api/applications').send(data)
  function allowCheck(app, id) {
    app.locals.database.prepare('UPDATE application_notifications SET next_check_at = 0 WHERE application_id = ?').run(id)
  }

  it('新增通知表迁移幂等且保留旧申请的审批兼容性', () => {
    const app = buildApp()
    const db = app.locals.database
    db.prepare('INSERT INTO access_requests (email,nickname) VALUES (?,?)').run('legacy@example.com', '历史成员')
    initializeSchema(db)
    initializeSchema(db)
    assert.equal(db.prepare('SELECT count(*) AS count FROM access_requests').get().count, 1)
    assert.equal(db.prepare('PRAGMA foreign_key_list(application_notifications)').all()[0].table, 'access_requests')
    assert.equal(db.prepare('SELECT count(*) AS count FROM application_notifications').get().count, 0)
  })
  it('未启用邮件或未配置投递查询时返回503且不落库、不发送', async () => {
    for (const mail of [{ env: { MAIL_ENABLED: 'false' } }, { deliveryClient: { configured: false } }]) {
      const app = buildApp(mail)
      const response = await submit(request.agent(app))
      assert.equal(response.status, 503)
      assert.equal(response.body.success, false)
      assert.equal(app.locals.database.prepare('SELECT count(*) AS count FROM access_requests').get().count, 0)
    }
    assert.equal(sent.length, 0)
  })
  it('SMTP接受只返回202，最终投递确认才返回成功并允许审批', async () => {
    const app = buildApp()
    const agent = request.agent(app)
    const response = await submit(agent)
    const id = response.body.application.id
    assert.equal(response.status, 202)
    assert.equal(response.body.success, false)
    assert.equal(response.body.notification.status, 'pending')
    assert.equal(response.body.retryable, false)
    assert.equal(approveApplication(app.locals.database, { id, reviewerId: 1, passwordHash: 'unused' }).type, 'not_pending')
    deliveryResult = 'delivered'
    allowCheck(app, id)
    const delivered = await agent.get(`/api/applications/${id}/notification`)
    assert.equal(delivered.status, 200)
    assert.equal(delivered.body.success, true)
    assert.equal(delivered.body.notification.status, 'delivered')
    assert.equal(sent.length, 1)
    assert.equal(checked[0].subject, sent[0].subject)
    assert.equal(checked[0].from, sent[0].from)
    assert.equal(checked[0].to, sent[0].to)
    assert.match(sent[0].messageId, /^<.+>$/)
  })
  it('立即获得delivered时返回201；已送达申请不能被重复发送', async () => {
    deliveryResult = 'delivered'
    const app = buildApp()
    const agent = request.agent(app)
    assert.equal((await submit(agent)).status, 201)
    assert.equal((await submit(agent)).status, 409)
    assert.equal(sent.length, 1)
  })
  it('无查询记录保持pending，查询异常仅unknown且不泄露上游错误', async () => {
    const app = buildApp()
    const agent = request.agent(app)
    const response = await submit(agent)
    const id = response.body.application.id
    assert.equal(response.body.notification.status, 'pending')
    allowCheck(app, id)
    deliveryResult = new Error('private-secret /private/database.sqlite')
    const unknown = await agent.get(`/api/applications/${id}/notification`)
    assert.equal(unknown.body.notification.status, 'unknown')
    assert.equal(unknown.body.retryable, false)
    assert.doesNotMatch(JSON.stringify(unknown.body), /private|secret|stack/)
    assert.equal(sent.length, 1)
  })
  it('明确失败可以原申请同邮箱重试，重新绑定会话与关联标识', async () => {
    const app = buildApp()
    const original = request.agent(app)
    deliveryResult = 'failed'
    const failed = await submit(original)
    assert.equal(failed.status, 502)
    assert.equal(failed.body.retryable, true)
    const id = failed.body.application.id
    const first = findNotification(app.locals.database, id)
    deliveryResult = 'delivered'
    const retrying = request.agent(app)
    const retried = await submit(retrying)
    assert.equal(retried.status, 201)
    assert.equal(retried.body.application.id, id)
    const current = findNotification(app.locals.database, id)
    assert.notEqual(current.subject, first.subject)
    assert.notEqual(current.owner_hash, first.owner_hash)
    assert.equal(app.locals.database.prepare('SELECT count(*) AS count FROM access_requests').get().count, 1)
    assert.equal(app.locals.database.prepare('SELECT count(*) AS count FROM application_notifications').get().count, 1)
    assert.equal((await original.get(`/api/applications/${id}/notification`)).status, 404)
    assert.equal(updateSendResult(app.locals.database, { id, subject: first.subject, status: 'failed' }), false)
    assert.equal(findNotification(app.locals.database, id).status, 'delivered')
  })
  it('SMTP明确认证失败仍保留申请，未知传输错误不能放开重试', async () => {
    const app = buildApp()
    sendError = Object.assign(new Error('smtp-password /private/path'), { code: 'EAUTH' })
    const first = await submit(request.agent(app))
    assert.equal(first.status, 502)
    assert.equal(first.body.notification.status, 'failed')
    sendError = Object.assign(new Error('smtp DATA timed out'), { code: 'ETIMEDOUT', command: 'DATA' })
    const owner = request.agent(app)
    const unknown = await submit(owner)
    assert.equal(unknown.status, 202)
    assert.equal(unknown.body.notification.status, 'unknown')
    assert.equal(unknown.body.retryable, false)
    deliveryResult = 'pending'
    assert.equal((await submit(owner)).status, 202)
    assert.equal((await submit(request.agent(app))).status, 409)
    assert.equal(sent.length, 2)
    assert.doesNotMatch(JSON.stringify(first.body), /smtp-password|private/)
  })
  it('并发相同邮箱只获取一次发送资格，其它会话不取得申请摘要', async () => {
    const app = buildApp()
    const responses = await Promise.all([submit(request.agent(app)), submit(request.agent(app))])
    assert.deepEqual(responses.map((item) => item.status).sort(), [202, 409])
    assert.equal(sent.length, 1)
    assert.equal(responses.find((item) => item.status === 409).body.application, undefined)
  })
  it('仅提交会话可以查询，重复查询与重复提交在冷却期间不重复查询或发信', async () => {
    const app = buildApp()
    const agent = request.agent(app)
    const initial = await submit(agent)
    const id = initial.body.application.id
    assert.equal((await request(app).get(`/api/applications/${id}/notification`)).status, 404)
    assert.equal((await agent.get('/api/applications/999/notification')).status, 404)
    assert.equal((await agent.get(`/api/applications/${id}/notification`)).status, 200)
    assert.equal((await submit(agent)).status, 202)
    assert.equal(checked.length, 1)
    assert.equal(sent.length, 1)
    const row = findNotification(app.locals.database, id)
    assert.match(row.owner_hash, /^[a-f0-9]{64}$/)
    assert.doesNotMatch(JSON.stringify(initial.body), /owner|messageId|subject|reason/)
  })
  it('明确失败后的并发重试只发送一次，同一owner未决提交可以恢复', async () => {
    const app = buildApp()
    deliveryResult = 'failed'
    const failed = await submit(request.agent(app))
    const id = failed.body.application.id
    let resolveSend
    let submissions = 0
    const service = createAccessApplicationService({
      database: app.locals.database,
      mail: {
        getDeliveryConfig() { return { enabled: true, from: 'club@example.com', adminTo: 'admin@example.com' } },
        submitNotification() { submissions += 1; return new Promise((resolve) => { resolveSend = resolve }) },
      },
      deliveryClient: { configured: true, async check() { return 'pending' } },
    })
    const first = service.submit(candidate, 'same-owner', 'request-1')
    const second = await service.submit(candidate, 'same-owner', 'request-2')
    const outsider = await service.submit(candidate, 'other-owner', 'request-3')
    assert.equal(second.notification.status, 'sending')
    assert.equal(second.application.id, id)
    assert.equal(outsider.type, 'pending_exists')
    assert.equal(submissions, 1)
    resolveSend('accepted')
    assert.equal((await first).notification.status, 'pending')
    assert.equal(submissions, 1)
  })
  it('发送和查询总超时仅标unknown，晚到结果不会覆盖unknown', async () => {
    const app = buildApp()
    let resolveSend
    const service = createAccessApplicationService({
      database: app.locals.database,
      mail: {
        getDeliveryConfig() { return { enabled: true, from: 'club@example.com', adminTo: 'admin@example.com' } },
        submitNotification() { return new Promise((resolve) => { resolveSend = resolve }) },
      },
      deliveryClient: { configured: true, check() { return new Promise(() => {}) } },
      sendTimeoutMs: 5,
      queryTimeoutMs: 5,
    })
    const result = await service.submit(candidate, 'owner', 'request')
    const id = result.application.id
    assert.equal(result.notification.status, 'unknown')
    resolveSend('accepted')
    await Promise.resolve()
    assert.equal(findNotification(app.locals.database, id).status, 'unknown')
    assert.equal((await service.refresh(id)).status, 'unknown')
    assert.equal(findNotification(app.locals.database, id).check_lease_token, null)
    assert.equal(findNotification(app.locals.database, id).next_check_at > Date.now(), true)
  })
  it('数据库查询lease防跨连接并发请求重复调用，晚到旧lease不能覆盖状态', async () => {
    const app = buildApp()
    const agent = request.agent(app)
    const initial = await submit(agent)
    const id = initial.body.application.id
    allowCheck(app, id)
    let resolveCheck
    const deliveryClient = { configured: true, check: () => new Promise((resolve) => { resolveCheck = resolve }) }
    const db2 = createDatabase(path.join(directory, 'database-0.sqlite'))
    try {
      const service1 = createAccessApplicationService({ database: app.locals.database, mail: app.locals.mail, deliveryClient })
      const service2 = createAccessApplicationService({ database: db2, mail: app.locals.mail, deliveryClient: { configured: true, async check() { throw new Error('不应重复查询') } } })
      const row = findNotification(app.locals.database, id)
      const first = service1.refresh(id)
      const second = await service2.refresh(id)
      assert.equal(second.status, 'pending')
      app.locals.database.prepare('UPDATE application_notifications SET subject = ?, status = ? WHERE application_id = ?').run('new-attempt', 'unknown', id)
      resolveCheck('failed')
      await first
      assert.equal(findNotification(app.locals.database, id).subject, 'new-attempt')
      assert.equal(findNotification(app.locals.database, id).status, 'unknown')
      assert.notEqual(row.subject, 'new-attempt')
    } finally { db2.close() }
  })
  it('同次发送的旧查询lease响应不得覆盖更新的查询结果', async () => {
    const app = buildApp()
    const response = await submit(request.agent(app))
    const id = response.body.application.id
    const db = app.locals.database
    const { subject } = findNotification(db, id)
    allowCheck(app, id)
    const moment = Date.now()
    const oldToken = acquireCheckLease(db, { id, subject, now: moment, cooldownMs: 10000, leaseMs: 6000 })
    assert.ok(oldToken)
    assert.equal(acquireCheckLease(db, { id, subject, now: moment + 1, cooldownMs: 10000, leaseMs: 6000 }), null)
    const newToken = acquireCheckLease(db, { id, subject, now: moment + 10001, cooldownMs: 10000, leaseMs: 6000 })
    assert.ok(newToken)
    assert.notEqual(newToken, oldToken)
    assert.equal(finishCheck(db, { id, subject, token: oldToken, status: 'failed' }), false)
    assert.equal(findNotification(db, id).status, 'pending')
    assert.equal(finishCheck(db, { id, subject, token: newToken, status: 'delivered' }), true)
    assert.equal(findNotification(db, id).status, 'delivered')
  })
  it('服务重启后从持久化关联恢复查询，遗留sending只能转unknown且不会重发', async () => {
    const app = buildApp()
    const agent = request.agent(app)
    const initial = await submit(agent)
    const id = initial.body.application.id
    const db = app.locals.database
    const restored = createDatabase(path.join(directory, 'database-0.sqlite'))
    try {
      initializeSchema(restored)
      const service = createAccessApplicationService({ database: restored, mail: app.locals.mail, deliveryClient: { configured: true, async check(query) {
        assert.equal(query.subject, sent[0].subject)
        return 'delivered'
      } } })
      allowCheck(app, id)
      assert.equal((await service.refresh(id)).status, 'delivered')
      db.prepare('UPDATE application_notifications SET status = ?, started_at = 0, next_check_at = 0 WHERE application_id = ?').run('sending', id)
      assert.equal((await service.refresh(id)).status, 'unknown')
    } finally { restored.close() }
    assert.equal(sent.length, 1)
  })
  it('状态轮询不占5次每小时提交额度，仍受全局限流保护', async () => {
    const app = buildApp({}, { rateLimitEnabled: true })
    const agent = request.agent(app)
    const response = await submit(agent)
    const id = response.body.application.id
    for (let index = 0; index < 8; index += 1) {
      assert.equal((await agent.get(`/api/applications/${id}/notification`)).status, 200)
    }
    for (let index = 0; index < 4; index += 1) {
      assert.equal((await submit(agent)).status, 202)
    }
    assert.equal((await submit(agent)).status, 429)
    assert.equal((await agent.get(`/api/applications/${id}/notification`)).status, 200)
    assert.equal(sent.length, 1)
    const globalLimited = buildApp({}, { rateLimitEnabled: true, rateLimits: { global: { limit: 2 } } })
    const globalAgent = request.agent(globalLimited)
    const initial = await submit(globalAgent)
    assert.equal((await globalAgent.get(`/api/applications/${initial.body.application.id}/notification`)).status, 200)
    assert.equal((await globalAgent.get(`/api/applications/${initial.body.application.id}/notification`)).status, 429)
  })
})
