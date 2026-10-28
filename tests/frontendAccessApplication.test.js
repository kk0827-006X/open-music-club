const assert = require('node:assert/strict')
const { it } = require('node:test')
const { withReactHarness } = require('./helpers/reactHarness')
function response(status, body) { return { ok: status >= 200 && status < 300, status, json: async () => body } }

it('申请样式独立加载并沿用主题，不覆盖旧登录表单或2FA样式', () => {
  const fs = require('node:fs')
  const css = fs.readFileSync('frontend/src/styles/access-application.css', 'utf8')
  assert.match(fs.readFileSync('frontend/src/style.css', 'utf8'), /@import '.\/styles\/access-application.css'/)
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgba?\(|\.factor-|\.login-shell\s*\{/i)
  assert.match(css, /\.login-application-dialog textarea:focus-visible/)
})
it('申请仅提交同源 CSRF 保护的联系信息，无通知轮询或密码', async () => {
  const { submitAccessApplication } = await import('../frontend/src/services/auth/applications.ts')
  const calls = []
  await submitAccessApplication({ email: ' Candidate@Example.COM ', nickname: ' 候选成员 ', reason: ' 喜欢音乐 ' }, { fetcher: async (url, init) => {
    calls.push({ url, init }); return response(url.includes('csrf-token') ? 200 : 202, url.includes('csrf-token') ? { csrfToken: 'isolated-token' } : { success: true, message: '符合条件的申请会进入审核' })
  } })
  assert.deepEqual(calls.map(call => call.url), ['/api/security/csrf-token', '/api/applications'])
  assert.equal(calls[1].init.headers['X-CSRF-Token'], 'isolated-token')
  assert.equal(calls[1].init.credentials, 'same-origin')
  assert.equal(calls[0].init.cache, 'no-store')
  assert.deepEqual(JSON.parse(calls[1].init.body), { email: 'candidate@example.com', nickname: '候选成员', reason: '喜欢音乐' })
})
it('申请成功提示直接进入审核，提供激活重发入口且不触发登录', async () => {
  let authenticated = 0
  const calls = []
  await withReactHarness(async h => {
    const { LoginPage } = await import('../frontend/src/features/auth/LoginPage.tsx')
    await h.render(h.React.createElement(LoginPage, { onAuthenticate: async () => { authenticated++; return { role: 'user' } } }))
    await h.click('[data-application-open]')
    assert.equal(h.document.activeElement, h.require('#application-email'))
    await h.input('#application-email', 'candidate@example.com'); await h.input('#application-nickname', '候选成员')
    assert.match(h.require('.application-note').textContent, /勿填写邮箱、电话/)
    await h.submit('[data-application-form]')
    assert.match(h.require('[data-application-feedback]').textContent, /申请已提交并进入审核.*审核结果将通过邮件通知/)
    assert.doesNotMatch(h.require('[data-application-feedback]').textContent, /验证邮件|投递成功|申请成功|初始密码/)
    assert.equal(h.require('[data-application-submit]').disabled, true)
    assert.equal(h.require('[data-application-submit] span').textContent, '申请已提交')
    assert.equal(h.require('[data-application-activation-link]').getAttribute('href'), '/activate')
    assert.equal(h.query('[data-application-check]'), null)
    assert.equal(authenticated, 0)
    assert.deepEqual(calls, ['/api/security/csrf-token', '/api/applications'])
    await h.click('[data-application-close]')
    assert.equal(h.document.activeElement, h.require('[data-application-open]'))
  }, { fetch: async url => { calls.push(url); return url.includes('csrf-token') ? response(200, { csrfToken: 'token' }) : response(202, { success: true, message: '符合条件的申请会进入审核' }) } })
})
it('提交期间禁止重复及关闭；卸载取消请求，服务端错误脱敏', async () => {
  let release, posts = 0, signal
  await withReactHarness(async h => {
    const { AccessApplicationDialog } = await import('../frontend/src/features/auth/AccessApplicationDialog.tsx')
    await h.render(h.React.createElement(AccessApplicationDialog, { onClose() {} }))
    await h.input('#application-email', 'candidate@example.com'); await h.input('#application-nickname', '成员')
    await h.submit('[data-application-form]'); await h.submit('[data-application-form]')
    assert.equal(posts, 1); assert.equal(h.require('[data-application-close]').disabled, true)
    release(response(500, { message: '/private/internal-secret' })); await h.flush()
    assert.match(h.require('[data-application-feedback]').textContent, /暂时不可用/)
    assert.doesNotMatch(h.document.body.textContent, /internal-secret/)
    await h.submit('[data-application-form]'); assert.equal(posts, 2)
    await h.unmount(); assert.equal(signal.aborted, true)
    release(response(202, { success: true })); await h.flush()
  }, { fetch: async (url, init) => { if (url.includes('csrf-token')) return response(200, { csrfToken: 'token' }); posts++; signal = init.signal; return new Promise(resolve => { release = resolve }) } })
})
it('整体超时覆盖挂起的网络及正文，且取消请求', async () => {
  const { submitAccessApplication } = await import('../frontend/src/services/auth/applications.ts')
  for (const stage of ['csrf', 'post', 'body']) {
    let signal
    await assert.rejects(() => submitAccessApplication({ email: 'a@example.com', nickname: '成员' }, { timeoutMs: 10, fetcher: async (url, init) => {
      signal = init.signal
      if (stage === 'csrf' || stage === 'post' && url.endsWith('/applications')) return new Promise(() => {})
      if (url.includes('csrf-token')) return response(200, { csrfToken: 'token' })
      return { ok: true, status: 202, json: () => new Promise(() => {}) }
    } }), /超时/)
    assert.equal(signal.aborted, true)
  }
})
it('非法输入和 CSRF 失败不会发送申请', async () => {
  const { submitAccessApplication } = await import('../frontend/src/services/auth/applications.ts')
  let calls = 0
  await assert.rejects(() => submitAccessApplication({ email: 'invalid', nickname: '成员' }, { fetcher: async () => { calls++; throw Error('不可调用') } }), /邮箱/)
  assert.equal(calls, 0)
  await assert.rejects(() => submitAccessApplication({ email: 'a@example.com', nickname: '成员' }, { fetcher: async () => { calls++; return response(403, {}) } }), /安全/)
  assert.equal(calls, 1)
})
it('Escape 关闭草稿并恢复焦点，申请与2FA互斥', async () => {
  await withReactHarness(async h => {
    const { LoginPage } = await import('../frontend/src/features/auth/LoginPage.tsx')
    await h.render(h.React.createElement(LoginPage, { onAuthenticate: async () => ({ requiresTwoFactor: true }) }))
    await h.click('[data-application-open]'); await h.input('#application-email', 'draft@example.com')
    await h.React.act(async () => h.require('[data-application-dialog]').dispatchEvent(new h.window.Event('cancel', { cancelable: true }))); await h.flush()
    assert.equal(h.query('[data-application-form]'), null)
    await h.click('[data-application-open]'); assert.equal(h.require('#application-email').value, '')
    await h.click('[data-application-close]')
    await h.input('#email', 'member@example.com'); await h.input('#password', 'isolated-password'); await h.submit('[data-login-form]')
    assert.equal(h.require('[data-login-factor-dialog]').open, true)
    assert.equal(h.require('[data-application-open]').disabled, true)
  })
})

it('匿名流程403给出适合当前页面的恢复提示，不要求登录2FA且不丢失邮件凭证', async () => {
  const { applicationRequest } = await import('../frontend/src/services/auth/applications.ts')
  for (const path of ['/api/applications', '/api/applications/resend', '/api/auth/activate']) {
    await assert.rejects(() => applicationRequest(path, {}, {fetcher:async url => url.includes('csrf-token')
      ? response(200,{csrfToken:'isolated-token'}) : response(403,{message:'内部原因不回显'})}), error => {
      assert.match(error.message,/安全会话.*重新/)
      if (path === '/api/auth/activate') {
        assert.match(error.message,/重新打开邮件中的链接/)
        assert.doesNotMatch(error.message,/刷新/)
      } else assert.match(error.message,/刷新/)
      assert.doesNotMatch(error.message,/登录|2FA|两步验证|内部原因/)
      return true
    })
  }
  await assert.rejects(() => applicationRequest('/api/admin/applications',undefined,{fetcher:async()=>response(403,{})}), /登录.*两步验证/)
})

it('申请503给出安全恢复提示，不回显密钥名称、值或内部错误', async () => {
  const { submitAccessApplication } = await import('../frontend/src/services/auth/applications.ts')
  await assert.rejects(() => submitAccessApplication({email:'candidate@example.com',nickname:'成员'},{fetcher:async url => url.includes('csrf-token')
    ? response(200,{csrfToken:'isolated-token'}) : response(503,{message:'APPLICATION_MAIL_ENCRYPTION_KEY=private-secret'})}), error => {
    assert.match(error.message,/暂时不可用.*联系管理员/)
    assert.doesNotMatch(error.message,/APPLICATION_MAIL|private-secret/)
    return true
  })
})
