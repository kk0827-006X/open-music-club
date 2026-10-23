const assert = require('node:assert/strict')
const { it } = require('node:test')
const { withReactHarness } = require('./helpers/reactHarness')

const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const event = { id: 1, source: 'local', sourceId: '8', trackKey: 'local:8', title: '<img src=x onerror=alert(1)>', artist: '隔离歌手', album: '测试专辑', coverUrl: 'javascript:alert(1)', durationMs: 65000, playedAt: '2026-10-22T20:00:00.000Z', note: null }
const post = { id: 4, cardId: 9, authorId: 2, authorNickname: '隔离成员', caption: '<script>test</script>', createdAt: event.playedAt, likeCount: 0, commentCount: 0, liked: false }
const card = { id: 9, title: '十月回忆', eventIds: [1], data: { period: { from: event.playedAt, to: event.playedAt }, trackCount: 1, totalDurationMs: 65000, tracks: [event], notes: [], highlight: null }, createdAt: event.playedAt }
function client(overrides = {}) {
  return { timeline: async () => ({ total: 0, events: [], timezoneOffsetMinutes: 480 }), milestone: async () => null,
    cards: async () => ({ total: 0, cards: [] }), myPosts: async () => [], posts: async () => ({ total: 0, posts: [] }),
    post: async () => ({ post, card, comments: [], canDelete: true, viewerId: 2 }), saveNote: async () => {}, deleteNote: async () => {},
    createCard: async () => card, deleteCard: async () => {}, publish: async () => 4, setLiked: async () => 1,
    comments: async () => [], addComment: async () => {}, deleteComment: async () => {}, deletePost: async () => {}, ...overrides }
}

it('足迹客户端写请求携带同源凭据和 CSRF，状态错误不泄漏上游内容', async () => {
  const { createFootprintClient, FootprintError } = await import('../frontend/src/services/music/footprint.ts')
  const requests = []
  const api = createFootprintClient(async (url, init) => { requests.push({ url, init }); return response(url.includes('csrf-token') ? { csrfToken: 'isolated-token' } : {}) })
  await api.saveNote(7, '隔离随笔')
  assert.equal(requests[1].url, '/api/footprint/events/7/note')
  assert.equal(requests[1].init.credentials, 'same-origin')
  assert.equal(requests[1].init.headers['X-CSRF-Token'], 'isolated-token')
  assert.deepEqual(JSON.parse(requests[1].init.body), { content: '隔离随笔' })
  const controller = new AbortController()
  await api.comments(4, 50, 50, controller.signal)
  assert.equal(requests[2].url, '/api/footprint/posts/4/comments?limit=50&offset=50')
  assert.equal(requests[2].init.signal, controller.signal)
  await assert.rejects(createFootprintClient(async () => response({ message: '/private/database' }, 403)).timeline(), error => error instanceof FootprintError && error.status === 403 && !error.message.includes('/private'))
})

it('足迹客户端取消令牌请求后不会发出写请求，取消仍为 AbortError', async () => {
  const { createFootprintClient } = await import('../frontend/src/services/music/footprint.ts')
  const controller = new AbortController()
  let calls = 0
  const api = createFootprintClient(async (url, init) => {
    calls++
    assert.equal(init.signal, controller.signal)
    controller.abort()
    throw new DOMException('cancelled', 'AbortError')
  })
  await assert.rejects(api.saveNote(1, 'x', controller.signal), { name: 'AbortError' })
  assert.equal(calls, 1)
})

it('React 足迹空态和全部分页入口可用，隐藏会取消请求，迟到时光轴不能覆盖里程', async () => {
  let resolveTimeline, signal
  const api = client({ timeline: (limit, offset, requestSignal) => { signal = requestSignal; return new Promise(resolve => { resolveTimeline = resolve }) } })
  await withReactHarness(async h => {
    const { default: FootprintPage } = await import('../frontend/src/features/footprint/FootprintPage.tsx')
    await h.render(h.React.createElement(FootprintPage, { active: true, client: api }))
    await h.click('[data-fp-tab="milestone"]')
    assert.equal(signal.aborted, true)
    resolveTimeline({ total: 1, events: [event] })
    await h.flush()
    assert.equal(h.query('[data-fp-play]'), null)
    assert.match(h.require('[data-fp-content]').textContent, /还没有听歌里程/)
    await h.click('[data-fp-tab="square"]')
    assert.match(h.require('[data-fp-content]').textContent, /还没有分享/)
    await h.click('[data-fp-tab="mine"]')
    assert.match(h.require('[data-fp-content]').textContent, /还没有分享/)
    await h.render(h.React.createElement(FootprintPage, { active: false, client: api }))
    assert.equal(h.require('[data-footprint-page]').hasAttribute('inert'), true)
  })
})

it('React 足迹保留来源、站点日期、播放队列和随笔 CRUD，文本不会成为 HTML', async () => {
  let note = null
  const saves = [], deletes = [], plays = [], queues = []
  const api = client({ timeline: async () => ({ total: 1, events: [{ ...event, note }], timezoneOffsetMinutes: 480 }),
    saveNote: async (id, content) => { saves.push([id, content]); note = { id: 1, content, updatedAt: event.playedAt } },
    deleteNote: async id => { deletes.push(id); note = null } })
  await withReactHarness(async h => {
    const { default: FootprintPage } = await import('../frontend/src/features/footprint/FootprintPage.tsx')
    await h.render(h.React.createElement(FootprintPage, { active: true, client: api, play: async song => plays.push(song), enqueue: song => queues.push(song) }))
    assert.match(h.require('[data-fp-content]').textContent, /2026年10月23日/)
    assert.equal(h.query('[data-fp-content] img[onerror]'), null)
    assert.equal(h.require('.fp-entry-card img').getAttribute('src'), '/images/album-placeholder-01.svg')
    await h.click('[data-fp-play]')
    await h.click('[data-fp-enqueue]')
    assert.equal(plays[0].source, 'local')
    assert.equal(queues[0].key, 'local:8')
    await h.click('[data-fp-note-edit="1"]')
    await h.input('[name="note"]', '听见 <b>晚风</b>')
    await h.submit('[data-fp-note-form]')
    assert.deepEqual(saves, [[1, '听见 <b>晚风</b>']])
    assert.equal(h.query('.fp-note b'), null)
    await h.click('[data-fp-note-delete="1"]')
    assert.deepEqual(deletes, [1])
  })
})

it('React 足迹分享详情点赞和评论保留草稿，删除确认 Modal 可取消且公开打开状态', async () => {
  const writes = [], comments = [], deleted = []
  let liked = false
  const api = client({ posts: async () => ({ total: 1, posts: [{ ...post, liked }] }),
    post: async () => ({ post: { ...post, liked }, card, comments: [], canDelete: true }),
    setLiked: async (id, value) => { liked = value; writes.push([id, value]); return 1 },
    addComment: async (id, value) => { comments.push([id, value]) }, deletePost: async id => deleted.push(id) })
  await withReactHarness(async h => {
    const { default: FootprintPage } = await import('../frontend/src/features/footprint/FootprintPage.tsx')
    const ref = h.React.createRef()
    await h.render(h.React.createElement(FootprintPage, { active: true, client: api, ref }))
    await h.click('[data-fp-tab="square"]')
    await h.click('[data-fp-open-post="4"]')
    await h.input('[name="content"]', '待发评论')
    await h.click('[data-fp-like]')
    assert.deepEqual(writes, [[4, true]])
    assert.equal(h.require('[name="content"]').value, '待发评论')
    await h.submit('[data-fp-comment-form]')
    assert.deepEqual(comments, [[4, '待发评论']])
    await h.click('[data-fp-delete-post]')
    assert.equal(ref.current.hasOpenDialog, true)
    assert.equal(h.require('[data-fp-dialog]').open, true)
    await h.click('[data-fp-dialog-cancel]')
    assert.equal(ref.current.hasOpenDialog, false)
    assert.deepEqual(deleted, [])
    assert.equal(h.query('[data-fp-content] script'), null)
  })
})

it('React 卡片工坊最多选择十二条、生成预览，分享使用共享 Modal', async () => {
  const created = [], published = []
  const api = client({ timeline: async limit => { assert.ok(limit <= 50, '工坊不能超过后端时间轴读取上限'); return { total: 13, events: Array.from({ length: 13 }, (_, index) => ({ ...event, id: index + 1 })) } },
    createCard: async (title, ids) => { created.push([title, ids]); return card }, publish: async (id, caption) => { published.push([id, caption]); return 4 } })
  await withReactHarness(async h => {
    const { default: FootprintPage } = await import('../frontend/src/features/footprint/FootprintPage.tsx')
    await h.render(h.React.createElement(FootprintPage, { active: true, client: api }))
    await h.click('[data-fp-tab="studio"]')
    for (let id = 1; id <= 12; id++) await h.click(`[data-fp-pick="${id}"]`)
    assert.equal(h.require('[data-fp-pick="13"]').disabled, true)
    await h.click('[data-fp-generate]')
    assert.equal(created[0][1].length, 12)
    assert.ok(h.query('.fp-card-preview svg'))
    await h.click('[data-fp-share]')
    await h.input('[name="caption"]', '十月的声音')
    await h.submit('[data-fp-dialog-form]')
    assert.deepEqual(published, [[9, '十月的声音']])
  })
})

it('React 足迹详情快进快退时取消请求，旧详情不会覆盖新详情', async () => {
  const pending = new Map()
  const api = client({ posts: async () => ({ total: 2, posts: [post, { ...post, id: 5 }] }),
    post: (id, signal) => new Promise(resolve => { pending.set(id, { resolve, signal }) }) })
  await withReactHarness(async h => {
    const { default: FootprintPage } = await import('../frontend/src/features/footprint/FootprintPage.tsx')
    await h.render(h.React.createElement(FootprintPage, { active: true, client: api }))
    await h.click('[data-fp-tab="square"]')
    await h.click('[data-fp-open-post="4"]')
    await h.click('[data-fp-back]')
    assert.equal(pending.get(4).signal.aborted, true)
    await h.click('[data-fp-open-post="5"]')
    pending.get(5).resolve({ post: { ...post, id: 5, caption: '最新详情' }, card, comments: [], canDelete: false })
    await h.flush()
    pending.get(4).resolve({ post: { ...post, caption: '过时详情' }, card, comments: [], canDelete: false })
    await h.flush()
    assert.match(h.require('[data-fp-content]').textContent, /最新详情/)
    assert.doesNotMatch(h.require('[data-fp-content]').textContent, /过时详情/)
  })
})

it('React 足迹评论提交同步去重，失败保留草稿并显示错误', async () => {
  let rejectComment, writes = 0
  const api = client({ posts: async () => ({ total: 1, posts: [post] }), addComment: () => { writes++; return new Promise((resolve, reject) => { rejectComment = reject }) } })
  await withReactHarness(async h => {
    const { default: FootprintPage } = await import('../frontend/src/features/footprint/FootprintPage.tsx')
    await h.render(h.React.createElement(FootprintPage, { active: true, client: api }))
    await h.click('[data-fp-tab="square"]')
    await h.click('[data-fp-open-post="4"]')
    await h.input('[name="content"]', '请保留草稿')
    await h.submit('[data-fp-comment-form]')
    await h.submit('[data-fp-comment-form]')
    assert.equal(writes, 1)
    assert.equal(h.require('[data-fp-comment-form] button').disabled, true)
    rejectComment(new Error('隔离测试保存失败'))
    await h.flush()
    assert.equal(h.require('[name="content"]').value, '请保留草稿')
    assert.match(h.require('[data-fp-feedback]').textContent, /隔离测试保存失败/)
    assert.equal(h.require('[data-fp-comment-form] button').disabled, false)
  })
})

it('React 足迹广场翻页按 ID 去重，revision 和重新显示都会重新读取首屏', async () => {
  const calls = []
  const api = client({ posts: async (limit, offset) => { calls.push(offset); return { total: 2, posts: offset ? [post, { ...post, id: 5 }] : [post] } } })
  await withReactHarness(async h => {
    const { default: FootprintPage } = await import('../frontend/src/features/footprint/FootprintPage.tsx')
    const render = (active, revision) => h.render(h.React.createElement(FootprintPage, { active, revision, client: api }))
    await render(true, 0)
    await h.click('[data-fp-tab="square"]')
    await h.click('[data-fp-more]')
    assert.equal(h.document.querySelectorAll('[data-fp-open-post]').length, 2)
    assert.equal(calls.at(-1), 1)
    await render(true, 1)
    assert.equal(calls.at(-1), 0)
    assert.equal(h.document.querySelectorAll('[data-fp-open-post]').length, 1)
    await render(false, 1)
    const hiddenCalls = calls.length
    await render(false, 2)
    assert.equal(calls.length, hiddenCalls)
    await render(true, 2)
    assert.equal(calls.at(-1), 0)
  })
})

it('卡片下载只序列化 React SVG，转义标题并及时撤销临时地址', async () => {
  const created = [], revoked = []
  const oldCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
  const oldRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
  try {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: blob => { created.push(blob); return 'blob:isolated-card' } })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: url => revoked.push(url) })
    await withReactHarness(async h => {
      h.window.HTMLAnchorElement.prototype.click = function () { assert.equal(this.href, 'blob:isolated-card') }
      const { default: FootprintPage } = await import('../frontend/src/features/footprint/FootprintPage.tsx')
      await h.render(h.React.createElement(FootprintPage, { active: true, client: client({ cards: async () => ({ total: 1, cards: [{ ...card, title: '<script>boom</script>' }] }) }) }))
      await h.click('[data-fp-tab="studio"]')
      await h.click('[data-fp-open-card="9"]')
      await h.click('[data-fp-download]')
      assert.equal(created.length, 1)
      assert.deepEqual(revoked, ['blob:isolated-card'])
      assert.equal(h.query('.fp-card-preview script'), null)
    })
  } finally {
    if (oldCreate) Object.defineProperty(URL, 'createObjectURL', oldCreate); else delete URL.createObjectURL
    if (oldRevoke) Object.defineProperty(URL, 'revokeObjectURL', oldRevoke); else delete URL.revokeObjectURL
  }
})

it('SQLite UTC 原串与 ISO 在不同本机时区都按站点偏移显示，偏移范围与后端一致', async () => {
  const { dayKey, formatDate, formatClock, siteOffset } = await import('../frontend/src/features/footprint/format.ts')
  const originalTimezone = process.env.TZ
  try {
    // 改变运行环境时区，覆盖浏览器日期解析对本机时区的依赖。
    for (const timezone of ['UTC', 'Asia/Shanghai', 'America/Los_Angeles']) {
      process.env.TZ = timezone
      for (const timestamp of ['2026-10-22 20:00:00', '2026-10-22T20:00:00', '2026-10-22T20:00:00.000Z']) {
        assert.equal(dayKey(timestamp, 480), '2026-10-23', timezone)
        assert.equal(formatDate(timestamp, 480), '2026年10月23日', timezone)
        assert.equal(formatClock(timestamp, 480), '04:00', timezone)
        assert.equal(dayKey(timestamp, -1440), '2026-10-21', timezone)
        assert.equal(formatClock(timestamp, -1440), '20:00', timezone)
      }
      assert.equal(formatClock('2026-10-23T04:00:00+08:00', 480), '04:00')
    }
    assert.equal(siteOffset(1440), 1440)
    assert.equal(siteOffset(-1440), -1440)
    assert.equal(siteOffset(1441), 480)
    assert.equal(siteOffset(1.5), 480)
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ
    else process.env.TZ = originalTimezone
  }
})

it('React 足迹详情分页读取超过五十条评论，末页停止并保留评论草稿', async () => {
  const comments = Array.from({ length: 103 }, (_, index) => ({ id: index + 1, postId: 4, authorId: 2, authorNickname: '隔离成员', content: `第${index + 1}条评论`, createdAt: event.playedAt }))
  const calls = []
  const api = client({ posts: async () => ({ total: 1, posts: [post] }),
    post: async () => ({ post: { ...post, commentCount: comments.length }, card, comments: comments.slice(0, 50), canDelete: false }),
    comments: async (id, limit, offset, signal) => { calls.push([id, limit, offset]); assert.equal(signal.aborted, false); return comments.slice(offset, offset + limit) } })
  await withReactHarness(async h => {
    const { default: FootprintPage } = await import('../frontend/src/features/footprint/FootprintPage.tsx')
    await h.render(h.React.createElement(FootprintPage, { active: true, client: api }))
    await h.click('[data-fp-tab="square"]')
    await h.click('[data-fp-open-post="4"]')
    assert.equal(h.document.querySelectorAll('.fp-comment-list li').length, 50)
    await h.input('[name="content"]', '分页不丢失草稿')
    await h.click('[data-fp-more-comments]')
    assert.equal(h.document.querySelectorAll('.fp-comment-list li').length, 100)
    await h.click('[data-fp-more-comments]')
    assert.equal(h.document.querySelectorAll('.fp-comment-list li').length, 103)
    assert.equal(h.require('[name="content"]').value, '分页不丢失草稿')
    assert.equal(h.query('[data-fp-more-comments]'), null)
    assert.deepEqual(calls, [[4, 50, 50], [4, 50, 100]])
  })
})

it('React 足迹评论分页请求在离开详情时取消，迟到评论不会进入下一条分享', async () => {
  let resolveComments, commentsSignal
  const firstComments = Array.from({ length: 50 }, (_, index) => ({ id: index + 1, postId: 4, authorId: 2, authorNickname: '隔离成员', content: '已加载评论', createdAt: event.playedAt }))
  const api = client({ posts: async () => ({ total: 2, posts: [post, { ...post, id: 5 }] }),
    post: async id => ({ post: { ...post, id, commentCount: id === 4 ? 51 : 0 }, card, comments: id === 4 ? firstComments : [], canDelete: false }),
    comments: (id, limit, offset, signal) => new Promise(resolve => { resolveComments = resolve; commentsSignal = signal }) })
  await withReactHarness(async h => {
    const { default: FootprintPage } = await import('../frontend/src/features/footprint/FootprintPage.tsx')
    await h.render(h.React.createElement(FootprintPage, { active: true, client: api }))
    await h.click('[data-fp-tab="square"]')
    await h.click('[data-fp-open-post="4"]')
    await h.click('[data-fp-more-comments]')
    await h.click('[data-fp-back]')
    assert.equal(commentsSignal.aborted, true)
    await h.click('[data-fp-open-post="5"]')
    resolveComments([{ ...firstComments[0], id: 51, content: '过时分页评论' }])
    await h.flush()
    assert.doesNotMatch(h.require('[data-fp-content]').textContent, /过时分页评论/)
    assert.equal(h.document.querySelectorAll('.fp-comment-list li').length, 0)
  })
})

it('React 足迹详情最多加载五百条评论，接口计数变化也不会继续请求', async () => {
  const comments = Array.from({ length: 501 }, (_, index) => ({ id: index + 1, postId: 4, authorId: 2, authorNickname: '隔离成员', content: '隔离评论', createdAt: event.playedAt }))
  const calls = []
  const api = client({ posts: async () => ({ total: 1, posts: [post] }),
    post: async () => ({ post: { ...post, commentCount: 501 }, card, comments: comments.slice(0, 50), canDelete: false }),
    comments: async (id, limit, offset) => { calls.push([limit, offset]); return comments.slice(offset, offset + limit) } })
  await withReactHarness(async h => {
    const { default: FootprintPage } = await import('../frontend/src/features/footprint/FootprintPage.tsx')
    await h.render(h.React.createElement(FootprintPage, { active: true, client: api }))
    await h.click('[data-fp-tab="square"]')
    await h.click('[data-fp-open-post="4"]')
    for (let page = 1; page < 10; page++) await h.click('[data-fp-more-comments]')
    assert.equal(h.document.querySelectorAll('.fp-comment-list li').length, 500)
    assert.equal(h.query('[data-fp-more-comments]'), null)
    assert.equal(calls.length, 9)
    assert.deepEqual(calls.at(-1), [50, 450])
  })
})

it('播放 revision 更新会等随笔保存结束再读取，不中断正在提交的请求', async () => {
  let resolveSave, saveSignal, note = null, timelineReads = 0
  const saved = []
  const api = client({ timeline: async () => { timelineReads++; return { total: 1, events: [{ ...event, note }], timezoneOffsetMinutes: 480 } },
    saveNote: (id, content, signal) => { saveSignal = signal; return new Promise(resolve => { resolveSave = () => { note = { id: 1, content, updatedAt: event.playedAt }; saved.push([id, content]); resolve() } }) } })
  await withReactHarness(async h => {
    const { default: FootprintPage } = await import('../frontend/src/features/footprint/FootprintPage.tsx')
    const render = revision => h.render(h.React.createElement(FootprintPage, { active: true, revision, client: api }))
    await render(0)
    await h.click('[data-fp-note-edit="1"]')
    await h.input('[name="note"]', '播放中写下的随笔')
    await h.submit('[data-fp-note-form]')
    const readsBeforeRevision = timelineReads
    await render(1)
    await render(2)
    assert.equal(saveSignal.aborted, false)
    assert.equal(timelineReads, readsBeforeRevision)
    resolveSave()
    await h.flush()
    assert.deepEqual(saved, [[1, '播放中写下的随笔']])
    assert.match(h.require('.fp-note').textContent, /播放中写下的随笔/)
    assert.equal(h.query('[data-fp-note-form]'), null)
    assert.ok(timelineReads > readsBeforeRevision)
    assert.equal(h.require('[data-fp-feedback]').dataset.error, 'false')
  })
})
