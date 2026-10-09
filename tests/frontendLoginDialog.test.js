const { it, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
// 复用项目现有的 jsdom，仅模拟 DOM，不请求真实账号或真实网络。
const { JSDOM } = require(require.resolve('jsdom', { paths: [path.resolve(__dirname, '../vendor/api-enhanced')] }))

let dom, root, cleanup, previous, requests
const globals = ['window', 'document', 'Element', 'HTMLElement', 'HTMLFormElement', 'FormData']
const settle = () => new Promise(resolve => setTimeout(resolve, 10))
beforeEach(() => {
  dom = new JSDOM('<div id="app"></div>', { url: 'http://localhost/' })
  previous = Object.fromEntries(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const key of globals) Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true })
  dom.window.matchMedia = () => ({ matches: true })
  dom.window.requestAnimationFrame = () => 1
  dom.window.cancelAnimationFrame = () => {}
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false }
  requests = []
  dom.window.fetch = async (url, init) => {
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
  root = document.querySelector('#app')
})
afterEach(() => {
  cleanup?.(); cleanup = null; dom.window.close()
  for (const key of globals) {
    if (previous[key]) Object.defineProperty(globalThis, key, previous[key])
    else delete globalThis[key]
  }
})
async function mount(authenticate, verified = () => {}) {
  const { mountLoginPage } = await import('../frontend/src/login-page.ts')
  cleanup = mountLoginPage(root, authenticate, verified)
}
async function submitPassword() {
  root.querySelector('#email').value = 'test@example.com'
  root.querySelector('#password').value = 'password'
  root.querySelector('[data-login-form]').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
  await settle()
}
async function submitFactor(code) {
  const form = root.querySelector('[data-login-factor]')
  form.querySelector('[name=code]').value = code
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
  await settle()
}
it('初始、密码错误、不需要 2FA 的账号均不弹出验证窗口', async () => {
  let mode = 'wrong'
  await mount(async () => { if (mode === 'wrong') throw new Error('密码错误'); return { role: 'user' } })
  const dialog = root.querySelector('dialog')
  assert.equal(dialog.open, false)
  await submitPassword(); assert.equal(dialog.open, false)
  mode = 'normal'; await submitPassword(); assert.equal(dialog.open, false)
})
it('密码正确后才弹出；错误验证码不关闭；正确验证关闭后才进入授权', async () => {
  const roles = []
  await mount(async () => ({ requiresTwoFactor: true }), role => roles.push(role))
  await submitPassword()
  const dialog = root.querySelector('dialog')
  assert.equal(dialog.open, true)
  assert.equal(document.activeElement, root.querySelector('[data-login-factor] [name=code]'))
  assert.equal(root.querySelector('#password').value, '')
  await submitFactor('000000')
  assert.equal(dialog.open, true); assert.match(dialog.textContent, /验证失败/); assert.deepEqual(roles, [])
  await submitFactor('123456'); assert.equal(dialog.open, false); assert.deepEqual(roles, ['user'])
  assert.equal(dialog.querySelector('[name=code]'), null)
})
it('关闭、Escape 与遮罩取消回到密码登录，不触发认证成功', async () => {
  let calls = 0
  await mount(async () => ({ requiresTwoFactor: true }), () => calls++)
  for (const way of ['button', 'escape', 'backdrop']) {
    await submitPassword()
    const dialog = root.querySelector('dialog')
    if (way === 'button') dialog.querySelector('[data-login-factor-close]').click()
    else if (way === 'escape') dialog.dispatchEvent(new window.Event('cancel', { cancelable: true }))
    else dialog.dispatchEvent(new window.MouseEvent('click', { clientX: -1, clientY: -1 }))
    await settle()
    assert.equal(dialog.open, false); assert.equal(root.querySelector('.primary-action').disabled, false)
    assert.equal(document.activeElement, root.querySelector('#password'))
  }
  assert.equal(calls, 0)
})
it('恢复码切换保持原接口，销毁页面后延迟的验证不触发跳转', async () => {
  let calls = 0
  await mount(async () => ({ requiresTwoFactor: true }), () => calls++)
  await submitPassword()
  const checkbox = root.querySelector('[name=recovery]')
  checkbox.checked = true; checkbox.dispatchEvent(new window.Event('change'))
  assert.equal(root.querySelector('[data-login-factor] [name=code]').maxLength, 35)
  await submitFactor('test-recovery')
  assert.ok(requests.includes('/api/auth/2fa/recovery')); assert.equal(calls, 1)
  cleanup()
  await mount(async () => ({ requiresTwoFactor: true }), () => calls++)
  await submitPassword()
  let resolve
  window.fetch = () => new Promise(done => { resolve = done })
  root.querySelector('[data-login-factor] [name=code]').value = '123456'
  root.querySelector('[data-login-factor]').dispatchEvent(new window.Event('submit', { cancelable: true }))
  cleanup()
  resolve({ ok: false, status: 401, json: async () => ({}) })
  await settle(); assert.equal(calls, 1)
})
it('管理员首次绑定也在弹窗完成，保存恢复码后才结束', async () => {
  const roles = []
  await mount(async () => ({ requiresTwoFactor: true, enrollmentRequired: true }), role => roles.push(role))
  await submitPassword()
  const dialog = root.querySelector('dialog')
  assert.equal(dialog.open, true)
  const setup = dialog.querySelector('[data-factor-action=setup]')
  setup.querySelector('[name=password]').value = 'password'
  setup.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await settle()
  const confirm = dialog.querySelector('[data-factor-action=confirm]')
  confirm.querySelector('[name=code]').value = '123456'
  confirm.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await settle()
  assert.match(dialog.textContent, /test-recovery-code/); assert.deepEqual(roles, [])
  dialog.querySelector('[data-factor-saved]').click(); await settle()
  assert.equal(dialog.open, false); assert.deepEqual(roles, ['user'])
})
