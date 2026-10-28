const assert = require('node:assert/strict')
const { it } = require('node:test')
const { withReactHarness } = require('./helpers/reactHarness')

const track = title => ({ source: 'local', sourceId: '1', trackKey: 'local:1', title, artists: [], album: { name: null }, durationMs: 1000, playable: true, liked: false })
const client = overrides => ({ profile: async () => ({ id: 1, nickname: '隔离成员', avatarUrl: null }), playlists: async () => [], likes: async () => [], uploads: async () => [], ...overrides })

it('切换中被外部刷新替代后，最新数据仍能结束淡出', async () => {
  await withReactHarness(async h => {
    const pending = []
    const api = client({ likes: () => new Promise(resolve => pending.push(resolve)) })
    const { UserPage } = await import('../frontend/src/features/user/UserPage.tsx')
    const ref = h.React.createRef()
    await h.render(h.React.createElement(UserPage, { ref, active: true, client: api }))
    await h.click('[data-user-tab="favorites"]')
    await h.until(() => pending.length === 1, '分类请求应开始')
    let refreshed
    await h.React.act(async () => { refreshed = ref.current.refresh() })
    await h.until(() => pending.length === 2, '外部刷新应开始')
    await h.React.act(async () => pending[0]([track('旧数据')]))
    await h.React.act(async () => { pending[1]([track('刷新结果')]); await refreshed })
    assert.equal(h.require('[data-user-content]').classList.contains('is-changing'), false)
    assert.match(h.require('[data-user-content]').textContent, /刷新结果/)
  })
})

it('分类切换先保留旧内容淡出，加载完成才恢复可见，不闪现空列表', async () => {
  await withReactHarness(async h => {
    h.window.matchMedia = query => ({ media: query, matches: false, addEventListener() {}, removeEventListener() {} })
    let resolveLikes
    const api = client({ likes: () => new Promise(resolve => { resolveLikes = resolve }) })
    const { UserPage } = await import('../frontend/src/features/user/UserPage.tsx')
    await h.render(h.React.createElement(UserPage, { active: true, client: api }))
    await h.click('[data-user-tab="favorites"]')
    assert.equal(h.require('[data-user-heading]').textContent, '我的歌单')
    assert.ok(h.require('[data-user-content]').classList.contains('is-changing'))
    await h.until(() => resolveLikes, '淡出后应读取喜爱')
    assert.equal(h.require('[data-user-heading]').textContent, '我的喜爱')
    assert.ok(h.require('[data-user-content]').classList.contains('is-changing'), '网络等待期间不能提前淡入空列表')
    assert.ok(h.require('[data-user-content]').hasAttribute('inert'))
    await h.React.act(async () => resolveLikes([track('喜爱的歌')]))
    await h.until(() => !h.require('[data-user-content]').classList.contains('is-changing'), '数据就绪后应淡入')
    assert.match(h.require('[data-user-content]').textContent, /喜爱的歌/)
    assert.equal(h.require('[data-user-content]').hasAttribute('inert'), false)
  })
})

it('连续切换时旧分类的迟到响应不能提前结束新分类的淡出', async () => {
  await withReactHarness(async h => {
    let resolveLikes, resolveUploads
    const api = client({ likes: () => new Promise(resolve => { resolveLikes = resolve }), uploads: () => new Promise(resolve => { resolveUploads = resolve }) })
    const { UserPage } = await import('../frontend/src/features/user/UserPage.tsx')
    await h.render(h.React.createElement(UserPage, { active: true, client: api }))
    await h.click('[data-user-tab="favorites"]')
    await h.until(() => resolveLikes, '应开始读取喜爱')
    await h.click('[data-user-tab="uploads"]')
    await h.until(() => resolveUploads, '应开始读取上传')
    await h.React.act(async () => resolveLikes([track('过期喜爱')]))
    await h.flush()
    assert.ok(h.require('[data-user-content]').classList.contains('is-changing'))
    await h.React.act(async () => resolveUploads([track('我的上传歌曲')]))
    await h.until(() => !h.require('[data-user-content]').classList.contains('is-changing'), '最后选择应完成淡入')
    assert.match(h.require('[data-user-content]').textContent, /我的上传歌曲/)
    assert.doesNotMatch(h.require('[data-user-content]').textContent, /过期喜爱/)
  })
})


it('进入和返回歌单复用先淡出再淡入，网络等待期间不闪现空歌曲列表', async () => {
  await withReactHarness(async h => {
    h.window.matchMedia = query => ({ media: query, matches: false, addEventListener() {}, removeEventListener() {} })
    const list = { id: 1, name: '过渡歌单', trackCount: 1, coverUrl: null }
    let resolveDetail, resolveLists
    let returning = false
    const api = client({
      playlists: async () => returning ? new Promise(resolve => { resolveLists = resolve }) : [list],
      playlist: () => new Promise(resolve => { resolveDetail = resolve }),
    })
    const { UserPage } = await import('../frontend/src/features/user/UserPage.tsx')
    await h.render(h.React.createElement(UserPage, { active: true, client: api }))
    await h.click('[data-user-list="1"]')
    assert.ok(h.query('[data-user-list="1"]'), '淡出时仍保留原卡片')
    assert.equal(resolveDetail, undefined, '淡出完成前不读取详情')
    assert.ok(h.require('[data-user-content]').hasAttribute('inert'))
    await h.until(() => resolveDetail, '淡出结束后请求详情')
    assert.ok(h.require('[data-user-content]').classList.contains('is-changing'))
    await h.React.act(async () => resolveDetail({ playlist: list, tracks: [track('等待后出现的歌曲')] }))
    await h.until(() => !h.require('[data-user-content]').classList.contains('is-changing'), '数据就绪后淡入')
    assert.match(h.require('[data-user-content]').textContent, /等待后出现的歌曲/)
    assert.equal(h.require('[data-user-content]').hasAttribute('inert'), false)
    returning = true
    await h.click('[data-user-back]')
    assert.match(h.require('[data-user-content]').textContent, /等待后出现的歌曲/, '返回时仍保留详情淡出')
    assert.equal(resolveLists, undefined)
    await h.until(() => resolveLists, '返回淡出完成后刷新列表')
    assert.ok(h.require('[data-user-content]').classList.contains('is-changing'))
    await h.React.act(async () => resolveLists([list]))
    await h.until(() => !h.require('[data-user-content]').classList.contains('is-changing'), '列表就绪后淡入')
    assert.ok(h.query('[data-user-list="1"]'))
  })
})

it('歌单详情读取失败仍结束过渡，减少动态效果时不等待淡出计时', async () => {
  await withReactHarness(async h => {
    const list = { id: 1, name: '失败歌单', trackCount: 0 }
    let detailCalls = 0
    const api = client({ playlists: async () => [list], playlist: async () => { detailCalls++; throw new Error('隔离读取失败') } })
    const { UserPage } = await import('../frontend/src/features/user/UserPage.tsx')
    await h.render(h.React.createElement(UserPage, { active: true, client: api }))
    await h.click('[data-user-list="1"]')
    assert.equal(detailCalls, 1, '减少动态效果时直接发起详情请求')
    assert.equal(h.require('[data-user-content]').classList.contains('is-changing'), false)
    assert.equal(h.require('[data-user-content]').hasAttribute('inert'), false)
    assert.match(h.require('[data-user-feedback]').textContent, /隔离读取失败/)
    await h.click('[data-user-back]')
    assert.ok(h.query('[data-user-list="1"]'))
  })
})

it('歌单淡出期间离开用户页，取消尚未开始的详情请求', async () => {
  await withReactHarness(async h => {
    h.window.matchMedia = query => ({ media: query, matches: false, addEventListener() {}, removeEventListener() {} })
    let detailCalls = 0
    const api = client({ playlists: async () => [{ id: 1, name: '离页歌单', trackCount: 0 }], playlist: async () => { detailCalls++; return null } })
    const { UserPage } = await import('../frontend/src/features/user/UserPage.tsx')
    await h.render(h.React.createElement(UserPage, { active: true, client: api }))
    await h.click('[data-user-list="1"]')
    await h.render(h.React.createElement(UserPage, { active: false, client: api }))
    await h.wait(230)
    assert.equal(detailCalls, 0)
    assert.equal(h.require('[data-user-content]').classList.contains('is-changing'), false)
  })
})
