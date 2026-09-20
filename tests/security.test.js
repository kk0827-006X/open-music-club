const assert = require('node:assert/strict')
const { afterEach, beforeEach, describe, it } = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const bcrypt = require('bcrypt')
const session = require('express-session')
const { MemoryStore: RateLimitMemoryStore } = require('express-rate-limit')
const request = require('supertest')

const { createApp } = require('../src/app')
const { createUser } = require('../src/db/users')

const ORIGIN = 'https://music.example.com'
const TEST_PASSWORD = 'test-password'

describe('公网通信安全基线', () => {
  let directory
  let applications

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'open-music-security-'))
    applications = []
  })

  afterEach(async () => {
    for (const app of applications) {
      if (app.locals.database?.open) app.locals.database.close()
      if (app.locals.sessionStore?.db?.open) {
        await new Promise((resolve) => app.locals.sessionStore.db.close(resolve))
      }
    }
    fs.rmSync(directory, { recursive: true, force: true })
  })

  function buildApp(overrides = {}) {
    const index = applications.length
    const rateLimitScopes = []
    const app = createApp({
      databasePath: path.join(directory, `database-${index}.sqlite`),
      sessionSecret: 'security-test-session-secret',
      localMusic: { storageRoot: path.join(directory, `storage-${index}`) },
      infrastructure: {
        sessionStore: new session.MemoryStore(),
        createRateLimitStore(scope) {
          rateLimitScopes.push(scope)
          return new RateLimitMemoryStore()
        },
      },
      security: {
        production: true,
        publicOrigin: ORIGIN,
        trustProxyHops: 1,
        logger: { error() {} },
        ...overrides,
      },
    })
    app.locals.rateLimitScopes = rateLimitScopes
    applications.push(app)
    return app
  }

  function asHttps(operation, origin = ORIGIN) {
    return operation
      .set('X-Forwarded-Proto', 'https')
      .set('Origin', origin)
  }

  async function getCsrfSession(app) {
    const response = await asHttps(
      request(app).get('/api/security/csrf-token'),
    )
    assert.equal(response.status, 200)
    return {
      token: response.body.csrfToken,
      cookie: response.headers['set-cookie'][0].split(';')[0],
    }
  }

  async function createMember(app) {
    const passwordHash = await bcrypt.hash(TEST_PASSWORD, 4)
    return createUser(app.locals.database, {
      email: 'member@example.com',
      nickname: '普通成员',
      passwordHash,
      role: 'user',
      status: 'active',
      mustChangePassword: false,
    })
  }

  it('生产配置缺少 HTTPS Origin 或代理跳数时拒绝启动且不创建数据库', () => {
    const databasePath = path.join(directory, 'invalid.sqlite')
    assert.throws(
      () =>
        applications.push(createApp({
          databasePath,
          sessionSecret: 'test-secret',
          localMusic: { storageRoot: path.join(directory, 'invalid-storage') },
          security: {
            production: true,
            publicOrigin: 'http://music.example.com',
            trustProxyHops: 0,
          },
        })),
      /PUBLIC_ORIGIN|TRUST_PROXY_HOPS/,
    )
    assert.equal(fs.existsSync(databasePath), false)
  })

  it('生产环境缺少 Redis Session 或限流存储时拒绝启动', () => {
    const databasePath = path.join(directory, 'missing-redis.sqlite')
    assert.throws(
      () =>
        createApp({
          databasePath,
          sessionSecret: 'test-secret',
          localMusic: { storageRoot: path.join(directory, 'missing-redis-storage') },
          security: {
            production: true,
            publicOrigin: ORIGIN,
            trustProxyHops: 1,
          },
        }),
      /Redis Session|Redis 限流/,
    )
    assert.equal(fs.existsSync(databasePath), false)
  })

  it('所有分层限流器使用各自的 Redis 命名空间 Store', () => {
    const app = buildApp()
    assert.deepEqual(app.locals.rateLimitScopes, [
      'global',
      'login',
      'applications',
      'upload',
      'download',
      'netease',
    ])
  })

  it('不安全请求使用固定正式 Origin 进行 308 跳转且不创建 Session', async () => {
    const app = buildApp()
    const response = await request(app)
      .get('/api/auth/me?next=1')
      .set('Host', 'attacker.example')

    assert.equal(response.status, 308)
    assert.equal(
      response.headers.location,
      `${ORIGIN}/api/auth/me?next=1`,
    )
    assert.equal(response.headers['set-cookie'], undefined)
  })

  it('可信代理报告 HTTPS 后返回安全响应头并隐藏 Express 标识', async () => {
    const response = await asHttps(request(buildApp()).get('/health'))

    assert.equal(response.status, 200)
    assert.equal(response.headers['x-powered-by'], undefined)
    assert.match(response.headers['strict-transport-security'], /max-age=/)
    assert.equal(response.headers['x-content-type-options'], 'nosniff')
    assert.equal(response.headers['x-frame-options'], 'DENY')
    assert.match(response.headers['content-security-policy'], /default-src 'self'/)
    assert.match(response.headers['referrer-policy'], /no-referrer/)
    assert.match(response.headers['x-request-id'], /^[0-9a-f-]{36}$/)
  })

  it('CORS 只允许正式 Origin，并正确处理预检请求', async () => {
    const app = buildApp()
    const allowed = await asHttps(
      request(app)
        .options('/api/auth/login')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'content-type,x-csrf-token'),
    )
    const rejected = await asHttps(
      request(app).get('/health'),
      'https://attacker.example',
    )

    assert.equal(allowed.status, 204)
    assert.equal(allowed.headers['access-control-allow-origin'], ORIGIN)
    assert.equal(allowed.headers['access-control-allow-credentials'], 'true')
    assert.doesNotMatch(allowed.headers['access-control-allow-origin'], /\*/)
    assert.equal(rejected.status, 403)
    assert.deepEqual(rejected.body, {
      success: false,
      message: '请求来源不受信任',
      requestId: rejected.headers['x-request-id'],
    })
  })

  it('修改数据的接口要求同源 CSRF Token', async () => {
    const app = buildApp()
    const missing = await asHttps(
      request(app).post('/api/applications').send({
        email: 'candidate@example.com',
        nickname: '候选成员',
      }),
    )
    const csrf = await getCsrfSession(app)
    const accepted = await asHttps(
      request(app)
        .post('/api/applications')
        .set('Cookie', csrf.cookie)
        .set('X-CSRF-Token', csrf.token)
        .send({
          email: 'candidate@example.com',
          nickname: '候选成员',
        }),
    )

    assert.equal(missing.status, 403)
    assert.equal(missing.body.message, 'CSRF 校验失败')
    assert.equal(accepted.status, 201)
  })

  it('生产登录 Cookie 使用 __Host 前缀和安全属性', async () => {
    const app = buildApp()
    await createMember(app)
    const csrf = await getCsrfSession(app)

    const response = await asHttps(
      request(app)
        .post('/api/auth/login')
        .set('Cookie', csrf.cookie)
        .set('X-CSRF-Token', csrf.token)
        .send({ email: 'member@example.com', password: TEST_PASSWORD }),
    )

    assert.equal(response.status, 200)
    const cookie = response.headers['set-cookie'][0]
    assert.match(cookie, /^__Host-open_music_club\.sid=/)
    assert.match(cookie, /Secure/)
    assert.match(cookie, /HttpOnly/)
    assert.match(cookie, /SameSite=Lax/)
    assert.match(cookie, /Path=\//)
    assert.match(cookie, /Expires=/)
    assert.doesNotMatch(cookie, /Domain=/)
  })

  it('登录成功重新生成 Session 后旧 CSRF Token 不能继续使用', async () => {
    const app = buildApp()
    await createMember(app)
    const csrf = await getCsrfSession(app)
    const loginResponse = await asHttps(
      request(app)
        .post('/api/auth/login')
        .set('Cookie', csrf.cookie)
        .set('X-CSRF-Token', csrf.token)
        .send({ email: 'member@example.com', password: TEST_PASSWORD }),
    )
    const loginCookie = loginResponse.headers['set-cookie'][0].split(';')[0]

    const logoutResponse = await asHttps(
      request(app)
        .post('/api/auth/logout')
        .set('Cookie', loginCookie)
        .set('X-CSRF-Token', csrf.token),
    )

    assert.equal(logoutResponse.status, 403)
    assert.equal(logoutResponse.body.message, 'CSRF 校验失败')
  })

  it('登录接口超过独立限制后返回统一 429', async () => {
    const app = buildApp({
      rateLimits: {
        login: { windowMs: 60_000, limit: 2 },
      },
    })
    const csrf = await getCsrfSession(app)

    const responses = []
    for (let index = 0; index < 3; index += 1) {
      responses.push(
        await asHttps(
          request(app)
            .post('/api/auth/login')
            .set('Cookie', csrf.cookie)
            .set('X-CSRF-Token', csrf.token)
            .send({ email: 'nobody@example.com', password: 'wrong-password' }),
        ),
      )
    }

    assert.deepEqual(
      responses.map((response) => response.status),
      [401, 401, 429],
    )
    assert.equal(responses[2].body.message, '请求过于频繁，请稍后再试')
    assert.equal(responses[2].body.requestId, responses[2].headers['x-request-id'])
  })

  it('过大的 JSON 请求在进入业务逻辑前被拒绝', async () => {
    const response = await asHttps(
      request(buildApp({ jsonBodyLimit: '1kb' }))
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send({ email: 'a'.repeat(2048), password: 'password' }),
    )

    assert.equal(response.status, 413)
    assert.deepEqual(response.body, {
      success: false,
      message: '请求内容过大',
      requestId: response.headers['x-request-id'],
    })
  })

  it('500 错误只返回通用消息和请求 ID，不暴露内部细节', async () => {
    const app = buildApp()
    const csrf = await getCsrfSession(app)
    app.locals.database.close()

    const response = await asHttps(
      request(app)
        .post('/api/auth/login')
        .set('Cookie', csrf.cookie)
        .set('X-CSRF-Token', csrf.token)
        .send({ email: 'member@example.com', password: TEST_PASSWORD }),
    )

    assert.equal(response.status, 500)
    assert.deepEqual(response.body, {
      success: false,
      message: '服务器内部错误',
      requestId: response.headers['x-request-id'],
    })
    const serialized = JSON.stringify(response.body)
    assert.doesNotMatch(serialized, /sqlite|database|stack|\/Users\//i)
  })

  it('未知接口返回统一 JSON 404，不返回 HTML 或框架信息', async () => {
    const response = await asHttps(
      request(buildApp()).get('/api/not-available'),
    )

    assert.equal(response.status, 404)
    assert.deepEqual(response.body, {
      success: false,
      message: '接口不存在',
      requestId: response.headers['x-request-id'],
    })
    assert.match(response.headers['content-type'], /application\/json/)
  })
})
