const fs = require('node:fs')
const { withReactHarness } = require('./helpers/reactHarness')
const assert = require('node:assert/strict')
const { it } = require('node:test')

it('设置仅展示左右分栏 UI，复用关闭图标，不保存或应用播放器偏好', async () => {
  await withReactHarness(async h => {
    const { SettingsDialog } = await import('../frontend/src/features/settings/SettingsDialog.tsx')
    const ref = h.React.createRef()
    await h.render(h.React.createElement(SettingsDialog, { ref, onOpen() {}, onClose() {} }))
    assert.equal(h.require('[data-settings-dialog]').open, false)
    await h.React.act(async () => ref.current.show())
    assert.equal(h.require('[data-settings-dialog]').open, true)
    assert.equal(h.require('[data-settings-close] [data-ui-icon]').dataset.uiIcon, 'close')
    for (const name of ['账号与安全', '播放偏好', '外观与动效', '上传偏好', '数据与关于']) assert.ok(h.require('[data-settings-dialog]').textContent.includes(name))
    assert.match(h.require('[data-settings-content]').textContent, /仅展示/)
    assert.equal(h.require('[aria-label="播放器常驻显示"]').disabled, true)
    await h.click('[data-settings-category="playback"]')
    assert.equal(h.require('[aria-label="默认音量"]').disabled, true)
    assert.equal(h.require('[aria-label="播放模式"]').disabled, true)
    await h.click('[data-settings-category="account"]')
    assert.equal(h.require('[data-settings-logout]').disabled, true)
    await h.render(h.React.createElement(SettingsDialog, { ref, onOpen() {}, onClose() {}, logout: async () => {} }))
    assert.equal(h.require('[data-settings-logout]').disabled, false)
  })
  const source = fs.readFileSync('frontend/src/features/settings/SettingsDialog.tsx', 'utf8')
  assert.doesNotMatch(source, /localStorage|audio\.volume|setQuality|playerAutoHide|playerPinned/)
})

it('设置兼容挂载保留工作区 DOM，关闭动画和退出错误均可恢复', async () => {
  await withReactHarness(async h => {
    const { mountSettingsDialog } = await import('../frontend/src/settings-dialog.ts')
    const root = h.require('#app'), sentinel = h.document.createElement('p')
    sentinel.textContent = '工作区'; root.append(sentinel)
    let dialog, opens = 0, closes = 0
    try {
      await h.React.act(async () => { dialog = mountSettingsDialog(root, { onOpen() { opens++ }, onClose() { closes++ }, logout: async () => { throw new Error('服务离线') } }); dialog.show() })
      await h.flush(); assert.equal(sentinel.isConnected, true); assert.equal(dialog.open, true); assert.equal(opens, 1)
      await h.click('[data-settings-category="account"]'); await h.click('[data-settings-logout]')
      assert.match(h.require('[data-settings-status]').textContent, /退出失败/); assert.equal(h.require('[data-settings-logout]').disabled, false)
      await h.click('[data-settings-close]'); await h.wait(10)
      assert.equal(dialog.open, false); assert.equal(closes, 1)
    } finally { if (dialog) await h.React.act(async () => dialog.destroy()) }
    assert.equal(sentinel.isConnected, true); assert.equal(h.query('[data-settings-dialog]'), null)
  })
})

it('管理员 2FA 管理遵守服务器禁止关闭策略，恢复码重新生成后须确认保存', async () => {
  const calls = []
  await withReactHarness(async h => {
    const { TwoFactorPanel } = await import('../frontend/src/features/auth/TwoFactorPanel.tsx')
    await h.render(h.React.createElement(TwoFactorPanel))
    assert.match(h.require('.two-factor-manager').textContent, /剩余 8 个恢复码/)
    assert.equal(h.query('[data-factor-action="disable"]'), null)
    assert.match(h.require('.two-factor-manager').textContent, /管理员不能自行关闭/)
    await h.input('[name=password]', 'isolated-password'); await h.input('[name=code]', '123456')
    await h.submit('[data-factor-action="recovery-codes/regenerate"]')
    assert.equal(h.require('.two-factor-codes').textContent, 'isolated-recovery')
    await h.click('[data-factor-saved]')
    assert.equal(h.query('.two-factor-codes'), null)
    assert.ok(calls.filter(url => url.endsWith('/status')).length >= 2)
  }, { fetch: async url => {
    calls.push(url)
    return { ok: true, status: 200, json: async () => url.includes('csrf') ? { csrfToken: 'test-token' }
      : url.endsWith('/status') ? { available: true, enabled: true, canDisable: false, recoveryCodesRemaining: 8 }
        : { recoveryCodes: ['isolated-recovery'] } }
  } })
})

it('退出登录通过已有接口和 CSRF 校验，接口失败不伪装成功', async () => {
  const { logoutSession } = await import('../frontend/src/auth-client.ts')
  const calls = []
  await logoutSession(async (url, init) => {
    calls.push({ url, init })
    return { ok: true, status: 200, json: async () => ({ csrfToken: 'test-token' }) }
  })
  assert.deepEqual(calls.map(c => c.url), ['/api/security/csrf-token', '/api/auth/logout'])
  assert.equal(calls[1].init.headers['X-CSRF-Token'], 'test-token')
  assert.equal(calls[1].init.method, 'POST')
  await assert.rejects(logoutSession(async () => ({ ok: false, status: 500, json: async () => ({}) })), /退出失败/)
})
