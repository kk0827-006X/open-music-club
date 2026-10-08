const assert = require('node:assert/strict')
const { it } = require('node:test')

it('设置仅展示左右分栏 UI，复用关闭图标，不保存或应用播放器偏好', async () => {
  const { createSettingsMarkup, settingsSectionMarkup } = await import('../frontend/src/settings-dialog.ts')
  const { uiIcons } = await import('../frontend/src/ui-icons.ts')
  const html = createSettingsMarkup()
  assert.match(html, /<dialog/)
  assert.ok(html.includes(uiIcons.close))
  for (const name of ['账号与安全', '播放偏好', '外观与动效', '上传偏好', '数据与关于']) assert.ok(html.includes(name))
  assert.match(settingsSectionMarkup('appearance', false), /仅展示/)
  assert.match(settingsSectionMarkup('playback', false), /disabled/)
  assert.match(settingsSectionMarkup('account', true), /data-settings-logout>/)
  assert.match(settingsSectionMarkup('account', false), /data-settings-logout disabled/)
  const source = require('node:fs').readFileSync('frontend/src/settings-dialog.ts', 'utf8')
  assert.doesNotMatch(source, /localStorage|audio\.volume|setQuality|playerAutoHide|playerPinned/)
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
