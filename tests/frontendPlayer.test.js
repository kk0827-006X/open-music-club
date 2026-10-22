const { readFrontendSource } = require('./helpers/frontendSource')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { describe, it } = require('node:test')
const { pathToFileURL } = require('node:url')
const { withReactHarness } = require('./helpers/reactHarness')

const projectRoot = path.resolve(__dirname, '..')

const withPlayerHarness = withReactHarness
const frontendModule = name => pathToFileURL(path.join(projectRoot, 'frontend/src', name)).href
const load = name => import(frontendModule(name))

const song = (id, source = 'local', overrides = {}) => ({
  key: `${source}:${id}`,
  source,
  sourceId: String(id),
  kind: 'song',
  title: `歌曲 ${id}`,
  artist: '歌手',
  album: '专辑',
  coverUrl: '/images/album-placeholder-01.svg',
  duration: '1:00',
  year: '2024',
  description: '',
  ...overrides,
})

// 生产播放器必须使用注入的假音频，测试中不创建真实 Audio。
function createFakeAudio(harness) {
  class FakeAudio extends harness.window.EventTarget {
    paused = true
    currentTime = 0
    duration = NaN
    volume = 1
    src = ''
    preload = ''
    plays = 0
    loads = 0
    play() {
      this.paused = false
      this.plays++
      this.dispatchEvent(new harness.window.Event('play'))
      return Promise.resolve()
    }
    pause() {
      if (this.paused) return
      this.paused = true
      this.dispatchEvent(new harness.window.Event('pause'))
    }
    removeAttribute(name) { if (name === 'src') this.src = '' }
    load() { this.loads++ }
  }
  return new FakeAudio()
}

function stubPersonalLibrary(overrides = {}) {
  return {
    // 本文件只验证播放器；队列恢复保持 pending，避免改写显式注入的队列。
    queue: () => new Promise(() => {}),
    saveQueue: async () => {},
    isLiked: async () => false,
    setLiked: async () => {},
    playlists: async () => [],
    addTrack: async () => {},
    ...overrides,
  }
}

async function setupPlayer(harness, tracks = []) {
  const { MusicQueue } = await load('features/queue/model.ts')
  const { createPlayerController } = await load('features/player/player-core.ts')
  const queue = new MusicQueue()
  queue.restore(tracks)
  const audio = createFakeAudio(harness)
  let created = 0
  const player = createPlayerController({
    queue,
    resolveUrl: async track => `/media/${track.source}/${track.sourceId}`,
    createAudio: () => { created++; return audio },
  })
  return { queue, audio, player, created: () => created }
}

async function renderPlayer(harness, { player, queue, personalLibrary, defaultTrack }) {
  const { PlayerView } = await load('features/player/PlayerView.tsx')
  const view = harness.React.createRef()
  const root = harness.React.createRef()
  root.current = harness.query('#app')
  const expanded = []
  const collection = []
  await harness.render(harness.React.createElement(PlayerView, {
    ref: view,
    player,
    queue,
    personalLibrary: personalLibrary || stubPersonalLibrary(),
    selectedAlbum: {
      title: '测试专辑',
      artist: '测试歌手',
      coverUrl: '/images/album-placeholder-01.svg',
      tracks: [{ title: '预览曲目', duration: '3:00' }],
    },
    defaultTrack: defaultTrack || song(99),
    onExpandedChanged: open => expanded.push(open),
    collectionChanged: () => collection.push(1),
    root,
  }))
  return { view, expanded, collection }
}

describe('底部播放器与歌词画面（真实 React 组件）', () => {
  it('按时间解析多时间戳歌词，忽略元信息与空行', async () => {
    const { parseLyrics, currentLyricIndex } = await load('player-lyrics.ts')
    const lines = parseLyrics('[ar:歌手]\n[00:01.20][00:03.50]第一句\n[00:07.00]第二句\n[00:09.00]')
    assert.deepEqual(lines, [
      { time: 1.2, text: '第一句' },
      { time: 3.5, text: '第一句' },
      { time: 7, text: '第二句' },
    ])
    assert.equal(currentLyricIndex(lines, 0), -1)
    assert.equal(currentLyricIndex(lines, 4), 1)
    assert.equal(currentLyricIndex(lines, 9), 2)
  })

  it('网易云歌词仅使用现有白名单与同源会话，本地歌曲不请求网易云', async () => {
    const { loadTrackLyrics } = await load('player-lyrics.ts')
    const calls = []
    const fetcher = async (url, options) => {
      calls.push({ url, options })
      return { ok: true, json: async () => ({ lrc: { lyric: '[00:01.00]测试歌词' } }) }
    }
    assert.deepEqual(await loadTrackLyrics({ source: 'netease', sourceId: '123' }, fetcher), [
      { time: 1, text: '测试歌词' },
    ])
    assert.equal(calls[0].url, '/api/netease/lyric?id=123')
    assert.equal(calls[0].options.credentials, 'same-origin')
    assert.deepEqual(await loadTrackLyrics({ source: 'local', sourceId: '123' }, fetcher), [])
    assert.equal(calls.length, 1)
  })

  it('没有歌词或接口失败时返回空列表，不暴露上游错误', async () => {
    const { loadTrackLyrics } = await load('player-lyrics.ts')
    assert.deepEqual(await loadTrackLyrics({ source: 'netease', sourceId: '1' }, async () => ({
      ok: false, json: async () => ({ message: '内部错误' }),
    })), [])
    assert.deepEqual(await loadTrackLyrics({ source: 'netease', sourceId: '0' }, async () => {
      throw new Error('不应请求非法 ID')
    }), [])
  })

  it('指针靠近底部或焦点进入时显示播放器，离开后自动隐藏', async () => {
    await withPlayerHarness(async harness => {
      const act = harness.React.act
      const { player, queue } = await setupPlayer(harness)
      await renderPlayer(harness, { player, queue })
      try {
        const footer = harness.require('[data-global-player]')
        assert.equal(footer.classList.contains('is-visible'), false)

        await act(async () => {
          harness.document.body.dispatchEvent(new harness.window.MouseEvent('pointermove', {
            bubbles: true, clientY: harness.window.innerHeight - 5,
          }))
        })
        await harness.flush()
        assert.ok(footer.classList.contains('is-visible'), '靠近视口底部应显示播放器')

        // 指针离开底部后开始 320ms 自动隐藏计时；使用真实计时，不伪造 CSS 过渡。
        await act(async () => {
          harness.document.body.dispatchEvent(new harness.window.MouseEvent('pointermove', {
            bubbles: true, clientY: 10,
          }))
        })
        await harness.wait(360)
        assert.equal(footer.classList.contains('is-visible'), false)

        await act(async () => {
          const toggle = harness.require('[data-player-queue-toggle]')
          toggle.focus()
          toggle.dispatchEvent(new harness.window.FocusEvent('focusin', { bubbles: true }))
        })
        await harness.flush()
        assert.ok(footer.classList.contains('is-visible'), '焦点进入播放器应重新显示')
      } finally {
        player.destroy()
      }
    })
  })

  it('真实播放器渲染预览、单一注入 Audio，并保留播放/暂停/上下首/进度/音量/收藏行为', async () => {
    await withPlayerHarness(async harness => {
      const act = harness.React.act
      const first = song(1, 'local', { title: '第一首' })
      const second = song(2, 'netease', { title: '第二首' })
      const { player, queue, audio, created } = await setupPlayer(harness, [first, second])
      let liked = true
      const setLikedCalls = []
      const personalLibrary = stubPersonalLibrary({
        isLiked: async () => liked,
        setLiked: async (track, value) => { setLikedCalls.push([track.key, value]); liked = value },
      })
      await player.play(first)
      const { collection } = await renderPlayer(harness, { player, queue, personalLibrary, defaultTrack: first })
      try {
        assert.equal(created(), 1, '整棵播放器只能使用注入的一个 Audio')
        assert.equal(audio.preload, 'none')
        assert.equal(harness.require('[data-player-track] strong').textContent, '第一首')
        assert.match(harness.require('[data-player-track] b').textContent, /LOCAL/)
        assert.equal(harness.require('[data-queue-count]').textContent, '02')
        assert.ok(harness.require('[data-player-queue-panel]'))
        assert.ok(harness.require('[data-player-expanded]'))
        assert.ok(harness.require('[data-player-lyrics]'))
        assert.ok(harness.require('[data-player-hotspot]'))
        assert.equal(harness.require('[data-player-toggle]').getAttribute('aria-label'), '暂停')

        // 收藏按钮先读取真实状态；点击后写入一次并同步图标与 aria-pressed。
        await harness.until(() => harness.require('[data-player-like]').disabled === false
          && harness.require('[data-player-like]').getAttribute('aria-pressed') === 'true')
        await harness.click('[data-player-like]')
        await harness.until(() => setLikedCalls.length === 1 && harness.require('[data-player-like]').getAttribute('aria-pressed') === 'false')
        assert.deepEqual(setLikedCalls, [['local:1', false]])
        assert.equal(collection.length, 1)
        assert.equal(harness.require('[data-player-like] [data-ui-icon="heart"]').dataset.filled, 'false')
        assert.equal(harness.require('[data-collection-feedback]').textContent, '已取消喜爱')

        // 播放/暂停、下一首、上一首都通过原控制器更新真实状态。
        await harness.click('[data-player-toggle]')
        await harness.until(() => audio.paused === true)
        assert.equal(harness.require('[data-player-toggle]').getAttribute('aria-label'), '播放')
        await harness.click('[data-player-toggle]')
        await harness.until(() => audio.paused === false)
        assert.equal(harness.require('[data-player-toggle]').getAttribute('aria-label'), '暂停')

        await harness.click('[data-player-next]')
        await harness.until(() => audio.src === '/media/netease/2')
        assert.equal(harness.require('[data-player-track] strong').textContent, '第二首')
        assert.match(harness.require('[data-player-track] b').textContent, /NETEASE/)
        await harness.click('[data-player-previous]')
        await harness.until(() => audio.src === '/media/local/1')
        assert.equal(harness.require('[data-player-track] strong').textContent, '第一首')

        // 进度条宽度来自真实元素边界；点击中点应 seek 到一半。
        const bar = harness.require('[data-player-progress-bar]')
        bar.getBoundingClientRect = () => ({ left: 0, right: 200, width: 200, top: 0, bottom: 10, height: 10, x: 0, y: 0, toJSON() {} })
        audio.duration = 100
        await act(async () => { audio.dispatchEvent(new harness.window.Event('loadedmetadata')) })
        await harness.flush()
        assert.equal(harness.require('[data-player-progress-bar]').disabled, false)
        await act(async () => {
          bar.dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true, cancelable: true, clientX: 50 }))
        })
        await harness.flush()
        assert.equal(audio.currentTime, 25)
        assert.equal(harness.require('[data-player-progress] time').textContent, '0:25')

        // 共享 Radix 音量滑杆仍把 0..1 值交给 PlayerController 的同一个 Audio。
        const thumb = harness.require('[data-player-volume-input]')
        assert.equal(thumb.getAttribute('aria-label'), '音量')
        await act(async () => {
          thumb.dispatchEvent(new harness.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
        })
        await harness.flush()
        assert.ok(Math.abs(audio.volume - 0.63) < 1e-9, `音量应由 62% 增到 63%，实际 ${audio.volume}`)
        assert.equal(harness.require('.player-volume-slider').style.getPropertyValue('--volume-percent'), '63%')

        // 卸载只清理视图，不销毁注入的播放器。
        await harness.unmount()
        assert.equal(audio.loads, 0)
        assert.equal(created(), 1)
        assert.equal(player.get().track.key, 'local:1')
      } finally {
        player.destroy()
      }
    })
  })

  it('展开层显示真实歌词并转义文本，减少动态效果时即时滚动，卸载中止请求', async () => {
    let lyricSignal
    const fetcher = async (url, options = {}) => {
      if (url.startsWith('/api/netease/lyric')) {
        lyricSignal = options.signal
        return { ok: true, json: async () => ({ lrc: { lyric: '[00:01.00]第一句\n[00:03.50]<img onerror="alert(1)">' } }) }
      }
      throw new Error(`测试未声明网络请求：${url}`)
    }
    await withPlayerHarness(async harness => {
      const act = harness.React.act
      const track = song(123, 'netease', {
        title: '<img src=x onerror="alert(1)">',
        artist: '<script>坏歌手</script>',
      })
      const { player, queue, audio } = await setupPlayer(harness, [track])
      await player.play(track)
      const scrollCalls = []
      const prototype = harness.window.HTMLElement.prototype
      const originalScroll = prototype.scrollIntoView
      prototype.scrollIntoView = function (options) { scrollCalls.push(options) }
      const { view } = await renderPlayer(harness, {
        player,
        queue,
        personalLibrary: stubPersonalLibrary(),
        defaultTrack: track,
      })
      try {
        const lyrics = harness.require('[data-player-lyrics]')
        await harness.until(() => lyrics.querySelectorAll('p').length === 2, '真实歌词请求后应渲染两行歌词')
        assert.equal(lyrics.querySelectorAll('img').length, 0, '歌词文本不能被解析成 HTML')
        assert.equal(harness.require('[data-player-track] strong').textContent, track.title)
        assert.match(harness.require('[data-player-track] span').textContent, /坏歌手/)
        assert.equal(harness.document.querySelectorAll('img[onerror]').length, 0)

        await harness.click('[data-player-open]')
        const expanded = harness.require('[data-player-expanded]')
        assert.ok(expanded.classList.contains('is-open'))
        assert.equal(expanded.getAttribute('aria-hidden'), 'false')
        assert.equal(harness.document.activeElement, harness.require('[data-player-close]'))
        assert.equal(lyrics.querySelectorAll('p')[1].textContent, '<img onerror="alert(1)">')

        // 减少动态效果（harness 默认 matchMedia 命中）下当前行应瞬时居中，而不是平滑滚动。
        audio.currentTime = 4
        await act(async () => { audio.dispatchEvent(new harness.window.Event('timeupdate')) })
        await harness.flush()
        assert.ok(lyrics.querySelectorAll('p')[1].classList.contains('is-current'))
        assert.ok(scrollCalls.some(options => options?.behavior === 'instant' && options?.block === 'center'))

        await harness.click('[data-player-close]')
        assert.equal(expanded.classList.contains('is-open'), false)
        assert.equal(expanded.getAttribute('aria-hidden'), 'true')

        // restoreFocus 为真时收起后焦点回到“展开歌词”。
        await act(async () => { view.current.setExpanded(true) })
        await harness.flush()
        await act(async () => { view.current.setExpanded(false, true) })
        await harness.flush()
        assert.equal(harness.document.activeElement, harness.require('[data-player-open]'))

        await harness.unmount()
        assert.equal(lyricSignal.aborted, true, '卸载必须中止未完成的歌词请求')
        assert.equal(audio.loads, 0)
      } finally {
        prototype.scrollIntoView = originalScroll
        player.destroy()
      }
    }, { fetch: fetcher })
  })

  it('展开层继续使用底部上推的 shell 样式与减少动态效果规则', () => {
    const css = readFrontendSource(path.join(projectRoot, 'frontend/src/style.css'))
    assert.match(css, /\.global-player:not\(\.is-visible\)/)
    assert.match(css, /\.player-volume-slider\b/)
    assert.match(css, /\.player-volume-slider-track\s*\{[^}]*height: 2px/)
    assert.match(css, /\.player-volume-slider-range\s*\{[^}]*background: var\(--amber\)/)
    assert.match(css, /\.player-expanded\s*\{[^}]*inset: 0 0 106px[^}]*visibility: hidden/)
    assert.match(css, /\.player-expanded::before\s*\{[^}]*transform-origin: (?:center bottom|bottom center)[^}]*transform: scaleY\(0\)[^}]*transition: transform (?:7|8|9)\d\dms/)
    assert.match(css, /\.player-expanded\.is-open::before\s*\{[^}]*transform: scaleY\(1\)/)
    assert.match(css, /\.player-expanded-header,\s*\.player-expanded-content\s*\{[^}]*opacity: 0[^}]*transform: translateY\(/)
    assert.match(css, /\.player-expanded\.is-open \.player-expanded-header,\s*\.player-expanded\.is-open \.player-expanded-content\s*\{[^}]*opacity: 1/)
    assert.match(css, /\.player-expanded\s*\{[^}]*inset: 0 0 76px/)
    assert.match(css, /\.player-expanded\.is-open ~ \.global-player\s*\{[^}]*backdrop-filter: none/)
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.player-expanded[^{]*\{[^}]*transition: none/)
  })
})
