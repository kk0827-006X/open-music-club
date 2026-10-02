const assert = require('node:assert/strict')
const { afterEach, beforeEach, describe, it } = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const bcrypt = require('bcrypt')
const request = require('supertest')

const { createApp } = require('../src/app')
const { createDatabase, initializeSchema } = require('../src/db/database')
const { createUser } = require('../src/db/users')

const TEST_PASSWORD = 'test-password'

describe('登录与认证 API', () => {
  let directory
  let databasePath
  let passwordHash
  let applications

  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'open-music-auth-'))
    databasePath = path.join(directory, 'users.sqlite')
    passwordHash = await bcrypt.hash(TEST_PASSWORD, 4)
    applications = []

    const database = createDatabase(databasePath)
    initializeSchema(database)
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
    createUser(database, {
      email: 'disabled@example.com',
      nickname: '已禁用成员',
      passwordHash,
      role: 'user',
      status: 'disabled',
      mustChangePassword: false,
    })
    database.close()
  })

  afterEach(async () => {
    for (const app of applications) {
      if (app.locals.database?.open) {
        app.locals.database.close()
      }
      if (app.locals.sessionStore?.db?.open) {
        await new Promise((resolve) => app.locals.sessionStore.db.close(resolve))
      }
    }
    fs.rmSync(directory, { recursive: true, force: true })
  })

  function buildApp(sessionStore) {
    const app = createApp({
      databasePath,
      sessionSecret: 'test-session-secret',
      ...(sessionStore ? { infrastructure: { sessionStore } } : {}),
    })
    applications.push(app)
    return app
  }

  async function login(agent, email, password = TEST_PASSWORD) {
    return agent.post('/api/auth/login').send({ email, password })
  }

  it('缺少 SESSION_SECRET 时拒绝创建服务', () => {
    assert.throws(
      () =>
        createApp({
          databasePath,
          sessionSecret: '',
        }),
      /SESSION_SECRET/,
    )
  })

  it('健康检查接口返回服务可用', async () => {
    const response = await request(buildApp()).get('/health')

    assert.equal(response.status, 200)
    assert.deepEqual(response.body, { status: 'ok' })
  })

  it('未登录时 me 返回明确状态，保护接口返回 401', async () => {
    const app = buildApp()

    const meResponse = await request(app).get('/api/auth/me')
    const protectedResponse = await request(app).get('/api/protected')
    const adminResponse = await request(app).get('/api/admin/test')

    assert.equal(meResponse.status, 200)
    assert.deepEqual(meResponse.body, {
      authenticated: false,
      user: null,
    })
    assert.equal(protectedResponse.status, 401)
    assert.equal(adminResponse.status, 401)
  })

  it('登录字段缺失时返回 400', async () => {
    const app = buildApp()

    const missingEmail = await request(app)
      .post('/api/auth/login')
      .send({ password: TEST_PASSWORD })
    const missingPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@example.com' })

    assert.equal(missingEmail.status, 400)
    assert.equal(missingPassword.status, 400)
  })

  it('不存在的邮箱和错误密码返回相同的 401 响应', async () => {
    const app = buildApp()

    const unknownUser = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: TEST_PASSWORD })
    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: 'wrong-password' })

    assert.equal(unknownUser.status, 401)
    assert.equal(wrongPassword.status, 401)
    assert.deepEqual(unknownUser.body, wrongPassword.body)
  })

  it('已禁用用户即使密码正确也返回 403', async () => {
    const response = await login(
      request(buildApp()),
      'disabled@example.com',
    )

    assert.equal(response.status, 403)
  })

  it('管理员登录成功并可访问本人、保护和管理员接口', async () => {
    const agent = request.agent(buildApp())

    const loginResponse = await login(agent, ' ADMIN@example.com ')
    const meResponse = await agent.get('/api/auth/me')
    const protectedResponse = await agent.get('/api/protected')
    const adminResponse = await agent.get('/api/admin/test')

    assert.equal(loginResponse.status, 200)
    assert.equal(loginResponse.body.success, true)
    assert.deepEqual(loginResponse.body.user, {
      id: 1,
      email: 'admin@example.com',
      nickname: '管理员',
      role: 'admin',
      mustChangePassword: true,
    })
    assert.equal(JSON.stringify(loginResponse.body).includes('password'), false)
    assert.match(loginResponse.headers['set-cookie'][0], /HttpOnly/)
    assert.match(loginResponse.headers['set-cookie'][0], /SameSite=Lax/)
    assert.doesNotMatch(loginResponse.headers['set-cookie'][0], /Max-Age/)
    assert.equal(meResponse.status, 200)
    assert.deepEqual(meResponse.body.user, loginResponse.body.user)
    assert.equal(protectedResponse.status, 200)
    assert.equal(adminResponse.status, 200)
  })

  it('普通用户可访问保护接口但不能访问管理员接口', async () => {
    const agent = request.agent(buildApp())

    assert.equal((await login(agent, 'member@example.com')).status, 200)
    assert.equal((await agent.get('/api/protected')).status, 200)
    assert.equal((await agent.get('/api/admin/test')).status, 403)
  })

  it('用户被禁用后已有 Session 立即失效', async () => {
    const app = buildApp()
    const agent = request.agent(app)
    assert.equal((await login(agent, 'member@example.com')).status, 200)

    app.locals.database
      .prepare("UPDATE users SET status = 'disabled' WHERE email = ?")
      .run('member@example.com')

    const meResponse = await agent.get('/api/auth/me')
    const protectedResponse = await agent.get('/api/protected')

    assert.deepEqual(meResponse.body, {
      authenticated: false,
      user: null,
    })
    assert.equal(protectedResponse.status, 401)
  })

  it('Session Store 共享时，新的应用实例能读取原 Session', async () => {
    const firstApp = buildApp()
    const loginResponse = await login(
      request(firstApp),
      'admin@example.com',
    )
    const cookie = loginResponse.headers['set-cookie'][0].split(';')[0]

    const secondApp = buildApp(firstApp.locals.sessionStore)
    const meResponse = await request(secondApp)
      .get('/api/auth/me')
      .set('Cookie', cookie)

    assert.equal(meResponse.status, 200)
    assert.equal(meResponse.body.authenticated, true)
    assert.equal(meResponse.body.user.email, 'admin@example.com')
  })

  it('退出登录会销毁 Session，重复退出仍然成功', async () => {
    const agent = request.agent(buildApp())
    assert.equal((await login(agent, 'admin@example.com')).status, 200)

    const logoutResponse = await agent.post('/api/auth/logout')
    const meResponse = await agent.get('/api/auth/me')
    const secondLogoutResponse = await agent.post('/api/auth/logout')

    assert.equal(logoutResponse.status, 200)
    assert.deepEqual(logoutResponse.body, { success: true })
    assert.deepEqual(meResponse.body, {
      authenticated: false,
      user: null,
    })
    assert.equal(secondLogoutResponse.status, 200)
  })

  it('勾选保持登录生成 30 天 Cookie，Session 不保存密码', async () => {
    const app = buildApp()
    const startedAt = Date.now()
    const response = await request(app).post('/api/auth/login').send({
      email: 'admin@example.com', password: TEST_PASSWORD, rememberMe: true,
    })
    assert.equal(response.status, 200)
    const cookie = response.headers['set-cookie'][0]
    assert.match(cookie, /Expires=/)
    assert.match(cookie, /HttpOnly/)
    assert.match(cookie, /SameSite=Lax/)
    const expires = Date.parse(cookie.match(/Expires=([^;]+)/)[1])
    const duration = 30 * 24 * 60 * 60 * 1000
    assert.ok(Math.abs(expires - startedAt - duration) < 5000)
    const sessions = await new Promise((resolve, reject) => {
      app.locals.sessionStore.all((error, values) => error ? reject(error) : resolve(values))
    })
    const saved = Object.values(sessions)[0]
    assert.equal(saved.userId, 1)
    assert.ok(saved.rememberUntil >= startedAt + duration)
    assert.equal(JSON.stringify(saved).includes(TEST_PASSWORD), false)
    assert.equal(JSON.stringify(saved).includes('password'), false)
    assert.equal(response.body.user.role, 'admin')
  })

  it('未勾选保持登录仍使用原本的临时 Cookie', async () => {
    const response = await request(buildApp()).post('/api/auth/login').send({
      email: 'member@example.com', password: TEST_PASSWORD, rememberMe: false,
    })
    assert.equal(response.status, 200)
    assert.doesNotMatch(response.headers['set-cookie'][0], /Expires=|Max-Age=/)
  })

  it('保持登录参数只能为布尔值', async () => {
    const app = buildApp()
    for (const rememberMe of ['true', 1, null, {}]) {
      const response = await request(app).post('/api/auth/login').send({
        email: 'member@example.com', password: TEST_PASSWORD, rememberMe,
      })
      assert.equal(response.status, 400)
    }
  })

  it('重新打开客户端及重建应用实例后可用持久 Store 恢复保持登录身份', async () => {
    const app = buildApp()
    const response = await request(app).post('/api/auth/login').send({
      email: 'admin@example.com', password: TEST_PASSWORD, rememberMe: true,
    })
    const cookie = response.headers['set-cookie'][0].split(';')[0]
    const secondApp = buildApp(app.locals.sessionStore)
    const me = await request(secondApp).get('/api/auth/me').set('Cookie', cookie)
    assert.equal(me.body.authenticated, true)
    assert.equal(me.body.user.role, 'admin')
    assert.equal(me.headers['cache-control'], 'no-store')
  })

  it('保持登录有固定截止时间，访问不会无限延长期限，过期后所有接口拒绝身份', async () => {
    const app = buildApp()
    const response = await request(app).post('/api/auth/login').send({
      email: 'member@example.com', password: TEST_PASSWORD, rememberMe: true,
    })
    const cookie = response.headers['set-cookie'][0].split(';')[0]
    const store = app.locals.sessionStore
    const sessions = await new Promise((resolve) => store.all((error, values) => resolve(values)))
    const [sid, saved] = Object.entries(sessions)[0]
    const deadline = Date.now() + 60_000
    saved.rememberUntil = deadline
    await new Promise((resolve) => store.set(sid, saved, resolve))
    const active = await request(app).get('/api/auth/me').set('Cookie', cookie)
    assert.equal(active.body.authenticated, true)
    const refreshed = await new Promise((resolve) => store.get(sid, (error, value) => resolve(value)))
    assert.ok(Date.parse(refreshed.cookie.expires) <= deadline + 100)
    refreshed.rememberUntil = Date.now() - 1
    await new Promise((resolve) => store.set(sid, refreshed, resolve))
    const protectedResponse = await request(app).get('/api/protected').set('Cookie', cookie)
    assert.equal(protectedResponse.status, 401)
    const me = await request(app).get('/api/auth/me').set('Cookie', cookie)
    assert.equal(me.body.authenticated, false)
  })

  it('保持登录也受退出与账号禁用控制，不能复用旧 Cookie', async () => {
    const app = buildApp()
    const response = await request(app).post('/api/auth/login').send({
      email: 'member@example.com', password: TEST_PASSWORD, rememberMe: true,
    })
    const cookie = response.headers['set-cookie'][0].split(';')[0]
    assert.equal((await request(app).post('/api/auth/logout').set('Cookie', cookie)).status, 200)
    assert.equal((await request(app).get('/api/protected').set('Cookie', cookie)).status, 401)
    const relogin = await request(app).post('/api/auth/login').send({
      email: 'member@example.com', password: TEST_PASSWORD, rememberMe: true,
    })
    app.locals.database.prepare("UPDATE users SET status = 'disabled' WHERE id = 2").run()
    const disabled = await request(app).get('/api/auth/me')
      .set('Cookie', relogin.headers['set-cookie'][0].split(';')[0])
    assert.equal(disabled.body.authenticated, false)
  })
})
