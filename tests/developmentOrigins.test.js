const assert = require('node:assert/strict')
const { it, beforeEach, afterEach } = require('node:test')
const express = require('express')
const session = require('express-session')
const request = require('supertest')
const { createSecurityConfig } = require('../src/config/security')
const { createSameOriginCors, createCsrfProtection, csrfTokenHandler } = require('../src/middleware/security')

const LOCAL = 'http://127.0.0.1:5173'
// 测试使用虚构的虚拟网地址，不把本机实际网络信息写入版本库。
const ZEROTIER = 'http://10.147.17.2:5173'
const PRODUCTION = 'https://music.example.com'
let previousOrigins

beforeEach(() => {
  previousOrigins = process.env.DEV_ALLOWED_ORIGINS
  process.env.DEV_ALLOWED_ORIGINS = `${LOCAL},http://localhost:5173,${ZEROTIER}`
})
afterEach(() => {
  if (previousOrigins === undefined) delete process.env.DEV_ALLOWED_ORIGINS
  else process.env.DEV_ALLOWED_ORIGINS = previousOrigins
})

function developmentConfig() {
  return createSecurityConfig({ production: false, publicOrigin: PRODUCTION, csrfEnabled: true })
}
function testApp(config = developmentConfig()) {
  const app = express()
  app.use(createSameOriginCors(config))
  app.use(session({ secret: 'isolated-origin-test-only', resave: false, saveUninitialized: false }))
  app.get('/csrf', csrfTokenHandler)
  app.use(createCsrfProtection(config))
  app.get('/health', (req, res) => res.json({ ok: true }))
  app.post('/write', (req, res) => res.json({ ok: true }))
  return app
}

it('开发环境使用独立的精确 Origin 列表，不继承正式域名', () => {
  const config = developmentConfig()
  assert.deepEqual(config.allowedOrigins, [LOCAL, 'http://localhost:5173', ZEROTIER])
  assert.equal(config.publicOrigin, PRODUCTION)
  assert.equal(config.secureCookies, false)
  assert.equal(config.enforceHttps, false)
})

it('开发 Origin 去重并规范化；未配置时沿用原 PUBLIC_ORIGIN', () => {
  process.env.DEV_ALLOWED_ORIGINS = ` ${LOCAL}/, ${LOCAL}, ${ZEROTIER} `
  assert.deepEqual(developmentConfig().allowedOrigins, [LOCAL, ZEROTIER])
  delete process.env.DEV_ALLOWED_ORIGINS
  assert.deepEqual(developmentConfig().allowedOrigins, [PRODUCTION])
})

it('开发 Origin 不接受通配符、文件协议、凭据、路径或查询参数', () => {
  for (const value of ['*', 'http://*.example.com', 'file:///tmp/', 'http://user:pass@example.com', `${LOCAL}/path`, `${LOCAL}?query=1`]) {
    process.env.DEV_ALLOWED_ORIGINS = value
    assert.throws(developmentConfig, /DEV_ALLOWED_ORIGINS/)
  }
})

it('生产环境忽略全部开发 Origin 配置，保留 HTTPS、Cookie、CSRF 和代理策略', async () => {
  for (const value of [ZEROTIER, '*']) {
    process.env.DEV_ALLOWED_ORIGINS = value
    const config = createSecurityConfig({ production: true, publicOrigin: PRODUCTION, trustProxyHops: 1 })
    assert.deepEqual(config.allowedOrigins, [PRODUCTION])
    assert.equal(config.secureCookies, true)
    assert.equal(config.enforceHttps, true)
    assert.equal(config.csrfEnabled, true)
    assert.equal(config.trustProxyHops, 1)
    const response = await request(testApp(config)).get('/health').set('Origin', ZEROTIER)
    assert.equal(response.status, 403)
  }
})

it('本机和 ZeroTier 的 CORS 预检都返回各自的精确 Origin，不使用通配符', async () => {
  const app = testApp()
  for (const origin of [LOCAL, 'http://localhost:5173', ZEROTIER]) {
    const response = await request(app).options('/write').set('Origin', origin).set('Access-Control-Request-Method', 'POST')
    assert.equal(response.status, 204)
    assert.equal(response.headers['access-control-allow-origin'], origin)
    assert.equal(response.headers['access-control-allow-credentials'], 'true')
    assert.match(response.headers.vary, /Origin/)
  }
})

it('不信任其他群内 IP、不同端口、伪装域名或正式站点对开发服务的跨域请求', async () => {
  const app = testApp()
  for (const origin of ['http://10.147.17.3:5173', 'http://10.147.17.2:5174', 'http://10.147.17.2.attacker.example:5173', PRODUCTION]) {
    assert.equal((await request(app).get('/health').set('Origin', origin)).status, 403)
  }
})

it('ZeroTier 和本机来源仍须正确的 Session CSRF Token 才能写入', async () => {
  for (const origin of [LOCAL, ZEROTIER]) {
    const agent = request.agent(testApp())
    const csrf = await agent.get('/csrf').set('Origin', origin)
    assert.equal(csrf.status, 200)
    assert.equal((await agent.post('/write').set('Origin', origin)).status, 403)
    assert.equal((await agent.post('/write').set('Origin', origin).set('X-CSRF-Token', 'wrong')).status, 403)
    assert.equal((await agent.post('/write').set('Origin', origin).set('X-CSRF-Token', csrf.body.csrfToken)).status, 200)
    assert.equal((await agent.post('/write').set('X-CSRF-Token', csrf.body.csrfToken)).status, 403)
  }
})
