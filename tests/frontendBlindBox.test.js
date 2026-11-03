const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { withReactHarness } = require('./helpers/reactHarness')

function frontendModule(relativePath) {
  return `${pathToFileURL(path.resolve(__dirname, '../frontend/src', relativePath)).href}?test=${Date.now()}-${Math.random()}`
}

const FETCH_OK = { ok: true, status: 200, async json() { return {} } }

describe('音乐盲盒前端数据适配', () => {
  it('盲盒曲目与搜索页共用播放模型，封面走白名单，时长缺省回退', async () => {
    const { toBlindBoxSong } = await import(frontendModule('services/music/blind-box.ts'))
    const song = toBlindBoxSong({
      key: 'netease:song:11', source: 'netease', sourceId: '11',
      title: '十年', artist: '陈奕迅', album: '黑·白·灰', coverUrl: 'http://p1.music.126.net/cover.jpg',
      durationMs: 205000, duration: '3:25', style: 'pop', styleLabel: '流行',
    })
    assert.equal(song.kind, 'song')
    assert.equal(song.key, 'netease:song:11')
    assert.equal(song.coverUrl, 'https://p1.music.126.net/cover.jpg')
    assert.equal(song.duration, '3:25')
    assert.match(song.description, /流行/)

    const local = toBlindBoxSong({
      key: 'local:7', source: 'local', sourceId: '7', title: '站内歌曲',
      artist: '', album: '', coverUrl: 'javascript:alert(1)',
      durationMs: 0, duration: '', style: 'jazz', styleLabel: '爵士',
    })
    assert.equal(local.artist, '未知艺术家')
    assert.equal(local.album, '未归档')
    assert.match(local.coverUrl, /album-placeholder/)
    assert.equal(local.duration, '0:00')
  })

  it('客户端只发同源会话请求，写操作带 CSRF，错误按状态码脱敏', async () => {
    const { createBlindBoxClient, BlindBoxError } = await import(frontendModule('services/music/blind-box.ts'))
    const requests = []
    const client = createBlindBoxClient(async (url, options = {}) => {
      requests.push({ url, method: options.method || 'GET', headers: options.headers || {} })
      if (String(url).includes('csrf-token')) {
        return { ok: true, status: 200, async json() { return { csrfToken: 'token-1' } } }
      }
      if (String(url).includes('draw')) return { ok: false, status: 409, async json() { return { message: 'x' } } }
      return FETCH_OK
    })
    await client.styles()
    await client.draw('pop', 3).catch((error) => {
      assert.ok(error instanceof BlindBoxError)
      assert.equal(error.status, 409)
      assert.doesNotMatch(error.message, /x/)
      assert.match(error.message, /曲库|抽取/)
    })
    const draw = requests.find((entry) => entry.url.includes('draw'))
    assert.equal(draw.method, 'POST')
    assert.equal(draw.headers['X-CSRF-Token'], 'token-1')
    const styles = requests.find((entry) => entry.url.includes('styles'))
    assert.equal(styles.method, 'GET')
    assert.equal(requests.filter((entry) => entry.url.includes('csrf-token')).length, 1, 'GET 请求不应取 CSRF')
  })
})

const STYLES = {
  styles: [
    { key: 'all', label: '全部', count: 12 },
    { key: 'pop', label: '流行', count: 4 },
    { key: 'jazz', label: '爵士', count: 0 },
  ],
  total: 12,
}

const BOX_TRACK = {
  key: 'local:8', source: 'local', sourceId: '8', title: '<img src=x onerror=alert(1)>',
  artist: '隔离歌手', album: '测试专辑', coverUrl: 'javascript:alert(1)',
  durationMs: 65000, duration: '1:05', style: 'pop', styleLabel: '流行',
}

function box(overrides = {}) {
  return { id: 7, style: 'pop', styleLabel: '流行', trackCount: 1, createdAt: '2026-10-27 12:00:00', favorited: false, tracks: [BOX_TRACK], ...overrides }
}

function client(overrides = {}) {
  return {
    styles: async () => STYLES,
    favorites: async () => ({ boxes: [], total: 0 }),
    ranking: async () => ({ entries: [], styleLabel: '流行', metric: 'favorite' }),
    draw: async () => box(),
    box: async () => box(),
    favorite: async () => box({ favorited: true }),
    unfavorite: async () => box({ favorited: false }),
    ...overrides,
  }
}

async function mount(h, api, props = {}) {
  const { BlindBoxPage } = await import(frontendModule('features/blind-box/BlindBoxPage.tsx'))
  await h.render(h.React.createElement(BlindBoxPage, { active: true, client: api, ...props }))
}

describe('音乐盲盒 React 页面', () => {
  it('首屏风格标签与每箱数量可用，曲库数量来自接口', async () => {
    await withReactHarness(async (h) => {
      await mount(h, client())
      assert.equal(h.query('[data-blind-box-page]').hidden, false)
      // 风格数量在接口返回后覆盖占位符，未拿到数据时不显示 0 误导用户。
      assert.equal(h.require('[data-style-count="pop"]').textContent, '4')
      assert.equal(h.require('[data-style-count="jazz"]').textContent, '0')
      assert.match(h.require('[data-blind-box-pool]').textContent, /曲库 12 首/)
      assert.equal(h.require('[data-blind-box-style="pop"]').getAttribute('aria-pressed'), 'true')
      assert.equal(h.require('[data-blind-box-count="3"]').getAttribute('aria-pressed'), 'true')
      assert.match(h.require('[data-blind-box-hint]').textContent, /当前风格「流行」/)
      assert.ok(h.require('[data-blind-box-draw]'))
      assert.ok(h.require('[data-blind-box-tab="ranking"]'))
      assert.doesNotMatch(h.document.body.innerHTML, /undefined/)
    })
  })

  it('收藏与榜单空态有可读文案，SSR 首屏不渲染抽取结果', async () => {
    await withReactHarness(async (h) => {
      await mount(h, client())
      assert.match(h.require('[data-blind-box-panel-body]').textContent, /还没有收藏的盲盒/)
      assert.equal(h.query('[data-blind-box-card]'), null)
      await h.click('[data-blind-box-tab="ranking"]')
      assert.match(h.require('[data-blind-box-panel-body]').textContent, /榜单还没有数据/)
      assert.equal(h.require('[data-blind-box-metric-bar]').hidden, false)
    })
  })

  it('抽取后渲染卡片并转义标题，收藏按钮切换为已收藏', async () => {
    await withReactHarness(async (h) => {
      await mount(h, client())
      await h.click('[data-blind-box-draw]')
      assert.ok(h.require('[data-blind-box-result]'))
      const card = h.require('[data-blind-box-card="local:8"]')
      // 标题里的标签只能作为文本出现，不能变成真实节点。
      assert.match(card.textContent, /<img src=x onerror=alert\(1\)>/)
      assert.equal(card.querySelectorAll('img[src="x"]').length, 0)
      assert.match(h.require('[data-blind-box-save]').textContent, /收藏这个盲盒/)
      await h.click('[data-blind-box-save]')
      assert.equal(h.require('[data-blind-box-save]').getAttribute('aria-pressed'), 'true')
      assert.match(h.require('[data-blind-box-save]').textContent, /已收藏/)
    })
  })

  it('抽取失败显示脱敏文案，并给出上传入口而不是上游报错', async () => {
    await withReactHarness(async (h) => {
      let navigated = false
      await mount(h, client({ draw: async () => { throw new Error('曲库里还没有可以抽取的歌曲') } }), { onNavigateUpload: () => { navigated = true } })
      await h.click('[data-blind-box-draw]')
      const hint = h.require('[data-blind-box-hint]').textContent
      assert.match(hint, /曲库/)
      assert.doesNotMatch(hint, /sqlite|\/data\/|Error:/)
      await h.click('[data-blind-box-upload]')
      assert.equal(navigated, true)
    })
  })

  it('迟到的旧榜单响应不会覆盖当前筛选的榜单', async () => {
    let releaseOld
    const api = client({
      ranking: async (metric, style) => {
        if (style !== 'pop') {
          return { entries: [{ rank: 1, key: 'netease:song:2', source: 'netease', sourceId: '2', title: '爵士歌', artist: '爵士歌手', coverUrl: null, style: 'jazz', styleLabel: '爵士', drawCount: 5, favoriteCount: 4 }], styleLabel: '爵士', metric }
        }
        return new Promise((resolve) => {
          releaseOld = () => resolve({ entries: [{ rank: 1, key: 'netease:song:1', source: 'netease', sourceId: '1', title: '旧流行歌', artist: '流行歌手', coverUrl: null, style: 'pop', styleLabel: '流行', drawCount: 9, favoriteCount: 9 }], styleLabel: '流行', metric })
        })
      },
    })
    await withReactHarness(async (h) => {
      await mount(h, api)
      await h.click('[data-blind-box-tab="ranking"]')   // 流行榜单请求在途
      await h.click('[data-blind-box-style="jazz"]')    // 切到爵士，立即返回
      assert.match(h.require('[data-blind-box-panel-body]').textContent, /爵士歌/)
      releaseOld()                                      // 迟到的流行结果
      await h.flush()
      assert.match(h.require('[data-blind-box-panel-body]').textContent, /爵士歌/)
      assert.doesNotMatch(h.require('[data-blind-box-panel-body]').textContent, /旧流行歌/)
    })
  })

  it('后台榜单失败不会覆盖已切回的收藏列表与状态文案', async () => {
    let failRanking
    const api = client({
      favorites: async () => ({ boxes: [{ id: 42, style: 'pop', styleLabel: '流行', trackCount: 5, createdAt: '2026-10-27 12:00:00', favoritedAt: '2026-10-27 12:24:00', covers: [], titles: ['晚风心里吹'] }], total: 1 }),
      ranking: () => new Promise((_resolve, reject) => { failRanking = () => reject(new Error('榜单读取失败')) }),
    })
    await withReactHarness(async (h) => {
      await mount(h, api)
      await h.click('[data-blind-box-tab="ranking"]')   // 榜单请求在途
      await h.click('[data-blind-box-tab="favorites"]') // 切回收藏
      failRanking()                                     // 迟到的失败
      await h.flush()
      assert.match(h.require('[data-blind-box-panel-body]').textContent, /晚风心里吹/)
      assert.doesNotMatch(h.require('[data-blind-box-status]').textContent, /榜单/)
    })
  })
})
