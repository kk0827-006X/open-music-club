const assert = require('node:assert/strict')
const path = require('node:path')
const { describe, it } = require('node:test')
const { pathToFileURL } = require('node:url')

const projectRoot = path.resolve(__dirname, '..')

function frontendModule(relativePath) {
  const modulePath = path.join(projectRoot, 'frontend/src', relativePath)
  return `${pathToFileURL(modulePath).href}?test=${Date.now()}-${Math.random()}`
}

describe('静态登录页面', () => {
  it('登录页显示音乐库原版 Logo，直接复用相同定位和字形样式', async () => {
    const { createLoginMarkup } = await import(frontendModule('login-page.ts'))
    const { createAlbumArchiveMarkup } = await import(frontendModule('album-archive.ts'))
    const loginHeader = createLoginMarkup().match(/<header class="archive-brand">([\s\S]*?)<\/header>/)
    const libraryHeader = createAlbumArchiveMarkup().match(/<header class="archive-brand">([\s\S]*?)<\/header>/)
    assert.ok(loginHeader, '登录页必须显示与音乐库同一 CSS 类的 Logo')
    assert.equal(loginHeader[1], libraryHeader[1].replace(/<small>[\s\S]*?<\/small>/, ''))
  })
  it('两步验证使用默认关闭的独立弹窗，不占用密码表单下方的可见空间', async () => {
    const { createLoginMarkup } = await import(frontendModule('login-page.ts'))
    const markup = createLoginMarkup()
    assert.match(markup, /<dialog[^>]*data-login-factor-dialog/)
    assert.doesNotMatch(markup, /<dialog[^>]*\bopen(?:\s|=|>)/)
    assert.match(markup, /data-login-factor-close/)
    const main = markup.match(/<main[\s\S]*?<\/main>/)[0]
    assert.doesNotMatch(main, /class="authenticator-panel"/)
    assert.match(main, /data-login-factor-spacer[^>]*aria-hidden="true"/)
  })
  it('只渲染登录所需内容，不提前显示业务导航或播放器', async () => {
    const { createLoginMarkup } = await import(frontendModule('login-page.ts'))
    const markup = createLoginMarkup()

    assert.match(markup, /<form[^>]*data-login-form/)
    assert.match(markup, /type="email"/)
    assert.match(markup, /type="password"/)
    assert.match(markup, /AUTHENTICATOR \/ 两步验证/)
    assert.match(markup, /login-layout-spacer/)
    assert.doesNotMatch(markup, /申请访问|忘记密码|AUTHENTICATION PROTOCOL|system-status|access-footer/)
    assert.doesNotMatch(markup, /data-business-navigation/)
    assert.doesNotMatch(markup, /data-global-player/)
  })

  it('按时间采样入场动画，并为减少动态效果直接返回最终状态', async () => {
    const { sampleLoginMotion } = await import(
      frontendModule('login-motion.ts')
    )

    const start = sampleLoginMotion(0, false)
    const middle = sampleLoginMotion(700, false)
    const end = sampleLoginMotion(1800, false)
    const reduced = sampleLoginMotion(0, true)

    assert.equal(start.brand, 0)
    assert.equal(start.panel, 0)
    assert.ok(middle.brand > 0 && middle.brand <= 1)
    assert.ok(middle.panel > 0 && middle.panel < 1)
    assert.equal(end.brand, 1)
    assert.equal(end.panel, 1)
    assert.equal(end.status, 1)
    assert.deepEqual(reduced, {
      brand: 1,
      panel: 1,
      protocol: 1,
      status: 1,
      orbit: 0,
      pulse: 1,
    })
  })

  it('生成可供 SVG 圆弧使用的稳定路径', async () => {
    const { describeArc } = await import(frontendModule('login-motion.ts'))

    assert.equal(
      describeArc(100, 100, 40, -90, 90),
      'M 100 60 A 40 40 0 0 1 100 140',
    )
  })

  it('密码框提供真实眼睛图标及可识别的保持登录复选框', async () => {
    const { createLoginMarkup, passwordEyeMarkup } = await import(frontendModule('login-page.ts'))
    const markup = createLoginMarkup()
    assert.match(markup, /data-remember-me/)
    assert.match(markup, /aria-pressed="false"/)
    assert.match(passwordEyeMarkup(false), /<svg/)
    assert.notEqual(passwordEyeMarkup(false), passwordEyeMarkup(true))
    assert.doesNotMatch(markup, />◉<\/button>/)
  })
})
