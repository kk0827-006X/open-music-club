const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { withReactHarness } = require('./helpers/reactHarness')

function frontendModule(relativePath) {
  return `${pathToFileURL(path.resolve(__dirname, '../frontend/src', relativePath)).href}?test=${Date.now()}-${Math.random()}`
}

const FETCH_OK = { ok: true, status: 200, async json() { return {} } }

describe('弹幕墙数据适配与纯函数', () => {
  it('trackRefOf 还原歌曲标识与时长，非法 key 返回 null', async () => {
    const { trackRefOf } = await import(frontendModule('features/danmaku/DanmakuPage.tsx'))
    assert.deepEqual(trackRefOf({ key: 'local:8', title: '热梗神曲', artist: '梗王', duration: '4:00' }), {
      source: 'local', sourceId: '8', title: '热梗神曲', artist: '梗王', durationMs: 240000,
    })
    assert.equal(trackRefOf({ key: 'netease:song:11', title: '云歌曲', artist: '云歌手', duration: '1:02:03' }).durationMs, 3723000)
    assert.equal(trackRefOf({ key: 'weird', title: 'x', artist: 'y', duration: '3:00' }), null)
    assert.equal(trackRefOf(null), null)
  })

  it('dueMessages 按时间戳触发，拖动进度超过 5 秒静默跳过', async () => {
    const { dueMessages } = await import(frontendModule('services/music/danmaku.ts'))
    const messages = [
      { id: 1, positionMs: 83000 }, { id: 2, positionMs: 84500 }, { id: 3, positionMs: 180000 },
    ]
    assert.deepEqual(dueMessages(messages, 82000, 83000).map((m) => m.id), [1])
    assert.deepEqual(dueMessages(messages, 83000, 84500).map((m) => m.id), [2])
    assert.deepEqual(dueMessages(messages, 80000, 180000), [], '一次跳过 5 秒以上视为拖动进度，不刷屏')
    assert.deepEqual(dueMessages(messages, 90000, 50000), [], '回退进度也不触发旧弹幕')
    assert.deepEqual(dueMessages(messages, Number.NaN, 83000), [])
  })

  it('屏蔽词解析与匹配忽略大小写，空词不参与', async () => {
    const { parseBlocklist, matchesBlocklist, formatPosition } = await import(frontendModule('services/music/danmaku.ts'))
    assert.deepEqual(parseBlocklist('广告, 剧透\nSPOLIER，'), ['广告', '剧透', 'spolier'])
    assert.equal(matchesBlocklist('这个广告真多', ['广告']), true)
    assert.equal(matchesBlocklist('这段吉他绝了', ['广告']), false)
    assert.equal(matchesBlocklist('anything', []), false)
    assert.equal(formatPosition(83000), '1:23')
    assert.equal(formatPosition(-5), '0:00')
  })

  it('客户端 GET 拉时间轴，POST 带 CSRF 与完整进度载荷，错误按状态码脱敏', async () => {
    const { createDanmakuClient, DanmakuError } = await import(frontendModule('services/music/danmaku.ts'))
    const requests = []
    const client = createDanmakuClient(async (url, options = {}) => {
      requests.push({ url: String(url), method: options.method || 'GET', headers: options.headers || {}, body: options.body })
      if (String(url).includes('csrf-token')) {
        return { ok: true, status: 200, async json() { return { csrfToken: 'token-1' } } }
      }
      if (String(url).includes('/danmaku') && options.method === 'POST') {
        return { ok: false, status: 429, async json() { return { message: 'rate limited' } } }
      }
      return { ok: true, status: 200, async json() { return { messages: [], total: 0 } } }
    })
    const page = await client.list('local', '8', 0)
    assert.equal(page.total, 0)
    const got = requests[0]
    assert.match(got.url, /\/api\/me\/danmaku\?source=local&sourceId=8&afterId=0&limit=500/)
    assert.equal(got.method, 'GET')
    assert.equal(got.headers['X-CSRF-Token'], undefined, 'GET 请求不取 CSRF')

    await client.recent(5)
    const recent = requests.find((entry) => entry.url.includes('/danmaku/recent'))
    assert.match(recent.url, /\/api\/me\/danmaku\/recent\?afterId=5&limit=30/, '全站实时流走独立接口')
    assert.equal(recent.method, 'GET')

    await client.send({ source: 'local', sourceId: '8', title: '热梗神曲', artist: '梗王', durationMs: 240000 }, '高能预警！', 83000).catch((error) => {
      assert.ok(error instanceof DanmakuError)
      assert.equal(error.status, 429)
      assert.doesNotMatch(error.message, /rate limited/)
      assert.match(error.message, /发送太快/)
    })
    const post = requests.find((entry) => entry.method === 'POST')
    assert.equal(post.headers['X-CSRF-Token'], 'token-1')
    const payload = JSON.parse(post.body)
    assert.deepEqual(payload.track, { source: 'local', sourceId: '8', title: '热梗神曲', artist: '梗王' })
    assert.equal(payload.positionMs, 83000)
    assert.equal(payload.durationMs, 240000)
  })
})

const TRACK = {
  key: 'local:8', kind: 'song', source: 'local', sourceId: '8',
  title: '热梗神曲', artist: '梗王', album: '梗专辑', coverUrl: '', duration: '4:00',
}

const MESSAGES = [
  { id: 1, source: 'local', sourceId: '8', userId: 2, nickname: '老歌友', content: '前奏一响拾起回忆', positionMs: 5000, createdAt: '2026-11-04 08:00:00' },
  { id: 2, source: 'local', sourceId: '8', userId: 2, nickname: '老歌友', content: '高能预警！', positionMs: 83000, createdAt: '2026-11-04 08:01:00' },
  { id: 3, source: 'local', sourceId: '8', userId: 3, nickname: '梗王本王', content: '中间这段广告太出戏', positionMs: 120000, createdAt: '2026-11-04 08:02:00' },
]

const FEED = [
  { id: 10, source: 'netease', sourceId: '42', userId: 4, nickname: '云中君', content: '全站第一条热梗', positionMs: 3000, createdAt: '2026-11-04 10:00:00', trackTitle: '云上的歌', trackArtist: '云端歌手' },
  { id: 11, source: 'local', sourceId: '8', userId: 2, nickname: '老歌友', content: '高能预警！', positionMs: 83000, createdAt: '2026-11-04 10:01:00', trackTitle: '热梗神曲', trackArtist: '梗王' },
]

function fakePlayer(initial = {}) {
  const listeners = new Set()
  let state = { track: TRACK, currentTime: 80, duration: 240, paused: false, volume: .62, error: null, ...initial }
  return {
    get: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    set(patch) {
      state = { ...state, ...patch }
      for (const listener of listeners) listener()
    },
  }
}

function client(overrides = {}) {
  return {
    list: async (_source, _sourceId, afterId) => ({ messages: afterId ? [] : MESSAGES, total: MESSAGES.length }),
    recent: async (afterId) => ({ messages: afterId ? [] : FEED, total: FEED.length }),
    send: async (track, content, positionMs) => ({
      id: 99, source: track.source, sourceId: track.sourceId, userId: 1, nickname: '我自己',
      content, positionMs, createdAt: '2026-11-04 09:00:00', mine: true,
    }),
    remove: async () => true,
    ...overrides,
  }
}

async function mount(h, api, player, props = {}) {
  const { DanmakuPage } = await import(frontendModule('features/danmaku/DanmakuPage.tsx'))
  await h.render(h.React.createElement(DanmakuPage, { active: true, client: api, player, ...props }))
}

describe('弹幕墙 React 页面', () => {
  it('首屏跟随真实播放器：歌名、进度与时间轴弹幕就位', async () => {
    await withReactHarness(async (h) => {
      await mount(h, client(), fakePlayer())
      assert.match(h.require('[data-danmaku-track-label]').textContent, /热梗神曲/)
      assert.match(h.require('[data-danmaku-track-label]').textContent, /梗王/)
      assert.equal(h.require('[data-danmaku-total]').textContent, '3')
      assert.equal(h.require('[data-danmaku-clock]').textContent, '1:20')
      assert.equal(h.require('[data-danmaku-stage]').style.opacity, '0.9')
      const items = h.document.querySelectorAll('[data-danmaku-item]')
      assert.equal(items.length, 3)
      assert.match(items[0].textContent, /前奏一响拾起回忆/)
      assert.match(h.require('[data-danmaku-send]').textContent, /发射/)
      assert.doesNotMatch(h.document.body.innerHTML, /undefined/)
    })
  })

  it('全站实时流侧栏：不播放歌曲也有内容，屏蔽词同步生效', async () => {
    await withReactHarness(async (h) => {
      const { DanmakuPage } = await import(frontendModule('features/danmaku/DanmakuPage.tsx'))
      await h.render(h.React.createElement(DanmakuPage, { active: true, client: client() }))
      await h.until(() => h.document.querySelectorAll('[data-danmaku-feed-item]').length === 2)
      assert.match(h.require('[data-danmaku-feed-total]').textContent, /2/)
      const items = () => [...h.document.querySelectorAll('[data-danmaku-feed-item]')]
      assert.ok(items().some((node) => node.textContent.includes('云上的歌')), '弹幕标注来源歌曲')
      assert.ok(items().some((node) => node.textContent.includes('全站第一条热梗')))
      assert.match(h.require('[data-danmaku-track-label]').textContent, /播放器|弹幕/)
      await h.input('[data-danmaku-blocklist]', '热梗')
      assert.ok(!items().some((node) => node.textContent.includes('全站第一条热梗')), '屏蔽词同时作用于实时流')
      assert.ok(items().some((node) => node.textContent.includes('高能预警！')))
    })
  })

  it('进度推进到弹幕时间戳时准时飘出，拖动进度不刷屏', async () => {
    await withReactHarness(async (h) => {
      const player = fakePlayer()
      await mount(h, client(), player)
      // 载入时播放头(1:20)已经越过的弹幕不回放，只飘「之后经过」的。
      assert.equal(h.document.querySelectorAll('[data-danmaku-flight]').length, 0)

      player.set({ currentTime: 83.2 })
      await h.flush()
      const flights = () => [...h.document.querySelectorAll('[data-danmaku-flight]')]
      assert.ok(flights().some((node) => node.textContent.includes('高能预警！')), '1:23 的弹幕准时出现')

      player.set({ currentTime: 200 }) // 一次跳过近 2 分钟 = 拖动进度
      await h.flush()
      assert.ok(!flights().some((node) => node.textContent.includes('出戏')), '拖动进度不触发 2:00 的弹幕')
    })
  })

  it('发送弹幕把当前进度写进载荷，成功后立刻起飞并进入时间轴', async () => {
    await withReactHarness(async (h) => {
      const sent = []
      const api = client({ send: async (track, content, positionMs) => { sent.push({ track, content, positionMs }); return { id: 99, source: 'local', sourceId: '8', userId: 1, nickname: '我自己', content, positionMs, createdAt: '', mine: true } } })
      await mount(h, api, fakePlayer())
      await h.input('[data-danmaku-input]', '来了来了！')
      await h.click('[data-danmaku-send]')
      assert.equal(sent.length, 1)
      assert.equal(sent[0].positionMs, 80000, '发送时刻的播放进度被记录')
      assert.equal(sent[0].track.sourceId, '8')
      assert.match(h.require('[data-danmaku-flight]').textContent, /我自己：来了来了！/)
      assert.equal(h.require('[data-danmaku-total]').textContent, '4')
      const items = [...h.document.querySelectorAll('[data-danmaku-item]')]
      assert.ok(items.some((node) => node.textContent.includes('来了来了！')), '新弹幕按进度插入时间轴')
      assert.equal(h.require('[data-danmaku-input]').value, '')
    })
  })

  it('屏蔽关键词让时间轴隐藏对应弹幕，并提示隐藏数量', async () => {
    await withReactHarness(async (h) => {
      await mount(h, client(), fakePlayer())
      assert.ok([...h.document.querySelectorAll('[data-danmaku-item]')].some((node) => node.textContent.includes('广告')))
      await h.input('[data-danmaku-blocklist]', '广告')
      assert.match(h.require('[data-danmaku-block-hint]').textContent, /隐藏 1 条/)
      assert.ok(![...h.document.querySelectorAll('[data-danmaku-item]')].some((node) => node.textContent.includes('广告')))
      assert.ok([...h.document.querySelectorAll('[data-danmaku-item]')].some((node) => node.textContent.includes('高能预警！')))
    })
  })

  it('关闭弹幕后舞台透明度为 0，进度推进也不再飘出新弹幕', async () => {
    await withReactHarness(async (h) => {
      const player = fakePlayer()
      await mount(h, client(), player)
      await h.click('[data-danmaku-toggle]')
      assert.equal(h.require('[data-danmaku-toggle]').getAttribute('aria-pressed'), 'false')
      assert.match(h.require('[data-danmaku-toggle]').textContent, /已关闭/)
      assert.equal(h.require('[data-danmaku-stage]').style.opacity, '0')
      const before = h.document.querySelectorAll('[data-danmaku-flight]').length
      player.set({ currentTime: 83.2 })
      await h.flush()
      assert.equal(h.document.querySelectorAll('[data-danmaku-flight]').length, before, '关闭后不再起飞新弹幕')
      // 时间轴列表不受开关影响，仍然可读。
      assert.match(h.require('[data-danmaku-item]').textContent, /前奏一响/)
    })
  })

  it('切歌后旧歌的迟到响应不会覆盖新歌的弹幕', async () => {
    let releaseOld
    const TRACK_B = { ...TRACK, key: 'netease:song:42', source: 'netease', sourceId: '42', title: '另一首' }
    const api = client({
      list: async (_source, sourceId, afterId) => {
        if (sourceId === '8' && !afterId) {
          return new Promise((resolve) => { releaseOld = () => resolve({ messages: MESSAGES, total: MESSAGES.length }) })
        }
        return { messages: [{ id: 50, source: 'netease', sourceId: '42', userId: 4, nickname: '新歌友', content: '新歌第一句就封神', positionMs: 3000, createdAt: '' }], total: 1 }
      },
    })
    await withReactHarness(async (h) => {
      const player = fakePlayer()
      await mount(h, api, player)
      player.set({ track: TRACK_B })
      await h.flush()
      assert.match(h.require('[data-danmaku-track-label]').textContent, /另一首/)
      await h.until(() => [...h.document.querySelectorAll('[data-danmaku-item]')].some((node) => node.textContent.includes('新歌第一句')))
      releaseOld() // 旧歌的迟到响应
      await h.flush()
      const items = [...h.document.querySelectorAll('[data-danmaku-item]')]
      assert.equal(items.length, 1)
      assert.match(items[0].textContent, /新歌第一句/)
      assert.ok(!items.some((node) => node.textContent.includes('前奏一响')))
    })
  })
})
