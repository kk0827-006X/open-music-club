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
  it('只渲染登录所需内容，不提前显示业务导航或播放器', async () => {
    const { createLoginMarkup } = await import(frontendModule('login-page.ts'))
    const markup = createLoginMarkup()

    assert.match(markup, /<form[^>]*data-login-form/)
    assert.match(markup, /type="email"/)
    assert.match(markup, /type="password"/)
    assert.match(markup, /申请访问/)
    assert.match(markup, /AUTHENTICATION PROTOCOL/)
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
})
