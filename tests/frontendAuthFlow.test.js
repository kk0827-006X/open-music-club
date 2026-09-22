const assert = require('node:assert/strict')
const path = require('node:path')
const { describe, it } = require('node:test')
const { pathToFileURL } = require('node:url')

const projectRoot = path.resolve(__dirname, '..')

function frontendModule(relativePath) {
  const modulePath = path.join(projectRoot, 'frontend/src', relativePath)
  return `${pathToFileURL(modulePath).href}?test=${Date.now()}-${Math.random()}`
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body
    },
  }
}

describe('前端真实登录与启动流程', () => {
  it('按 CSRF、登录、me 的顺序确认服务端管理员身份', async () => {
    const { loginAndVerify } = await import(frontendModule('auth-client.ts'))
    const calls = []
    const fetcher = async (url, options = {}) => {
      calls.push({ url, options })
      if (url === '/api/security/csrf-token') {
        return jsonResponse(200, { csrfToken: 'csrf-test-token' })
      }
      if (url === '/api/auth/login') {
        return jsonResponse(200, {
          success: true,
          user: { id: 1, email: 'admin@example.com', role: 'admin' },
        })
      }
      return jsonResponse(200, {
        authenticated: true,
        user: { id: 1, email: 'admin@example.com', role: 'admin' },
      })
    }

    const result = await loginAndVerify(
      { email: ' admin@example.com ', password: 'secret-password' },
      fetcher,
    )

    assert.equal(result.user.role, 'admin')
    assert.deepEqual(calls.map((call) => call.url), [
      '/api/security/csrf-token',
      '/api/auth/login',
      '/api/auth/me',
    ])
    assert.equal(calls[1].options.headers['X-CSRF-Token'], 'csrf-test-token')
    assert.equal(calls[1].options.credentials, 'same-origin')
    assert.deepEqual(JSON.parse(calls[1].options.body), {
      email: 'admin@example.com',
      password: 'secret-password',
    })
  })

  it('不接受登录响应与 me 响应不一致的会话', async () => {
    const { loginAndVerify, AuthFlowError } = await import(
      frontendModule('auth-client.ts')
    )
    const responses = [
      jsonResponse(200, { csrfToken: 'token' }),
      jsonResponse(200, {
        success: true,
        user: { id: 1, role: 'admin' },
      }),
      jsonResponse(200, { authenticated: false, user: null }),
    ]

    await assert.rejects(
      () => loginAndVerify(
        { email: 'admin@example.com', password: 'secret-password' },
        async () => responses.shift(),
      ),
      (error) => error instanceof AuthFlowError && error.code === 'SESSION_UNVERIFIED',
    )
  })

  it('把后端错误转换为安全的用户提示', async () => {
    const { loginAndVerify, AuthFlowError } = await import(
      frontendModule('auth-client.ts')
    )
    const responses = [
      jsonResponse(200, { csrfToken: 'token' }),
      jsonResponse(401, { success: false, message: '邮箱或密码错误' }),
    ]

    await assert.rejects(
      () => loginAndVerify(
        { email: 'admin@example.com', password: 'wrong-password' },
        async () => responses.shift(),
      ),
      (error) => error instanceof AuthFlowError
        && error.code === 'LOGIN_REJECTED'
        && error.message === '邮箱或密码错误',
    )
  })

  it('入口页在登录页之前，且不包含业务导航', async () => {
    const { createEntryMarkup } = await import(frontendModule('entry-page.ts'))
    const markup = createEntryMarkup()

    assert.match(markup, /data-entry-start/)
    assert.match(markup, /点击进入/)
    assert.match(markup, /OPEN MUSIC CLUB/)
    assert.doesNotMatch(markup, /data-login-form/)
    assert.doesNotMatch(markup, /data-business-navigation/)
  })

  it('登录成功后使用原项目时间轨依次进入授权与欢迎阶段', async () => {
    const { sampleAuthorizedSequence } = await import(
      frontendModule('authorized-sequence.ts')
    )

    assert.equal(sampleAuthorizedSequence(0).step, 'scan')
    assert.equal(sampleAuthorizedSequence(3300).step, 'welcome')
    assert.equal(sampleAuthorizedSequence(7600).complete, true)
  })
})
