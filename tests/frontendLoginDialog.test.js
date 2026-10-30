const { it } = require('node:test')
const assert = require('node:assert/strict')
const { withReactHarness } = require('./helpers/reactHarness')

async function withLogin(authenticate, verified, run) {
  const requests = []
  const fetch = async (url, init) => {
    requests.push(url)
    let body = { success: true }, status = 200
    if (url.includes('csrf')) body = { csrfToken: 'test-token' }
    else if (url.endsWith('/me')) body = { authenticated: true, user: { id: 1, email: 'test@example.com', role: 'user' } }
    else if (url.endsWith('/status')) body = { available: true, enabled: false }
    else if (url.endsWith('/setup')) body = { secret: 'TEST-SECRET', qrCode: 'data:image/png;base64,AA==' }
    else if (url.endsWith('/confirm')) body = { recoveryCodes: ['test-recovery-code'] }
    else if (url.endsWith('/verify') && JSON.parse(init.body).code === '000000') { status = 401; body = { message: '验证失败' } }
    return { ok: status === 200, status, json: async () => body }
  }
  return withReactHarness(async h => {
    const { LoginPage } = await import('../frontend/src/features/auth/LoginPage.tsx')
    const render = () => h.render(h.React.createElement(LoginPage, { onAuthenticate: authenticate, onVerified: verified }))
    await render()
    const password = async () => {
      await h.input('#email', 'test@example.com'); await h.input('#password', 'password')
      await h.submit('[data-login-form]')
    }
    const factor = async code => { const recovery = h.require('[name=recovery]').checked; await h.input('[data-login-factor] [name=code]', code); if (recovery) await h.submit('[data-login-factor]'); await h.wait(10) }
    await run(h, { requests, password, factor, render })
  }, { fetch })
}

it('初始、密码错误、不需要 2FA 的账号均不弹出验证窗口', async () => {
  let mode = 'wrong'
  const roles = []
  await withLogin(async () => { if (mode === 'wrong') throw new Error('密码错误'); return { role: 'user' } }, role => roles.push(role), async (h, { password }) => {
    assert.equal(h.require('[data-login-factor-dialog]').open, false)
    await password(); assert.equal(h.require('[data-login-factor-dialog]').open, false); assert.deepEqual(roles, [])
    assert.match(h.require('[data-preview-status]').textContent, /密码错误/)
    mode = 'normal'; await password(); assert.equal(h.require('[data-login-factor-dialog]').open, false)
    assert.deepEqual(roles, ['user'])
  })
})
it('密码正确后才弹出；错误验证码不关闭；正确验证关闭后才进入授权', async () => {
  const roles = []
  await withLogin(async () => ({ requiresTwoFactor: true }), role => roles.push(role), async (h, { password, factor }) => {
    await password()
    const dialog = h.require('[data-login-factor-dialog]')
    assert.equal(dialog.open, true)
    assert.equal(h.document.activeElement, h.require('[data-login-factor] [name=code]'))
    assert.equal(h.require('#password').value, '')
    await factor('000000')
    assert.equal(dialog.open, true); assert.match(dialog.textContent, /验证失败/); assert.deepEqual(roles, [])
    await factor('123456')
    assert.equal(h.require('[data-login-factor-dialog]').open, false); assert.deepEqual(roles, ['user'])
    assert.equal(h.query('[data-login-factor] [name=code]'), null)
  })
})
it('Code Slots 输入、退格和自动验证沿用服务端结果，无旧六格或普通确认按钮', async () => {
  await withLogin(async () => ({ requiresTwoFactor: true }), undefined, async (h, { password, factor, requests }) => {
    await password()
    assert.ok(h.query('.code-slots'))
    assert.equal(h.query('[data-factor-digits], .factor-challenge-step, .factor-confirm'), null)
    const code = h.require('[name=code]')
    assert.equal(code.autocomplete, 'one-time-code')
    assert.equal(code.getAttribute('aria-label'), '验证码')
    await h.input('[name=code]', '01234')
    assert.equal(h.document.querySelectorAll('.code-slots__slot[data-filled]').length, 5)
    assert.equal(requests.filter(url => url.endsWith('/verify')).length, 0)
    await h.React.act(async () => code.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })))
    assert.equal(h.document.querySelectorAll('.code-slots__slot[data-filled]').length, 4)
    await factor('000000')
    assert.equal(requests.filter(url => url.endsWith('/verify')).length, 1)
    assert.equal(h.document.querySelectorAll('.code-slots__slot[data-filled]').length, 0)
    assert.equal(h.require('[data-login-factor-dialog]').open, true)
  })
})
it('Code Slots 与恢复码切换清空状态，恢复码保留独立输入和手动提交', async () => {
  await withLogin(async () => ({ requiresTwoFactor: true }), undefined, async (h, { password }) => {
    await password()
    const form = h.require('[data-login-factor]')
    await h.input('[name=code]', '12345'); await h.click('[name=recovery]')
    let code = h.require('[name=code]')
    assert.equal(form.classList.contains('is-recovery'), true)
    assert.equal(h.query('.code-slots'), null)
    assert.equal(code.value, ''); assert.equal(code.maxLength, 35); assert.equal(code.inputMode, 'text')
    assert.ok(h.query('.factor-confirm'))
    await h.input('[name=code]', 'abcd-efgh-ijkl'); assert.equal(code.value, 'abcd-efgh-ijkl')
    await h.click('[name=recovery]')
    code = h.require('[name=code]')
    assert.equal(form.classList.contains('is-recovery'), false); assert.equal(code.value, '')
    assert.equal(code.maxLength, 6); assert.equal(code.inputMode, 'numeric')
    assert.equal(h.document.querySelectorAll('.code-slots__slot[data-filled]').length, 0)
  })
})
it('关闭、Escape 与遮罩取消回到密码登录，不触发认证成功', async () => {
  let calls = 0
  await withLogin(async () => ({ requiresTwoFactor: true }), () => calls++, async (h, { password }) => {
    for (const way of ['button', 'escape', 'backdrop']) {
      await password()
      const dialog = h.require('[data-login-factor-dialog]')
      if (way === 'button') await h.click('[data-login-factor-close]')
      else await h.React.act(async () => dialog.dispatchEvent(way === 'escape'
        ? new h.window.Event('cancel', { cancelable: true })
        : new h.window.MouseEvent('click', { bubbles: true, clientX: -1, clientY: -1 })))
      await h.wait(10)
      assert.equal(h.require('[data-login-factor-dialog]').open, false); assert.equal(h.require('.primary-action').disabled, false)
      assert.equal(h.document.activeElement, h.require('#password'))
    }
    assert.equal(calls, 0)
  })
})
it('恢复码切换保持原接口，销毁页面后延迟的验证不触发跳转', async () => {
  let calls = 0
  await withLogin(async () => ({ requiresTwoFactor: true }), () => calls++, async (h, { requests, password, factor }) => {
    await password(); await h.click('[name=recovery]')
    assert.equal(h.require('[name=code]').maxLength, 35)
    await factor('test-recovery')
    assert.ok(requests.includes('/api/auth/2fa/recovery')); assert.equal(calls, 1)
  })
  await withLogin(async () => ({ requiresTwoFactor: true }), () => calls++, async (h, { password }) => {
    await password()
    let resolve
    h.window.fetch = () => new Promise(done => { resolve = done })
    await h.input('[name=code]', '123456'); await h.submit('[data-login-factor]')
    await h.unmount()
    resolve({ ok: false, status: 401, json: async () => ({}) })
    await h.flush(); assert.equal(calls, 1)
  })
})
it('管理员首次绑定也在弹窗完成，保存恢复码后才结束', async () => {
  const roles = []
  await withLogin(async () => ({ requiresTwoFactor: true, enrollmentRequired: true }), role => roles.push(role), async (h, { password }) => {
    await password(); assert.equal(h.require('[data-login-factor-dialog]').open, true)
    await h.input('[data-factor-action=setup] [name=password]', 'password'); await h.submit('[data-factor-action=setup]')
    await h.input('[data-factor-action=confirm] [name=code]', '123456'); await h.submit('[data-factor-action=confirm]')
    assert.match(h.require('[data-login-factor-dialog]').textContent, /test-recovery-code/); assert.deepEqual(roles, [])
    await h.click('[data-factor-saved]'); await h.wait(10)
    assert.equal(h.require('[data-login-factor-dialog]').open, false); assert.deepEqual(roles, ['user'])
  })
})
it('保持登录和眼睛交互沿用原输入，重复提交只发送一次认证请求', async () => {
  let calls = 0, credentials, release
  await withLogin(value => { calls++; credentials = value; return new Promise(resolve => { release = resolve }) }, undefined, async (h, { password }) => {
    await h.click('[data-remember-me]'); await h.click('[data-reveal-password]')
    assert.equal(h.require('#password').type, 'text'); assert.equal(h.require('[data-reveal-password]').getAttribute('aria-pressed'), 'true')
    await password(); await h.submit('[data-login-form]')
    assert.equal(calls, 1); assert.equal(credentials.rememberMe, true)
    await h.click('[data-reveal-password]'); assert.equal(h.require('#password').type, 'password')
    release({ role: 'user' }); await h.flush()
    assert.equal(h.require('#password').value, '')
  })
})

it('Code Slots 支持带空格粘贴，自动验证期间禁止重复提交及切换，失败后可重新输入', async () => {
  await withLogin(async () => ({ requiresTwoFactor: true }), undefined, async (h, { password }) => {
    await password()
    const originalFetch = h.window.fetch
    let verifications = 0, release
    h.window.fetch = (url, init) => {
      if (url.endsWith('/verify')) { verifications++; return new Promise(resolve => { release = resolve }) }
      return originalFetch(url, init)
    }
    const paste = async value => {
      const event = new h.window.Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'clipboardData', { value: { getData: () => value } })
      await h.React.act(async () => h.require('[name=code]').dispatchEvent(event))
      await h.flush()
    }
    await paste('000 000')
    await h.until(() => verifications === 1, '填满后应自动验证')
    assert.equal(h.require('[name=code]').disabled, true)
    assert.equal(h.require('[name=recovery]').disabled, true)
    assert.equal(h.require('[data-login-factor-close]').disabled, true)
    await h.submit('[data-login-factor]'); await h.submit('[data-login-factor]')
    assert.equal(verifications, 1)
    await h.React.act(async () => release({ ok: false, status: 401, json: async () => ({ message: '验证失败' }) }))
    await h.until(() => !h.require('[name=code]').disabled, '失败后恢复输入')
    assert.equal(h.document.querySelectorAll('.code-slots__slot[data-filled]').length, 0)
    assert.equal(h.document.activeElement, h.require('[name=code]'))
    h.window.fetch = originalFetch
    await paste('123456')
    await h.wait(10)
    assert.equal(h.require('[data-login-factor-dialog]').open, false)
  })
})
