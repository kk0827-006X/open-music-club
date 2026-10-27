const assert = require('node:assert/strict')
const { it } = require('node:test')
const { withReactHarness } = require('./helpers/reactHarness')
const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const token = 'a'.repeat(43)
const applicant = { id: 7, nickname: '音乐爱好者', reason: '愿意分享音乐', status: 'pending', emailVerified: true, createdAt: '2026-10-27T00:00:00Z', reviewedAt: null, reviewedBy: null, activatedAt: null, notificationStatus: 'delivered' }

it('验证链接立即清除fragment，GET不消费凭证，点击后才提交且不挂载播放器', async () => {
  const calls = []
  await withReactHarness(async h => {
    h.window.history.replaceState(null, '', `/verify-email#token=${token}`)
    const { App } = await import('../frontend/src/app/App.tsx')
    await h.render(h.React.createElement(App))
    assert.equal(h.window.location.hash, '')
    assert.equal(h.query('[data-album-archive]'), null)
    assert.equal(h.query('audio'), null)
    assert.equal(calls.length, 0)
    await h.submit('[data-application-link-page] form')
    assert.deepEqual(calls.map(call => call.url), ['/api/security/csrf-token', '/api/applications/verify-email'])
    assert.deepEqual(JSON.parse(calls[1].init.body), { token })
    assert.match(h.document.body.textContent, /邮箱验证成功.*进入管理员审核/)
    assert.equal(h.window.localStorage.length, 0)
  }, { fetch: async (url, init) => { calls.push({ url, init }); return response(200, url.includes('csrf-token') ? { csrfToken: 'csrf' } : { success: true }) } })
})
it('激活验证UTF8字节和二次密码，不自动登录，成功清除密码输入', async () => {
  const calls = []
  await withReactHarness(async h => {
    h.window.history.replaceState(null, '', `/activate#token=${token}`)
    const { App } = await import('../frontend/src/app/App.tsx')
    await h.render(h.React.createElement(App))
    await h.input('#activation-password', '短密码'); await h.input('#activation-confirm', '短密码')
    await h.submit('[data-application-link-page] form'); assert.equal(calls.length, 0)
    assert.match(h.document.body.textContent, /15～72/)
    const password = 'isolated-long-password'
    await h.input('#activation-password', password); await h.input('#activation-confirm', 'different-password')
    await h.submit('[data-application-link-page] form'); assert.equal(calls.length, 0)
    await h.input('#activation-confirm', password); await h.submit('[data-application-link-page] form')
    assert.deepEqual(calls.map(call => call.url), ['/api/security/csrf-token', '/api/auth/activate'])
    assert.deepEqual(JSON.parse(calls[1].init.body), { token, password })
    assert.equal(h.query('#activation-password'), null)
    assert.match(h.document.body.textContent, /账号已激活/)
    assert.equal(h.require('.application-return').getAttribute('href'), '/')
  }, { fetch: async (url, init) => { calls.push({ url, init }); return response(200, url.includes('csrf-token') ? { csrfToken: 'csrf' } : { success: true }) } })
})
it('密码长度按UTF8字节计数，兼容中文并拒绝bcrypt截断', async () => {
  const { passwordValid } = await import('../frontend/src/services/auth/applications.ts')
  assert.equal(passwordValid('中'.repeat(5)), true)
  assert.equal(passwordValid('中'.repeat(24)), true)
  assert.equal(passwordValid('中'.repeat(25)), false)
  assert.equal(passwordValid('a'.repeat(14)), false)
  assert.equal(passwordValid('a'.repeat(72)), true)
  assert.equal(passwordValid('a'.repeat(73)), false)
})
it('过期链接允许重发，统一成功文案不透露申请或账号是否存在', async () => {
  const calls = []
  await withReactHarness(async h => {
    const { ApplicationLinkPage } = await import('../frontend/src/features/auth/ApplicationLinkPage.tsx')
    await h.render(h.React.createElement(ApplicationLinkPage, { purpose: 'verify', initialToken: token }))
    await h.submit('[data-application-link-page] form')
    assert.match(h.document.body.textContent, /链接无效/)
    await h.input('#resend-email', ' Candidate@Example.com ')
    await h.submit('.application-resend-form')
    assert.match(h.document.body.textContent, /如果该邮箱符合条件/)
    assert.deepEqual(JSON.parse(calls.at(-1).init.body), { email: 'candidate@example.com', purpose: 'verify' })
    assert.doesNotMatch(h.document.body.textContent, /internal-secret/)
  }, { fetch: async (url, init) => {
    calls.push({ url, init })
    return url.includes('csrf-token') ? response(200, { csrfToken: 'csrf' }) : url.endsWith('verify-email') ? response(410, { message: '/private/internal-secret' }) : response(202, { success: true })
  } })
})
it('管理员仅查看脱敏字段，审批须确认，只发送空body且处理后禁用', async () => {
  const calls = []; let approved = false
  await withReactHarness(async h => {
    const { AdminApplicationsPage } = await import('../frontend/src/features/auth/AdminApplicationsPage.tsx')
    await h.render(h.React.createElement(AdminApplicationsPage, { onLogout: async () => {} }))
    await h.click('.application-list-item')
    assert.match(h.document.body.textContent, /愿意分享音乐/)
    assert.equal(h.query('input[type="password"]'), null)
    assert.doesNotMatch(h.document.body.textContent, /candidate@example.com|initialPassword/)
    await h.click('.application-detail .primary-action')
    assert.equal(calls.filter(call => call.init?.method === 'POST').length, 0)
    assert.equal(h.require('.application-confirm-dialog').open, true)
    await h.click('.application-confirm-dialog .primary-action')
    const post = calls.find(call => call.init?.method === 'POST')
    assert.equal(post.url, '/api/admin/applications/7/approve')
    assert.deepEqual(JSON.parse(post.init.body), {})
    assert.equal(post.init.headers['X-CSRF-Token'], 'csrf')
    assert.match(h.document.body.textContent, /已通过审核/)
    await h.click('.application-list-item')
    assert.equal(h.require('.application-detail .primary-action').disabled, true)
  }, { fetch: async (url, init) => {
    calls.push({ url, init })
    if (url.includes('csrf-token')) return response(200, { csrfToken: 'csrf' })
    if (init?.method === 'POST') { approved = true; return response(200, { success: true, application: { ...applicant, status: 'approved' } }) }
    return response(200, { success: true, applications: [{ ...applicant, status: approved ? 'approved' : 'pending' }], total: 1, page: 1, pageSize: 20 })
  } })
})
it('后台403展示重新登录与2FA设置引导，不展示未授权申请', async () => {
  await withReactHarness(async h => {
    const { AdminApplicationsPage } = await import('../frontend/src/features/auth/AdminApplicationsPage.tsx')
    await h.render(h.React.createElement(AdminApplicationsPage, { onLogout: async () => {} }))
    assert.match(h.require('[role="alert"]').textContent, /两步验证/)
    assert.match(h.document.body.textContent, /设置.*两步验证/)
    assert.equal(h.query('.application-list-item'), null)
    assert.equal(h.query('.application-detail .primary-action'), null)
  }, { fetch: async () => response(403, { success: false, message: '/private/db.sqlite' }) })
})
it('申请筛选切换正确请求，空列表和错误均可恢复', async () => {
  const calls = []
  await withReactHarness(async h => {
    const { AdminApplicationsPage } = await import('../frontend/src/features/auth/AdminApplicationsPage.tsx')
    await h.render(h.React.createElement(AdminApplicationsPage, { onLogout: async () => {} }))
    await h.click('.application-filters button:nth-child(5)')
    assert.ok(calls.some(url => url.includes('status=notification_error&page=1')))
    assert.match(h.document.body.textContent, /没有符合条件的申请/)
  }, { fetch: async url => { calls.push(url); return response(200, { success: true, applications: [], total: 0 }) } })
})
