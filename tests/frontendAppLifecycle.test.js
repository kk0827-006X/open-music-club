const assert = require('node:assert/strict')
const { it } = require('node:test')
const { withReactHarness } = require('./helpers/reactHarness')
it('入口页面销毁会取消尚未触发的跳转', async () => {
  await withReactHarness(async h => {
    const { EntryPage } = await import('../frontend/src/features/auth/EntryPage.tsx')
    const timers = new Map(); let id = 0
    h.window.setTimeout = fn => { timers.set(++id, fn); return id }
    h.window.clearTimeout = id => timers.delete(id)
    await h.render(h.React.createElement(EntryPage, { onEnter: () => assert.fail('销毁后不应跳转') }))
    await h.click('[data-entry-start]'); assert.equal(timers.size, 1)
    await h.unmount(); assert.equal(timers.size, 0)
  })
})

// 只控制公开可见的入场和认证延迟，不替换 React/Motion 需要的其他计时器。
function phaseClock(h) {
  const pending = new Map()
  const originalSet = globalThis.setTimeout
  const originalClear = globalThis.clearTimeout
  const originalWindowSet = h.window.setTimeout.bind(h.window)
  const originalWindowClear = h.window.clearTimeout.bind(h.window)
  let id = 100000
  globalThis.setTimeout = (callback, delay, ...args) => {
    if (delay !== 1150) return originalSet(callback, delay, ...args)
    const handle = { phase: 'authorized', id: ++id }
    pending.set(handle, { callback: () => callback(...args), delay })
    return handle
  }
  globalThis.clearTimeout = handle => {
    if (pending.delete(handle)) return
    originalClear(handle)
  }
  h.window.setTimeout = (callback, delay, ...args) => {
    if (delay !== 520) return originalWindowSet(callback, delay, ...args)
    const handle = ++id
    pending.set(handle, { callback: () => callback(...args), delay })
    return handle
  }
  h.window.clearTimeout = handle => {
    if (pending.delete(handle)) return
    originalWindowClear(handle)
  }
  return {
    count: delay => [...pending.values()].filter(item => item.delay === delay).length,
    peek: delay => [...pending.values()].find(item => item.delay === delay)?.callback,
    async advance(delay) {
      const selected = [...pending].filter(([, value]) => value.delay === delay)
      assert.equal(selected.length, 1, `预期只有一个 ${delay}ms 阶段定时器`)
      pending.delete(selected[0][0])
      await h.React.act(async () => selected[0][1].callback())
      await h.flush()
    },
    restore() {
      globalThis.setTimeout = originalSet
      globalThis.clearTimeout = originalClear
      h.window.setTimeout = originalWindowSet
      h.window.clearTimeout = originalWindowClear
    },
  }
}

async function openLogin(h, clock) {
  await h.click('[data-entry-start]')
  await clock.advance(520)
  await h.until(() => h.query('[data-login-form]'), '未恢复 Session 时应显示真实登录表单')
}

async function submitPassword(h) {
  await h.input('[name="email"]', 'isolated@example.test')
  await h.input('[name="password"]', 'synthetic-secret')
  await h.submit('[data-login-form]')
}

it('真实 App 不把待 2FA 的密码登录当作授权，验证码和 Session 验证后才开始延迟入场', async () => {
  const requests = []
  await withReactHarness(async h => {
    const { App } = await import('../frontend/src/app/App.tsx')
    const clock = phaseClock(h)
    const credentials = []
    try {
      await h.render(h.React.createElement(App, { api: {
        restore: async () => null,
        login: async value => { credentials.push(value); return { user: null, requiresTwoFactor: true } },
        logout: async () => {},
      } }))
      await openLogin(h, clock)
      await submitPassword(h)
      assert.equal(credentials.length, 1)
      assert.equal(h.require('[data-login-factor-dialog]').open, true)
      assert.equal(h.query('[data-authorized-stage]'), null)
      assert.equal(clock.count(1150), 0, '仅密码认证成功不调度授权入场')
      assert.equal(requests.length, 0, '没有验证码不能请求提升权限')
      await h.input('[name="code"]', '123456')
      await h.submit('[data-login-factor]')
      await h.until(() => clock.count(1150) === 1, '2FA 与实时 Session 成功后应开始认证过渡计时')
      assert.ok(h.query('[data-login-form]'), '延迟尚未结束时继续显示登录页面')
      assert.equal(h.query('[data-authorized-stage]'), null)
      assert.deepEqual(requests, ['/api/security/csrf-token', '/api/auth/2fa/verify', '/api/auth/me'])
      await clock.advance(1150)
      assert.equal(h.query('[data-login-form]'), null)
      assert.ok(h.query('[data-authorized-stage]'), '延迟完成后才显示真实授权动画组件')
      assert.match(h.require('.sequence-session').textContent, /MEMBER SESSION VERIFIED/)
      await h.unmount()
      assert.equal(clock.count(1150), 0)
    } finally { clock.restore() }
  }, { fetch: async url => {
    requests.push(url)
    const body = url === '/api/security/csrf-token' ? { csrfToken: 'synthetic-csrf' }
      : url === '/api/auth/2fa/verify' ? { success: true }
        : url === '/api/auth/me' ? { authenticated: true, user: { id: 1, email: 'isolated@example.test', role: 'user' } }
          : assert.fail(`测试未声明请求 ${url}`)
    return { ok: true, status: 200, json: async () => body }
  } })
})

it('真实 App 卸载取消待执行授权计时，已排队的旧回调也不能恢复页面', async () => {
  await withReactHarness(async h => {
    const { App } = await import('../frontend/src/app/App.tsx')
    const clock = phaseClock(h)
    try {
      await h.render(h.React.createElement(App, { api: {
        restore: async () => null,
        login: async () => ({ user: { id: 1, email: 'isolated@example.test', role: 'user' } }),
        logout: async () => {},
      } }))
      await openLogin(h, clock)
      await submitPassword(h)
      assert.equal(clock.count(1150), 1)
      const lateCallback = clock.peek(1150)
      await h.unmount()
      assert.equal(clock.count(1150), 0, 'App 清理必须取消认证计时器')
      await h.React.act(async () => lateCallback())
      assert.equal(h.require('#app').children.length, 0)
      assert.equal(h.query('[data-authorized-stage]'), null)
      assert.equal(clock.count(1150), 0)
    } finally { clock.restore() }
  })
})

it('真实 App 忽略卸载后才返回的密码认证响应，不创建迟到授权计时器', async () => {
  await withReactHarness(async h => {
    const { App } = await import('../frontend/src/app/App.tsx')
    const clock = phaseClock(h)
    let releaseLogin
    try {
      await h.render(h.React.createElement(App, { api: {
        restore: async () => null,
        login: () => new Promise(resolve => { releaseLogin = resolve }),
        logout: async () => {},
      } }))
      await openLogin(h, clock)
      await submitPassword(h)
      assert.equal(typeof releaseLogin, 'function')
      assert.equal(clock.count(1150), 0)
      await h.unmount()
      await h.React.act(async () => releaseLogin({ user: { id: 1, email: 'isolated@example.test', role: 'admin' } }))
      await h.flush()
      assert.equal(clock.count(1150), 0)
      assert.equal(h.require('#app').children.length, 0)
      assert.equal(h.query('[data-authorized-stage]'), null)
    } finally { clock.restore() }
  })
})

it('真实 App 忽略卸载后才返回的 Session 恢复，不显示授权页面', async () => {
  await withReactHarness(async h => {
    const { App } = await import('../frontend/src/app/App.tsx')
    const clock = phaseClock(h)
    let releaseRestore
    try {
      await h.render(h.React.createElement(App, { api: {
        restore: () => new Promise(resolve => { releaseRestore = resolve }),
        login: async () => assert.fail('恢复阶段不应登录'),
        logout: async () => {},
      } }))
      await h.click('[data-entry-start]')
      await clock.advance(520)
      assert.equal(typeof releaseRestore, 'function')
      await h.unmount()
      await h.React.act(async () => releaseRestore({ id: 1, email: 'isolated@example.test', role: 'admin' }))
      await h.flush()
      assert.equal(clock.count(1150), 0)
      assert.equal(h.require('#app').children.length, 0)
      assert.equal(h.query('[data-authorized-stage]'), null)
    } finally { clock.restore() }
  })
})
