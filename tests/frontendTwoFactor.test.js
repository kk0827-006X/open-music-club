const { it } = require('node:test')
const assert = require('node:assert/strict')

it('密码通过但需要 2FA 时，不查询正式身份或进入授权画面', async () => {
  const { loginAndVerify } = await import('../frontend/src/auth-client.ts')
  const calls = []
  const result = await loginAndVerify({ email: 'a@example.com', password: 'password' }, async url => {
    calls.push(url)
    return { ok: true, status: 200, json: async () => url.includes('csrf') ? { csrfToken: 'token' } : { requiresTwoFactor: true, enrollmentRequired: true } }
  })
  assert.equal(result.user, null); assert.equal(result.requiresTwoFactor, true)
  assert.equal(calls.length, 2)
})
it('第二因子提交使用新 CSRF，成功后再次向服务器确认 Session', async () => {
  const { verifyTwoFactor } = await import('../frontend/src/auth-client.ts')
  const calls = []
  const user = await verifyTwoFactor('recovery', true, async (url, init) => {
    calls.push({ url, init })
    return { ok: true, status: 200, json: async () => url.includes('csrf') ? { csrfToken: 'new' } : url.endsWith('/me') ? { authenticated: true, user: { id: 1, email: 'a@example.com', role: 'user' } } : { success: true } }
  })
  assert.equal(user.id, 1)
  assert.deepEqual(calls.map(c => c.url), ['/api/security/csrf-token', '/api/auth/2fa/recovery', '/api/auth/me'])
  assert.equal(calls[1].init.headers['X-CSRF-Token'], 'new')
})
it('无效验证码、无效 CSRF、网络错误与未确认身份不得伪装成功', async () => {
  const { verifyTwoFactor, twoFactorRequest } = await import('../frontend/src/auth-client.ts')
  await assert.rejects(twoFactorRequest('verify', {}, async () => ({ ok: false, status: 403, json: async () => ({}) })), /安全/)
  await assert.rejects(twoFactorRequest('status', undefined, async () => ({ ok: false, status: 401, json: async () => ({ message: '验证失败' }) })), /验证失败/)
  await assert.rejects(twoFactorRequest('status', undefined, async () => { throw new Error('离线') }), /离线/)
  await assert.rejects(verifyTwoFactor('123456', false, async url => ({ ok: true, status: 200, json: async () => url.includes('csrf') ? { csrfToken: 'token' } : {} })), /会话/)
})
