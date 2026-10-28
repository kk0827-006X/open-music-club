const assert = require('node:assert/strict')
const { it } = require('node:test')
const { withReactHarness } = require('./helpers/reactHarness')
const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const token = 'a'.repeat(43)
const pending = {
  id: 7, nickname: '音乐爱好者', reason: '愿意分享音乐', status: 'pending',
  canReview: true, canResendActivation: false, activationMailStatus: null, notificationStatus: 'delivered',
  emailVerified: false, createdAt: '2026-10-27T00:00:00Z', reviewedAt: null, reviewedBy: null, activatedAt: null,
}
const awaiting = {
  ...pending, status: 'approved', canReview: false, canResendActivation: true,
  // 最新的管理员提醒失败不能覆盖激活邮件状态。
  activationMailStatus: 'delivered', notificationStatus: 'failed', reviewedAt: '2026-10-27T00:10:00Z', reviewedBy: 1,
}

it('旧验证链接只显示流程简化说明，不提交验证也不挂载播放器', async () => {
  let calls = 0
  await withReactHarness(async h => {
    h.window.history.replaceState(null, '', `/verify-email#token=${token}`)
    const { App } = await import('../frontend/src/app/App.tsx')
    await h.render(h.React.createElement(App))
    assert.equal(h.window.location.hash, '')
    assert.equal(h.query('[data-album-archive]'), null)
    assert.equal(h.query('audio'), null)
    assert.equal(h.query('[data-application-link-page] form'), null)
    assert.match(h.document.body.textContent, /申请流程已简化/)
    assert.match(h.document.body.textContent, /无需验证邮箱/)
    assert.equal(h.require('[data-application-link-page] a[href="/activate"]').getAttribute('href'), '/activate')
    assert.equal(calls, 0)
    assert.equal(h.window.localStorage.length, 0)
  }, { fetch: async () => { calls++; return response(500, {}) } })
})

it('激活按新密码规则校验并单独提示确认密码，不自动登录，成功清除密码输入', async () => {
  const calls = []
  await withReactHarness(async h => {
    h.window.history.replaceState(null, '', `/activate#token=${token}`)
    const { App } = await import('../frontend/src/app/App.tsx')
    await h.render(h.React.createElement(App))
    assert.equal(h.require('#activation-password').minLength, 8)
    // 不设置 maxLength：浏览器静默截断会让用户以为设置了更长密码；超长由 JS 与后端明确拒绝。
    assert.equal(h.require('#activation-password').maxLength, -1)
    assert.equal(h.require('[data-application-link-page] form').noValidate, true)
    assert.match(h.require('#password-hint').textContent, /密码需为8～72位，包含大写字母、小写字母、数字和符号。/)
    await h.input('#activation-password', '短密码'); await h.input('#activation-confirm', '短密码')
    await h.submit('[data-application-link-page] form'); assert.equal(calls.length, 0)
    assert.match(h.document.body.textContent, /密码只能由半角英文字母、数字和英文符号组成，长度8～72位/)
    assert.doesNotMatch(h.document.body.textContent, /UTF-?8|字节/)
    // 8 位但缺大写仍被拒绝，且不会发请求。
    await h.input('#activation-password', 'abcdef1!'); await h.input('#activation-confirm', 'abcdef1!')
    await h.submit('[data-application-link-page] form'); assert.equal(calls.length, 0)
    assert.match(h.document.body.textContent, /需同时包含大写字母、小写字母、数字和符号/)
    const password = 'Active1!'
    await h.input('#activation-password', password); await h.input('#activation-confirm', 'Different1!')
    await h.submit('[data-application-link-page] form'); assert.equal(calls.length, 0)
    assert.match(h.document.body.textContent, /两次输入的密码不一致，请重新输入/)
    await h.input('#activation-confirm', password); await h.submit('[data-application-link-page] form')
    assert.deepEqual(calls.map(call => call.url), ['/api/security/csrf-token', '/api/auth/activate'])
    assert.deepEqual(JSON.parse(calls[1].init.body), { token, password })
    assert.equal(h.query('#activation-password'), null)
    assert.match(h.document.body.textContent, /账号已激活/)
    assert.equal(h.require('.application-return').getAttribute('href'), '/')
  }, { fetch: async (url, init) => { calls.push({ url, init }); return response(200, url.includes('csrf-token') ? { csrfToken: 'csrf' } : { success: true }) } })
})

it('前端密码规则与后端一致，覆盖边界、四类字符与非法输入', async () => {
  const { passwordValid } = await import('../frontend/src/services/auth/applications.ts')
  const backend = await import('../src/services/accessLifecycle.service.js')
  const isValidActivationPassword = backend.isValidActivationPassword || backend.default?.isValidActivationPassword
  assert.equal(typeof isValidActivationPassword, 'function')
  const cases = [
    ['Abcdef1!', true],
    ['Active1!', true],
    ['Abc1!xy', false], // 7 位
    ['Aa1!' + 'x'.repeat(68), true], // 72 位
    ['Aa1!' + 'x'.repeat(69), false], // 73 位
    ['abcdef1!', false], // 缺大写
    ['ABCDEF1!', false], // 缺小写
    ['Abcdefg!', false], // 缺数字
    ['Abcdefg1', false], // 缺符号
    ['Abcdef1 !', false], // 空格
    [' Abcdef1!', false], // 前导空格不得被 trim 成合法密码
    ['Abcdef1!\n', false], // 换行
    ['Abcdef1!\t', false], // 控制字符
    ['Abcdef1!\u0000', false], // NUL
    ['Abcdef1!\u007f', false], // DEL
    ['Abcdef1!中', false], // 中文
    ['Aa1!' + 'x'.repeat(67) + '中', false], // 长度在 72 位内但含中文，仍须拒绝
    ['Abcdef1!😀', false], // 其他 Unicode
    [null, false],
    [undefined, false],
  ]
  for (const [password, expected] of cases) {
    assert.equal(passwordValid(password), expected, `前端规则不一致: ${String(password)}`)
    assert.equal(isValidActivationPassword(password), expected, `后端规则不一致: ${String(password)}`)
  }
})

it('过期激活链接允许重发，统一成功文案不透露申请或账号是否存在', async () => {
  const calls = []
  await withReactHarness(async h => {
    const { ApplicationLinkPage } = await import('../frontend/src/features/auth/ApplicationLinkPage.tsx')
    await h.render(h.React.createElement(ApplicationLinkPage, { purpose: 'activate', initialToken: token }))
    await h.input('#activation-password', 'Isolated-Long1'); await h.input('#activation-confirm', 'Isolated-Long1')
    await h.submit('[data-application-link-page] form')
    assert.match(h.document.body.textContent, /链接无效/)
    await h.input('#resend-email', ' Candidate@Example.com ')
    await h.submit('.application-resend-form')
    assert.match(h.document.body.textContent, /如果该邮箱对应的申请已通过且尚未激活/)
    assert.deepEqual(JSON.parse(calls.at(-1).init.body), { email: 'candidate@example.com', purpose: 'activate' })
    assert.doesNotMatch(h.document.body.textContent, /internal-secret/)
  }, { fetch: async (url, init) => {
    calls.push({ url, init })
    return url.includes('csrf-token') ? response(200, { csrfToken: 'csrf' }) : url.endsWith('activate') && init?.method === 'POST' ? response(410, { message: '/private/internal-secret' }) : response(202, { success: true })
  } })
})

it('管理员可直接审批待审核申请，确认后才发送空 body 且处理后禁用重复审核', async () => {
  const calls = []
  await withReactHarness(async h => {
    const { AdminApplicationsPage } = await import('../frontend/src/features/auth/AdminApplicationsPage.tsx')
    await h.render(h.React.createElement(AdminApplicationsPage, { onLogout: async () => {} }))
    await h.click('.application-list-item')
    assert.match(h.document.body.textContent, /愿意分享音乐/)
    assert.equal(h.query('input[type="password"]'), null)
    assert.doesNotMatch(h.document.body.textContent, /candidate@example.com|initialPassword/)
    assert.equal(h.require('.application-detail .primary-action').disabled, false)
    assert.equal(h.query('[data-resend-activation]'), null)
    await h.click('.application-detail .primary-action')
    assert.equal(calls.filter(call => call.init?.method === 'POST').length, 0)
    assert.equal(h.require('.application-confirm-dialog').open, true)
    await h.click('.application-confirm-dialog .primary-action')
    const post = calls.find(call => call.init?.method === 'POST')
    assert.equal(post.url, '/api/admin/applications/7/approve')
    assert.deepEqual(JSON.parse(post.init.body), {})
    assert.equal(post.init.headers['X-CSRF-Token'], 'csrf')
    assert.match(h.document.body.textContent, /激活邮件已入队/)
    await h.click('.application-filters button:nth-child(2)')
    await h.until(() => h.query('.application-list-item'), '待激活列表应加载')
    await h.click('.application-list-item')
    assert.equal(h.require('.application-detail .primary-action').disabled, true)
    assert.ok(h.query('[data-resend-activation]'))
  }, { fetch: async (url, init) => {
    calls.push({ url, init })
    if (url.includes('csrf-token')) return response(200, { csrfToken: 'csrf' })
    if (init?.method === 'POST') return response(200, { success: true, application: awaiting })
    const list = url.includes('awaiting_activation') ? awaiting : pending
    return response(200, { success: true, applications: [list], total: 1, page: 1, pageSize: 20 })
  } })
})

it('管理员补发激活邮件先确认旧链接失效，Escape 关闭模态框，成功只声称已入队', async () => {
  const calls = []
  await withReactHarness(async h => {
    const { AdminApplicationsPage } = await import('../frontend/src/features/auth/AdminApplicationsPage.tsx')
    await h.render(h.React.createElement(AdminApplicationsPage, { onLogout: async () => {}, onDialogChange: open => { h.dialogOpen = open } }))
    await h.click('.application-filters button:nth-child(2)')
    await h.until(() => h.query('.application-list-item'), '待激活列表应加载')
    await h.click('.application-list-item')
    assert.match(h.document.body.textContent, /已送达（不代表已阅读）/)
    await h.click('[data-resend-activation]')
    assert.equal(h.require('[data-resend-dialog]').open, true)
    assert.match(h.document.body.textContent, /旧链接会立即失效/)
    assert.equal(h.dialogOpen, true)
    await h.React.act(async () => h.require('[data-resend-dialog]').dispatchEvent(new h.window.Event('cancel', { cancelable: true })))
    await h.flush()
    assert.equal(h.query('[data-resend-dialog]')?.open, false)
    assert.equal(h.dialogOpen, false)
    await h.click('[data-resend-activation]')
    await h.click('[data-resend-dialog] .primary-action')
    const post = calls.find(call => call.init?.method === 'POST')
    assert.equal(post.url, '/api/admin/applications/7/resend-activation')
    assert.deepEqual(JSON.parse(post.init.body), {})
    assert.match(h.require('.application-feedback').textContent, /激活邮件已重新入队/)
    assert.doesNotMatch(h.require('.application-feedback').textContent, /已送达/)
  }, { fetch: async (url, init) => {
    calls.push({ url, init })
    if (url.includes('csrf-token')) return response(200, { csrfToken: 'csrf' })
    if (init?.method === 'POST') return response(200, { success: true, application: { ...awaiting, activationMailStatus: 'queued' } })
    return response(200, { success: true, applications: [awaiting], total: 1, page: 1, pageSize: 20 })
  } })
})

it('补发命中额度时展示频率提示，不误报成功或已送达', async () => {
  await withReactHarness(async h => {
    const { AdminApplicationsPage } = await import('../frontend/src/features/auth/AdminApplicationsPage.tsx')
    await h.render(h.React.createElement(AdminApplicationsPage, { onLogout: async () => {} }))
    await h.click('.application-filters button:nth-child(2)')
    await h.until(() => h.query('.application-list-item'), '待激活列表应加载')
    await h.click('.application-list-item')
    await h.click('[data-resend-activation]')
    await h.click('[data-resend-dialog] .primary-action')
    assert.match(h.require('[role="alert"]').textContent, /操作过于频繁/)
    assert.doesNotMatch(h.require('.application-feedback').textContent, /已重新入队/)
  }, { fetch: async (url, init) => {
    if (url.includes('csrf-token')) return response(200, { csrfToken: 'csrf' })
    if (init?.method === 'POST') return response(429, { success: false, message: 'limited' })
    return response(200, { success: true, applications: [awaiting], total: 1, page: 1, pageSize: 20 })
  } })
})

it('已激活申请不显示补发按钮，审批按钮也保持禁用', async () => {
  const activated = { ...awaiting, activatedAt: '2026-10-27T01:00:00Z', canResendActivation: false }
  await withReactHarness(async h => {
    const { AdminApplicationsPage } = await import('../frontend/src/features/auth/AdminApplicationsPage.tsx')
    await h.render(h.React.createElement(AdminApplicationsPage, { onLogout: async () => {} }))
    await h.click('.application-filters button:nth-child(3)')
    await h.until(() => h.query('.application-list-item'), '已激活列表应加载')
    await h.click('.application-list-item')
    assert.equal(h.require('.application-detail .primary-action').disabled, true)
    assert.equal(h.query('[data-resend-activation]'), null)
    assert.match(h.document.body.textContent, /已激活/)
  }, { fetch: async () => response(200, { success: true, applications: [activated], total: 1 }) })
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

it('申请筛选不再出现待验证邮箱，异常筛选正确请求且空列表可恢复', async () => {
  const calls = []
  await withReactHarness(async h => {
    const { AdminApplicationsPage } = await import('../frontend/src/features/auth/AdminApplicationsPage.tsx')
    await h.render(h.React.createElement(AdminApplicationsPage, { onLogout: async () => {} }))
    assert.equal(h.document.querySelectorAll('.application-filters button').length, 5)
    assert.doesNotMatch(h.document.body.textContent, /待验证邮箱/)
    await h.click('.application-filters button:nth-child(5)')
    assert.ok(calls.some(url => url.includes('status=notification_error&page=1')))
    assert.match(h.document.body.textContent, /没有符合条件的申请/)
  }, { fetch: async url => { calls.push(url); return response(200, { success: true, applications: [], total: 0 }) } })
})

it('管理员入口位于用户左侧分类末尾，内嵌审核不跳页，普通成员不可见', async () => {
  const calls = []
  await withReactHarness(async h => {
    const { UserPage } = await import('../frontend/src/features/user/UserPage.tsx')
    const client = { profile: async () => ({id:1,nickname:'管理员',avatarUrl:null}), playlists: async () => [] }
    const handle = h.React.createRef()
    const originalPath = h.window.location.href
    await h.render(h.React.createElement(UserPage, {ref:handle,active:true,role:'admin',client}))
    const menu = h.require('.user-sidebar [aria-label="个人音乐分类"]')
    const admin = h.require('.user-sidebar [data-user-tab="admin"]')
    assert.equal(menu.querySelector('li:last-child button'), admin)
    assert.equal(admin.tagName,'BUTTON')
    await h.click('[data-user-tab="admin"]')
    assert.ok(h.query('[data-admin-applications]'))
    assert.equal(h.window.location.href,originalPath)
    assert.equal(h.query('[data-authorized-stage]'),null)
    assert.equal(h.query('[data-admin-applications] .archive-brand'),null)
    await h.click('.application-list-item')
    assert.equal(h.require('.application-detail .primary-action span').textContent,'通过审核')
    await h.click('.application-detail .primary-action')
    assert.equal(h.require('.application-confirm-dialog .primary-action span').textContent,'确认决定')
    assert.equal(handle.current.hasOpenDialog,true)
    await h.click('.application-confirm-dialog .application-secondary')
    assert.equal(handle.current.hasOpenDialog,false)
    await h.click('[data-user-tab="playlists"]')
    assert.equal(h.query('[data-admin-applications]'),null)
    assert.ok(h.query('[data-user-create]'))
    assert.ok(calls.every(path=>path.startsWith('/api/admin/applications')))
    await h.render(h.React.createElement(UserPage, {active:true,role:'user',client}))
    assert.equal(h.query('[data-user-tab="admin"]'),null)
  }, {fetch:async url=>{ calls.push(url); return response(200,{success:true,applications:[pending],total:1}) }})
})

it('已有管理员会话直接打开审核地址时不重复播放授权动画', async () => {
  await withReactHarness(async h => {
    h.window.history.replaceState(null,'','/admin/applications')
    const { App } = await import('../frontend/src/app/App.tsx')
    await h.render(h.React.createElement(App,{api:{
      restore:async()=>({id:1,email:'admin@example.test',role:'admin'}),
      login:async()=>assert.fail('现有会话不应重新登录'),logout:async()=>{},
    }}))
    assert.ok(h.query('[data-admin-applications]'))
    assert.equal(h.query('[data-authorized-stage]'),null)
    assert.equal(h.query('[data-login-form]'),null)
  }, {fetch:async()=>response(200,{success:true,applications:[],total:0})})
})
