const assert = require('node:assert/strict')
const { afterEach, beforeEach, describe, it } = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const bcrypt = require('bcrypt')
const request = require('supertest')

const { createApp } = require('../src/app')
const { createUser, findUserByEmail } = require('../src/db/users')

const TEST_PASSWORD = 'test-password'
const INITIAL_PASSWORD = 'initial-password'

describe('访问申请与管理员审核 API', () => {
  let directory
  let app
  let database
  let adminAgent
  let memberAgent

  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'open-music-applications-'))
    app = createApp({
      databasePath: path.join(directory, 'database.sqlite'),
      sessionDatabasePath: path.join(directory, 'sessions.sqlite'),
      sessionSecret: 'test-session-secret',
    })
    database = app.locals.database

    const passwordHash = await bcrypt.hash(TEST_PASSWORD, 4)
    createUser(database, {
      email: 'admin@example.com',
      nickname: '管理员',
      passwordHash,
      role: 'admin',
      status: 'active',
      mustChangePassword: true,
    })
    createUser(database, {
      email: 'member@example.com',
      nickname: '普通成员',
      passwordHash,
      role: 'user',
      status: 'active',
      mustChangePassword: false,
    })

    adminAgent = request.agent(app)
    memberAgent = request.agent(app)
    await login(adminAgent, 'admin@example.com')
    await login(memberAgent, 'member@example.com')
  })

  afterEach(async () => {
    if (database?.open) database.close()
    if (app?.locals.sessionStore?.db?.open) {
      await new Promise((resolve) => app.locals.sessionStore.db.close(resolve))
    }
    fs.rmSync(directory, { recursive: true, force: true })
  })

  function login(agent, email, password = TEST_PASSWORD) {
    return agent.post('/api/auth/login').send({ email, password })
  }

  function submitApplication(overrides = {}) {
    return request(app)
      .post('/api/applications')
      .send({
        email: 'candidate@example.com',
        nickname: '候选成员',
        reason: 'Open Music Club 小组成员',
        ...overrides,
      })
  }

  function insertApplication({
    email = 'candidate@example.com',
    nickname = '候选成员',
    reason = '申请理由',
    status = 'pending',
    reviewedBy = null,
    reviewedAt = null,
    createdAt,
  } = {}) {
    const result = database
      .prepare(
        `INSERT INTO access_requests (
          email,
          nickname,
          reason,
          status,
          reviewed_by,
          reviewed_at,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))`,
      )
      .run(
        email,
        nickname,
        reason,
        status,
        reviewedBy,
        reviewedAt,
        createdAt || null,
      )
    return Number(result.lastInsertRowid)
  }

  function findApplication(id) {
    return database.prepare('SELECT * FROM access_requests WHERE id = ?').get(id)
  }

  it('初始化 access_requests 表、状态约束、外键和 pending 唯一索引', () => {
    const columns = database
      .prepare('PRAGMA table_info(access_requests)')
      .all()
      .map((column) => column.name)
    const foreignKeys = database.prepare('PRAGMA foreign_key_list(access_requests)').all()

    assert.deepEqual(columns, [
      'id',
      'email',
      'nickname',
      'reason',
      'status',
      'reviewed_by',
      'reviewed_at',
      'created_at',
    ])
    assert.equal(foreignKeys.some((key) => key.table === 'users'), true)
    assert.throws(
      () => insertApplication({ status: 'invalid' }),
      /CHECK constraint failed/,
    )

    insertApplication()
    assert.throws(() => insertApplication(), /UNIQUE constraint failed/)
  })

  it('未登录访客可以提交申请，禁止字段不会生效', async () => {
    const response = await submitApplication({
      email: '  New.User@Example.COM  ',
      nickname: '  测试用户  ',
      reason: '  小组成员  ',
      status: 'approved',
      role: 'admin',
      reviewed_by: 1,
    })

    assert.equal(response.status, 201)
    assert.equal(response.body.success, true)
    assert.deepEqual(response.body.application, {
      id: 1,
      email: 'new.user@example.com',
      nickname: '测试用户',
      status: 'pending',
      createdAt: response.body.application.createdAt,
    })
    assert.match(response.body.application.createdAt, /^\d{4}-\d{2}-\d{2}T/)

    const stored = findApplication(1)
    assert.equal(stored.reason, '小组成员')
    assert.equal(stored.reviewed_by, null)
  })

  it('缺少 email、缺少 nickname、空昵称和非法邮箱返回 400', async () => {
    const missingEmail = await submitApplication({ email: undefined })
    const missingNickname = await submitApplication({ nickname: undefined })
    const emptyNickname = await submitApplication({ nickname: '   ' })
    const invalidEmail = await submitApplication({ email: 'invalid-email' })

    assert.equal(missingEmail.status, 400)
    assert.equal(missingNickname.status, 400)
    assert.equal(emptyNickname.status, 400)
    assert.equal(invalidEmail.status, 400)
  })

  it('reason 提供非字符串值时返回 400', async () => {
    const response = await submitApplication({ reason: 123 })

    assert.equal(response.status, 400)
  })

  it('users 已存在相同邮箱时拒绝申请', async () => {
    const response = await submitApplication({ email: ' MEMBER@example.com ' })

    assert.equal(response.status, 409)
  })

  it('同邮箱已有 pending 申请时拒绝重复提交', async () => {
    const first = await submitApplication()
    const second = await submitApplication({ email: ' CANDIDATE@example.com ' })

    assert.equal(first.status, 201)
    assert.equal(second.status, 409)
  })

  it('先前申请 rejected 后允许创建新的 pending 申请', async () => {
    insertApplication({
      status: 'rejected',
      reviewedBy: 1,
      reviewedAt: '2026-01-01 00:00:00',
    })

    const response = await submitApplication()
    const applications = database
      .prepare('SELECT status FROM access_requests ORDER BY id')
      .all()

    assert.equal(response.status, 201)
    assert.deepEqual(
      applications.map((item) => item.status),
      ['rejected', 'pending'],
    )
  })

  it('未登录用户不能查看申请列表', async () => {
    const response = await request(app).get('/api/admin/applications')

    assert.equal(response.status, 401)
  })

  it('普通用户不能查看申请列表', async () => {
    const response = await memberAgent.get('/api/admin/applications')

    assert.equal(response.status, 403)
  })

  it('管理员可以按创建时间倒序查看精简申请列表', async () => {
    insertApplication({
      email: 'old@example.com',
      createdAt: '2025-01-01 00:00:00',
    })
    insertApplication({
      email: 'new@example.com',
      status: 'rejected',
      reviewedBy: 1,
      reviewedAt: '2026-01-02 00:00:00',
      createdAt: '2026-01-01 00:00:00',
    })

    const response = await adminAgent.get('/api/admin/applications')

    assert.equal(response.status, 200)
    assert.equal(response.body.success, true)
    assert.deepEqual(
      response.body.applications.map((item) => item.email),
      ['new@example.com', 'old@example.com'],
    )
    assert.deepEqual(Object.keys(response.body.applications[0]), [
      'id',
      'email',
      'nickname',
      'reason',
      'status',
      'createdAt',
      'reviewedAt',
      'reviewedBy',
    ])
    assert.equal(response.body.applications[0].reviewedBy, 1)
    assert.match(response.body.applications[0].reviewedAt, /^\d{4}-\d{2}-\d{2}T/)
  })

  it('管理员可以按合法 status 过滤，非法 status 返回 400', async () => {
    insertApplication({ email: 'pending@example.com' })
    insertApplication({
      email: 'rejected@example.com',
      status: 'rejected',
      reviewedBy: 1,
      reviewedAt: '2026-01-01 00:00:00',
    })

    const filtered = await adminAgent.get(
      '/api/admin/applications?status=pending',
    )
    const invalid = await adminAgent.get(
      '/api/admin/applications?status=invalid',
    )

    assert.equal(filtered.status, 200)
    assert.deepEqual(
      filtered.body.applications.map((item) => item.status),
      ['pending'],
    )
    assert.equal(invalid.status, 400)
  })

  it('管理员批准 pending 申请并原子创建普通用户', async () => {
    const applicationId = insertApplication()

    const response = await adminAgent
      .post(`/api/admin/applications/${applicationId}/approve`)
      .send({ initialPassword: INITIAL_PASSWORD })
    const application = findApplication(applicationId)
    const user = findUserByEmail(database, 'candidate@example.com')

    assert.equal(response.status, 200)
    assert.deepEqual(response.body.user, {
      id: user.id,
      email: 'candidate@example.com',
      nickname: '候选成员',
      role: 'user',
      mustChangePassword: true,
    })
    assert.equal(JSON.stringify(response.body).includes('password'), false)
    assert.equal(user.role, 'user')
    assert.equal(user.status, 'active')
    assert.equal(user.must_change_password, 1)
    assert.equal(await bcrypt.compare(INITIAL_PASSWORD, user.password_hash), true)
    assert.equal(bcrypt.getRounds(user.password_hash), 12)
    assert.equal(application.status, 'approved')
    assert.equal(application.reviewed_by, 1)
    assert.notEqual(application.reviewed_at, null)
  })

  it('批准创建的普通用户复用现有登录，并且没有管理员权限', async () => {
    const applicationId = insertApplication()
    await adminAgent
      .post(`/api/admin/applications/${applicationId}/approve`)
      .send({ initialPassword: INITIAL_PASSWORD })

    const newUserAgent = request.agent(app)
    const loginResponse = await login(
      newUserAgent,
      'candidate@example.com',
      INITIAL_PASSWORD,
    )

    assert.equal(loginResponse.status, 200)
    assert.equal((await newUserAgent.get('/api/protected')).status, 200)
    assert.equal((await newUserAgent.get('/api/admin/test')).status, 403)
  })

  it('批准接口校验申请 id、申请存在性和初始密码', async () => {
    const applicationId = insertApplication()
    const invalidId = await adminAgent
      .post('/api/admin/applications/not-a-number/approve')
      .send({ initialPassword: INITIAL_PASSWORD })
    const notFound = await adminAgent
      .post('/api/admin/applications/999/approve')
      .send({ initialPassword: INITIAL_PASSWORD })
    const shortPassword = await adminAgent
      .post(`/api/admin/applications/${applicationId}/approve`)
      .send({ initialPassword: 'short' })

    assert.equal(invalidId.status, 400)
    assert.equal(notFound.status, 404)
    assert.equal(shortPassword.status, 400)
  })

  it('已 approved 或 rejected 的申请不能批准', async () => {
    const approvedId = insertApplication({
      email: 'approved@example.com',
      status: 'approved',
      reviewedBy: 1,
      reviewedAt: '2026-01-01 00:00:00',
    })
    const rejectedId = insertApplication({
      email: 'rejected@example.com',
      status: 'rejected',
      reviewedBy: 1,
      reviewedAt: '2026-01-01 00:00:00',
    })

    const approved = await adminAgent
      .post(`/api/admin/applications/${approvedId}/approve`)
      .send({ initialPassword: INITIAL_PASSWORD })
    const rejected = await adminAgent
      .post(`/api/admin/applications/${rejectedId}/approve`)
      .send({ initialPassword: INITIAL_PASSWORD })

    assert.equal(approved.status, 409)
    assert.equal(rejected.status, 409)
  })

  it('批准前发现 users 已有相同邮箱时返回 409', async () => {
    const applicationId = insertApplication({ email: 'member@example.com' })

    const response = await adminAgent
      .post(`/api/admin/applications/${applicationId}/approve`)
      .send({ initialPassword: INITIAL_PASSWORD })

    assert.equal(response.status, 409)
    assert.equal(findApplication(applicationId).status, 'pending')
  })

  it('批准过程中更新申请失败时回滚已创建用户', async () => {
    const applicationId = insertApplication({ email: 'rollback@example.com' })
    database.exec(`
      CREATE TRIGGER reject_test_approval
      BEFORE UPDATE OF status ON access_requests
      WHEN NEW.id = ${applicationId} AND NEW.status = 'approved'
      BEGIN
        SELECT RAISE(ABORT, '测试强制回滚');
      END;
    `)

    const originalConsoleError = console.error
    console.error = () => {}
    let response
    try {
      response = await adminAgent
        .post(`/api/admin/applications/${applicationId}/approve`)
        .send({ initialPassword: INITIAL_PASSWORD })
    } finally {
      console.error = originalConsoleError
    }

    assert.equal(response.status, 500)
    assert.deepEqual(response.body, {
      success: false,
      message: '服务器内部错误',
    })
    assert.equal(findApplication(applicationId).status, 'pending')
    assert.equal(findUserByEmail(database, 'rollback@example.com'), undefined)
  })

  it('管理员可以拒绝 pending 申请且不会创建用户', async () => {
    const applicationId = insertApplication({ email: 'reject-me@example.com' })

    const response = await adminAgent.post(
      `/api/admin/applications/${applicationId}/reject`,
    )
    const application = findApplication(applicationId)

    assert.equal(response.status, 200)
    assert.equal(response.body.application.status, 'rejected')
    assert.equal(response.body.application.reviewedBy, 1)
    assert.equal(application.status, 'rejected')
    assert.equal(application.reviewed_by, 1)
    assert.notEqual(application.reviewed_at, null)
    assert.equal(findUserByEmail(database, 'reject-me@example.com'), undefined)
  })

  it('不存在的申请返回 404，已处理申请不能再次 reject', async () => {
    const approvedId = insertApplication({
      email: 'approved@example.com',
      status: 'approved',
      reviewedBy: 1,
      reviewedAt: '2026-01-01 00:00:00',
    })
    const rejectedId = insertApplication({
      email: 'rejected@example.com',
      status: 'rejected',
      reviewedBy: 1,
      reviewedAt: '2026-01-01 00:00:00',
    })

    assert.equal(
      (await adminAgent.post('/api/admin/applications/999/reject')).status,
      404,
    )
    assert.equal(
      (
        await adminAgent.post(
          `/api/admin/applications/${approvedId}/reject`,
        )
      ).status,
      409,
    )
    assert.equal(
      (
        await adminAgent.post(
          `/api/admin/applications/${rejectedId}/reject`,
        )
      ).status,
      409,
    )
  })

  it('未登录和普通用户都不能 approve 或 reject', async () => {
    const applicationId = insertApplication()
    const anonymousApprove = await request(app)
      .post(`/api/admin/applications/${applicationId}/approve`)
      .send({ initialPassword: INITIAL_PASSWORD })
    const memberApprove = await memberAgent
      .post(`/api/admin/applications/${applicationId}/approve`)
      .send({ initialPassword: INITIAL_PASSWORD })
    const anonymousReject = await request(app).post(
      `/api/admin/applications/${applicationId}/reject`,
    )
    const memberReject = await memberAgent.post(
      `/api/admin/applications/${applicationId}/reject`,
    )

    assert.equal(anonymousApprove.status, 401)
    assert.equal(memberApprove.status, 403)
    assert.equal(anonymousReject.status, 401)
    assert.equal(memberReject.status, 403)
    assert.equal(findApplication(applicationId).status, 'pending')
  })
})
