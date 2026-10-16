const assert = require('node:assert/strict')
const { it } = require('node:test')
const { JSDOM } = require(require.resolve('jsdom', { paths: [require('node:path').resolve('vendor/api-enhanced')] }))
it('入口页面销毁会取消尚未触发的跳转', async () => {
  const { mountEntryPage } = await import('../frontend/src/entry-page.ts')
  const dom = new JSDOM('<div id="app"></div>'), old = global.window
  global.window = dom.window
  const timers = new Map(); let id = 0
  dom.window.setTimeout = fn => { timers.set(++id, fn); return id }
  dom.window.clearTimeout = id => timers.delete(id)
  try {
    const root = dom.window.document.querySelector('#app')
    const destroy = mountEntryPage(root, () => assert.fail('销毁后不应跳转'))
    root.querySelector('button').click(); destroy()
    assert.equal(timers.size, 0)
  } finally { dom.window.close(); if (old === undefined) delete global.window; else global.window = old }
})
it('应用调度不把待 2FA 的登录当成授权，销毁取消延迟授权', async () => {
  const { mountApplication } = await import('../frontend/src/app/app-controller.ts')
  const old = global.window, timers = new Map(); let id = 0, enter, credentials, verified, authorized = 0, destroyed = 0
  global.window = { setTimeout: fn => { timers.set(++id, fn); return id }, clearTimeout: id => timers.delete(id) }
  let needsFactor = true
  try {
    const root = { dataset: {}, replaceChildren() {} }
    const app = mountApplication(root, {
      restore: async () => null, login: async () => needsFactor ? { user: null, requiresTwoFactor: true } : { user: { role: 'user' } },
      entry: (_, next) => { enter = next; return () => destroyed++ },
      loginPage: (_, action, next) => { credentials = action; verified = next; return () => destroyed++ },
      authorizedPage: () => { authorized++; return () => destroyed++ },
    })
    enter(); await new Promise(resolve => setImmediate(resolve))
    const result = await credentials({ email: 'a', password: 'test' })
    assert.equal(result.requiresTwoFactor, true); assert.equal(timers.size, 0); assert.equal(authorized, 0)
    verified('user'); assert.equal(timers.size, 1)
    app.destroy(); assert.equal(timers.size, 0)
    needsFactor = false; await credentials({ email: 'a', password: 'test' }); assert.equal(timers.size, 0)
    assert.equal(destroyed, 2)
  } finally { if (old === undefined) delete global.window; else global.window = old }
})
