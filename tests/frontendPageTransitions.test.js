const assert = require('node:assert/strict')
const fs = require('node:fs')
const { it } = require('node:test')
const { withReactHarness } = require('./helpers/reactHarness')

it('足迹复用用户页的淡出时序，等待新数据再淡入，失败也能恢复交互', async () => {
  await withReactHarness(async h => {
    h.window.matchMedia = query => ({ media: query, matches: false, addEventListener() {}, removeEventListener() {} })
    let rejectMilestone
    const api = { timeline: async () => ({ events: [], total: 0 }), milestone: () => new Promise((_, reject) => { rejectMilestone = reject }) }
    const { FootprintPage } = await import('../frontend/src/features/footprint/FootprintPage.tsx')
    await h.render(h.React.createElement(FootprintPage, { active: true, client: api }))
    await h.click('[data-fp-tab="milestone"]')
    assert.equal(h.require('.fp-header h2').textContent, '音乐足迹时光轴')
    assert.ok(h.require('[data-fp-content]').classList.contains('is-changing'))
    await h.until(() => rejectMilestone, '淡出后才请求新分类')
    assert.equal(h.require('.fp-header h2').textContent, '我的听歌里程')
    assert.ok(h.require('[data-fp-content]').hasAttribute('inert'))
    await h.React.act(async () => rejectMilestone(new Error('隔离失败')))
    await h.until(() => !h.require('[data-fp-content]').hasAttribute('inert'), '失败也不能卡在不可见状态')
    assert.match(h.require('[data-fp-feedback]').textContent, /隔离失败/)
  })
})

it('离开足迹取消待切换动作，不在隐藏后切换分类；重新进入保留原页', async () => {
  await withReactHarness(async h => {
    h.window.matchMedia = query => ({ media: query, matches: false, addEventListener() {}, removeEventListener() {} })
    let calls = 0
    const api = { timeline: async () => ({ events: [], total: 0 }), milestone: async () => { calls++; return null } }
    const { FootprintPage } = await import('../frontend/src/features/footprint/FootprintPage.tsx')
    const render = active => h.render(h.React.createElement(FootprintPage, { active, client: api }))
    await render(true)
    await h.click('[data-fp-tab="milestone"]')
    await render(false)
    await h.wait(210)
    assert.equal(calls, 0)
    await render(true)
    assert.equal(h.require('.fp-header h2').textContent, '音乐足迹时光轴')
    assert.equal(h.require('[data-fp-content]').hasAttribute('inert'), false)
  })
})

it('用户页与足迹引用同一过渡实现及主题背景，不保留第二份切换计时器', () => {
  for (const file of ['user/UserPage.tsx', 'footprint/FootprintPage.tsx']) {
    const text = fs.readFileSync(`frontend/src/features/${file}`, 'utf8')
    assert.match(text, /usePageMotion\(active\)/)
    assert.match(text, /useSectionTransition\(active\)/)
    assert.doesNotMatch(text, /tabTimerRef/)
  }
  const css = fs.readFileSync('frontend/src/styles/member-sidebar.css', 'utf8')
  assert.match(css, /\.user-page, \.footprint-page \{[^}]*background: radial-gradient[^}]*var\(--color-surface-40\)[^}]*var\(--color-surface-22\)[^}]*var\(--color-surface-23\)/)
})
