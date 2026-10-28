const assert = require('node:assert/strict')
const { it } = require('node:test')
const { withReactHarness } = require('./helpers/reactHarness')

const makeList = (id, coverUrl) => ({ id, name: `歌单 ${id}`, description: null, trackCount: 2, coverUrl, createdAt: '', updatedAt: '' })

it('用户页首次列出所有封面，不读取任何歌单详情；刷新后首曲封面和空歌单同步更新', async () => {
  await withReactHarness(async h => {
    let lists = [makeList(1, '/api/local/music/1/cover'), makeList(2, 'http://p.music.126.net/first.jpg'), makeList(3, null)]
    let detailCalls = 0
    const client = {
      profile: async () => ({ id: 1, nickname: '隔离成员', avatarUrl: null }),
      playlists: async () => lists,
      playlist: async id => { detailCalls++; return { playlist: lists.find(list => list.id === id), tracks: [] } },
    }
    const { UserPage } = await import('../frontend/src/features/user/UserPage.tsx')
    const ref = h.React.createRef()
    await h.render(h.React.createElement(UserPage, { active: true, ref, client }))
    await h.until(() => h.query('[data-user-list="1"]') && !h.require('[data-user-list="1"]').disabled, '首屏列表可操作')
    assert.equal(h.require('[data-user-list="1"] img').getAttribute('src'), '/api/local/music/1/cover')
    assert.equal(h.require('[data-user-list="2"] img').getAttribute('src'), 'https://p.music.126.net/first.jpg')
    assert.equal(h.require('[data-user-list="3"] img').getAttribute('src'), '/images/album-placeholder-01.svg')
    assert.equal(detailCalls, 0)
    lists = [makeList(1, null), makeList(2, 'https://p.music.126.net/updated.jpg'), makeList(3, 'javascript:alert(1)')]
    await h.React.act(async () => { await ref.current.refresh() })
    assert.equal(h.require('[data-user-list="1"] img').getAttribute('src'), '/images/album-placeholder-01.svg')
    assert.equal(h.require('[data-user-list="2"] img').getAttribute('src'), 'https://p.music.126.net/updated.jpg')
    assert.equal(h.require('[data-user-list="3"] img').getAttribute('src'), '/images/album-placeholder-01.svg')
    assert.equal(detailCalls, 0)
    await h.click('[data-user-list="2"]')
    await h.until(() => detailCalls === 1, '点击才加载歌单详情')
  })
})

it('封面加载失败降级为默认图，保留可访问的卡片按钮和新建入口', async () => {
  await withReactHarness(async h => {
    const { PlaylistCardDeck } = await import('../frontend/src/features/user/PlaylistCardDeck.tsx')
    const opens = [], creates = []
    await h.render(h.React.createElement(PlaylistCardDeck, {
      lists: [makeList(1, 'https://p.music.126.net/missing.jpg')], disabled: false,
      onOpen: id => opens.push(id), onCreate: () => creates.push(true),
    }))
    const image = h.require('[data-user-list="1"] img')
    await h.React.act(async () => image.dispatchEvent(new h.window.Event('error')))
    assert.equal(image.getAttribute('src'), '/images/album-placeholder-01.svg')
    assert.equal(h.require('[data-user-list="1"]').getAttribute('aria-label'), '打开歌单：歌单 1')
    await h.click('[data-user-list="1"]')
    await h.click('[data-user-create]')
    assert.deepEqual(opens, [1])
    assert.equal(creates.length, 1)
    await h.render(h.React.createElement(PlaylistCardDeck, { lists: [makeList(1, null)], disabled: true, onOpen: id => opens.push(id), onCreate: () => {} }))
    assert.equal(h.require('[data-user-list="1"]').disabled, true)
    await h.React.act(async () => h.require('[data-user-list="1"]').click())
    assert.deepEqual(opens, [1])
  })
})


it('超过三张歌单全部同页渲染，刷新新增不重建旧卡片，旧卡片可置顶超过二十张的堆叠', async () => {
  await withReactHarness(async h => {
    let lists = Array.from({ length: 25 }, (_, index) => makeList(index + 1, null))
    const client = {
      profile: async () => ({ id: 1, nickname: '隔离成员', avatarUrl: null }),
      playlists: async () => lists,
    }
    const { UserPage } = await import('../frontend/src/features/user/UserPage.tsx')
    const ref = h.React.createRef()
    await h.render(h.React.createElement(UserPage, { active: true, ref, client }))
    assert.equal(h.document.querySelectorAll('[data-user-list]').length, 25)
    assert.equal(h.query('[data-user-page-step]'), null, '总览不显示任何分页按钮')
    const fourth = h.require('[data-user-list="4"]').closest('[data-draggable-card]')
    assert.notEqual(fourth.style.left, '', '挂载后必须写入随机位置')
    assert.notEqual(fourth.style.top, '', '挂载后必须写入随机位置')
    const position = [fourth.style.left, fourth.style.top, fourth.style.transform]
    lists = [makeList(26, null), ...lists]
    await h.React.act(async () => { await ref.current.refresh() })
    assert.equal(h.document.querySelectorAll('[data-user-list]').length, 26)
    assert.equal(h.require('[data-user-list="4"]').closest('[data-draggable-card]'), fourth)
    assert.deepEqual([fourth.style.left, fourth.style.top, fourth.style.transform], position)
    await h.React.act(async () => h.require('[data-user-list="1"]').focus())
    assert.equal(h.require('[data-user-list="1"]').closest('[data-draggable-card]').style.zIndex, '27')
  })
})
